---
title: "Skies, weather, water and story scenes"
description: "Living skies, lights and the air, weather, flowing water, and story scenes."
host:
  who: mallory
  says: "A scene that is never quite still: skies, weather and water, and scenes that tell a story."
  side: right
---

## Living skies, lights and the air

Three things make a scene feel alive without any events. All are drawn by the game in code, over or behind the scene's pictures. They are kept in the scene's `params` (`sky`, `atmosphere`) and `layout` (`lights`) and come out of the compiler as scene fields.

**`sky`**: a sky behind every background layer, for a time of day: a gradient from the top of the sky to the horizon, the sun (bigger and redder as it sinks, with a soft glow) or the moon and twinkling stars. It can change slowly while a player is in the scene, through the times between: from `afternoon` until `dusk` is a sunset through gold, orange, pink and purple into a starry dusk. The backgrounds in front must be see-through where the sky shows.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
time | string | | `dawn`, `morning`, `midday`, `afternoon`, `golden`, `sunset`, `dusk` or `night`: what the sky shows when a player first arrives.
until | string | | What it becomes, slowly; it then stays. Always forward round the clock (`night` until `dawn` goes through the small hours).
minutes | decimal | 8 | How long the change takes, easing in and out. It carries on, not over, when the player comes back to the scene.
horizon | decimal | 0.6 | Where the horizon is, as a share of the scene's height from the top: where the sun sets, behind the scenery.
sun_x | decimal | 0.72 | Where across the screen the sun is (the moon is on the other side). Both stay put on the screen as the view moves, being far away.
sun, stars | bool | true | Draw the sun or the moon; stars when it is dark.
shade | decimal | 60 | How much the scene in front takes on the sky's light, 0 to 100: warmer at sunset, bluer at night, over everything below the labels.

Layers marked `sky` (clouds, a far view) are tinted with the sky's light. A band of clouds is a tiled layer with a drift: `{ "media_id": 40, "tile": true, "scroll_speed_x": 7, "parallax": 0.06, "sky": true }`. The colours at each time are in `packages/shared/src/sky.ts` (`skyLook`), which the editor and the generator's scene previews use too.

**`lights`**: soft glows drawn over the scene (they add light, so they show best in the dark). Put one where the picture has a light: a lantern's glass, a campfire, a lit window, a beacon.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
x, y | decimal | | Where the light is.
kind | string | flicker | `flicker` (a small flame: a lantern, a torch, a candle), `fire` (a campfire: it flickers more, and embers rise from it), `glow` (steady, breathing slowly: crystals, a window, a screen), `blink` (on for a moment, then off: a beacon, a warning light) or `twinkle` (a sparkle now and then).
color | string | #ffc46b | `#rrggbb`.
radius | decimal | 90 | How far the glow reaches, in pixels.
strength | decimal | 70 | How bright, 0 to 100.
period | decimal | 4 (glow), 1.4 (blink) | Seconds for one breath or one blink.
name | string | | For the editor.

With a `sky`, lights shine at a third of their strength in full daylight and fully at night; without one (indoors, a cave) always fully.

**`atmosphere`**: a list of things in the air, drawn over the scene wherever the player is looking: `{ "kind": "fireflies", "amount": "few" }`. `kind` is `fireflies` (they wander and glow, more in the dark), `leaves` (tumbling down), `snow`, `rain`, `dust` (floating slowly in the light) or `bubbles` (rising, under water); `amount` is `few`, `some` (default) or `many`; `color` (`#rrggbb`) replaces their own colours.

For players whose system asks for reduced motion, nothing in the air is drawn and lights glow steadily.

## Weather

