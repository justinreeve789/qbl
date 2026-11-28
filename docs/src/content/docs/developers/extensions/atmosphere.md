---
title: "Skies, weather, water and story scenes"
description: "Living skies, lights and the air, weather, flowing water, underwater light, and story scenes."
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
conditions | [Condition](/docs/developers/condition/)[] | | On only while all of these hold. None: always on.
name | string | | For the editor.

With a `sky`, lights shine at a third of their strength in full daylight and fully at night; without one (indoors, a cave) always fully.

A light with `conditions` is checked again whenever a variable changes. It fades in or out over 0.4 seconds (straight away for players who ask for reduced motion), and a campfire that goes out stops sending up embers. When a player arrives, each light is already on or off, with no fade. A beacon that comes on once the ship is repaired: `{ "x": 820, "y": 310, "kind": "blink", "color": "#ff4040", "conditions": [{ "variable": "ship_repaired", "operator": "=", "operand": 1 }] }`.

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

Rain or snow listed in a scene's `atmosphere` is weather too, as `{ "kind": "rain", "intensity": 0.55 }` (few 0.3, some 0.55, many 0.85). The [`weather` action](/docs/developers/actions/weather/) changes it while the player is in the scene. For players whose system asks for reduced motion only the darkening (and the sound) is there: nothing falls, and nothing flashes.

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

## Underwater light

**`water_lights`** (kept in the scene's `layout`): light under water, in a box of the scene, drawn live on the GPU (`WaterLightSystem` in the client; the shaders are `packages/shared/src/waterLightShaders.ts`, which the editor's canvas also runs to preview it). Nothing is downloaded, and it never visibly repeats. `ripples` is the bright web of light dancing on the floor of a pool: cells whose walls light up, two webs moving different ways, bent by a slow wave, in a true perspective (smaller toward the top of the box). It is drawn just above the floor art, behind every figure. `shafts` are beams of light slanting down from the surface, drifting, brightening and fading, drawn in front of the figures. Both are added to what is under them (the ADD blend), so they only brighten.

