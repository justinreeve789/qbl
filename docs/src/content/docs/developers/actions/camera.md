---
title: "Camera"
description: "Points the player's view."
---

`type`: `camera`

The `camera` action points the player's view.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
target | string | | `character`: follow a character placed in the scene as they move. `point`: glide to a spot and stay. `player`: follow the player again (as the view does outside story scenes). `auto`: follow whoever is acting, as a [story scene](/docs/developers/extensions/atmosphere/#story-scenes) does. Default: `character` with a `character_id`, `point` with a position, else `player`.
character_id | int | | For `character`.
position_x, position_y | int | | For `point`: the middle of the view, kept inside the scene.
duration | int | 1200 | Milliseconds the glide takes; with `blocking`, the next action waits for it.

It lasts until another camera action, or the scene ends.
