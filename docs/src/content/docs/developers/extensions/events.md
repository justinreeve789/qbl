---
title: "Events and hotspots"
description: "How hotspots fire in a walk-around game, reveal distances, and who sees an event."
host:
  who: mallory
  says: "Walk into it, click it, or reveal it as you come near. And who gets to watch."
  side: right
---

`activate_by_trigger` keeps its meaning. In a walk-around game the two cases are:

* `true`: fires when the player **clicks or taps** inside the radius (or on one of the hotspot's labels).
* `false`: fires when the player's avatar **walks into** the radius. It fires again each time they leave and re-enter. If it cannot fire at that moment (another event is blocking hotspots, or its conditions are not met) it fires as soon as it can while the avatar is still inside.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
once | bool | false | Fire only once per player, ever. Remembered in the save data.
reveal_radius | decimal | | The hotspot is only there when the player's avatar is within this many scene pixels of its position. Further away, its labels are invisible and it cannot be clicked. Absent: it is always there.
reveal_full_radius | decimal | half of reveal_radius | Within this distance the hotspot is fully visible. Between the two distances its labels fade in as the avatar approaches and out as it leaves.

The reveal distance is measured from each player's own avatar, so a hotspot can be visible to one player and not yet to another. A coordinate the hotspot leaves empty does not count towards the distance. Walk-in hotspots still fire by their `radius` alone.

## Who sees an event

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
audience | string | player | `player`: only the player who sets the event off sees it. `scene`: every player in the scene sees and hears it as it happens.

Every kind of event can have an `audience`. With `scene`, these actions are shown to the other players in the scene at the moment they happen for the player who set the event off: `audio`, `image_fixed`, `image_overlay`, `text_overlay`, `spritemap`, `video`, `dialogue`, `narration`, `translate`, `cancel` and `cancel_event`. In a shared dialogue, "the player" is the player who set it off: the bubble hangs over their avatar, and a story box shows their name and portrait.

Everything an event *does* stays with the player who set it off, whatever the audience: `variable`, `award`, `jump`, `freeze`, `avatar`, `shop`, `infobox` and the timing actions. Nothing another player's event shows can change your variables, move you or open a box you must answer. (A variable that should change for everyone is a shared variable; see [Variables](/docs/developers/extensions/variables/). An avatar being hidden is seen by everyone anyway.)

* The player's own conditions decide which actions run; the others are shown exactly those.
* A player who walks into the scene part-way through sees the rest, not what came before. For something that must still be true for late arrivals (the boulders are across the path), use a shared variable and a hotspot or start event conditioned on it; use `audience: scene` for the moment itself (the boulders falling).
* An event run with `run_event` has its own audience: a private conversation can set off a shared event.
* The game server passes on only actions that belong to a `scene` event in the scene the player is in, so a player cannot push anything else onto other screens.

```json
{ "id": 553, "shortname": "rockfall", "audience": "scene", "actions": [
  { "type": "text_overlay", "text": "RUMBLE! Boulders crash down across the cliff path.", "duration": 3000, "blocking": false },
  { "type": "variable", "name": "rockfall", "operator": "set", "operand": 1 }
] }
```

`overridable` is implemented as: when any event starts, every running event flagged `overridable` is stopped where it is. Events not flagged always run to the end.
