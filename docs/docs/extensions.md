# Runtime extensions (spec v2)

The original pages describe the JSON as first designed. The walk-around multiplayer runtime needs a few things those pages do not cover: where avatars can walk, where they appear, how scenes connect, where items and characters stand, and which state is shared between players.

Everything on this page is **optional and additive**. A document that uses none of it still plays: the whole scene is walkable, players appear in the centre, and all variables are per-player. Set `"spec_version": 2` on scenarios that use these fields.

All coordinates are scene pixels with the origin at the top left. An avatar's position is the position of its **feet**.

## Scenario

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
spec_version | int | 1 | Version of the spec the document was written against.
code | string | | The scenario's unique 16-letter code (lowercase `a` to `z`). It is generated when the scenario is created, never changes, and is its address: players open `/{code}`. `shortname` stays as a readable name and can be edited freely.
items | array | | Item definitions (see [Items](item.md)). Scenes place them with `scenes[].items`.
characters | array | | Character definitions (see [Characters](character.md)). Scenes place them with `scenes[].characters`.
asset_base_url | string | | Prefix for media `url` values that are neither absolute nor rooted. A `url` that starts with `/` (such as `/media/12/ab12….png`, a file uploaded in the editor) is used as it is.
chat_mode | string | emotes | `off`: no chat. `emotes`: a fixed set of emoji only. `free`: typed text, filtered by the game server.
move_speed | decimal | 420 | Avatar walking speed in scene pixels per second.
avatar_media_ids | array | | Image media ids players may choose as their avatar. The first is the default.
objectives | array | | The mission checklist shown to the player. See below.
session | object | null | Save data for the requesting player. See [Save data](session.md).

`jump_targets` is generated from jump actions (including those on infobox buttons), by the API when it builds the JSON and again by the runtime. It may be either an object keyed by scene id (`{"3": [4]}`) or an array of `{scene_id, targets}`.

The game server only lets a player move to a scene listed in the current scene's jump targets.

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
* `{{media:ID}}` is replaced with the URL of a media asset, for use in infobox HTML: `<img src="{{media:40}}" alt="">`.

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

### Background and foreground layers

Entries of `background_media` and `foreground_media` may be plain media objects, as before, or layer objects:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Media to draw.
position_x, position_y | decimal | 0 | Top-left corner.
display_width, display_height | decimal | scene size | Size to draw the image at.
tile | bool | false | Repeat the image to fill the display size.
scroll_speed_x, scroll_speed_y | decimal | 0 | For tiled layers: pixels per second the texture drifts.
parallax | decimal | 1 | Camera scroll factor. 1 moves with the world, 0 stays fixed on screen.

Backgrounds draw in order behind everything; foregrounds draw in order in front of avatars.

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

`overridable` is implemented as: when any event starts, every running event flagged `overridable` is stopped where it is. Events not flagged always run to the end.

## Actions

Action `type` values are matched loosely: `Image Fixed`, `imageFixed` and `image_fixed` are the same. The canonical names are `audio`, `cancel`, `image_fixed`, `image_overlay`, `infobox`, `jump`, `repeat`, `run_event`, `spritemap`, `text_overlay`, `translate`, `variable`, `video` and `wait`.

Actions may carry their own `conditions` array (the Conditions page allows this; the Actions page did not list it). An action whose conditions fail is skipped.

### Freeze

A new action type, `freeze`, stops the player from walking, or lets them walk again: for a conversation with a character, a cutscene, a countdown.

Parameter | Type | Description
--------- | ---- | -----------
frozen | bool | `true`: the player cannot move. `false`: they can again.

```json
{ "type": "freeze", "frozen": true }
```

A freeze ends at a `freeze` action with `frozen: false`, **or when the event that froze the player finishes**, or on leaving the scene, whichever comes first, so a player can never be left stuck by a missing action. While frozen a player can still click hotspots and infobox buttons. The demo freezes the player while Captain Vega is speaking.

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

