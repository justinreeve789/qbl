---
title: "Multiplayer protocol"
---

The client joins a Colyseus room named `scenario`. Rooms are matched on `scenario` and `group`, so players who launch the same scenario with the same group key share a room, whichever scene each of them is in. The types live in `packages/shared/src/protocol.ts`.

## Join options

Option | Description
------ | -----------
scenario | Scenario shortname.
group | The instance to play in: `public`, an assignment's (`a12`) or a team's (`t7`). Defaults to `public`.
party | The room to join. Rooms are matched on `scenario` and `party`: the teams of one assignment share a room (the assignment's key), so they can meet in scenes that are not limited to a team. Defaults to the group. The backend says which party an instance belongs to (`instance.party` in the play document) and the server refuses any other.
token | API bearer token. Required.
avatar_media_id | Chosen avatar: the `id` of one of the document's `avatars`. If absent, the avatar saved on the account is used.

If the same account joins twice, the earlier connection is closed with code 4103.

## Synchronized state

State the server owns and every client sees (Colyseus schema, `apps/server/src/rooms/state.ts`):

* `players[sessionId]`: `user_id`, `name`, `role`, `avatar`, `scene_id`, `x`, `y`, `facing`, `attachments` (comma-separated item ids), `connected`, `hidden` (an `avatar` action has hidden this player; cleared on every scene change), `anim` (the last animation asked of the avatar, as `name:count`; cleared when the player walks or changes scene), `look` (comma-separated ids of the marketplace items the player has on; the server reads it from the backend, never from the client).
* `items["team|itemId"]`: unique items only, one set per team. `scene_id`, `x`, `y`, `holder` (a session id, or empty).
* `vars["team|name"]`: shared variables, JSON-encoded, one set per team.
* `npcs["team|characterId"]`: [characters that roam](/docs/developers/extensions/#characters-that-walk-around-on-their-own), one set per team. `scene_id`, `x`, `y`, `facing`, `moving` (walking: the walking pose plays), `anim` (the last animation it was asked to play, as `name:count`; cleared when it walks), `line` (the routine line it is saying, as `count:step`, the step's index in its routine, so the client reads the text from the document; empty when it is over), `trip` (the ticket of the player's `walk` it is carrying out, or empty). The server moves them twenty times a second; clients smooth the steps in between, and fade a character in and out as it comes and goes through doors.

`players[...].team` is the instance a player is in. A room holds every instance of its party; each is its own `World` over its own part of `items` and `vars` (keys are prefixed with the team's key), and clients read their own team's part. Clients draw the players whose `scene_id` matches their own, and where the scene is limited to teams (`team_only`, on the scene or its group) only those with the same `team`, (`canSee`). `players[...].team_name` is the team's name ("Comets"), empty for an assignment's or the public instance. Chat, emotes and scene-audience events go to the same players (`World.audience`). `JoinOptions.scene_id` starts a teacher or admin in that scene instead of their saved one (how a teacher switching team arrives where the team is); it is ignored for anyone else.

## Client to server

Message | Payload | Server behaviour
------- | ------- | ----------------
`move` | `{x, y, facing}` | Accepted if the spot is walkable and within the distance the avatar could have covered. Otherwise the server replies `snap`.
`scene` | `{scene_id, spawn_point?}` | Accepted if the scene is a jump target of the current one. The player is placed on the spawn point.
`var` | `{name, operator, operand?}` | Applies a variable action to a room-scoped variable.
`item` | `{item_id, action: "attach" or "detach"}` | Checks reach, uniqueness and the one-vehicle rule.
`emote` | `{emoji}` | Must be in the allowed list; rate limited. Not available when `chat_mode` is `off`.
`chat` | `{text}` | Only when `chat_mode` is `free`. Cleaned, length-limited and rate limited.
`progress` | `{variables, flags, time_elapsed}` | Player-scoped progress to include in the next save.
`avatar` | `{visible}` | An `avatar` action ran: show or hide the sender's avatar for everyone in the scene.
`award` | `{action_id}` | An `award` action ran. The server asks the backend to grant it and replies `progress`. Ignored for guests.
`animate` | `{name}` | Play an animation on the sender's avatar, from a move button or an `animate` action. The name must look like a name; at most four a second. An empty name stops it.
`walk` | `{ticket, character_id, to?, position_x?, position_y?, spawn_point?, scene_id?, speed?, facing?}` | A `walk` action of the sender's event, aimed at a roaming character. Accepted only if an event of the sender's scene (on a button too) has a walk of that character with the same destination, speed and facing, and at most four a second. The character's `trip` carries the ticket until it arrives; the client's action finishes when it changes. Nothing is sent back for a walk that is refused or has no way there: the ticket never appears, and the client gives up after three seconds.
`show` | `{event_id, action_id}` | An event whose `audience` is `scene` reached this action for the sender. Passed on to the other players in the sender's scene if the action belongs to such an event there and is one of the shown types.
`look` | `{}` | The player changed what they wear. The server fetches their look from the backend and updates `players[...].look`.
`whisper` | `{to, text}` | A private message for the player with that session id, anywhere in the room. Only when the scenario's `private_messages` is on. Cleaned and rate limited like chat, delivered to both ends, and logged.
`track` | `{type, ref?, label?, value?}` | Something for the activity log: `hotspot`, `choice`, `objective`, `glossary` or `narration`. The server adds who, where and when; at most five a second.

`emote`, `chat` and `show` reach the players who can see the sender: those in the same scene, and only the sender's team where the scene is limited to teams. Every `emote`, `chat` and `whisper` is written to the message log; joins, leaves, scene changes and awards are written to the activity log by the server itself. Both are handed to the backend in batches every few seconds.

## Server to client

Message | Payload | Meaning
------- | ------- | -------
`welcome` | `{session_id, session, chat_mode, team: {key, name?}, private_messages}` | Sent on join with the save data to start from, the instance the player is in, and whether private messages are allowed.
`whisper` | `{from, to, from_name, to_name, text, at}` | A private message, sent to both ends.
`snap` | `{x, y, scene_id}` | A move was refused; return to this position.
`chat` | `{session_id, text}` |
`emote` | `{session_id, emoji}` |
`notice` | `{code, message}` | Something to tell the player, e.g. an item is taken.
`show` | `{session_id, event_id, action_id}` | Another player's event is showing this action. The client presents it and changes nothing else.
`progress` | `{stars, xp, rank, next_rank_xp, owned, equipped, delta_stars, delta_xp, note?, rank_up?, badge?}` | The result of an award: the player's new totals, what changed, and the badge if one was earned.

## Trust model

The client predicts its own movement and runs scene events locally, because events are presentation (sounds, pictures, text) and each player experiences them individually. The server decides everything players could otherwise cheat on or disagree about: positions, which scene a player is in, who holds a unique item, shared variable values, what is saved, and stars and XP (an award is granted by the backend from the published document, once per player unless it repeats). Player-scoped variables are reported by the client and are therefore **not tamper-proof**; treat them as progress markers, not as grades.

## Reconnection

A dropped connection keeps its seat for 30 seconds (`QBL_RECONNECT_SECONDS`). The avatar is shown faded to others meanwhile. The SDK reconnects by itself.