Rippling light also falls on the people and things standing in it: every picture between the floor and the foreground (avatars, characters, items, critters) whose bounds overlap the light's box gets a Phaser filter on its own picture (`systems/waterLightFilter.ts`, shader `RIPPLES_ON_FIGURE_FRAG`), so only the picture is lit, never the air around it. It runs the floor's own pattern (`ripplesAt`), at the same moment. Someone standing up is lit by the light where their feet are (the bottom of the picture), carried up the body and stretched as on a wall, with the pattern moved so it is not mistaken for the floor behind them, and the light brightens their own colours with a little white, plus an even wash. Something lying on the floor (depth below `Depth.floor + 100`: background-placed items and hotspots) is lit as the floor is, so the pattern carries on across it. Who stands in the light is looked at again every 120 ms. A filter is only drawn while it is on, so figures out of the light cost nothing. Only with WebGL.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
x, y, width, height | decimal | | The box.
kind | string | ripples | `ripples` or `shafts`.
color | string | #e1f6ff | `#rrggbb`.
strength | decimal | 60 (ripples), 40 (shafts) | Brightness, 0 to 100.
size | decimal | 120 (ripples), 90 (shafts) | Pixels: a ripple's width at the front of the box; the gap between beams.
speed | decimal | 100 | Percent of the usual pace. 0 holds it still.
tilt | decimal | 60 | Ripples: how far the floor leans away, 0 (seen from above) to 100.
spread | decimal | 35 | Shafts: how much they fan out from above, 0 (side by side) to 100.
edge | string | soft | `soft`: fades out at the box's edges. `oval`: in an oval.
shape | array | | Ripples only: an outline of its own, `[{x, y}, ...]` in scene pixels, 3 to 16 corners. The light fades out softly inside it and `edge` does not apply; the box is kept as its bounds (the game draws over the outline's bounds either way). The shader takes the corners as `uPoly` (two to a vec4) and `uCorners`.
figures | decimal | 100 | Ripples only: how strongly they light the people and things standing in them, in percent of their brightness on the floor. 0: only the floor. Shafts are in front of everyone and light them anyway.
conditions | array | | On only while all of these hold; it fades in and out (as a light does). None: always on.
name | string | | For the editor.

```json
{ "water_lights": [
  { "kind": "ripples", "x": 0, "y": 420, "width": 1280, "height": 300, "edge": "oval" },
  { "kind": "shafts", "x": 240, "y": 0, "width": 800, "height": 560 }
] }
```

Without WebGL (Phaser's canvas renderer) nothing is drawn. With reduced motion it is held still.

## Fog

**`fogs`** (kept in the scene's `layout`): patches of soft, see-through fog, each inside an outline of its own, drawn live on the GPU (`FogSystem` in the client; the shader is `FOG_FRAG` in `packages/shared/src/fog.ts`, which the editor's canvas also runs to preview it). A scene may have any number. Unlike the weather's fog (`weather.kind: "fog"`), which covers the whole scene, it stays inside its outline, fading out raggedly at the edges.

The fog is fractal noise whose shape is bent by a slower noise, so its wisps curl and churn even when it does not drift. Drifting across (`right`, `left`, `up`, `down`), the whole pattern is carried along at `speed`. Spreading `outward` from a point (steam from a vent, smoke from a cauldron) or gathering `inward` to one (a portal, a drain), two layers are each carried a little way and faded as the other takes over (as a flow map is), so it streams out for ever without stretching; near the point it moves more slowly, so nothing is carried across it. Fog is drawn with the usual blend, so it can hide what is behind it, and it is drawn `front` (just behind labels and names: in front of every figure and the foreground layers) or `behind` (just above the floor art, behind every figure: ground mist).

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
shape | array | | Required: its outline, `[{x, y}, ...]` in scene pixels, 3 to 16 corners. The game draws over the outline's bounds; the shader takes the corners as `uPoly` (two to a vec4) and `uCorners`, as underwater light's.
color | string | #e8edf2 | `#rrggbb`.
opacity | decimal | 60 | How much it hides where it is thickest, 0 (invisible) to 100 (solid).
density | decimal | 55 | How much of the outline it covers: 0 (a few thin wisps) to 100 (a thick bank, hardly a gap).
size | decimal | 220 | Pixels: how big its wisps and puffs are.
speed | decimal | 25 | Pixels per second. 0: it does not drift, only churns slowly.
direction | string | right | `right`, `left`, `up`, `down`, `outward` or `inward`.
origin | object | the middle of the outline | `outward` and `inward`: the point, `{x, y}` in scene pixels. It may be outside the outline (fog blowing in from beyond the edge).
layer | string | front | `front` or `behind`.
conditions | array | | There only while all of these hold. It rolls in and clears over 2.5 s as they start or stop holding. None: always there.
name | string | | For the editor.

```json
{ "fogs": [
  { "name": "moor mist", "shape": [{ "x": 0, "y": 480 }, { "x": 1280, "y": 440 }, { "x": 1280, "y": 720 }, { "x": 0, "y": 720 }], "direction": "left", "speed": 20, "layer": "behind" },
  { "name": "steam", "shape": [{ "x": 820, "y": 60 }, { "x": 1180, "y": 60 }, { "x": 1180, "y": 380 }, { "x": 820, "y": 380 }],
    "direction": "outward", "origin": { "x": 1000, "y": 360 }, "speed": 45, "color": "#ffffff", "size": 140,
    "conditions": [{ "variable": "vent_open", "operator": "=", "operand": 1 }] }
] }
```

Without WebGL (Phaser's canvas renderer) nothing is drawn. With reduced motion it is held still. How far fog has drifted is wrapped (`fogTravelWrap`) so the GPU's floats stay exact: fog spreading from a point never jumps, and fog drifting across jumps once, after drifting over a thousand of its sizes.

## Critters

`scene.critters`: a little life that has nothing to do with the lesson. Each player sees their own (they are not shared through the room), now and then: `CritterSystem` in the client. A shy critter scatters early when anyone comes near (the player, another player or a character): birds take off, a squirrel bolts for its tree, a rabbit dives into the nearest bush. There are none with reduced motion.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Its picture: a sprite sheet whose named animations it plays (a single picture works too, and still hops).
behavior | string | | `lands` (flies in, lands on a spot, pecks and hops, flies off), `climbs` (scampers about, then runs up a tree out of sight), `hides` (pops out of one hiding place, sits, hops into another), `walks_by`, `flies_by`, `swims_by`, `drives_by`.
spots | array | | `{x, y, top?}` in scene pixels: where it lands; the bottoms of the trees it climbs (`top`: how high); the bases of the bushes it hides in (it is drawn just behind the base, so behind the bush's sort line: it seems to go in). Also the depth a walker or vehicle crosses at.
animations | object | | Which sheet animation plays for `idle`, `walk`, `run`, `fly`, `take_off`, `land`, `peck`, `hop`, `climb`, when the names differ. A missing one falls back (run → walk, peck → idle...).
scale | number | 1 | Its size, before the scene's depth.
faces | string | `right` | Which way its picture faces.
every | [min, max] | [12, 28] | Seconds between visits.
shy | int | 170 | How near (pixels; counted double in depth) anyone may come before it scatters. 0: never.
count | int | 1 | How many come together (a flock), at most 6.
speed | number | by behavior | Pixels per second.
sound | string | | One of [the game's own sounds](/docs/developers/actions/audio/#the-games-own-sounds), as it comes.

## Story scenes

**`story: true`** (kept in the scene's `params`): the scene plays by itself, like a page of a picture book. What happens is in its start events: characters walk on and off, say lines, wave; a narrator's captions; the rain starts; a car goes by. They usually end with a `jump` to the next scene, so a story turns its own pages. In a story scene:

- avatars are not shown (whatever `show_avatars` says), and the player does not walk (a freeze that is never released);
- the view follows whoever is acting: the last character to speak, walk or play an animation while on the stage, and otherwise the middle of everyone on it (a [`camera` action](/docs/developers/actions/camera/) can say otherwise);
- a bar at the foot of the screen offers **↺ Again** (the scene from its beginning) and **Skip ⏭** (to the scene its start events jump to, running its end events first), when there is somewhere to skip to.

**Off stage.** A character placed beyond the left or right edge of a scene (`position_x` below 0, or past the scene's width) waits off stage, out of sight, until a walk brings it on: it walks straight in to the edge, then on to where the walk says. A walk to a point beyond an edge walks it off the stage and out of sight. This works in any scene, not only stories.

**Captions.** A text overlay with `text_font_style: "caption"` is a story's narration: a soft panel of words, usually at `bottom center`. A text overlay read aloud stays until the voice has finished, as a speech bubble does. A scenario's `narrator_voice` (a key of the voice catalog) is the voice its read-aloud text overlays are recorded in (`qbl:voice`, the editor's "Record voices" and the generator record them). A story box for the narrator is the [`narration`](/docs/developers/actions/narration/) action.
