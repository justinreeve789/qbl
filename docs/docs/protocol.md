# Multiplayer protocol

The client joins a Colyseus room named `scenario`. Rooms are matched on `scenario` and `group`, so players who launch the same scenario with the same group key share a room, whichever scene each of them is in. The types live in `packages/shared/src/protocol.ts`.

## Join options

Option | Description
------ | -----------
scenario | Scenario shortname.
group | Group key. Defaults to `public`.
token | API bearer token. Required.
avatar_media_id | Chosen avatar; must be in the scenario's `avatar_media_ids`.

If the same account joins twice, the earlier connection is closed with code 4103.

## Synchronized state

State the server owns and every client sees (Colyseus schema, `apps/server/src/rooms/state.ts`):

* `players[sessionId]`: `user_id`, `name`, `role`, `avatar`, `scene_id`, `x`, `y`, `facing`, `attachments` (comma-separated item ids), `connected`, `hidden` (an `avatar` action has hidden this player; cleared on every scene change).
* `items[itemId]`: unique items only. `scene_id`, `x`, `y`, `holder` (a session id, or empty).
* `vars[name]`: room-scoped variables, JSON-encoded.

Clients draw the players whose `scene_id` matches their own.

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

## Server to client

Message | Payload | Meaning
------- | ------- | -------
`welcome` | `{session_id, session, chat_mode}` | Sent on join with the save data to start from.
`snap` | `{x, y, scene_id}` | A move was refused; return to this position.
`chat` | `{session_id, text}` |
`emote` | `{session_id, emoji}` |
`notice` | `{code, message}` | Something to tell the player, e.g. an item is taken.

## Trust model

The client predicts its own movement and runs scene events locally, because events are presentation (sounds, pictures, text) and each player experiences them individually. The server decides everything players could otherwise cheat on or disagree about: positions, which scene a player is in, who holds a unique item, shared variable values, and what is saved. Player-scoped variables are reported by the client and are therefore **not tamper-proof**; treat them as progress markers, not as grades.

## Reconnection

A dropped connection keeps its seat for 30 seconds (`QBL_RECONNECT_SECONDS`). The avatar is shown faded to others meanwhile. The SDK reconnects by itself.