Addition | Applies to | Description
-------- | ---------- | -----------
dismissible | infobox | Default true. See below.
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
* Infobox `content` is sanitised. Formatting, lists, tables, links and images are kept; scripts, styles, frames and event handlers are removed.
* **Background music** is an audio action with `repeat` and `persist` in a scene's start events. Persistent audio is treated as the music track: only one plays at a time. When a scene starts a persistent audio action with the same media that is already playing, the music carries on without restarting; with different media, it replaces the old track. A cancel action naming the audio action's id stops it.

## Variables

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
scope | string | player | `player`: each player has their own value, saved with their progress. `room`: one value shared by everyone in the group, held by the game server.
persist | bool | true | If false the variable returns to `default_value` on every visit.

Conditions and variable actions work the same for both scopes. A variable action on a room variable is sent to the game server, applied there, and the new value reaches every player.

Additional reserved variables: `QBLSceneId`, `QBLPlayerName`, `QBLPlayerCount`.

Additional condition operators: `>=` and `<=`.

## Items

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Image for the item.
scale | decimal | 1.0 | Display scale.
blocking_radius | decimal | 40 | Size of the obstacle for `blocking` items.
attach_offset_x, attach_offset_y | decimal | 0 | Where the item sits relative to the avatar's feet while worn or ridden. X is mirrored when the avatar faces left.
attach_layer | string | front | `front` or `behind` the avatar.
art_faces | string | right | Which way the artwork faces. It is mirrored to match the avatar.
speed_multiplier | decimal | 1.5 | Vehicles: walking speed while riding.

Items are positioned by the bottom centre of their image, like avatars.

**Wearables and vehicles** work the same way: clicking one within reach attaches it to the avatar, and a button on screen removes it. A player can ride one vehicle at a time.

* `unique: true`: one exists per room. While someone has it nobody else can take it, and when they let go (or disconnect) it stays where they stood, in whatever scene that is. Its position is saved with the room.
* `unique: false`: every player has their own. It disappears from the floor for the player using it and is saved with that player.

`blocking` is implemented. `physical` (pushable objects) is **not implemented yet**.

### Vehicles are single objects

A vehicle is always `unique`, whatever the document says: there is one of it in the room. It goes with whoever is riding it, across scenes. When the rider gets out it stays in that scene at that spot, where any player can climb in. Where vehicles were left is part of the room's saved data, so a vehicle left on the planet is still on the planet next lesson.

## Characters

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Image for the character.
scale | decimal | 1.0 | Display scale.

A placement's `event_id` names an indirect event in the same scene that runs when the character is clicked, typically an infobox with what they say.

## Patterns

These need no special support; they are combinations of the pieces above.

**A scored question.** An indirect event holds an infobox with `dismissible: false` and one button per answer. Each button runs its own indirect event, which records the answer in a variable, adds to a score variable if it is the right one, and shows an infobox explaining why.

**A menu that stays open.** An event holds a non-dismissible infobox followed by a `repeat` action with a condition such as `menu_open = 1`. Buttons change variables or run events; a "Step away" button sets `menu_open` to 0, which ends the loop. Do not have an event run itself through `run_event`: an event that is already running is not started again.

**A hands-on experiment.** The same loop, with buttons that change a variable (`beaker_ph + 1`) and content that shows it (`pH {{beaker_ph}}`), plus an action whose condition detects the goal (`beaker_ph = 7`).

**Collecting things.** A click hotspot whose conditions include `sample_x = 0`, with the object as an image label. Its actions set `sample_x` to 1 and add to a counter. The label disappears because the hotspot's conditions no longer hold.

## Not implemented yet

* `physical` items.
* `intro_media_portrait_id` / `intro_media_landscape_id` splash screens and `is_intro_scene`.
* `allow_groups` as a lobby. Groups work (players who join with the same group key share a room, up to `max_players`), but choosing a group is left to whatever launches the game: pass `?group=`.
* Animated avatars. Avatars are single images mirrored for direction.
