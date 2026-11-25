---
title: "Scenes, layers and spawn points"
description: "Scene size, walkable and blocked areas, what stands in front of what, layers, music, scale areas, spawn points, teams in a scene and moving between scenes."
host:
  who: mallory
  says: "Where feet may go, what stands in front of what, and how players arrive and leave."
  side: right
---

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
width, height | int | first background's size | World size in pixels. **Set these**: the game server cannot see image files, and uses the size to check movement.
walkable_areas | array of polygons | whole scene | Where feet may be. A polygon is an array of `{x, y}` points. A point is walkable if it is inside any of them.
blocked_areas | array of polygons | | Holes cut out of the walkable areas (furniture, pits).
spawn_points | array | | Named places players appear. See below.
items | array | | Item placements: `{item_id, position_x, position_y}`.
characters | array | | Character placements: `{character_id, position_x, position_y, facing, event_id}`.
indirect_events | array | | Events that only run via a run event action, an infobox button or a character. (Mentioned on the [Events](/docs/developers/event/) page; this is where they live.)
shadow_spots | array | | Patches of shade. See [Shadow spots](#shadow-spots).
sky | object | | A living sky behind the backgrounds. See [Living skies, lights and the air](/docs/developers/extensions/atmosphere/#living-skies-lights-and-the-air).
lights | array | | Glows that flicker, burn, breathe, blink or twinkle. See the same section.
atmosphere | array | | What is in the air: fireflies, leaves, snow, rain, dust, bubbles. See the same section.
critters | array | | Birds, squirrels, rabbits, cats, cars: little life that comes and goes, and scatters. See [Critters](/docs/developers/extensions/atmosphere/#critters).
team_only | bool | the group's | Show a player only their own team in this scene. See [Teams in a scene](#teams-in-a-scene).
params.editor_map | `{x, y}` | | Where the scene's box sits on the editor's scene map (Scenes page › Map), in map pixels. The editor writes it; the game ignores it. A scene without one is placed by the map itself.

## What stands in front of what

Everything placed in a scene has a place relative to the players. There are three:

Place | Drawn | Use it for
----- | ----- | ----------
`background` | Behind every player, in front of the background layers | A hotspot's icon, a marking on the floor, a rug, a sign on the far wall
`object` | Among the players, sorted by where it stands: a player lower on the screen is in front of it, one higher up is behind it | A rock, a crate, a plant, a console players can walk around
`front` | Over everything | A caption floating above the scene

What decides it:

* **Hotspot labels**: `placement` on the label. Default: `background`, for pictures and text alike, so **players are always drawn in front of a hotspot's labels, wherever they walk**. A label that should be walked behind says `object`; it then stands on its **bottom edge**, the line players are sorted against. `front` draws it over everything.
* **Items**: `placement` on the item, `object` (default) or `background`. An item stands at its position, the middle of its bottom edge. An object item that runs into the room at an angle (a counter) can have a `sort_line` along its base: figures in front of the line where they stand are drawn in front of it, those behind it behind (see [Items](/docs/developers/extensions/items/)).
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

## Walking around things

A click or tap sets a destination, and the avatar finds its own way there around blocked areas, blocking items and solid labels. The route comes from a navigation mesh built with the [`navmesh`](https://github.com/mikewesthad/navmesh) library (MIT): the scene is sampled into squares, the walkable ones are merged into a mesh, and the shortest path across it is pulled tight around corners. The mesh is rebuilt when an obstacle appears, goes or moves. Keyboard movement is direct, as before, and every step, however it was planned, is still checked by the same "feet inside polygons" rule the game server uses. Where no route exists the avatar heads straight for the spot and stops at the first thing in its way. With `?debug` the obstacles are drawn.

## Shadow spots

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

## Teams in a scene

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

## Background and foreground layers

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

## Background music

A scene starts with its own music (`music_media_id`, `music_volume` on the scene) or, failing that, the scenario's. Events can change the music at any time with an `audio` action flagged `repeat` and `persist`; the next scene starts with its own music again. One music track plays at a time, and a track that is already playing is never restarted, so walking between scenes that share music is seamless. A scene whose start events start background music themselves is left to do so.

**Persistent audio.** An `audio` action with `repeat` and `persist` in a scene's start events is treated as the music track: only one plays at a time. When a scene starts a persistent audio action with the same media that is already playing, the music carries on without restarting; with different media, it replaces the old track. A cancel action naming the audio action's id stops it.

## Scale areas

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

## Spawn points

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
name | string | | Unique within the scene. The one named `default` is used when none is asked for.
position_x, position_y | decimal | |
facing | string | right | `left` or `right`.

## Moving between scenes

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
