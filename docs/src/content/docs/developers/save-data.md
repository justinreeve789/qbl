---
title: "Save data"
host:
  who: asimov
  says: "What the game remembers between visits, and who writes it down."
---

When `enable_save_session` is true, a player's progress is saved and delivered with the scenario the next time they visit, as the `session` object at the top level of the scenario JSON.

Parameter | Type | Description
--------- | ---- | -----------
scene_id | int | The scene the player was in.
position_x, position_y | decimal | Where they stood. If that spot is no longer walkable (the scene was edited), the nearest walkable point is used. If the scene no longer exists, they start at `start_scene_id`.
variables | object | Values of player-scoped variables with `persist` not false, by name.
attachments | array | Ids of non-unique items the player was wearing or riding.
flags | array | One-shot markers, such as `hotspot:420` for a hotspot flagged `once` that has fired.
time_elapsed | int | Total seconds spent in the scenario. Feeds `QL_TimeElapsed`.
updated_at | string | ISO 8601 time of the save.

```json
"session": {
  "scene_id": 2,
  "position_x": 1050,
  "position_y": 1000,
  "variables": { "mission": "flora", "visited_ship": 1 },
  "attachments": [2],
  "flags": ["hotspot:420"],
  "time_elapsed": 734,
  "updated_at": "2026-11-15T17:37:00.000Z"
}
```

## Who writes it

The game server. It knows where each player is and what they hold; the client reports its player-scoped variables and flags every few seconds and before each jump. Saves happen when a player leaves or drops, and periodically while they play.

Values reported by the client are filtered: only variables declared in `global_variables` with player scope are kept.

## Room data

State shared by a group is saved separately, per scenario and group key:

Parameter | Type | Description
--------- | ---- | -----------
variables | object | Values of room-scoped variables with `persist` not false.
items | object | For each unique item id: `{scene_id, x, y}`, where it was left.
characters | object | For each [character that roams](/docs/developers/extensions/characters/#characters-that-walk-around-on-their-own), by id: `{scene_id, x, y, facing, step}`, where it was left and the routine step it was on. A scene that no longer exists sends it back to its first placement.

It is loaded when the first player of a group arrives and saved when the room empties and whenever it changes. It is not part of the scenario JSON; clients receive it through the live room state.