**`weather`** (kept in the scene's `params`): weather drawn over the scene by the game's weather plugin (`apps/client/src/plugins/weather`), in the part of the scene the player is looking at, with its own sound made by the game. Rain falls in slanting streaks, nearer drops longer, faster and brighter, and splashes on the floor (between the top and the bottom of the walkable areas); snow drifts and sways; a storm is heavy rain blown by the wind, the light going, and lightning now and then (a soft double flash and a bolt) with thunder a moment later; a blizzard is snow driven across the screen; fog is a haze, thicker near the ground, with banks drifting by. The wind gusts about its own strength.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
kind | string | | `rain`, `snow`, `storm`, `blizzard` or `fog`.
intensity | decimal | 0.6 (0.85 for a storm or a blizzard) | How heavy, from 0 to 1.
wind | decimal | by kind | From -1 (blowing hard to the left) to 1 (to the right). Rain 0.15, snow 0.1, a storm 0.6, a blizzard 0.8, fog 0.08.
lightning | bool | only in a storm | Lightning now and then.
darken | decimal | by kind | How much darker the scene is, 0 to 100: a storm 35, rain 15, a blizzard 18, snow and fog 5.
sound | bool | true | Rain on the ground (heavier with a heavier rain), the wind in a storm or a blizzard.

```json
{ "weather": { "kind": "storm", "intensity": 0.9, "wind": -0.5 } }
```

Rain or snow listed in a scene's `atmosphere` is weather too, as `{ "kind": "rain", "intensity": 0.55 }` (few 0.3, some 0.55, many 0.85). The [`weather` action](/docs/developers/extensions/actions-world/#weather-action) changes it while the player is in the scene. For players whose system asks for reduced motion only the darkening (and the sound) is there: nothing falls, and nothing flashes.

The plugin works in any Phaser scene, not only QBL's: `new Weather(scene, options)` and `weather.set({ kind: 'rain' })`, or as a scene plugin (`plugins: { scene: [{ key: 'WeatherPlugin', plugin: WeatherPlugin, mapping: 'weather' }] }`, then `this.weather.storm()`). See `apps/client/src/plugins/weather/README.md`.

## Flowing water

**`flows`** (kept in the scene's `layout`): water that moves, in a box of the scene. Rivers and streams are carried along in rows of ripples (far water, at the top of the box, slower and finer than near water), a waterfall pours down with foam at its foot, the sea and lakes lap to and fro; glints catch the light here and there; the water darkens as a living sky does. Each kind has its sound: a rushing river (and a waterfall), a babbling stream, waves on a shore.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
x, y, width, height | decimal | | The box.
kind | string | river | `river`, `stream`, `waterfall`, `sea` or `lake`.
direction | string | by kind | `right`, `left`, `down` or `up`: a river or stream right, a waterfall down; the sea and a lake lap.
speed | decimal | by kind | Pixels per second at the front: a river 70, a stream 55, a waterfall 260.
color | string | by kind | `#rrggbb`.
layer | string | behind | `behind`: drawn behind the scene's own picture (its last background layer), showing wherever that picture is see-through. Paint the water's surface out of the picture and the river flows between its painted banks. `over`: only the ripples and glints, over water painted in the picture.
sound | bool | true | Its sound.
name | string | | For the editor.

```json
{ "flows": [{ "kind": "river", "x": 0, "y": 960, "width": 2250, "height": 240, "direction": "right" }] }
```

The generator paints a scene's water as a flat chroma colour, cuts it out and puts a `flows` box where the see-through part is, so the water always flows between the banks it painted.

## Story scenes

**`story: true`** (kept in the scene's `params`): the scene plays by itself, like a page of a picture book. What happens is in its start events: characters walk on and off, say lines, wave; a narrator's captions; the rain starts; a car goes by. They usually end with a `jump` to the next scene, so a story turns its own pages. In a story scene:

- avatars are not shown (whatever `show_avatars` says), and the player does not walk (a freeze that is never released);
- the view follows whoever is acting: the last character to speak, walk or play an animation while on the stage, and otherwise the middle of everyone on it (a [`camera` action](/docs/developers/extensions/actions-world/#camera) can say otherwise);
- a bar at the foot of the screen offers **↺ Again** (the scene from its beginning) and **Skip ⏭** (to the scene its start events jump to, running its end events first), when there is somewhere to skip to.

**Off stage.** A character placed beyond the left or right edge of a scene (`position_x` below 0, or past the scene's width) waits off stage, out of sight, until a walk brings it on: it walks straight in to the edge, then on to where the walk says. A walk to a point beyond an edge walks it off the stage and out of sight. This works in any scene, not only stories.

**Captions.** A text overlay with `text_font_style: "caption"` is a story's narration: a soft panel of words, usually at `bottom center`. A text overlay read aloud stays until the voice has finished, as a speech bubble does. A scenario's `narrator_voice` (a key of the voice catalog) is the voice its read-aloud text overlays are recorded in (`qbl:voice`, the editor's "Record voices" and the generator record them). A story box for the narrator is the [`narration`](/docs/developers/extensions/dialogue/#the-narrator) action.
