---
title: "Characters that live in the world"
description: "Avatars and characters in scenes: animations of a character, and characters that walk around on their own."
host:
  who: pinta
  says: "Who is in the scene, how they look, and how they wander about by themselves."
  side: right
---

Everyone who walks around a scene is a **character**: the avatars players choose from, and the characters (NPCs) a scenario places. Both are drawn from their **animations**, by name, and nothing else; they differ in where they live. A scenario's characters are in `characters` and placed by `scenes[].characters`. Avatars belong to the platform, the same in every scenario: the server adds them to the document as `avatars` (above), and a player's choice of avatar (`avatar_media_id` on their account, `avatar` in the room) is an avatar's `id`.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id, name | int, string | | As in the base docs.
animations | object | | The character's animations, by name. See below.
scale | decimal | 1.0 | Display scale of its pictures. Each picture is also stretched by its own media `scale_x` and `scale_y`, so a sheet shared by several characters can be sized once, on the media, and each character sized on top of that.
tts_voice | | | The voice its lines are recorded in, a key of the server's voice catalog. See [Characters' voices](/docs/developers/voices/).
voice_pitch, voice_rate, voice_name | | | How the browser reads its lines that have no recording. See [Reading text aloud](/docs/developers/actions/reading-aloud/).
conditions | array | | Scenario characters only: the character is there only while these hold. One whose conditions stop holding while players are in the scene fades away (a character who leaves for good sets a shared variable it tests). One placed in the scene (not roaming) fades back in where it is placed once they hold again: a character who fell and has been rescued.
media_id, portrait_media_id | int | | *Before animations.* One picture and a close-up. Read only when `animations` is empty (see below).

## Animations of a character

Each animation is a picture of the scenario (for an avatar, of the platform) and how to play it:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | The picture: a still image, an **animated PNG**, or a **sprite sheet** (an image with `sheet`, see [Sprite sheets](/docs/developers/extensions/animations/#sprite-sheets-and-named-animations)). The picture is ordinary media, so one sheet can serve several characters, each taking the frames it needs.
frames | array | every frame | For a sheet or an animated PNG: the frame numbers to show, in order. Frames may repeat.
duration | int | | Milliseconds one pass takes. Default: an animated PNG's own speed (in proportion, for some of its frames), else 100 per frame.
repeat | bool | | Whether it loops. Default: the poses loop, and the built-in moves that loop (`dance`); anything else plays once.
flip | bool | false | Draw it mirrored, so art drawn facing one way serves the other.
sheet_animation | string | | The animation of the picture's this one plays, by name (the picture's `animations`, made on the Media page). The editor copies its `frames`, `duration` and `repeat` here and keeps them in step when it changes, so the game reads only the fields above.

Five names are **poses**, which the game shows by itself:

Name | Shown
---- | -----
`stand_right`, `stand_left` | While the character stands, facing that way.
`walk_right`, `walk_left` | While it walks that way.
`portrait` | Beside what it says in a story box (`dialogue` with `style: "portrait"`), and as its face on the player's own pages.

A pose that is missing is filled in from another, so a single picture makes a whole character. Walking uses `walk_<way>`, else the other walk mirrored, else standing. Standing uses `stand_<way>`, else the other stand mirrored, else the portrait. The portrait is `portrait`, else the character standing facing right. Art is taken to face the way its name says: give a character only `stand_right` and it is mirrored to face left.

Any **other name** (`wave`, `dig`, `talk`...) is played when an [`animate` action](/docs/developers/actions/animate/) or, for an avatar, a player's [move](/docs/developers/extensions/animations/#moves-what-players-can-do-themselves) asks for it. A name that is also a [built-in move](/docs/developers/extensions/animations/#built-in-moves) (`jump`, `dance`...) replaces that move with these frames. Names are lowercase letters, digits and underscores, starting with a letter.

```json
{ "id": 1, "name": "Captain Vega", "scale": 0.85,
  "animations": {
    "stand_right": { "media_id": 109, "frames": [0, 1], "duration": 900 },
    "walk_right": { "media_id": 109, "frames": [6, 7, 8, 9, 10, 11], "duration": 600 },
    "portrait": { "media_id": 110 },
    "wave": { "media_id": 140 }
  } }
```

Here she stands and walks from one sheet (mirrored when facing left), her close-up is a still picture, and she waves with an animated PNG played whole at its own speed.

**Older documents.** A character with no `animations` is read from `media_id` and `portrait_media_id`: the picture is `stand_right` (on a sprite sheet, the sheet's own `idle` is `stand_right`, its `walk`, `walk_right` and `walk_left` are the walks, and its other animations are the character's), and the close-up is `portrait`. An `avatar_media_ids` list is read the same way, each picture an avatar with the picture's id. Nothing has to be rewritten; the editor saves a character as animations the first time it is changed.

**Platform avatars** (Laravel API) are rows of `avatars`. An avatar's `settings.animations` names pictures that are rows of `platform_media` (the platform's own pictures, which several avatars can share); an older row with `image_url` (and a sheet in `settings`) and `portrait_url` is read as one picture and a close-up. `database/seeders/data/avatars.php` gives pictures by address and seeding makes one `platform_media` row per address.

