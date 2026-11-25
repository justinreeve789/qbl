---
title: "Animations"
description: "Sprite sheets, named animations, built-in moves, the moves players can make and how animations reach other players."
host:
  who: pinta
  says: "Sprite sheets, names that mean something, and moves players can pull off themselves."
  side: right
---

## Sprite sheets and named animations

Any image can be a **sprite sheet**: a grid of equal frames. The media says how the grid is cut, and can name animations made of its frames. Every animation is made here, on the media: an item, a vehicle or an `image_fixed` picture drawn with it plays them by name, and a character's animation names the one it plays (`sheet_animation`, see [Characters](/docs/developers/extensions/characters/)), with its frames copied, so several characters can share one sheet's walk.

Parameter | Type | Description
--------- | ---- | -----------
sheet | object | `{ "columns": 6, "rows": 3 }`: frames across and down. `count` may be added when the last row is not full. Frames are numbered from 0 at the top left, left to right and then down, as on the [Spritemaps](/docs/developers/spritemap/) page.
animations | array | `{ "name", "frames", "duration", "repeat" }`. `frames` are frame numbers in the order they play. `duration` is the milliseconds one pass takes (default 100 per frame). `repeat` says whether it loops (default: by its name, see below).

```json
{ "id": 120, "type": "image", "url": "avatars/sprocket-sheet.png",
  "sheet": { "columns": 6, "rows": 3 },
  "animations": [
    { "name": "idle", "frames": [0, 1], "duration": 900 },
    { "name": "walk", "frames": [6, 7, 8, 9, 10, 11], "duration": 600 },
    { "name": "jump", "frames": [12, 13, 14, 13, 12], "duration": 600, "repeat": false },
    { "name": "dance", "frames": [15, 16, 17, 16], "duration": 700 }
  ] }
```

An **animated PNG** is kept as it is. When one is uploaded the server notes it on the media as `apng: { "frames": 4, "duration": 500, "plays": 0 }` (its frame count, the milliseconds one pass takes, and how many times the file says to play, 0 being forever). The game cuts it into its frames as it loads, the way a sheet is cut: a character's animation can play all of them at the file's own speed or pick some, and an item or picture drawn with it plays the whole file over and over. Until the frames are ready, the first frame shows. The existing `spritemap` action and spritemap labels, which describe their grid themselves, work as before.

## Names that mean something (items, vehicles, pictures)

Name | When it plays
---- | -------------
`idle` | By itself, while the figure stands. Loops.
`walk` | By itself, while the figure moves: an avatar walking, a vehicle being ridden. Loops. It is mirrored for the direction the art does not face.
`walk_left`, `walk_right` | Used instead of `walk` for that direction, unmirrored. If only one is given, it is mirrored for the other.
anything else | When an `animate` action or a player's move asks for it. Plays once unless `repeat` is true (`dance` loops by default).

A figure with no sheet, or a sheet without `idle` or `walk`, simply stands and is mirrored to face the way it goes, as before. Characters and avatars use their poses instead (see [Characters](/docs/developers/extensions/characters/)).

## Built-in moves

Five moves need no frames: `jump` (a hop), `spin` (a turn on the spot), `crouch` (a duck), `wave` (a sway from side to side) and `dance` (a looping bounce and sway). The picture itself is moved, so they work on any figure. **Frames win**: when a character has an animation of the same name (or an item's sheet does), that is played instead. So `jump` always does something, and looks best where a jump was drawn.

## Moves: what players can do themselves

`moves` on the scenario lists what players can do whenever they like, from buttons on their screen.

Parameter | Type | Description
--------- | ---- | -----------
animation | string | The animation or built-in move to play on the player's avatar.
label, icon | string | What the button shows. Default: the animation's name.
conditions | array | The button is there only while these hold. Absent: always.

```json
"moves": [
  { "animation": "jump" },
  { "animation": "dance", "conditions": [{ "variable": "learned_dance", "operator": "=", "operand": 1 }] }
]
```

This is the "animation inventory": a move a scenario teaches is a player's own variable set by an event, and the button appears when the condition holds. Moves of that kind belong to the scenario. Moves **bought in the marketplace** (shop items of kind `move`) belong to the account: once bought and switched on, their buttons are there in every scenario. A pressed move plays until it ends, or for a looping one until the player walks or presses it again.

Avatars differ, so a move is not tied to one avatar's art: a player whose avatar has a `dance` animation dances with it, and any other avatar does the built-in dance. A move that is neither one of the avatar's animations nor built in does nothing for that avatar.

## How animations reach other players

`players[...].anim` in the room state holds the last animation asked of a player's avatar, as `name:count`; clients play it when it changes, and it is cleared when the player walks or changes scene. The server checks the name's shape and how often it is asked (four times a second at most), not whether the player "owns" the move: animations are only something to look at. Walking and standing need no message; every client works them out from the positions it already receives.
