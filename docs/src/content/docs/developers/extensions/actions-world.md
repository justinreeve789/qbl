---
title: "Actions that move, change and travel"
description: "The animate, walk, weather and camera actions, story panels (image_overlay), freeze, cancel_event, travel and avatar actions, and the game's own sounds."
host:
  who: mallory
  says: "Make things move, change the weather, point the camera, stop a player, or send them on a journey."
  side: right
---

## Animate

A new action type, `animate`, plays an animation on something in the scene. See [Animations](/docs/developers/extensions/animations/) for where animations come from.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
animation | string | | The animation's name: one of the character's or avatar's animations (not a pose), one defined on an item's sprite sheet, or a built-in move (`jump`, `spin`, `crouch`, `wave`, `dance`). Empty: stop what is playing and return to standing and walking.
target | string | player | `player`: the avatar of the player whose event this is. `item`: an item or vehicle, on the floor of this scene or being worn or ridden. `character`: a character placed in this scene. `action`: a picture that an `image_fixed` action is showing.
item_id, character_id, target_id | int | | Which item, character or action, for those targets.

```json
{ "type": "animate", "target": "character", "character_id": 1, "animation": "wave", "blocking": false }
```

With `blocking` (the default) the sequence waits until a one-pass animation has finished; a looping one never holds it up. An animation on a **player's avatar goes through the game server**, so everyone in the scene sees it, whatever the event's audience. An animation on an item, a character or a picture is shown to the other players only when the event's `audience` is `scene`, like anything else an event shows.

## Walk

A new action type, `walk`, walks a character or the player somewhere on foot. Unlike [`translate`](/docs/developers/action/#translate), which glides a picture in a straight line, a walk finds a way around whatever is in the scene (walkable and blocked areas, blocking items, solid labels), plays the walking poses, turns the walker the way it goes, and slows down in [scale areas](/docs/developers/extensions/scenes/#scale-areas) as players do.

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

**Who sees it.** A character that [roams](/docs/developers/extensions/characters/#characters-that-walk-around-on-their-own) is walked by the game server, for everyone, and stays where it went. Any other character walks on the player's own screen (or, when the event's `audience` is `scene`, on everyone's in the scene), like any other thing an event shows; one that walks out through a door is gone from the scene until it is entered again. The player walks themselves through the room as usual (their position reaches everyone through the room state), even while [frozen](#freeze): a freeze and walks make a cutscene. A player walked `to` a scene goes through a door of this scene, running the door's actions as if they had walked in (or clicked it), so only a scene next to this one can be reached.

With `blocking` (the default) the next action waits until the walker arrives, or stops trying: there is no way there, another walk took over, or (for the player) the player walked off elsewhere.

**Off stage.** A walk to a point beyond the left or right edge of the scene goes to the edge and on out of sight; a character placed beyond an edge comes on from there. See [story scenes](/docs/developers/extensions/atmosphere/#story-scenes).

## Weather action

A new action type, `weather`, changes the scene's [weather](/docs/developers/extensions/atmosphere/#weather) while the player is there, slowly: the rain starts, a storm blows up, the snow stops. Everyone in the scene sees it when the event's audience is the scene.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
kind | string | | `clear` (it stops), `rain`, `snow`, `storm`, `blizzard` or `fog`. The same kind changes how heavy it is; another fades the old one out as the new one comes in.
intensity, wind, lightning | | | As for the scene's weather.
duration | int | 3000 | Milliseconds the change takes. With `blocking`, the next action waits for it.

```json
{ "type": "weather", "kind": "storm", "intensity": 0.9, "duration": 5000, "blocking": false }
```

It lasts until another weather action, or until the player leaves the scene, which has its own weather again next time.

## Camera

A new action type, `camera`, points the player's view.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
target | string | | `character`: follow a character placed in the scene as they move. `point`: glide to a spot and stay. `player`: follow the player again (as the view does outside story scenes). `auto`: follow whoever is acting, as a [story scene](/docs/developers/extensions/atmosphere/#story-scenes) does. Default: `character` with a `character_id`, `point` with a position, else `player`.
character_id | int | | For `character`.
position_x, position_y | int | | For `point`: the middle of the view, kept inside the scene.
duration | int | 1200 | Milliseconds the glide takes; with `blocking`, the next action waits for it.
zoom | number | as it is | How close the view is, glided to over `duration`: 1 is the scene's usual view, 1.6 a push in on someone's face, up to 3 (0.5 at the least; never so far out that the scene stops filling the window).

It lasts until another camera action, or the scene ends. A story builder uses it for push-ins, pull-backs and pans, and lets the view drift slightly (zoom 1.12 and back) whenever nothing has moved on screen for a while.

## Story panels

An `image_overlay` with `panel: true` is shown like a page of a comic or a shot in a film: the picture fills the play area over a dark backdrop (under the captions, so narration reads over it), fades in and out, and a click moves on.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
panel | bool | false | Show it as a story panel.
duration | int | | Milliseconds it stays. Keep it to 20 seconds at most: the validator warns above that (a still picture gets dull), and when it has none.
motion | string | `still` | How the camera moves over it, slowly, over its duration: `push_in`, `pull_out`, `pan_left`, `pan_right`. Off with reduced motion.
tone | string | | `memory` (warm, faded, a dark vignette: a flashback) or `dream` (hazy and bright).


## The game's own sounds

An `audio` action can play a sound the game makes itself instead of a file: `{ "type": "audio", "sound": "thunder" }`. They are made with Web Audio as they play (`apps/client/src/audio/synth.ts`), through the game's master volume, so a scenario needs no sound files for its rain or a car going by. The list is `BUILT_IN_SOUNDS` in `packages/shared/src/sounds.ts`:

- **Ones that go on** (loop them with `repeat`; without it they play for a few seconds): `rain`, `heavy_rain`, `wind`, `river`, `stream`, `waves`, `fire` (crackling), `birds` (singing), `crickets`.
- **One-shots**: `thunder`, `car` (driving by, left to right, pitched up and then down as it passes), `horn`, `hooves` (going by), `bell`, `chime` (magic), `knock`, `door` (creaking shut), `footsteps`, `splash`, `whoosh`, `pop`, `tweet`.

`volume` works as for any sound; a cancel action stops it.

## Freeze

A new action type, `freeze`, stops the player from walking, or lets them walk again: for a conversation with a character, a cutscene, a countdown.

Parameter | Type | Description
--------- | ---- | -----------
frozen | bool | `true`: the player cannot move. `false`: they can again.

```json
{ "type": "freeze", "frozen": true }
```

A freeze ends at a `freeze` action with `frozen: false`, **or when the event that froze the player finishes**, or on leaving the scene, whichever comes first, so a player can never be left stuck by a missing action. While frozen a player can still click hotspots and infobox buttons. The demo freezes the player while Captain Vega is speaking.

## Cancel event

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

## Travel

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

## Avatar

A new action type, `avatar`, shows or hides the player's own avatar.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
visible | bool | | `false` hides the avatar, `true` shows it.
duration | int | 0 | Fade time in milliseconds.

```json
{ "type": "avatar", "visible": false, "duration": 400 }
```

The change goes through the game server, so every player in the scene sees it. A hidden player can still walk and use hotspots. Avatars are **always shown again when a player arrives in a scene**: to keep them hidden in a scene, hide them in one of its start events. The demo's rocket hides the avatar as the player steps aboard, and the player reappears in the control room. (The scene attribute `show_avatars: false` from the base docs still hides every avatar in a scene, for everyone, for the whole visit.)