A placement's `event_id` names an indirect event in the same scene that runs when the character is clicked, typically an infobox with what they say.

## Characters that walk around on their own

A character with `roams: true`, or with a `routine`, **lives in the world**. There is one of it per instance (team), kept by the game server like a [unique item](/docs/developers/extensions/items/): every player sees it in the same place, it walks between scenes, and where it was left is saved with the instance (`characters` in [room data](/docs/developers/save-data/#room-data)). It starts at its **first placement**, taking the scenes in order. Placing it in other scenes too does not make copies: it says what clicking it does in that scene (`event_id`). Its `conditions` still decide, for each player, whether it can be seen.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
roams | bool | false | It walks around on its own. Set by itself when it has a routine.
walk_speed | int | `move_speed` | Scene pixels per second when a walk does not say.
routine | object | | What it does on its own (below).

A **routine** is a list of steps the server runs one after another, for everyone, whether or not anyone is watching:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
steps | array | | The steps, in order.
loop | bool | true | Start again from the first step after the last.
conditions | array | | It keeps to its routine only while these hold. When they stop holding it stops where it is, and carries on with the step it was on when they hold again.

Each step is written as the action it is, without an `id` and without saying who does it (it is the character itself): `walk` (any destination above), `wait`, `dialogue` (a bubble over the character; `style`, `speaker` and `character_id` are not used), `animate` (`animation` only) and `variable`. A step may have `conditions` (it is skipped while they do not hold) and `blocking: false` (the next step starts at once: say something while walking).

```json
{ "id": 3, "name": "Robo", "walk_speed": 240,
  "animations": { "stand_right": { "media_id": 50 }, "walk_right": { "media_id": 51 } },
  "routine": {
    "conditions": [{ "variable": "robo_on", "operator": "=", "operand": 1 }],
    "steps": [
      { "type": "walk", "to": "scene", "scene_id": 12, "spawn_point": "console" },
      { "type": "dialogue", "text": "Readings look normal." },
      { "type": "animate", "animation": "wave" },
      { "type": "wait", "duration": 4000 },
      { "type": "variable", "name": "robo_laps", "operator": "+", "operand": 1 },
      { "type": "walk", "to": "scene", "scene_id": 10 }
    ] } }
```

**Only shared variables count.** A routine is nobody's in particular, so conditions on a player's own variables are left out (the validator warns), and a `variable` step can only change a room-scoped variable. To have a character stop and talk, set a shared variable in the event that starts the conversation, and make the routine's conditions test it.

**Walk actions come first.** A player's event can send a roaming character anywhere with a `walk` action. The routine waits until it has arrived, then carries on with its current step (a walk step sets off again from where the character now is). The server takes only walks that an event of the sender's scene contains, no more than four a second per player.

**Media.** A roaming character can turn up in any scene, so its pictures load with the scenario's global media rather than with a scene.
