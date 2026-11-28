---
title: "Shake"
description: "Shakes the screen, for this player or everyone in the scene."
---

`type`: `shake`

The `shake` action shakes the screen: a rockfall, an explosion, a door slammed shut. The view jolts about where it is and settles back; nothing in the scene moves, and the player can still walk.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
intensity | number | 3 | How hard, from 1 to 10. 1 is a faint tremble, 3 a door slamming, 6 a rockfall, 10 an earthquake.
duration | int | 500 | Milliseconds it lasts; with `blocking`, the next action waits for it.
audience | string | as the event's | Who feels it. `player`: only the player whose event it is. `scene`: everyone in the scene. Absent: as the event's [`audience`](/docs/developers/extensions/events/).

## Who feels it

`audience` is the one action setting that can differ from its event's. A shake for `scene` reaches every player who can see this one (in the same scene, and the same team where the scene is limited to teams), even from an event that is only the player's own: a player who knocks over a shelf can shake everyone's screen while the infobox that follows stays theirs. A shake for `player` stays on this player's screen even in an event shown to the whole scene.

Like everything shown to the scene, the others feel it as it happens; a player who arrives afterwards does not.

A shake inside a conversation's choice is the player's own whatever its `audience`, as are all actions there.

## Reduced motion

A player whose device asks for reduced motion (`prefers-reduced-motion`) is not shaken. The action still takes `duration`, so the event keeps its timing. Pair a shake with a sound (a rumble, a crash) so that nobody misses what happened.

## Example

```json
{ "type": "shake", "intensity": 6, "duration": 800, "audience": "scene", "blocking": false }
```

With `blocking: false`, the next action (say, a crash sound) starts at the same time.
