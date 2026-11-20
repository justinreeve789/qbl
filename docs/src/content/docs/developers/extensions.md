---
title: "Runtime extensions (spec v2)"
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
private_messages | bool | false | Players may send typed messages to one other player. See [Messages](#messages).

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

shadow_spots | array | | Patches of shade. See [Shadow spots](#shadow-spots).
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
* **Items**: `placement` on the item, `object` (default) or `background`. An item stands at its position, the middle of its bottom edge.
* **Characters and avatars** are always objects.
* **`image_fixed` and `spritemap` actions**: `layer`, which is `above` (default: over everything), `sorted` (among the players, by `position_y`) or `behind` (part of the background).
* **Foreground layers** are drawn over all of it, as before.

A label can also be **solid**: players cannot walk through it and are led around it.

Parameter | Applies to | Default | Description
--------- | ---------- | ------- | -----------
placement | label | background | `background`, `object` or `front`.
solid | picture label | false | Players walk around it. This does not change how it is drawn: add `"placement": "object"` if players should also pass behind it.
solid_radius | picture label | 35% of its width | Radius of the obstacle, a circle at the picture's base.
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

The demo does exactly this: the starship's rooms are shared except the laboratory, and the planet is each team's own. What is limited is what players **see and hear** of each other: avatars, emotes, chat, and events with `audience: scene`. A shared variable is always the team's own, in every scene: one team's rockfall never blocks another team's path, even in a scene where the teams can see each other. `QBLPlayerCount` counts the player's team. With no teams (the public instance, an assignment without teams) everyone is one team and the setting changes nothing.

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
parallax | decimal | 1 | Camera scroll factor. 1 moves with the world, 0 stays fixed on screen.

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

Every kind of event can have an `audience`. With `scene`, these actions are shown to the other players in the scene at the moment they happen for the player who set the event off: `audio`, `image_fixed`, `image_overlay`, `text_overlay`, `spritemap`, `video`, `dialogue`, `translate` and `cancel`. In a shared dialogue, "the player" is the player who set it off: the bubble hangs over their avatar, and a story box shows their name and portrait.

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
{ "type": "dialogue", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QBLPlayerName}}!" }
```

The bubble follows the speaker and keeps itself on screen. It sits above them when there is room, below when they are near the top of the screen, and to the right or left when there is room neither above nor below; sideways it slides along to stay inside the screen while its tail keeps pointing at the speaker. A sequence of dialogue actions is a conversation; put a `freeze` before it to hold the player still. For one where the player chooses what to say, use a [conversation](#conversations-dialogue-trees).

**The story box** (`style: "portrait"`) is for the characters and moments that carry the story. It is a panel across the bottom of the screen with the speaker's close-up portrait standing on its edge, their name, and the words appearing a few at a time. The player clicks, or presses Enter or Space, to continue: once to show the whole line, again to go on. The portrait is the speaker's `portrait` animation (or the character standing, if it has none): a character's, or for the player their avatar's.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QBLPlayerName}}! I am Captain Vega." }
```

A story conversation is normally the player's own (`audience: player`, the default), as the captain's greeting in the demo is. If its event is shown to the scene, the other players get a smaller version at the top of the screen that closes by itself and never takes their clicks or keys.

### Conversations (dialogue trees)

A new action type, `conversation`, is a conversation the player takes part in: a **dialogue tree**. It is a list of lines, each said by the player or a character. After a line the player picks what to say next from its **choices**, and each choice leads to another line, or ends the conversation. Choices can lead back to a line already said, so a conversation can return to a "hub" ("Anything else?"). A line without choices goes straight on to its `next` line.

It is separate from `dialogue`, which says one line. The whole tree lives inside the one action, so it travels with the event, is duplicated and exported with it, and needs no ids of its own beyond the lines' names.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
lines | array | | The lines, below. At least one.
start | string | the first line | The `id` of the line it starts with.
style | string | portrait | `portrait`: each line in a story box with the speaker's close-up, the choices listed under it. `bubble`: each line in a bubble over its speaker, the choices in a box at the bottom of the screen.
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
    { "id": "hello", "speaker": "character", "character_id": 1, "text": "Ready for your briefing, {{QBLPlayerName}}?", "next": "ask" },
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
narrate | dialogue, conversation, infobox, text_overlay | the scenario's | `true` or `false` for this action.
narration_media_id | dialogue, infobox, text_overlay, a conversation's line | | An audio recording to play instead of the browser's voice. The words are highlighted at an even pace over its length.
voice_pitch, voice_rate | character | 1 | How the character sounds: 0 to 2, and 0.5 to 2.
voice_name | character | | Part of the name of a voice to prefer ("female", "Daniel"). Devices differ; where none matches, the default voice reads.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "narrate": true, "text": "Welcome aboard, {{QBLPlayerName}}!" }
```

A speech bubble that is being read stays until the voice has finished. One thing is read at a time: a new line stops the one before. Players have a switch for reading aloud at the foot of the side panel (it is offered when the scenario has anything to read) and their choice is kept in their browser. In the demo the story's portrait dialogue is read.

Browser voices vary in quality from device to device. For a consistent voice, record the lines (or generate them once with a text-to-speech service) and attach them with `narration_media_id`; a service that returns word timings could drive the highlight exactly, which is the natural next step if the built-in voices are not good enough.

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

Additional reserved variables: `QBLSceneId`, `QBLPlayerName`, `QBLPlayerCount`, and for the player's account `QBLStars`, `QBLXp`, `QBLRank` (the rank's name) and `QBLAbility_<key>` (1 while the player has a marketplace ability with that key equipped, otherwise 0). They can be used in conditions and as `{{placeholders}}` like any other variable.

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

Everyone who walks around a scene is a **character**: the avatars players choose from, and the characters (NPCs) a scenario places. Both are drawn from their **animations**, by name, and nothing else; they differ in where they live. A scenario's characters are in `characters` and placed by `scenes[].characters`. Avatars belong to the platform, the same in every scenario: the server adds them to the document as `avatars` (above), and a player's choice of avatar (`avatar_media_id` on their account, `avatar` in the room) is an avatar's `id`.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id, name | int, string | | As in the base docs.
animations | object | | The character's animations, by name. See below.
scale | decimal | 1.0 | Display scale of its pictures. Each picture is also stretched by its own media `scale_x` and `scale_y`, so a sheet shared by several characters can be sized once, on the media, and each character sized on top of that.
voice_pitch, voice_rate, voice_name | | | How its lines are read aloud. See [Reading text aloud](#reading-text-aloud).
conditions | array | | Scenario characters only: the character is there only while these hold.
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

Any image can be a **sprite sheet**: a grid of equal frames. The media says how the grid is cut, and can name animations made of its frames. Characters and avatars take the frames they need in their own animations (see [Characters](#characters)); the animations named on the media are for whatever else is drawn with it (an item, a vehicle, an `image_fixed` picture).

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
ability | string | Abilities: a key. While equipped, `QBLAbility_<key>` is 1.

```json
"shop_items": [
  { "id": 101, "name": "Wilting Stream patch", "kind": "wearable", "slot": "body", "price": 20, "media_id": 46, "scale": 0.14 },
  { "id": 102, "name": "Stream survey map", "kind": "ability", "price": 15, "media_id": 47, "ability": "stream_map" }
]
```

A player owns what they buy for good, and chooses what to have on: one wearable per slot, one pet, one animation (a way of standing: bounce, float, sway, pulse), and any number of moves and abilities. What a player wears is drawn on their avatar in every scenario and is seen by the other players.

**Abilities do nothing by themselves.** They are a flag scenarios can test, so what an ability unlocks is up to each author: a hotspot only its owners see, an extra line of dialogue, a shortcut. They never change walking speed or how far away a hotspot is revealed. In the demo, the survey map makes a map table appear at the landing site:

```json
{ "shortname": "survey-map", "conditions": [{ "variable": "QBLAbility_stream_map", "operator": "=", "operand": 1 }], "...": "..." }
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
