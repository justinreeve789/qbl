---
title: "Patterns, and what is not built yet"
description: "Combinations of the pieces that need no special support, and the list of things the spec describes but does not do yet."
host:
  who: lucy
  says: "Recipes made of ordinary pieces, and an honest list of what is still to come."
  side: right
---

## Patterns

These need no special support; they are combinations of the pieces above.

**A scored question.** An indirect event holds an infobox with `dismissible: false` and one button per answer. Each button runs its own indirect event, which records the answer in a variable, adds to a score variable if it is the right one, and shows an infobox explaining why.

**A menu that stays open.** An event holds a non-dismissible infobox followed by a `repeat` action with a condition such as `menu_open = 1`. Buttons change variables or run events; a "Step away" button sets `menu_open` to 0, which ends the loop. Do not have an event run itself through `run_event`: an event that is already running is not started again.

**A hands-on experiment.** The same loop, with buttons that change a variable (`beaker_ph + 1`) and content that shows it (`pH {{beaker_ph}}`), plus an action whose condition detects the goal (`beaker_ph = 7`).

**Collecting things.** A click hotspot whose conditions include `sample_x = 0`, with the object as an image label. Its actions set `sample_x` to 1 and add to a counter. The label disappears because the hotspot's conditions no longer hold.

## Not implemented yet

* `physical` items (pushable objects). Things players walk *around* are covered: blocking items and solid labels.
* `intro_media_portrait_id` / `intro_media_landscape_id` splash screens and `is_intro_scene`.
* `allow_groups` as a lobby. Groups work (players who join with the same group key share a room, up to `max_players`), but choosing a group is left to whatever launches the game: pass `?group=`.
* Animating what an avatar wears along with a sheet animation: worn items follow the figure's position, not its frames.
* A screen for editing the platform's marketplace catalogue and the ranks.
* Characters bumping into one another or into players: characters walk around the scene's obstacles, but not around other figures.
* A routine step that plays a sound, or runs one of the scene's events: what an event does belongs to a player, and a routine belongs to no one.
