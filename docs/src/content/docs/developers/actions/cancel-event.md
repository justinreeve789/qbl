---
title: "Cancel event"
description: "Stops a whole event that is running."
---

`type`: `cancel_event`

The `cancel_event` action stops an event of the same scene that is running. `cancel` stops one action; this stops a whole event: a loop of a bird flying about, a countdown, a character's chatter once the player has solved the puzzle.

Parameter | Type | Description
--------- | ---- | -----------
target_event_id | int | The event to stop. Named like `run_event`'s, since `event_id` is the event the action belongs to. It must be in the same scene.

```json
{ "type": "cancel_event", "target_event_id": 42 }
```

* The event goes no further, and whatever its actions are showing or playing stops, as when an `overridable` event is interrupted. A `freeze` it made ends, and if it had `block_hotspots`, hotspots work again.
* An event that is not running is left alone: nothing happens, and it can still start later. Use conditions to keep it from starting.
* It counts as finished at once, so it can be started straight away: `cancel_event` followed by `run_event` for the same event restarts it.
* An event may name itself, which ends it there.
* Background music (persistent audio) it started keeps playing; a `cancel` naming the audio action stops it.
* Events it started with `run_event` are their own and keep running.
* In an event whose audience is the scene, the other players have what they are being shown of the stopped event taken away too.
