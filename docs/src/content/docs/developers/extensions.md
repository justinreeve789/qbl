---
title: "Runtime extensions (spec v2)"
host:
  who: asimov
  says: "The full runtime spec, version 2. Grab a snack: this one is long."
  side: right
---

The original pages describe the JSON as first designed. The walk-around multiplayer runtime needs a few things those pages do not cover: where avatars can walk, where they appear, how scenes connect, where items and characters stand, and which state is shared between players.

Everything on this page is **optional and additive**. A document that uses none of it still plays: the whole scene is walkable, players appear in the centre, and all variables are per-player. Set `"spec_version": 2` on scenarios that use these fields.

All coordinates are scene pixels with the origin at the top left. An avatar's position is the position of its **feet**.

## Scenario

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
spec_version | int | 1 | Version of the spec the document was written against.
code | string | | The scenario's unique code and its address: players open `/{code}`. It is 16 random lowercase letters when the scenario is created; the editor can change it to 4 to 32 lowercase letters, digits and hyphens (starting with a letter, not one of the site's own paths), after which the old code no longer opens it. `shortname` stays as a readable name and can be edited freely.
items | array | | Item definitions (see [Items](/docs/developers/item/)). Scenes place them with `scenes[].items`.
characters | array | | Character definitions (see [Characters](/docs/developers/character/)). Scenes place them with `scenes[].characters`.
asset_base_url | string | | Prefix for media `url` values that are neither absolute nor rooted. A `url` that starts with `/` (such as `/media/12/ab12….png`, a file uploaded in the editor) is used as it is.
visibility | string | public | `public`: on every player's missions page. `private`: only for students a teacher assigned it to.
chat_mode | string | emotes | `off`: no chat. `emotes`: a fixed set of emoji only. `free`: typed text, filtered by the game server.
move_speed | decimal | 420 | Avatar walking speed in scene pixels per second.
avatars | array | | The avatars players choose from: characters (see [Characters](#characters)) with an `id` and a `name`. The first is the default. With the Laravel API these are the platform's avatars, the same in every scenario, added when the document is served with the pictures they use (avatar ids from 900000, platform pictures from 800000); a scenario does not set them. See [Classes, missions and teams](/docs/editor/classes/).
avatar_media_ids | array | | *Before `avatars`.* Image media ids players may choose as their avatar; each is read as an avatar whose id is the picture's id, standing facing right. Read only when `avatars` is absent.
avatar_portraits | object | | *Before `avatars`.* A close-up for such an avatar: `{"<avatar media id>": <portrait media id>}`.
objectives | array | | The mission checklist shown to the player. See below.
music_media_id | int | | Background music for the scenario: it plays in every scene that does not have music of its own.
music_volume | decimal | 0.5 | Volume of that music, 0 to 1.
session | object | null | Save data for the requesting player. See [Save data](/docs/developers/save-data/).
curriculum | object | | What the mission teaches: `standards` (`framework`, `code`, `description`, `alignment`, `rationale`), `learning_objectives` (`id`, `text`, `standards`), `vocabulary`, and `evidence`: for each objective, the variables that record a student's evidence of it. Written by the [mission generator](/docs/developers/generation/); the runtime ignores it.

`jump_targets` is generated from jump actions (including those on infobox buttons), by the API when it builds the JSON and again by the runtime. It may be either an object keyed by scene id (`{"3": [4]}`) or an array of `{scene_id, targets}`.

The game server only lets a player move to a scene listed in the current scene's jump targets.

scene_groups | array | | Groups of scenes, each `{id, name, team_only}`. A scene names its group with `group_id`. See [Teams in a scene](#teams-in-a-scene).
glossary | array | | Words the mission teaches. See [Glossary](#glossary).
narration | string | off | `on`: dialogue, infoboxes and text overlays are read aloud unless an action says otherwise. `off`: only actions marked `narrate`. See [Reading text aloud](#reading-text-aloud).
narrator_voice | string | the default narrator | The narrator's voice: what no character says (`narration` actions, and the text overlays and infoboxes read aloud) is recorded in it. A key of the server's voice catalog. Absent: the server's default narrator for the scenario's language (in English, "storyteller": dramatic and charismatic). `none`: no narrator, so the browser reads them. See [The narrator](#the-narrator).
private_messages | bool | false | Players may send typed messages to one other player. See [Messages](#messages).
wait_for_launch | bool | false | Kept in the scenario's `settings`. Students see the mission, and can join it, only once their teacher launches their assignment of it (`assignments.launched_at`): from the game (the `launch` message, see [Travel](#travel)) or from the Classes page (`POST`/`DELETE /api/teach/assignments/{id}/launch`). Not listed to students as a public mission, and its public instance is closed to them. Applies at once, without publishing.

### Objectives

A scenario can define a checklist that is shown on screen while it is played. Objectives are driven by variables, so events move the mission along simply by changing variables.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id | string or int | | Unique within the scenario.
text | string | | What the player reads. May contain placeholders, e.g. `Collect samples ({{samples}}/3)`.
show_when | array of conditions | always | The objective is listed only while these hold. Use it to reveal steps as the mission unfolds.
complete_when | array of conditions | | The objective is ticked while these hold. Required.
optional | bool | false | Shown as a bonus.

The player is told when an objective becomes complete.

### Placeholders in text

Text overlays, infobox content, infobox button labels, text labels and objective text may contain placeholders:

* `{{variable_name}}` is replaced with the variable's current value. Reserved variables work too.
* `{{media:ID}}` is replaced with the URL of a media asset, for use in infobox HTML: `<img src="{{media:40}}" alt="">`. Written on its own in an infobox's text, it shows the media itself. See [Rich infoboxes](#rich-infoboxes).

Values are escaped when inserted into HTML. A placeholder that names nothing is left as written, so a typo shows up.

## Scenes

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
width, height | int | first background's size | World size in pixels. **Set these**: the game server cannot see image files, and uses the size to check movement.
walkable_areas | array of polygons | whole scene | Where feet may be. A polygon is an array of `{x, y}` points. A point is walkable if it is inside any of them.
blocked_areas | array of polygons | | Holes cut out of the walkable areas (furniture, pits).
spawn_points | array | | Named places players appear. See below.
items | array | | Item placements: `{item_id, position_x, position_y}`.
characters | array | | Character placements: `{character_id, position_x, position_y, facing, event_id}`.
indirect_events | array | | Events that only run via a run event action, an infobox button or a character. (Mentioned on the Events page; this is where they live.)

shadow_spots | array | | Patches of shade. See [Shadow spots](#shadow-spots).
sky | object | | A living sky behind the backgrounds. See [Living skies, lights and the air](#living-skies-lights-and-the-air).
lights | array | | Glows that flicker, burn, breathe, blink or twinkle. See the same section.
atmosphere | array | | What is in the air: fireflies, leaves, snow, rain, dust, bubbles. See the same section.
team_only | bool | the group's | Show a player only their own team in this scene. See [Teams in a scene](#teams-in-a-scene).
params.editor_map | `{x, y}` | | Where the scene's box sits on the editor's scene map (Scenes page › Map), in map pixels. The editor writes it; the game ignores it. A scene without one is placed by the map itself.

### What stands in front of what

Everything placed in a scene has a place relative to the players. There are three:

Place | Drawn | Use it for
----- | ----- | ----------
`background` | Behind every player, in front of the background layers | A hotspot's icon, a marking on the floor, a rug, a sign on the far wall
`object` | Among the players, sorted by where it stands: a player lower on the screen is in front of it, one higher up is behind it | A rock, a crate, a plant, a console players can walk around
`front` | Over everything | A caption floating above the scene

What decides it:

* **Hotspot labels**: `placement` on the label. Default: `background`, for pictures and text alike, so **players are always drawn in front of a hotspot's labels, wherever they walk**. A label that should be walked behind says `object`; it then stands on its **bottom edge**, the line players are sorted against. `front` draws it over everything.
* **Items**: `placement` on the item, `object` (default) or `background`. An item stands at its position, the middle of its bottom edge. An object item that runs into the room at an angle (a counter) can have a `sort_line` along its base: figures in front of the line where they stand are drawn in front of it, those behind it behind (see [Items](#items)).
* **Characters and avatars** are always objects.
* **`image_fixed` and `spritemap` actions**: `layer`, which is `above` (default: over everything), `sorted` (among the players, by `position_y`) or `behind` (part of the background).
* **Foreground layers** are drawn over all of it, as before.

A label can also be **solid**: players cannot walk through it and are led around it.

Parameter | Applies to | Default | Description
--------- | ---------- | ------- | -----------
placement | label | background | `background`, `object` or `front`.
solid | picture label | false | Players walk around it. This does not change how it is drawn: add `"placement": "object"` if players should also pass behind it.
solid_radius | picture label | 35% of its width | Radius of the obstacle, a circle at the picture's base.
show_near | label | | A hint: the label shows only while the player's avatar is within this many scene pixels of the hotspot, or the pointer is over the hotspot. For a thing's name over a small marker, so a scene is not covered in words. Absent: always shown.
pulse | picture label | false | The picture grows and shrinks gently while its hotspot can be clicked, to draw the eye. Pictures used to pulse by default; now they hold still unless asked, and the pointer shows what can be clicked.
placement | item | object | `object` or `background`.

```json
{ "type": "image", "media": 48, "position_x": 1700, "position_y": 790, "solid": true, "solid_radius": 110 }
```

A solid label blocks only while its hotspot is there: when the hotspot's conditions stop holding (the boulders have been cleared) the picture goes and so does the obstacle. Items block with `blocking` and `blocking_radius`, as before. In the demo every label is in the background, and the fallen boulders on the cliff path are also solid.

### Walking around things

A click or tap sets a destination, and the avatar finds its own way there around blocked areas, blocking items and solid labels. The route comes from a navigation mesh built with the [`navmesh`](https://github.com/mikewesthad/navmesh) library (MIT): the scene is sampled into squares, the walkable ones are merged into a mesh, and the shortest path across it is pulled tight around corners. The mesh is rebuilt when an obstacle appears, goes or moves. Keyboard movement is direct, as before, and every step, however it was planned, is still checked by the same "feet inside polygons" rule the game server uses. Where no route exists the avatar heads straight for the spot and stops at the first thing in its way. With `?debug` the obstacles are drawn.

### Shadow spots

`shadow_spots` is a list of patches of shade on the floor. A figure walking through one is darkened as if shade were cast over it: most at the centre of the spot, fading smoothly to nothing at its edge. It applies to avatars and what they wear, carry or ride, and to items and characters standing there. Where spots overlap, their shade adds up.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
name | string | | A label for the editor.
x, y | int | | The centre, in scene pixels.
radius | int | | How far the shade reaches across.
radius_y | int | radius | How far it reaches up and down. Smaller than `radius` for a shadow lying on a floor seen at an angle.
strength | decimal | 60 | How dark the centre is, 0 to 100.

```json
"shadow_spots": [{ "name": "under the tree", "x": 640, "y": 820, "radius": 220, "radius_y": 90, "strength": 70 }]
```

Put spots where the artwork already shows shade. In the scene editor, add one with **Add › Shadow spot**, drag it into place and drag its two handles to size it. The spot itself draws nothing in the game; it only shades what walks through.

### Living skies, lights and the air

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

### Weather

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

Rain or snow listed in a scene's `atmosphere` is weather too, as `{ "kind": "rain", "intensity": 0.55 }` (few 0.3, some 0.55, many 0.85). The [`weather` action](#weather-action) changes it while the player is in the scene. For players whose system asks for reduced motion only the darkening (and the sound) is there: nothing falls, and nothing flashes.

The plugin works in any Phaser scene, not only QBL's: `new Weather(scene, options)` and `weather.set({ kind: 'rain' })`, or as a scene plugin (`plugins: { scene: [{ key: 'WeatherPlugin', plugin: WeatherPlugin, mapping: 'weather' }] }`, then `this.weather.storm()`). See `apps/client/src/plugins/weather/README.md`.

### Flowing water

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

### Story scenes

**`story: true`** (kept in the scene's `params`): the scene plays by itself, like a page of a picture book. What happens is in its start events: characters walk on and off, say lines, wave; a narrator's captions; the rain starts; a car goes by. They usually end with a `jump` to the next scene, so a story turns its own pages. In a story scene:

- avatars are not shown (whatever `show_avatars` says), and the player does not walk (a freeze that is never released);
- the view follows whoever is acting: the last character to speak, walk or play an animation while on the stage, and otherwise the middle of everyone on it (a [`camera` action](#camera) can say otherwise);
- a bar at the foot of the screen offers **↺ Again** (the scene from its beginning) and **Skip ⏭** (to the scene its start events jump to, running its end events first), when there is somewhere to skip to.

**Off stage.** A character placed beyond the left or right edge of a scene (`position_x` below 0, or past the scene's width) waits off stage, out of sight, until a walk brings it on: it walks straight in to the edge, then on to where the walk says. A walk to a point beyond an edge walks it off the stage and out of sight. This works in any scene, not only stories.

**Captions.** A text overlay with `text_font_style: "caption"` is a story's narration: a soft panel of words, usually at `bottom center`. A text overlay read aloud stays until the voice has finished, as a speech bubble does. A scenario's `narrator_voice` (a key of the voice catalog) is the voice its read-aloud text overlays are recorded in (`qbl:voice`, the editor's "Record voices" and the generator record them). A story box for the narrator is the [`narration`](#the-narrator) action.

### Teams in a scene

When a teacher puts students into teams (see [Classes, missions and teams](/docs/editor/classes/)), every team is its own instance of the scenario, with its own shared variables, items and save data. The teams of one assignment are nevertheless in **one room**, so that they can meet where the scenario wants them to. Each scene says which it is:

* A scene **limited to teams** shows a player only their own team. Use it for small rooms and for anywhere a team should feel on its own: a laboratory, a planet. A teacher is a member of the team they follow, so the same holds for them; they switch teams from the game's side panel.
* A scene that is **not** shows everyone playing. Use it for meeting places: an observation deck for briefings.

A scene's `team_only` decides; if it does not say, its group's `team_only` does; with neither, everyone is shown. Groups are `scene_groups` on the scenario, and a scene belongs to one through `group_id`:

```json
"scene_groups": [{ "id": 1, "name": "Starship" }, { "id": 2, "name": "Planet", "team_only": true }]
```

```json
{ "id": 8, "shortname": "laboratory", "group_id": 1, "team_only": true }
```

The demo does exactly this: the starship's rooms are shared except the laboratory, and the planet is each team's own. What is limited is what players **see and hear** of each other: avatars, emotes, chat, and events with `audience: scene`. A shared variable is always the team's own, in every scene: one team's rockfall never blocks another team's path, even in a scene where the teams can see each other. `QL_PlayerCount` counts the player's team. With no teams (the public instance, an assignment without teams) everyone is one team and the setting changes nothing.

In the editor, groups are made on the **Scenes** page, where each scene's card has its group and shows who is seen there; a scene's own setting is in the scene editor ("Who players see here").

### Background and foreground layers

Entries of `background_media` and `foreground_media` may be plain media objects, as before, or layer objects:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Media to draw.
position_x, position_y | decimal | 0 | Top-left corner.
display_width, display_height | decimal | scene size | Size to draw the image at.
tile | bool | false | Repeat the image to fill the display size.
scroll_speed_x, scroll_speed_y | decimal | 0 | For tiled layers: pixels per second the texture drifts.
parallax | decimal | 1 | How far the layer moves as the view moves along the scene. 1 moves with the world, 0 stays fixed on screen, between drifts slower as if far away (more than 1, faster, for something close). At the scene's left edge the layer's left edge shows, whatever the screen size, so a far layer needs to be only as wide as the widest view plus `parallax` times the rest of the scene.
sky | bool | false | Part of the sky (a band of clouds, a far view): with a scene `sky`, it takes on the sky's light as it changes.
main | bool | false | Background layers only: this layer is the scene's main picture, shown for the scene in lists (the scenario's card in the scenario list when this is the start scene, the editor's scene cards and scene map). At most one per scene; with none marked, the first background layer is the main picture. It does not change the drawing order or the scene's size, which still comes from the first background layer when the scene has no `width` and `height`.

Backgrounds draw in order behind everything; foregrounds draw in order in front of avatars.

### Background music

A scene starts with its own music (`music_media_id`, `music_volume` on the scene) or, failing that, the scenario's. Events can change the music at any time with an `audio` action flagged `repeat` and `persist`; the next scene starts with its own music again. One music track plays at a time, and a track that is already playing is never restarted, so walking between scenes that share music is seamless. A scene whose start events start background music themselves is left to do so.

### Scale areas

`scale_areas` is a list of boxes that give a scene depth. Whatever stands in a box is drawn at `scale_top` percent of its normal size at the box's top edge and `scale_bottom` percent at its bottom edge, and in proportion in between. It applies to avatars, to what they wear or ride, and to items and characters, by where their feet are.

Parameter | Type | Description
--------- | ---- | -----------
name | string | A label for the editor.
x, y, width, height | int | The box, in scene pixels.
scale_top | decimal | Percent of normal size at the top edge. 100 is unchanged.
scale_bottom | decimal | Percent of normal size at the bottom edge.
speed_effect | decimal | How much walking speed follows size, 0 to 100. Default 100: one to one, so a figure drawn at half size walks at half speed. 0: speed is unaffected. A value such as 60 lets distant figures cover ground a little faster than their size suggests without looking like they are racing.

```json
"scale_areas": [{ "name": "corridor depth", "x": 0, "y": 580, "width": 1800, "height": 620, "scale_top": 40, "scale_bottom": 100 }]
```

Scale areas are separate from walkable areas on purpose: a crate at the far end of a room should be small even though nobody can walk there. Outside every box things are drawn at normal size. Where boxes overlap, the first one listed applies. Scale areas change how things are drawn and, through `speed_effect`, how fast avatars walk. Hotspot radii, reach and blocking radii stay in scene pixels. The game server's speed limit is the full walking speed, so slowing down in a scale area never conflicts with it.

### Spawn points

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
name | string | | Unique within the scene. The one named `default` is used when none is asked for.
position_x, position_y | decimal | |
facing | string | right | `left` or `right`.

### Moving between scenes

Scenes are connected the way the original docs describe: with **jump actions**. To send players to the next scene when they reach the edge of the current one, put a walk-in hotspot along that edge and give it a jump action.

A hotspot whose `position_x` or `position_y` is null covers that entire axis, so one hotspot makes a whole edge:

```json
{
  "id": 310, "shortname": "edge-east",
  "position_x": 2250, "position_y": null, "radius": 35,
  "activate_by_trigger": false,
  "actions": [{ "id": 3101, "type": "jump", "scene_id": 4, "spawn_point": "west" }]
}
```

This fires when an avatar comes within 35 pixels of x = 2250, at any height. Use `position_y` with a null `position_x` for a top or bottom edge. Because it is an ordinary hotspot it can have conditions (a locked door), and the jump can be preceded by other actions (a sound, a line of text). The scene's end events run before the jump, as always.

The spawn point a jump arrives at must not be inside a walk-in hotspot that jumps, or arriving players would leave again at once. The validator rejects this.

## Events and hotspots

`activate_by_trigger` keeps its meaning. In a walk-around game the two cases are:

* `true`: fires when the player **clicks or taps** inside the radius (or on one of the hotspot's labels).
* `false`: fires when the player's avatar **walks into** the radius. It fires again each time they leave and re-enter. If it cannot fire at that moment (another event is blocking hotspots, or its conditions are not met) it fires as soon as it can while the avatar is still inside.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
once | bool | false | Fire only once per player, ever. Remembered in the save data.
reveal_radius | decimal | | The hotspot is only there when the player's avatar is within this many scene pixels of its position. Further away, its labels are invisible and it cannot be clicked. Absent: it is always there.
reveal_full_radius | decimal | half of reveal_radius | Within this distance the hotspot is fully visible. Between the two distances its labels fade in as the avatar approaches and out as it leaves.

The reveal distance is measured from each player's own avatar, so a hotspot can be visible to one player and not yet to another. A coordinate the hotspot leaves empty does not count towards the distance. Walk-in hotspots still fire by their `radius` alone.

### Who sees an event

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
audience | string | player | `player`: only the player who sets the event off sees it. `scene`: every player in the scene sees and hears it as it happens.

Every kind of event can have an `audience`. With `scene`, these actions are shown to the other players in the scene at the moment they happen for the player who set the event off: `audio`, `image_fixed`, `image_overlay`, `text_overlay`, `spritemap`, `video`, `dialogue`, `narration`, `translate`, `cancel` and `cancel_event`. In a shared dialogue, "the player" is the player who set it off: the bubble hangs over their avatar, and a story box shows their name and portrait.

Everything an event *does* stays with the player who set it off, whatever the audience: `variable`, `award`, `jump`, `freeze`, `avatar`, `shop`, `infobox` and the timing actions. Nothing another player's event shows can change your variables, move you or open a box you must answer. (A variable that should change for everyone is a shared variable; see [Variables](#variables). An avatar being hidden is seen by everyone anyway.)

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

## Actions

Action `type` values are matched loosely: `Image Fixed`, `imageFixed` and `image_fixed` are the same. The canonical names are `audio`, `cancel`, `image_fixed`, `image_overlay`, `infobox`, `jump`, `repeat`, `run_event`, `spritemap`, `text_overlay`, `translate`, `variable`, `video` and `wait`.

Actions may carry their own `conditions` array (the Conditions page allows this; the Actions page did not list it). An action whose conditions fail is skipped.

### Dialogue

A new action type, `dialogue`, shows what someone says: in a speech bubble over them, or in a story box with their portrait.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | What is said. `{{variable}}` placeholders work.
speaker | string | player | `player`, or `character`.
character_id | int | | The character, when `speaker` is `character`. For a bubble it must be placed in the scene; a story box can carry a voice from anywhere.
style | string | bubble | `bubble`: a speech bubble over the speaker. `portrait`: a story box.
duration | int | | Milliseconds on screen. Absent: a bubble stays long enough to read, and a story box stays until the player continues. A click closes either sooner.

```json
{ "type": "dialogue", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QL_PlayerName}}!" }
```

The bubble follows the speaker and keeps itself on screen. It sits above them when there is room, below when they are near the top of the screen, and to the right or left when there is room neither above nor below; sideways it slides along to stay inside the screen while its tail keeps pointing at the speaker. A sequence of dialogue actions is a conversation; put a `freeze` before it to hold the player still. For one where the player chooses what to say, use a [conversation](#conversations-dialogue-trees).

**The story box** (`style: "portrait"`) is for the characters and moments that carry the story. It is a panel across the bottom of the screen with the speaker's close-up portrait standing on its edge, their name, and the words appearing a few at a time. The player clicks, or presses Enter or Space, to continue: once to show the whole line, again to go on. The portrait is the speaker's `portrait` animation (or the character standing, if it has none): a character's, or for the player their avatar's.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QL_PlayerName}}! I am Captain Vega." }
```

A story conversation is normally the player's own (`audience: player`, the default), as the captain's greeting in the demo is. If its event is shown to the scene, the other players get a smaller version at the top of the screen that closes by itself and never takes their clicks or keys.

### The narrator

A new action type, `narration`, is the narrator speaking: the same story box as a portrait dialogue, with no close-up and no name, its words centred. It is for what no character says: setting the scene, what happens next, a word from the storyteller.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | What the narrator says. May contain `{{variable}}` placeholders.
duration | int | 0 | Milliseconds it stays. 0 or absent: until the player clicks, or presses Enter or Space, to continue (once to show the whole line, again to go on). With a duration it closes by itself, but not before the voice has finished.
narrate | bool | true | A narration is read aloud whatever the scenario's `narration` setting, unless this is `false`.
narration_media_id | int | | Its recording, made in the scenario's [narrator's voice](#reading-text-aloud) by "Record voices".

```json
{ "type": "narration", "text": "Long ago, beyond the edge of every map, there was a valley where the rivers ran uphill." }
```

Shown to the scene (`audience: scene`), the other players get the smaller box at the top of the screen that closes by itself, as with a story conversation.

### Conversations (dialogue trees)

A new action type, `conversation`, is a conversation the player takes part in: a **dialogue tree**. It is a list of lines, each said by the player or a character. After a line the player picks what to say next from its **choices**, and each choice leads to another line, or ends the conversation. Choices can lead back to a line already said, so a conversation can return to a "hub" ("Anything else?"). A line without choices goes straight on to its `next` line.

It is separate from `dialogue`, which says one line. The whole tree lives inside the one action, so it travels with the event, is duplicated and exported with it, and needs no ids of its own beyond the lines' names.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
lines | array | | The lines, below. At least one. Their order is the author's (the editor lets it be changed); the conversation goes by `start`, `next` and the choices. Lines that run on with `next` and no choices are said one after another, each in its own box, before the player answers the last.
start | string | the first line | The `id` of the line it starts with.
style | string | portrait | `portrait`: each line in a story box with the speaker's close-up. `bubble`: each line in a bubble over its speaker. Either way a line's choices come after it, once it has been said: as a story box of the player's own (their close-up and name), or for bubbles a plain box at the bottom of the screen.
narrate | bool | the scenario's | Read the lines aloud, each in its speaker's voice. See [Reading text aloud](#reading-text-aloud).

**A line**

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id | string | | Unique within the conversation: 1 to 32 letters, digits, `-` and `_`. What choices and `next` point at.
speaker | string | player | `player`, or `character`.
character_id | int | | The character, when `speaker` is `character`. As a bubble it must be placed in the scene; a story box can carry a voice from anywhere.
text | string | | What is said. `{{variable}}` placeholders work.
narration_media_id | int | | A recording of this line, played instead of the browser's voice.
conditions | array | | The line is said only while these hold. Otherwise the conversation passes over it to its `next`, so one line can stand in for another ("Back again?" before "Hello, stranger").
choices | array | | What the player can say in reply, below. Only those whose conditions hold are offered.
next | string | | Where it goes when it has no choices to offer: another line's `id`. Absent: the conversation ends.

**A choice**

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | The answer as the player sees it. `{{variable}}` placeholders work.
next | string | | The line it leads to. Absent: choosing it ends the conversation.
actions | array | | Actions done when it is chosen, in order, before the next line. They need no ids. A `jump` ends the conversation (and the event, as a jump of its own would).
conditions | array | | Offered only while these hold.
correct | bool | | For the teacher's report: a right answer. When any choice of a line is marked, the report says whether each student's first answer to it was right.

```json
{
  "type": "conversation",
  "lines": [
    { "id": "hello", "speaker": "character", "character_id": 1, "text": "Ready for your briefing, {{QL_PlayerName}}?", "next": "ask" },
    {
      "id": "ask", "speaker": "character", "character_id": 1, "text": "What do plants need to grow?",
      "choices": [
        { "text": "Sunlight and water", "correct": true, "next": "right", "actions": [{ "type": "variable", "name": "briefed", "operator": "set", "operand": 1 }] },
        { "text": "Only soil", "next": "wrong" }
      ]
    },
    { "id": "wrong", "speaker": "character", "character_id": 1, "text": "Not quite. Think about the sun.", "next": "ask" },
    { "id": "right", "speaker": "character", "character_id": 1, "text": "Exactly. Off you go!" }
  ]
}
```

How it runs:

* The action waits until the conversation is over (unless `blocking` is `false`), so the event's next action comes after it.
* While the player is choosing they cannot walk away. A line with nothing to choose is shown as a `dialogue` would be: a story box the player clicks on from, or a bubble that stays long enough to read. Players pick an answer by clicking it or pressing its number.
* What a choice does happens inside the event, as if its actions were the event's own: a `freeze` lasts to the end of the event, a `run_event` waits, a `cancel` naming the conversation ends it. A choice's actions cannot `repeat` the event. An `award` in a choice is not granted (awards are checked against the events' own actions): have the choice `run_event` an event that gives it.
* It is the player's own, like an infobox: an event whose audience is the scene does not show it to the other players.
* Each answer is logged as a `choice` with the reference `<action id>:<line id>`, so the report lists every line with choices as a question, with the first answer and how many tries it took.
* Lines that lead round in a circle with no choice to leave are stopped after 200 lines. The validator reports choices and lines that lead to a line that is not there, lines no choice leads to, and duplicate ids.

### Reading text aloud

Dialogue, infoboxes and text overlays can be read aloud, with **each word highlighted as it is spoken**. The voice is the one built into the player's browser (the Web Speech API): it costs nothing, needs no recordings and no server, and works with whatever voices the device has. The browser reports each word as it starts speaking it, and that is what moves the highlight; where a voice does not report its progress, the words are paced evenly over the time the line takes, allowing for longer words and for the pauses punctuation makes.

Parameter | Applies to | Default | Description
--------- | ---------- | ------- | -----------
narration | scenario | off | `on`: read everything unless an action says otherwise.
narrate | dialogue, narration, conversation, infobox, text_overlay | the scenario's (a narration's: `true`) | `true` or `false` for this action.
narration_media_id | dialogue, narration, infobox, text_overlay, a conversation's line | | An audio recording to play instead of the browser's voice. When the recording has word timings (`speech`, below), each word is lit as the recording says it; otherwise the words are paced evenly over its length.
speech | media (audio) | | The recording's words and when each is said: `{text, line?, voice?, engine?, words: [{w, s, e}], duration?}`, in milliseconds. Recordings made by the server's text-to-speech service have it. See [Characters' voices](/docs/developers/voices/).
narrator_voice | scenario | the default narrator | The voice what no character says is recorded in: narrations, and the text overlays and infoboxes read aloud. `none`: the browser reads them. See [Characters' voices](/docs/developers/voices/#the-narrator).
tts_voice | character | | The voice the character's lines are recorded in: a key of the server's voice catalog ("heart", "captain", "robot"). See [Characters' voices](/docs/developers/voices/).
voice_pitch, voice_rate | character | 1 | How the browser's voice sounds reading the character's lines that have no recording: 0 to 2, and 0.5 to 2.
voice_name | character | | For lines with no recording: part of the name of a browser voice to prefer ("female", "Daniel"). Devices differ; where none matches, the default voice reads.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "narrate": true, "text": "Welcome aboard, {{QL_PlayerName}}!" }
```

A speech bubble that is being read stays until the voice has finished. One thing is read at a time: a new line stops the one before. Players have a switch for reading aloud at the foot of the side panel (it is offered when the scenario has anything to read) and their choice is kept in their browser. In the demo the story's portrait dialogue is read.

Browser voices vary in quality from device to device. For a consistent voice, give characters a recorded voice: the server records their lines once with its text-to-speech service (Kokoro, in the `tts` container), with the time of every word, and the highlight follows the recording exactly. See [Characters' voices](/docs/developers/voices/). A recording of your own can be attached with `narration_media_id` too; its words are paced evenly.

### Glossary

A scenario can teach words. `glossary` on the scenario lists them; players see the ones they have in the side panel, in alphabetical order, and can search them.

Parameter | Type | Description
--------- | ---- | -----------
id | string or int | Unique within the scenario.
term | string | The word.
definition | string | What it means. `{{variable}}` placeholders work.
media_id | int | A picture, optional.
initial | bool | In every player's glossary from the start. Otherwise a `glossary` action adds it.

A new action type, `glossary`, gives the player a word:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
entry_id | string or int | | The entry's `id`.
quiet | bool | false | Add it without telling the player.

```json
{ "type": "glossary", "entry_id": "ph" }
```

A player gets each word once (they are told, and the word is marked as new in the panel). Words are kept with the player's save, as flags (`glossary:<id>`), so they are still there next visit. The action never holds up the sequence. Which words each student has is part of the teacher's report.

### Animate

A new action type, `animate`, plays an animation on something in the scene. See [Animations](#animations) for where animations come from.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
animation | string | | The animation's name: one of the character's or avatar's animations (not a pose), one defined on an item's sprite sheet, or a built-in move (`jump`, `spin`, `crouch`, `wave`, `dance`). Empty: stop what is playing and return to standing and walking.
target | string | player | `player`: the avatar of the player whose event this is. `item`: an item or vehicle, on the floor of this scene or being worn or ridden. `character`: a character placed in this scene. `action`: a picture that an `image_fixed` action is showing.
item_id, character_id, target_id | int | | Which item, character or action, for those targets.

```json
{ "type": "animate", "target": "character", "character_id": 1, "animation": "wave", "blocking": false }
```

With `blocking` (the default) the sequence waits until a one-pass animation has finished; a looping one never holds it up. An animation on a **player's avatar goes through the game server**, so everyone in the scene sees it, whatever the event's audience. An animation on an item, a character or a picture is shown to the other players only when the event's `audience` is `scene`, like anything else an event shows.

### Walk

A new action type, `walk`, walks a character or the player somewhere on foot. Unlike [`translate`](/docs/developers/action/#translate), which glides a picture in a straight line, a walk finds a way around whatever is in the scene (walkable and blocked areas, blocking items, solid labels), plays the walking poses, turns the walker the way it goes, and slows down in [scale areas](#scale-areas) as players do.

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

**Who sees it.** A character that [roams](#characters-that-walk-around-on-their-own) is walked by the game server, for everyone, and stays where it went. Any other character walks on the player's own screen (or, when the event's `audience` is `scene`, on everyone's in the scene), like any other thing an event shows; one that walks out through a door is gone from the scene until it is entered again. The player walks themselves through the room as usual (their position reaches everyone through the room state), even while [frozen](#freeze): a freeze and walks make a cutscene. A player walked `to` a scene goes through a door of this scene, running the door's actions as if they had walked in (or clicked it), so only a scene next to this one can be reached.

With `blocking` (the default) the next action waits until the walker arrives, or stops trying: there is no way there, another walk took over, or (for the player) the player walked off elsewhere.

**Off stage.** A walk to a point beyond the left or right edge of the scene goes to the edge and on out of sight; a character placed beyond an edge comes on from there. See [story scenes](#story-scenes).

### Weather action

A new action type, `weather`, changes the scene's [weather](#weather) while the player is there, slowly: the rain starts, a storm blows up, the snow stops. Everyone in the scene sees it when the event's audience is the scene.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
kind | string | | `clear` (it stops), `rain`, `snow`, `storm`, `blizzard` or `fog`. The same kind changes how heavy it is; another fades the old one out as the new one comes in.
intensity, wind, lightning | | | As for the scene's weather.
duration | int | 3000 | Milliseconds the change takes. With `blocking`, the next action waits for it.

```json
{ "type": "weather", "kind": "storm", "intensity": 0.9, "duration": 5000, "blocking": false }
```

It lasts until another weather action, or until the player leaves the scene, which has its own weather again next time.

### Camera

A new action type, `camera`, points the player's view.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
target | string | | `character`: follow a character placed in the scene as they move. `point`: glide to a spot and stay. `player`: follow the player again (as the view does outside story scenes). `auto`: follow whoever is acting, as a [story scene](#story-scenes) does. Default: `character` with a `character_id`, `point` with a position, else `player`.
character_id | int | | For `character`.
position_x, position_y | int | | For `point`: the middle of the view, kept inside the scene.
duration | int | 1200 | Milliseconds the glide takes; with `blocking`, the next action waits for it.

It lasts until another camera action, or the scene ends.

### The game's own sounds

An `audio` action can play a sound the game makes itself instead of a file: `{ "type": "audio", "sound": "thunder" }`. They are made with Web Audio as they play (`apps/client/src/audio/synth.ts`), through the game's master volume, so a scenario needs no sound files for its rain or a car going by. The list is `BUILT_IN_SOUNDS` in `packages/shared/src/sounds.ts`:

- **Ones that go on** (loop them with `repeat`; without it they play for a few seconds): `rain`, `heavy_rain`, `wind`, `river`, `stream`, `waves`, `fire` (crackling), `birds` (singing), `crickets`.
- **One-shots**: `thunder`, `car` (driving by, left to right, pitched up and then down as it passes), `horn`, `hooves` (going by), `bell`, `chime` (magic), `knock`, `door` (creaking shut), `footsteps`, `splash`, `whoosh`, `pop`, `tweet`.

`volume` works as for any sound; a cancel action stops it.

### Freeze

A new action type, `freeze`, stops the player from walking, or lets them walk again: for a conversation with a character, a cutscene, a countdown.

Parameter | Type | Description
--------- | ---- | -----------
frozen | bool | `true`: the player cannot move. `false`: they can again.

```json
{ "type": "freeze", "frozen": true }
```

A freeze ends at a `freeze` action with `frozen: false`, **or when the event that froze the player finishes**, or on leaving the scene, whichever comes first, so a player can never be left stuck by a missing action. While frozen a player can still click hotspots and infobox buttons. The demo freezes the player while Captain Vega is speaking.

### Cancel event

A new action type, `cancel_event`, stops an event of the same scene that is running. `cancel` stops one action; this stops a whole event: a loop of a bird flying about, a countdown, a character's chatter once the player has solved the puzzle.

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

### Travel

A new action type, `travel`, takes the player out of this scenario to the mission their teacher has just launched. It is how a **departure scene** ends: a teacher, playing with the class, launches one of their assignments from the game's 🚀 tab and may choose a scene of the current scenario for everyone to go through first (into the time portal, aboard the shuttle). The game server puts every student of that assignment who is in the room into that scene, door or no door; its events play; their `travel` action takes each student into their own instance of the launched mission (`/{code}?group=…`). Launched with no departure scene, the client runs a `travel` in whatever scene the player is in.

Parameter | Type | Description
--------- | ---- | -----------
to | string | Where to. `launched` (the default, and the only value so far): the mission the teacher launched for the player.

```json
{ "type": "travel" }
```

* Like `jump`, it ends the event, and the scene's end events run before the player goes. It works on infobox buttons and conversation choices too.
* With nothing launched for the player (they walked into the departure scene another day) nothing happens and the event carries on with its next action. The system variable `QL_NextMission` tells the cases apart: the title of the launched mission while one is waiting for the player to go, and empty otherwise (test it with `!=` and an empty value).
* A teacher is offered as departure scenes only the scenes with a `travel` action somewhere in their events (`departureScenes`).
* While a player is still in the departure scene a launch put them in, they are saved where they were before it, so coming back to the scenario another day does not start them mid-countdown.
* In a preview there is no launch: a toast says where players would go, and the event carries on.

### Avatar

A new action type, `avatar`, shows or hides the player's own avatar.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
visible | bool | | `false` hides the avatar, `true` shows it.
duration | int | 0 | Fade time in milliseconds.

```json
{ "type": "avatar", "visible": false, "duration": 400 }
```

The change goes through the game server, so every player in the scene sees it. A hidden player can still walk and use hotspots. Avatars are **always shown again when a player arrives in a scene**: to keep them hidden in a scene, hide them in one of its start events. The demo's rocket hides the avatar as the player steps aboard, and the player reappears in the control room. (The scene attribute `show_avatars: false` from the base docs still hides every avatar in a scene, for everyone, for the whole visit.)

### Award

A new action type, `award`, gives the player stars, XP, or both. A negative number takes them away.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
stars | int | 0 | Stars to give (or take, if negative). Stars are the currency of the marketplace.
xp | int | 0 | Experience points to give (or take). XP is never spent; it adds up to a rank.
note | string | | A few words shown with the award: "Sample collected".
repeatable | bool | false | By default a player gets each award **once**, however often its event runs and in however many visits. Set this to give it every time.

```json
{ "type": "award", "stars": 3, "xp": 10, "note": "Sample collected" }
```

Stars and XP belong to the player's **account**, not to a scenario: they carry across every scenario on the platform. See [Stars, XP and the marketplace](#stars-xp-and-the-marketplace) for how they are kept honest.

**Badges.** An award can carry a badge: `badge` (its name), and optionally `badge_description` and `badge_media_id` (its picture). A player earns each badge once, and it is shown on their [profile](/docs/editor/classes/#profiles), where other players can see it.

```json
{ "type": "award", "stars": 10, "xp": 40, "badge": "Stream Saver", "badge_description": "Found out why the stream wilted", "badge_media_id": 46 }
```

* Neither total goes below zero. Taking away more than a player has leaves them with none.
* **Guests earn nothing.** Stars and XP need a signed-in account.
* Put awards in an event's own actions. An award placed directly on an infobox button is not given (the validator warns): make the button run an event (`run_event`) that contains the award.
* Awards never hold up the sequence, whatever `blocking` says.

### Shop

A new action type, `shop`, opens the marketplace. It has no parameters. The sequence waits until the player closes the window.

```json
{ "type": "shop" }
```

Players can also open the marketplace at any time from the stars shown in the corner of the screen, so a scenario needs no shop action; it is there for scenarios that want a place for it, as the demo's marketplace room does.

Addition | Applies to | Description
-------- | ---------- | -----------
dismissible | infobox | Default true. See below.
media_id, size, accent | infobox | A picture or video (`media_id`) drawn across the top; `small`, `medium` (default) or `large`; a CSS colour for the edge and main buttons. See [Rich infoboxes](#rich-infoboxes).
mark | an infobox's `call_to_actions` | `right`, `wrong` or `try_again`. See [Rich infoboxes](#rich-infoboxes).
spawn_point | jump | Spawn point to arrive at in the target scene.
target_event_id | run_event | The event to run. Use this rather than `event_id`, which the base action attributes already use for "the event this action belongs to". `event_id` is still read if `target_event_id` is absent.
layer | image_fixed, spritemap | `above` (default) draws over avatars and foregrounds. `sorted` depth-sorts with avatars using `position_y`, so players can walk in front of it.
position_x, position_y, scale_x, scale_y, alpha, duration | translate | Values present are animated on the target over `duration` milliseconds. Position applies to `image_fixed` and `spritemap` targets; overlays support scale and alpha.
alignment, scale_x, scale_y, volume | video | Video plays as an overlay with browser controls. It blocks until it ends.

Clarifications of documented behaviour:

* An action with no end (an image or text with `duration` 0, repeating audio, a repeating spritemap) never holds up the sequence, whatever `blocking` says. It stays until a cancel or a jump.
* A `repeat` with no `wait` in its loop runs about once per frame rather than freezing the page.
* `call_to_actions` is a list of `{"text": "...", "action": {...}, "conditions": [...]}`. The action needs no `id`. A button with `conditions` is only offered while they hold, so one infobox can serve as a menu that changes.
* An infobox has a close button unless `dismissible` is `false`. A box that cannot be dismissed must be answered with one of its buttons, which is how questions are asked.
* An infobox action is not finished until the box is closed **and** the chosen button's action has run to its end. A sequence such as "ask a question, then open a menu" therefore waits for the feedback the answer triggers.
* Infobox `content` is sanitised. Formatting, lists, tables, links, images, video, sound and the blocks below are kept; scripts, styles, classes, frames, forms and event handlers are removed.

### Rich infoboxes

An infobox's `content` is still one string of HTML, so a document written for the original spec plays unchanged and HTML can still be written by hand. Richer parts are ordinary HTML marked with `data-qbl`; the game makes them interactive, and anything else reading the document sees plain HTML. They are listed in `packages/shared/src/infobox.ts`.

Markup | What players get
------ | ----------------
`<hr data-qbl="page">` | A new page. The box steps through its pages with Next and Back (and ← →), with dots showing where the player is; its buttons are offered on the last page. Each page is read aloud as it is shown.
`<img src="{{media:ID}}">`, `<figure data-size="small\|medium">…<figcaption>` | A picture, tapped to see it large. `data-size` on the `figure` or the `img`; full width without it.
`<video src="{{media:ID}}">`, `<audio src="…">` | Played with their controls. `autoplay` (a video then starts muted) and `loop` are kept.
`<div data-qbl="gallery">` of `<figure>`s or `<img>`s | A slideshow: swipe, arrows, dots, ← →.
`<details><summary>Prompt</summary>…</details>` | A card that opens smoothly. What it hides is not read aloud.
`<div data-qbl="flip"><div>front</div><div>back</div></div>` | A card that turns over when tapped. The back is not read aloud.
`<div data-qbl="callout" data-tone="tip\|fact\|warn\|think">` | A coloured note with an icon.
`<input data-qbl="answer" data-var="name" placeholder="…">` | A box to type in. When a button is chosen, what was typed is saved in the variable (`set`; a number when it reads as one) before the button's action runs. The first button waits until every answer box has something in it. The answer is logged with the choice for the report: `“7” (Check)`.
`<span data-qbl="word" data-word="ID">word</span>` | A glossary word. Tapped, a card says what it means and the entry is added to the player's glossary (logged as a `glossary` activity, like a `glossary` action).

A `{{media:ID}}` written on its own in the text, not inside a tag, shows the media itself: a picture, a video or a sound.

**Controls**, for hands-on instruments with many parts side by side. Each control has a variable (`data-var`, which must be declared) that its value is saved in when a button of the box is chosen, before the button's action runs, as an answer box's is; until then the box shows what it would do. The values are logged with the choice, like answers. `{{name}}` in an attribute puts a variable's value there, so `data-value="{{rope}}"` opens the box as the player left it.

Markup | What players get
------ | ----------------
`<div data-qbl="panel">…</div>` | A bench: what is in it stands side by side, two or three across (one column on a narrow screen).
`<input data-qbl="slider" data-var="rope" data-min="0" data-max="20" data-step="1" data-value="8" data-unit=" m" data-label="Rope">` | A number set by sliding, with its label, its value and both ends. The value is saved as a number.
`<input data-qbl="switch" data-var="brake" data-value="1" data-label="Brake">` | A switch, on (1) or off (0).
`<div data-qbl="wheel" data-var="wind" data-options="Calm\|Breezy\|Calm" data-label="Wind"></div>` | A wheel of chance. Spin turns it for a couple of seconds and it lands on one of its options at random; repeat an option to make it likelier. `data-spins` limits how often it can be spun in one showing; `data-value` shows where it last landed (kept unless spun again). Nothing is saved until it has landed.
`<span data-qbl="value" data-var="rope"></span>` | A control's value as it is now (or any variable's).
`<div data-qbl="meter" data-var="rope" data-min="0" data-max="20" data-label="Rope out"></div>` | A bar showing a value between its ends.
`<div data-qbl="when" data-when="rope >= 12; brake = 1">…</div>` | Shown only while every condition holds (`=`, `!=`, `<`, `>`, `<=`, `>=`, `%`, `!%`, separated by `;` or `,`), on the controls as they are set now and on variables. It appears with a little lift, and a screen reader hears it.

**Maths, worked-out values and graphs.** Formulas are worked out with math.js (`@qbl/shared/formula`, an entry of its own so that only a box with a formula loads it), typeset with KaTeX and drawn with JSXGraph. Each is loaded the first time a box needs it.

Markup | What players get
------ | ----------------
`<div data-qbl="math" data-tex="\frac{m}{V}">m / V</div>`, `<span data-qbl="math" data-tex="x^2">x^2</span>` | Maths typeset by KaTeX, on a line of its own (`div`) or in a line of text (`span`). `\ce{2H2 + O2 -> 2H2O}` sets chemistry (KaTeX's mhchem). What is inside the tag is what a reader without KaTeX shows. It is not read aloud.
`<span data-qbl="calc" data-formula="mass / volume" data-digits="2" data-unit="g/mL" data-var="density"></span>` | A formula's value, from the controls as they are now and from variables. With `data-var` (which must be declared) it is saved there when a button is chosen, and values, meters and `when` blocks of the box can read it at once. A dash when the formula has no value.
`<input data-qbl="answer" data-var="a" data-accept="9.8 m/s^2" data-tolerance="2%" data-check="a_right">` | An answer box that is checked. When a button is chosen, `data-check` (declared) is set to 1 if what was typed is `data-accept`, else 0. `data-accept` is a number, a quantity with a unit (right in any unit of its kind; a bare number is then wrong), a formula of variables, or words; `\|` separates several. `data-tolerance` is a share (`5%`) or an amount. What is typed is worked out with no variables.
`<div data-qbl="graph" data-fn="a*x^2; sin(x)" data-x="-5,5" data-y="-5,5" data-points="px,py=1,2; qx,qy=3,1" data-join="line" data-snap="1" data-series="log" data-xlabel="t" data-ylabel="h" data-label="Title"></div>` | Axes with a curve for each formula of `x` in `data-fn` (other names are controls and variables: curves follow sliders), points the player drags (`xVar,yVar=x,y`; saved in their two declared variables when a button is chosen; `data-snap` makes them land on multiples), joined as `data-join` says (`line` through the first two, `segment`s in order, a `polygon`), and the data recorded in the variable `data-series` as `x,y;x,y` (what a bench's graph keeps).

A formula is written as math.js reads it: `+ - * / ^`, brackets, `sqrt`, `sin`, `round(x, 1)`, `pi`, and quantities with units (`(2 m + 50 cm) to cm`). A variable with nothing in it counts as 0. The parts of math.js that reach outside a formula (`import`, `createUnit`, `evaluate`, `parse` and the like) are switched off, since formulas are written by authors and answers typed by players. The validator reports a formula whose brackets do not match, a point, worked-out value or check whose variable is not declared, and warns of a name a formula reads that is neither a control of the box nor a variable.

The buttons do the testing: a "Test" button sets a variable, and conditions on the following actions read the controls' variables (see how the generator builds an [instrument](/docs/developers/generation/)). The validator reports a control whose variable is not declared, and a value, meter or `when` block that reads a variable that is neither a control in the box, an answer, a declared variable nor a reserved one.

Each button in `call_to_actions` can have a `mark`. `right`: the button turns green with a tick and a burst of stars for about 650 ms before the box closes and the button's action runs. `wrong`: it turns red and shakes, then the same. `try_again`: it shakes and is crossed out and **the box stays open**; its action, if any, runs while it does, and the box waits for it. The choice is logged either way, so the report's first answer is still the first one chosen. A box with `dismissible: false` needs at least one button that is always offered and is not `try_again`.

The box opens with a short spring and closes with a fade. When a button's action opens another infobox, the two share the backdrop and cross over. A box opened over another (a `try_again` button's infobox) leaves the one below inert until it closes. Everything moves less when the player's system asks for reduced motion.

When a scenario is copied or imported, `{{media:ID}}` placeholders in any text are pointed at the copied media.
* **Background music** is an audio action with `repeat` and `persist` in a scene's start events. Persistent audio is treated as the music track: only one plays at a time. When a scene starts a persistent audio action with the same media that is already playing, the music carries on without restarting; with different media, it replaces the old track. A cancel action naming the audio action's id stops it.

### Bench

`{ "type": "bench", "op": "reset" | "add" | "empty" | "stir" | "burner", … }` works the scene's [close-up bench](#close-up-bench): `reset` puts everything back as it started; `add` puts `amount` of `substance` into `vessel_id`; `empty` and `stir` take a `vessel_id`; `burner` lights or puts out `tool_id` (`on`: true or false; absent, it changes over). In a scene with no bench it does nothing, and the validator says so.

## Close-up bench

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

## The side panel

Everything that used to float over the scene is in one panel at the side of the screen: a rail of icons that is always there, each opening its panel and closing it again (Escape closes it too). The panel that was open is remembered between visits.

Panel | Holds | Shown when
----- | ----- | ----------
Mission | The objectives checklist | The scenario has objectives. Open at first, as the checklist always was
Inventory | What the player is wearing or riding, with a button to leave each, and the way into the wardrobe and marketplace | There is anything to show
Moves and emotes | The move buttons and the emote pad | The scenario has moves, or chat is not `off`
Players | Everyone in the scenario with the player: teammates first, each with where they are. A name opens that player's profile | Always
Messages | What was said in the scene, and private conversations | `chat_mode` is `free`, or `private_messages` is on
Glossary | The player's words | The scenario has a glossary

**Icons.** Every icon in the game and the editor is an emoji from one set, Twemoji, drawn through the [Twemoji Awesome](https://github.com/iamludal/twemoji-awesome) stylesheet (MIT, vendored in `packages/shared/assets/twemoji-awesome.css`): `<i class="twa twa-rocket"></i>`. They look the same on every device, where plain emoji characters differ from one system to the next. The interface's own icons are named in `packages/shared/src/icons.ts`; the emote pad, move buttons and the editor's tabs and lists are drawn the same way. After using a new emoji as an icon, run `node tools/make-twemoji-map.mjs <checkout of twemoji-awesome>` so it has its class; one without is shown as the plain character. The stylesheet loads each picture from `twitter.github.io/twemoji`: a site that must work without reaching that address should host the SVGs itself and replace the address in the stylesheet. Emoji drawn inside the scene (a speech bubble over an avatar) are still the device's own.

### Messages

With `chat_mode: free`, what is typed is said in the scene: it shows as a bubble over the speaker and in the Messages panel, for the players who can see the speaker (those in the scene, and only teammates where the scene is limited to teams). With `private_messages: true`, a player can also write to **one** other player anywhere in the scenario, from the Players panel or that player's profile; only the two of them see it.

Every message is cleaned and length-limited by the game server like chat, and **every message is logged**, scene or private, with who wrote it, to whom, where and when, so that it can be audited later. A teacher reads the log of an assignment on the Classes page. Players are told on the panel that messages are kept.

## Variables

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
scope | string | player | `player`: each player has their own value, saved with their progress. `room`: one value shared by everyone in the group, held by the game server.
persist | bool | true | If false the variable returns to `default_value` on every visit.

**Each variable is one or the other, and its `scope` says which.**

* A **player's own** variable (`player`) has a separate value for every player. Changing it for one player changes nothing for anyone else. Use it for a player's progress: students must greet three animals before a door opens, and each has their own count of how many they have greeted.
* A **shared** variable (`room`) has one value for everyone playing together. When any player changes it, it changes for all of them at once, wherever in the scenario they are. Use it for the state of the world: one student sends boulders down across a path, and after that nobody can use the path.

Conditions and variable actions are written the same way for both; only the variable's scope differs, so a scenario decides this once, where the variable is defined, and not in every action. A variable action on a shared variable is sent to the game server, applied there, and the new value reaches every player; hotspots and objectives whose conditions use it update for everyone. The editor marks shared variables wherever one is chosen.

"Everyone playing together" is a group: the players who joined with the same group key (a class, a team), up to `max_players`. A shared variable with `persist` is saved with the group's game, so the path is still blocked when they come back tomorrow; a different group has its own. A player's own variables are reported by the browser and can be tampered with; shared variables are held by the server, but any player's event can change them, so they are not secrets either.

Both examples are in the demo: the rockfall above the spring meadow (`rockfall`, shared, cleared again by the repair drone in the engine room) and the critters in the hydroponics bay (`critters_met`, each player's own).

`QL_Holding` is the id of the thing the player has picked in their bag to use (see [The bag](#the-bag-point-and-click-things)), and 0 otherwise.

The other reserved variables these extensions add are in [Reserved Variables](/docs/developers/variable/#reserved-variables): `QL_SceneId`, `QL_PlayerCount`, and for the player's account `QL_PlayerStars`, `QL_PlayerXP`, `QL_PlayerRank` (the rank's name) and `QL_Ability_<key>` (1 while the player has a marketplace ability with that key equipped, otherwise 0). They can be used in conditions and as `{{placeholders}}` like any other variable.

Additional condition operators: `>=`, `<=`, and the modulus pair `%` (the variable is a whole multiple of the operand, e.g. `turns % 2` on even turns) and `!%` (it is not one, e.g. `turns !% 2` on odd turns). See [Conditions](/docs/developers/condition/).

## Items

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Image for the item.
scale | decimal | 1.0 | Display scale.
blocking_radius | decimal | 40 | Size of the obstacle for `blocking` items.
placement | string | object | `object`: sorted among the players by where it stands. `background`: it lies on the floor and everyone walks over it.
sort_line | array | | Objects only: where the item meets the floor, for something that runs into the room at an angle (a counter, a bench seen from the side). At least two `[x, y]` points along its base, each a fraction of its picture (0 left/top, 1 right/bottom), e.g. `[[0, 0.6], [0.5, 0.93], [1, 1]]`. A figure (avatar, character or pet) overlapping the picture whose feet are below the line where it stands is drawn in front of the item; one above it is drawn behind it. The line is straight between its points and level beyond its ends, and is mirrored with the picture. The item itself is drawn at the depth of the line's lowest point. Unset: the bottom edge of the picture is the line.
attach_offset_x, attach_offset_y | decimal | 0 | Where the item sits relative to the avatar's feet while worn or ridden. X is mirrored when the avatar faces left.
attach_layer | string | front | `front` or `behind` the avatar.
art_faces | string | right | Which way the artwork faces. It is mirrored to match the avatar.
hide_rider_below | decimal | | While worn or ridden, the avatar (and what it wears) is not drawn below this line: a fraction of the item's picture height, 0 at its top and 1 at its bottom. Lets a rider sit in a UFO or a car instead of their legs showing beneath it. Unset: the whole avatar is drawn.
speed_multiplier | decimal | 1.5 | Vehicles: walking speed while riding.

Items are positioned by the bottom centre of their image, like avatars.

**Wearables and vehicles** work the same way: clicking one within reach attaches it to the avatar, and a button on screen removes it. A player can ride one vehicle at a time.

* `unique: true`: one exists per room. While someone has it nobody else can take it, and when they let go (or disconnect) it stays where they stood, in whatever scene that is. Its position is saved with the room.
* `unique: false`: every player has their own. It disappears from the floor for the player using it and is saved with that player.

`blocking` is implemented. `physical` (pushable objects) is **not implemented yet**.

### The bag: point-and-click things

An item with `carried_when` is something players carry, as in a point-and-click adventure. While its conditions hold (usually a player's own variable, set to 1 by the event that picks it up and back to 0 when it is used up) it is in the player's **bag**: a bar of pictures at the foot of their screen.

Parameter | Type | Description
--------- | ---- | -----------
carried_when | conditions | The item is in the player's bag while these hold. Absent: it is never carried.
description | string | What the player reads when they point at it in their bag.

Using a thing works through one reserved variable, `QL_Holding`. The player picks a thing in the bag (it is marked, with a line saying what to do), then:

* **clicks something in the scene.** Only hotspots that **take things** run: those whose conditions, or the conditions of one of their own actions or of an event they run, test `QL_Holding`. Give the hotspot that uses the rope the condition `QL_Holding = <the rope's id>` and it is there only while the rope is picked. Anything else clickable under the pointer says "That does not work there." Clicking empty floor walks there, still holding the thing.
* **clicks a character.** Their click event runs if it takes things (tests `QL_Holding`), so it can thank them for the right thing and turn down anything else; otherwise the player is told the character does not need that.
* **picks a second thing.** If `combinations` has the pair, its actions are done; otherwise the player is told the two do not go together. Picking the same thing again, or pressing Escape, puts it back.

`QL_Holding` keeps the thing's id until whatever the click started has finished, so every action of the event can test it; the bag lets go at once. What happens to the thing is up to the event: set its variable to 0 to use it up, or leave it to keep it.

```json
"combinations": [{
  "items": [21, 22],
  "actions": [
    { "type": "variable", "name": "has_rope", "operator": "set", "operand": 0 },
    { "type": "variable", "name": "has_hook", "operator": "set", "operand": 0 },
    { "type": "variable", "name": "has_grapple", "operator": "set", "operand": 1 },
    { "type": "text_overlay", "text": "You tie the hook to the rope.", "duration": 3000 }
  ]
}]
```

A combination's actions need no ids and are done in whatever scene the player is in, so they are the kinds that work anywhere: `variable`, `text_overlay`, `audio`, `glossary`, `infobox`, `wait`, and `dialogue` said by the player. A combination can have `conditions`. The validator checks that both items exist and can be carried.

### Vehicles are single objects

A vehicle is always `unique`, whatever the document says: there is one of it in the room. It goes with whoever is riding it, across scenes. When the rider gets out it stays in that scene at that spot, where any player can climb in. Where vehicles were left is part of the room's saved data, so a vehicle left on the planet is still on the planet next lesson.

## Characters

Everyone who walks around a scene is a **character**: the avatars players choose from, and the characters (NPCs) a scenario places. Both are drawn from their **animations**, by name, and nothing else; they differ in where they live. A scenario's characters are in `characters` and placed by `scenes[].characters`. Avatars belong to the platform, the same in every scenario: the server adds them to the document as `avatars` (above), and a player's choice of avatar (`avatar_media_id` on their account, `avatar` in the room) is an avatar's `id`.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id, name | int, string | | As in the base docs.
animations | object | | The character's animations, by name. See below.
scale | decimal | 1.0 | Display scale of its pictures. Each picture is also stretched by its own media `scale_x` and `scale_y`, so a sheet shared by several characters can be sized once, on the media, and each character sized on top of that.
tts_voice | | | The voice its lines are recorded in, a key of the server's voice catalog. See [Characters' voices](/docs/developers/voices/).
voice_pitch, voice_rate, voice_name | | | How the browser reads its lines that have no recording. See [Reading text aloud](#reading-text-aloud).
conditions | array | | Scenario characters only: the character is there only while these hold. One whose conditions stop holding while players are in the scene fades away (a character who leaves for good sets a shared variable it tests). One placed in the scene (not roaming) fades back in where it is placed once they hold again: a character who fell and has been rescued.
media_id, portrait_media_id | int | | *Before animations.* One picture and a close-up. Read only when `animations` is empty (see below).

### Animations of a character

Each animation is a picture of the scenario (for an avatar, of the platform) and how to play it:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | The picture: a still image, an **animated PNG**, or a **sprite sheet** (an image with `sheet`, see [Sprite sheets](#sprite-sheets-and-named-animations)). The picture is ordinary media, so one sheet can serve several characters, each taking the frames it needs.
frames | array | every frame | For a sheet or an animated PNG: the frame numbers to show, in order. Frames may repeat.
duration | int | | Milliseconds one pass takes. Default: an animated PNG's own speed (in proportion, for some of its frames), else 100 per frame.
repeat | bool | | Whether it loops. Default: the poses loop, and the built-in moves that loop (`dance`); anything else plays once.
flip | bool | false | Draw it mirrored, so art drawn facing one way serves the other.
sheet_animation | string | | The animation of the picture's this one plays, by name (the picture's `animations`, made on the Media page). The editor copies its `frames`, `duration` and `repeat` here and keeps them in step when it changes, so the game reads only the fields above.

Five names are **poses**, which the game shows by itself:

Name | Shown
---- | -----
`stand_right`, `stand_left` | While the character stands, facing that way.
`walk_right`, `walk_left` | While it walks that way.
`portrait` | Beside what it says in a story box (`dialogue` with `style: "portrait"`), and as its face on the player's own pages.

A pose that is missing is filled in from another, so a single picture makes a whole character. Walking uses `walk_<way>`, else the other walk mirrored, else standing. Standing uses `stand_<way>`, else the other stand mirrored, else the portrait. The portrait is `portrait`, else the character standing facing right. Art is taken to face the way its name says: give a character only `stand_right` and it is mirrored to face left.

Any **other name** (`wave`, `dig`, `talk`...) is played when an [`animate` action](#animate) or, for an avatar, a player's [move](#moves-what-players-can-do-themselves) asks for it. A name that is also a [built-in move](#built-in-moves) (`jump`, `dance`...) replaces that move with these frames. Names are lowercase letters, digits and underscores, starting with a letter.

```json
{ "id": 1, "name": "Captain Vega", "scale": 0.85,
  "animations": {
    "stand_right": { "media_id": 109, "frames": [0, 1], "duration": 900 },
    "walk_right": { "media_id": 109, "frames": [6, 7, 8, 9, 10, 11], "duration": 600 },
    "portrait": { "media_id": 110 },
    "wave": { "media_id": 140 }
  } }
```

Here she stands and walks from one sheet (mirrored when facing left), her close-up is a still picture, and she waves with an animated PNG played whole at its own speed.

**Older documents.** A character with no `animations` is read from `media_id` and `portrait_media_id`: the picture is `stand_right` (on a sprite sheet, the sheet's own `idle` is `stand_right`, its `walk`, `walk_right` and `walk_left` are the walks, and its other animations are the character's), and the close-up is `portrait`. An `avatar_media_ids` list is read the same way, each picture an avatar with the picture's id. Nothing has to be rewritten; the editor saves a character as animations the first time it is changed.

**Platform avatars** (Laravel API) are rows of `avatars`. An avatar's `settings.animations` names pictures that are rows of `platform_media` (the platform's own pictures, which several avatars can share); an older row with `image_url` (and a sheet in `settings`) and `portrait_url` is read as one picture and a close-up. `database/seeders/data/avatars.php` gives pictures by address and seeding makes one `platform_media` row per address.

A placement's `event_id` names an indirect event in the same scene that runs when the character is clicked, typically an infobox with what they say.

### Characters that walk around on their own

A character with `roams: true`, or with a `routine`, **lives in the world**. There is one of it per instance (team), kept by the game server like a [unique item](#items): every player sees it in the same place, it walks between scenes, and where it was left is saved with the instance (`characters` in [room data](/docs/developers/save-data/#room-data)). It starts at its **first placement**, taking the scenes in order. Placing it in other scenes too does not make copies: it says what clicking it does in that scene (`event_id`). Its `conditions` still decide, for each player, whether it can be seen.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
roams | bool | false | It walks around on its own. Set by itself when it has a routine.
walk_speed | int | `move_speed` | Scene pixels per second when a walk does not say.
routine | object | | What it does on its own (below).

A **routine** is a list of steps the server runs one after another, for everyone, whether or not anyone is watching:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
steps | array | | The steps, in order.
loop | bool | true | Start again from the first step after the last.
conditions | array | | It keeps to its routine only while these hold. When they stop holding it stops where it is, and carries on with the step it was on when they hold again.

Each step is written as the action it is, without an `id` and without saying who does it (it is the character itself): `walk` (any destination above), `wait`, `dialogue` (a bubble over the character; `style`, `speaker` and `character_id` are not used), `animate` (`animation` only) and `variable`. A step may have `conditions` (it is skipped while they do not hold) and `blocking: false` (the next step starts at once: say something while walking).

```json
{ "id": 3, "name": "Robo", "walk_speed": 240,
  "animations": { "stand_right": { "media_id": 50 }, "walk_right": { "media_id": 51 } },
  "routine": {
    "conditions": [{ "variable": "robo_on", "operator": "=", "operand": 1 }],
    "steps": [
      { "type": "walk", "to": "scene", "scene_id": 12, "spawn_point": "console" },
      { "type": "dialogue", "text": "Readings look normal." },
      { "type": "animate", "animation": "wave" },
      { "type": "wait", "duration": 4000 },
      { "type": "variable", "name": "robo_laps", "operator": "+", "operand": 1 },
      { "type": "walk", "to": "scene", "scene_id": 10 }
    ] } }
```

**Only shared variables count.** A routine is nobody's in particular, so conditions on a player's own variables are left out (the validator warns), and a `variable` step can only change a room-scoped variable. To have a character stop and talk, set a shared variable in the event that starts the conversation, and make the routine's conditions test it.

**Walk actions come first.** A player's event can send a roaming character anywhere with a `walk` action. The routine waits until it has arrived, then carries on with its current step (a walk step sets off again from where the character now is). The server takes only walks that an event of the sender's scene contains, no more than four a second per player.

**Media.** A roaming character can turn up in any scene, so its pictures load with the scenario's global media rather than with a scene.

## Animations

### Sprite sheets and named animations

Any image can be a **sprite sheet**: a grid of equal frames. The media says how the grid is cut, and can name animations made of its frames. Every animation is made here, on the media: an item, a vehicle or an `image_fixed` picture drawn with it plays them by name, and a character's animation names the one it plays (`sheet_animation`, see [Characters](#characters)), with its frames copied, so several characters can share one sheet's walk.

Parameter | Type | Description
--------- | ---- | -----------
sheet | object | `{ "columns": 6, "rows": 3 }`: frames across and down. `count` may be added when the last row is not full. Frames are numbered from 0 at the top left, left to right and then down, as on the [Spritemaps](/docs/developers/spritemap/) page.
animations | array | `{ "name", "frames", "duration", "repeat" }`. `frames` are frame numbers in the order they play. `duration` is the milliseconds one pass takes (default 100 per frame). `repeat` says whether it loops (default: by its name, see below).

```json
{ "id": 120, "type": "image", "url": "avatars/sprocket-sheet.png",
  "sheet": { "columns": 6, "rows": 3 },
  "animations": [
    { "name": "idle", "frames": [0, 1], "duration": 900 },
    { "name": "walk", "frames": [6, 7, 8, 9, 10, 11], "duration": 600 },
    { "name": "jump", "frames": [12, 13, 14, 13, 12], "duration": 600, "repeat": false },
    { "name": "dance", "frames": [15, 16, 17, 16], "duration": 700 }
  ] }
```

An **animated PNG** is kept as it is. When one is uploaded the server notes it on the media as `apng: { "frames": 4, "duration": 500, "plays": 0 }` (its frame count, the milliseconds one pass takes, and how many times the file says to play, 0 being forever). The game cuts it into its frames as it loads, the way a sheet is cut: a character's animation can play all of them at the file's own speed or pick some, and an item or picture drawn with it plays the whole file over and over. Until the frames are ready, the first frame shows. The existing `spritemap` action and spritemap labels, which describe their grid themselves, work as before.

### Names that mean something (items, vehicles, pictures)

Name | When it plays
---- | -------------
`idle` | By itself, while the figure stands. Loops.
`walk` | By itself, while the figure moves: an avatar walking, a vehicle being ridden. Loops. It is mirrored for the direction the art does not face.
`walk_left`, `walk_right` | Used instead of `walk` for that direction, unmirrored. If only one is given, it is mirrored for the other.
anything else | When an `animate` action or a player's move asks for it. Plays once unless `repeat` is true (`dance` loops by default).

A figure with no sheet, or a sheet without `idle` or `walk`, simply stands and is mirrored to face the way it goes, as before. Characters and avatars use their poses instead (see [Characters](#characters)).

### Built-in moves

Five moves need no frames: `jump` (a hop), `spin` (a turn on the spot), `crouch` (a duck), `wave` (a sway from side to side) and `dance` (a looping bounce and sway). The picture itself is moved, so they work on any figure. **Frames win**: when a character has an animation of the same name (or an item's sheet does), that is played instead. So `jump` always does something, and looks best where a jump was drawn.

### Moves: what players can do themselves

`moves` on the scenario lists what players can do whenever they like, from buttons on their screen.

Parameter | Type | Description
--------- | ---- | -----------
animation | string | The animation or built-in move to play on the player's avatar.
label, icon | string | What the button shows. Default: the animation's name.
conditions | array | The button is there only while these hold. Absent: always.

```json
"moves": [
  { "animation": "jump" },
  { "animation": "dance", "conditions": [{ "variable": "learned_dance", "operator": "=", "operand": 1 }] }
]
```

This is the "animation inventory": a move a scenario teaches is a player's own variable set by an event, and the button appears when the condition holds. Moves of that kind belong to the scenario. Moves **bought in the marketplace** (shop items of kind `move`) belong to the account: once bought and switched on, their buttons are there in every scenario. A pressed move plays until it ends, or for a looping one until the player walks or presses it again.

Avatars differ, so a move is not tied to one avatar's art: a player whose avatar has a `dance` animation dances with it, and any other avatar does the built-in dance. A move that is neither one of the avatar's animations nor built in does nothing for that avatar.

### How animations reach other players

`players[...].anim` in the room state holds the last animation asked of a player's avatar, as `name:count`; clients play it when it changes, and it is cleared when the player walks or changes scene. The server checks the name's shape and how often it is asked (four times a second at most), not whether the player "owns" the move: animations are only something to look at. Walking and standing need no message; every client works them out from the positions it already receives.

## Stars, XP and the marketplace

Players earn **stars** and **XP** through `award` actions. Stars are spent in the marketplace. XP is never spent: its total decides the player's **rank**. Both are kept on the player's account by the backend and are the same in every scenario.

### Ranks

Ranks are platform-wide. The defaults are in `apps/api/config/qbl.php` (`ranks`):

XP | Rank
-- | ----
0 | Cadet
100 | Explorer
300 | Navigator
700 | Specialist
1500 | Commander
3000 | Admiral

### What the marketplace sells

Every scenario sells the platform's catalogue (`apps/api/database/seeders/data/shop.php`). A scenario can also sell items of its own, which exist only there: a mission badge, a tool for this planet. Authors add them on the editor's **Shop** page; they are in the document as `shop_items`.

Parameter | Type | Description
--------- | ---- | -----------
id | int |
name, description | string |
kind | string | `wearable`, `pet`, `animation`, `move` or `ability`.
price | int | In stars.
media_id | int | The item's picture, one of the scenario's media. (Platform items have an `image_url` instead.)
slot | string | Wearables: `head`, `body`, `back` or `hand`. One item per slot is worn at a time.
scale | decimal | Wearables and pets: height as a fraction of the avatar's height, so an item fits avatars of any size.
offset_x, offset_y | decimal | Wearables and pets: a nudge forward and down, in avatar heights.
animation | string | Animations: `bounce`, `float`, `sway` or `pulse`. How the avatar moves while standing.
move | string | Moves: the animation a button on the player's screen plays, in every scenario. See [Moves](#moves-what-players-can-do-themselves).
ability | string | Abilities: a key. While equipped, `QL_Ability_<key>` is 1.

```json
"shop_items": [
  { "id": 101, "name": "Wilting Stream patch", "kind": "wearable", "slot": "body", "price": 20, "media_id": 46, "scale": 0.14 },
  { "id": 102, "name": "Stream survey map", "kind": "ability", "price": 15, "media_id": 47, "ability": "stream_map" }
]
```

A player owns what they buy for good, and chooses what to have on: one wearable per slot, one pet, one animation (a way of standing: bounce, float, sway, pulse), and any number of moves and abilities. What a player wears is drawn on their avatar in every scenario and is seen by the other players.

**Abilities do nothing by themselves.** They are a flag scenarios can test, so what an ability unlocks is up to each author: a hotspot only its owners see, an extra line of dialogue, a shortcut. They never change walking speed or how far away a hotspot is revealed. In the demo, the survey map makes a map table appear at the landing site:

```json
{ "shortname": "survey-map", "conditions": [{ "variable": "QL_Ability_stream_map", "operator": "=", "operand": 1 }], "...": "..." }
```

### How it is kept honest

The game client never changes stars or XP itself. When an award action runs, the client tells the game server the action's id; the game server asks the backend, which looks the action up **in the published document**, checks whether this player already had it, and records the change in a ledger. A player can therefore not invent an award or collect a once-only award twice. What they *can* do is trigger an award whose event they have not really reached, because events run in the browser (see the trust model on the [protocol](/docs/developers/protocol/) page). Treat stars as encouragement, not as grades.

Purchases go straight from the browser to the backend, which takes the stars and hands over the item in one step.

While testing a draft from the editor, awards and purchases are pretend: the preview starts with 500 stars and nothing is written to the account.

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
