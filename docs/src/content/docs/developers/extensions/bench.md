---
title: "The close-up bench"
description: "Scene.bench: substances, vessels, tools, reactions, readouts, watches and graphs."
host:
  who: sam
  says: "Pour, mix, heat and measure: a whole lab in one scene."
  side: right
---

`scene.bench` makes a scene an experiment worked with the hands (`packages/shared/src/bench.ts`; run by `bench-sim.ts`, checked by `bench-validate.ts`). With `show_avatars: false` the camera shows the whole scene, and a press on nothing in particular does not walk anybody.

```json
{
  "enabled": true,
  "ambient": 20,
  "substances": [
    { "id": "vinegar", "name": "Vinegar", "color": "#e3c45c", "ph": 2.4 },
    { "id": "baking_soda", "name": "Baking soda", "state": "solid", "color": "#ffffff" },
    { "id": "salty_water", "name": "Salty water", "color": "#d3e4ec", "strength": 0.4 },
    { "id": "co2", "name": "Carbon dioxide", "state": "gas" }
  ],
  "vessels": [
    { "id": "beaker", "shape": "beaker", "x": 960, "y": 840, "capacity": 250, "fixed": true, "marks": true },
    { "id": "bottle", "name": "Vinegar", "shape": "bottle", "x": 420, "y": 840, "supply": true, "pour": 20, "contents": [{ "substance": "vinegar", "amount": 500 }] }
  ],
  "tools": [{ "id": "burner", "kind": "burner", "x": 960, "y": 920, "vessel_id": "beaker", "power": 6 }],
  "reactions": [
    { "id": "fizz", "uses": [{ "substance": "vinegar", "amount": 2 }, { "substance": "baking_soda", "amount": 1 }],
      "makes": [{ "substance": "salty_water", "amount": 2 }, { "substance": "co2", "amount": 6 }],
      "rate": 4, "heat": -0.15, "effect": "fizz", "note": "It fizzes!" }
  ],
  "readouts": [{ "id": "gas", "measure": "released", "vessel_id": "beaker", "substance": "co2", "variable": "fizz_gas" }],
  "watches": [{ "id": "fizzed", "when": "reaction", "reaction_id": "fizz", "variable": "fizz_done", "set": 1, "event_id": 760050 }],
  "graph": { "x": "time", "y": "gas", "variable": "fizz_log" }
}
```

* **Substances.** `state` is `liquid` (default), `solid` or `gas`; amounts are in mL, and a gram of a solid counts as one. A gas that is made leaves the container and is counted as `released`. `strength` is how strongly it colours a mixture (left out: 1 with a `color`, hardly at all without one, strongly for an indicator); `indicator` is a list of `{ ph, color }` its colour blends between; `separate` liquids keep to a layer of their own, ordered by `density`; `boils_at` caps a container's temperature. Ids are names (`[A-Za-z_]\w*`), since conditions read them.
* **Vessels** stand on (`x`, `y`): the middle of the foot. `shape` is `tube`, `beaker`, `flask`, `cylinder`, `dish`, `bottle`, `jar` or `dropper`, each with a usual `width`, `height`, `capacity` and `pour` (how much one tip gives). `supply`: a stock bottle that never runs out and takes nothing in. `fixed`: it is poured into, never out of.
* **Tools**: `burner` (heats `vessel_id` by `power` °C a second for 100 mL; tapped on and off), `stirrer` (picked up and tapped on a container: `stirred` holds for six seconds), `sink` (a container in the hand is emptied into it).
* **Reactions.** `uses` must all be present; an amount of 0 is needed but not used up. A round uses the amounts given and makes `makes`; `rate` is rounds a second (absent: all at once). `when` is conditions as in an infobox's `when` block, over `temperature`, `volume`, `ph`, `stirred`, `time` and the substances (how much of each is there). `heat` warms 100 mL by so many degrees a round. `effect`: `bubbles`, `fizz`, `smoke`, `glow`, `flash` or `none`.
* **pH** is worked out from the liquids that have one: each brings its excess of acid or base, they cancel, and the rest dilutes, which gives a strong acid and base their real titration curve. A substance with no `ph` only dilutes.
* **Readouts** measure `volume`, `temperature`, `ph`, `amount` or `released` (of `substance`), `pours`, `time`, or a `formula` of other readouts' ids (math.js). With `variable`, the value is kept there, at most four times a second.
* **Watches** notice a `reaction` (the first time it happens in a container), a `reading` passing a `value` (`operator`), a container that `contains` a `substance` (at least `amount`), or an `overflow`. Each sets `variable` (to `set`, else 1, or a reading's value) and runs `event_id`, an indirect event of the scene. Once, unless `repeat`. What already holds when the scene starts is not something that happened.
* **Graph**: `x` and `y` are readout ids (`x` may be `time`). `record` is `button` (the player presses Record) or `live` (a point every half second). With `variable`, the points are kept as `x,y;x,y` (at most 300), for a graph block's `data-series`.

The bench runs in each player's browser (there is no shared mode yet), is not saved between visits, and is kept in the scene's `layout` in the database, so it travels in exports and copies; a watch's `event_id` follows its event to a copy.

The scene is worked from events with the [`bench` action](/docs/developers/actions/bench/).
