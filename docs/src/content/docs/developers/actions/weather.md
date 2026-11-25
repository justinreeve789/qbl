---
title: "Weather"
description: "Changes the weather slowly while the player is in the scene."
---

`type`: `weather`

The `weather` action changes the scene's [weather](/docs/developers/extensions/atmosphere/#weather) while the player is there, slowly: the rain starts, a storm blows up, the snow stops. Everyone in the scene sees it when the event's audience is the scene.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
kind | string | | `clear` (it stops), `rain`, `snow`, `storm`, `blizzard` or `fog`. The same kind changes how heavy it is; another fades the old one out as the new one comes in.
intensity, wind, lightning | | | As for the scene's weather.
duration | int | 3000 | Milliseconds the change takes. With `blocking`, the next action waits for it.

```json
{ "type": "weather", "kind": "storm", "intensity": 0.9, "duration": 5000, "blocking": false }
```

It lasts until another weather action, or until the player leaves the scene, which has its own weather again next time.
