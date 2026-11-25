---
title: "Walk"
description: "Walks a character or the player somewhere on foot, around obstacles."
---

`type`: `walk`

The `walk` action walks a character or the player somewhere on foot. Unlike [`translate`](/docs/developers/actions/translate/), which glides a picture in a straight line, a walk finds a way around whatever is in the scene (walkable and blocked areas, blocking items, solid labels), plays the walking poses, turns the walker the way it goes, and slows down in [scale areas](/docs/developers/extensions/scenes/#scale-areas) as players do.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
target | string | character | `character` or `player`: the avatar of the player whose event this is.
character_id | int | | Which character, for `target: "character"`.
to | string | point | `point`: a spot in the scene the walker is in. `spawn`: one of that scene's spawn points. `scene`: another scene, through its doors (below).
position_x, position_y | int | | For `point`. The walker stops at the nearest spot it can stand on.
spawn_point | string | | For `spawn`: the spawn point. For `scene`: a spawn point of that scene to walk on to once there (roaming characters only).
scene_id | int | | For `scene`: the scene to walk to.
speed | int | | Scene pixels per second. Default: the character's `walk_speed`, else the scenario's `move_speed`. A player is never walked faster than `move_speed`.
facing | string | | `left` or `right`: turn this way on arriving. Default: the way it walked (at a spawn point, the way the spawn point faces).

```json
{ "type": "walk", "character_id": 3, "to": "scene", "scene_id": 12, "spawn_point": "console" }
```

**Doors.** To walk `to` a scene, the walker heads for a **door**: a hotspot of its scene whose own actions include a `jump` to that scene (the first jump counts; one on an infobox button does not). Walk-in hotspots are preferred, which is what the [scene map](/docs/editor/scenarios-and-scenes/) makes between scenes. On reaching the hotspot it goes through and arrives at the spawn point the jump names, facing the way that spawn point faces, exactly as a player would. A roaming character goes through as many rooms as it takes (the fewest), and only through doors whose conditions on shared variables hold, so a door locked by a room variable keeps characters out too. The door's other actions are not run: they belong to players.

**Who sees it.** A character that [roams](/docs/developers/extensions/characters/#characters-that-walk-around-on-their-own) is walked by the game server, for everyone, and stays where it went. Any other character walks on the player's own screen (or, when the event's `audience` is `scene`, on everyone's in the scene), like any other thing an event shows; one that walks out through a door is gone from the scene until it is entered again. The player walks themselves through the room as usual (their position reaches everyone through the room state), even while [frozen](/docs/developers/actions/freeze/): a freeze and walks make a cutscene. A player walked `to` a scene goes through a door of this scene, running the door's actions as if they had walked in (or clicked it), so only a scene next to this one can be reached.

With `blocking` (the default) the next action waits until the walker arrives, or stops trying: there is no way there, another walk took over, or (for the player) the player walked off elsewhere.

**Off stage.** A walk to a point beyond the left or right edge of the scene goes to the edge and on out of sight; a character placed beyond an edge comes on from there. See [story scenes](/docs/developers/extensions/atmosphere/#story-scenes).
