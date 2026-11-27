---
title: "The game client (apps/client)"
description: "How the Phaser game is put together: start-up and sign-in, GameContext, PlayScene and its systems, ActionHost and the presenters, the session features, the HTML UI behind UiPort, networking online and offline, assets, entities and the other pages the package builds."
host:
  who: asimov
  says: "One Phaser scene plays every scene of every mission. Everything you can see is a system, a presenter or a feature, and each one is in a list you can add to."
  side: right
---

The game is a Phaser 4 application built with Vite. Nothing in it knows about a particular mission: scenes, hotspots, events and the checklist all come from the scenario JSON. The rules (how events run, where avatars may walk, what the server allows) are not in the client either; they are in [`packages/shared`](/docs/codebase/shared/).

:::tip[In short]
- `main.ts` signs the player in, loads the scenario, joins the room (or plays offline), makes a **`GameContext`**, starts the **features**, then starts Phaser with `BootScene` and `PlayScene`.
- **`PlayScene`** is the only Phaser scene that plays scenes. It is restarted on every jump. It makes a `SceneEngine`, an `ActionHost`, and every **system** in `systems/index.ts`.
- There are **three extension points**: a scene system (`SceneSystem`, lives for one scene), an action presenter (`Presenter`, shows one action type) and a game feature (`GameFeature`, lives for the session).
- Game code reaches the DOM only through **`UiPort`** (implemented by `Ui`, and by `HeadlessUi` in tests) and the room only through **`GameConnection`** (`OnlineConnection` or `OfflineConnection`).
- Systems **read the room state every frame** instead of subscribing to changes, so they behave the same online and offline.
:::

## The files

```text
apps/client/
  index.html            the marketing page, at "/" only (src/site/, Tailwind; no game code)
  play.html             the game's page, for every other path
  vite.config.ts        two pages; the game fallback; the dev proxy; @qbl/shared aliased to source
  public/               icons, manifest, service worker (sw.js), assetlinks.json
  src/
    main.ts             sign-in, missions page, scenario, avatar, connection, features, Phaser
    config.ts           URL parameters and build-time settings
    home.ts teach.ts    the missions page; the teacher's part of it
    plans.ts            /plans: plans, trial, checkout, the quote form
    pwa.ts              the installable app: service worker and install offer
    core/               GameContext, SceneRuntime, GameFeature, assets, depth, sorting, Bag, Builds, Rewards
    scenes/             BootScene, PlayScene
    systems/            one concern of a scene each; index.ts is the ordered list
    actions/            ActionHost, Presenter types, presenters/ (one per presented action type)
    features/           one concern of the session each; index.ts is the list
    entities/           Figure, CharacterFigure, Avatar, NpcFigure
    net/                Api (HTTP), Connection (online and offline)
    ui/                 UiPort, Ui (HTML over the canvas), Sidebar, AccountMenu, Narrator, infobox/, science/ ...
    audio/              synth.ts (sounds made with Web Audio), soundLock.ts (autoplay)
    bench/              BenchRenderer (drawing a close-up bench)
    plugins/weather/    rain, snow, storms, fog for any Phaser scene
  test/                 a fake Phaser, a headless UI, and tests that play the game
```

## Start-up: `main.ts`

`setUpApp()` (PWA) runs first; then either `showPlans(api)` on `/plans`, or `start()`.

### `config.ts`

Built-time settings come from Vite env (`VITE_API_URL`, `VITE_SERVER_URL`, `VITE_AUTH_MODE`, `VITE_DEFAULT_SCENARIO`). The rest is read from the address:

Setting | From | Meaning
------- | ---- | -------
`scenario` | `/{code}`, else `?scenario=`, else the default | Which scenario
`home` | No code, no `?scenario`, `?preview` or `?offline` | Show the missions page
`preview` | `?preview=12` | Play the draft of scenario 12 (forces `offline`)
`startScene` | `?scene=40` | Start in this scene
`group`, `party` | `?group=`, `?party=` | Which instance and room
`launch` | `?launch=` | Arrived on a teacher's launch from another scenario
`editBuild` | `?edit_build=` | For a teacher: open this student's build once in its scene
`offline`, `debug` | `?offline`, `?debug` | Play without the server; draw walkable areas and hotspots
`authMode` | `VITE_AUTH_MODE` | `guest` (file backend: pick a name) or `login` (Laravel: accounts)

### `start()`, in order

1. **`loadScenario()`** loops until it has a scenario and a user: `api.me()`; `signIn()` if needed (the form has modes `login`, `register`, `guest`, `forgot`, `reset` and Google); the missions page if no scenario was asked for (`showHome`, which never returns); otherwise `loadDraft` (preview) or `api.play`. A 401 signs out and asks again.
2. **`chooseAvatar()`**: asked once; remembered on the account (`PUT /api/me/avatar`) and in `localStorage` (`qbl.avatar`).
3. **The connection**: `new OfflineConnection(scenario, user, avatarId)` or `await OnlineConnection.join(serverUrl, options)`.
4. **`new Ui(app)`** and **`new GameContext(...)`**.
5. **Optional services on the context**, each null when not available: `rewards.connect` (not for guests; `pretend(500)` in a preview), `builds` (only if some scene allows building), `fetchProfile`, `fetchTeams` and `followTeam` (staff), `goToMission`, `leavePage`, `fetchLaunchable` (staff), and the arriving launch.
6. **`ui.account(...)`**: the account button and its menu.
7. **Every feature**: `for (const feature of gameFeatures()) feature.start(ctx)`.
8. **Phaser**: `new Phaser.Game({ scene: [], scale: RESIZE, ... })`, `game.registry.set('ctx', ctx)`, add `play` (`PlayScene`) and start `boot` (`BootScene`). The context is in the registry **before** any scene runs; scenes get it with `getContext(scene)`.

## `GameContext`: what outlives a scene

`core/GameContext.ts`. One per play session; every system, presenter and feature reaches it.

Member | What it is
------ | ----------
`scenario`, `user`, `connection`, `ui`, `options` | What it was made with
`index: ScenarioIndex` | Lookups
`vars: VariableStore` | The player's variables. `vars.remote` forwards room-scoped changes to `connection.variable`. Providers supply the system variables
`flags: Set<string>` | One-shot markers, saved
`music` | The background music playing (a persistent audio action), which survives scene changes
`rewards: Rewards` | Stars, XP, rank, belongings and the marketplace catalogue (`core/Rewards.ts`)
`bag: Bag` | What the player carries and the thing they have picked (`core/Bag.ts`); `QL_Holding` reads it
`builds: Builds \| null` | Student builds, when some scene allows building
`launched`, `departed`, `launchUrl` | A teacher's launch waiting for this player, and where it goes (`QL_NextMission`, `QL_SCENARIO_LAUNCH_URL`)
`inScene`, `sceneId` | Set by the scene being played: run loose actions there; its id
Optional hooks | `fetchTeams`, `followTeam`, `goToMission`, `leavePage`, `fetchLaunchable`, `showProfile`, `fetchProfile`, `previewAward`
`sees(other)`, `team`, `staff` | Whether another player is shown, this player's team, whether they are staff
`learn(entryId)`, `glossary`, `onGlossary` | The glossary
`track(msg)` | A line for the teacher's activity log (sent as `track`)
`text(t)`, `html(t)`, `mediaUrl(id)` | Fill `{{placeholders}}` (HTML-escaped in `html`)
`syncRoomVariables()` | Copy room variables from the synchronized state into the store (called every frame)
`markDirty()`, `saveProgress(force?)` | Send `progress` when something changed

## `PlayScene` and the scene runtime

`scenes/PlayScene.ts` is described step by step on the [lifecycle page](/docs/codebase/lifecycle/#playscenecreate). Its parts:

- **`create(data: PlaySceneData)`**: `{sceneId, position?}`. Builds the engine, the host and the systems; starts music and start events.
- **`update(time, delta)`**: `connection.tick()`, `ctx.syncRoomVariables()`, then every system's `update`.
- **`restart(data)`**: every way into a scene comes here (a jump, a server correction, a launch). It waits for anything not yet loaded (`queueScene`), with "Loading…" on screen, then `scene.restart(data)`. Asking twice does nothing.
- **`jump(sceneId, spawn)`** (private, called by the engine after end events): saves, sends `scene`, fades out, restarts at the spawn point.
- **`shutdown()`**: stops the engine, tears the host down, destroys systems in reverse order.
- **`walk()`**: the current `WalkContext`, with obstacles from `PropsSystem` and `HotspotSystem` (solid labels).

`PlayScene` hands systems a small facade, **`SceneRuntime`** (`core/SceneRuntime.ts`), rather than itself (Phaser's `Scene` already has a `scene` property):

Member | Meaning
------ | -------
`scene` | The Phaser scene
`ctx` | The `GameContext`
`def` | The QBL scene being played
`size`, `zoom` | World size in pixels; the scene's zoom
`engine` | The `SceneEngine`
`startPosition` | Where the local player starts, if not where the room says
`leaving` | True once a jump has begun: stop reacting to input, keep drawing through the fade
`system(Class)` | Another system, by class. Throws if not registered
`walk()` | Where feet may be now
`restart(data)` | Switch scene now, without end events

### The `SceneSystem` interface

```ts
interface SceneSystem {
  create?(): void;                        // once, in registration order
  update?(time: number, delta: number): void;   // every frame, in order
  variablesChanged?(): void;              // a variable changed (the player's or the room's)
  destroy?(): void;                       // remove what create() made
}
```

A system is a class constructed with the `SceneRuntime`. Add it to `sceneSystems` in `systems/index.ts`. **Order matters** where one system reads another's result in the same frame: the local player moves before hotspots check where it stands.

### The systems, in order

System | Responsibility
------ | --------------
`LayerSystem` | Background and foreground layers: stretched, tiled, drifting, parallax. Marks sky layers for `SkySystem`
`FlowSystem` | Rivers, streams, waterfalls, the sea: moving water behind see-through parts of the picture, glints over it, sound
`WaterLightSystem` | Underwater light on the GPU: ripples on the floor (and on figures, through a filter), shafts from above. Nothing without WebGL
`SkySystem` | The living sky: a time-of-day gradient behind everything, sun, moon, stars; how dark it is (`light`) for the others
`LightSystem` | Glows that flicker, burn, breathe, blink; brighter in the dark; conditional lights fade in and out
`AtmosphereSystem` | What is in the air: fireflies, leaves, snow, dust, bubbles
`WeatherSystem` | Rain, snow, storms, fog through the weather plugin; `change(action)` for weather actions
`PropsSystem` | Items and characters placed in the scene: drawing, depth, clicking (runs their events), unique items from the room state, walking characters (`walkCharacter`), roaming characters (`syncRoaming`), animations, obstacles
`BuildSystem` | Students' builds as a layer over the scene, the Build button and build mode
`RemotePlayersSystem` | Other players: avatars created, moved and removed by comparing with the room state every frame
`LocalPlayerSystem` | The player's avatar: keys and pointer, click-to-walk with the `Pathfinder`, moves sent every 66 ms, snaps, scripted walks (`walkScripted`), freezing, hiding, following the room's scene (`reconcileScene`), using items
`HotspotSystem` | Labels (text, image, spritemap; placement, hints, reveal, pulse), clicks and walk-ins (`fire` → `engine.triggerHotspot`), solid labels as obstacles
`CritterSystem` | Birds, squirrels, rabbits that come and go on each player's own screen, and scatter
`BenchSystem` | A close-up bench: steps `BenchSim`, draws it with `BenchRenderer`, taps to pour and heat, readouts into variables, watches run events
`SpeechSystem` | Chat and emotes as speech bubbles
`CameraSystem` | Keeps the scene covering the window, follows the player (or, in a story, whoever is acting), camera actions
`StorySystem` | The story bar: skip ahead to where the start events jump, or watch again
`PreloadSystem` | Loads every jump target's media in the background, so jumps are instant
`DebugSystem` | With `?debug`: walkable areas, spawn points, hotspot areas, obstacles

## `ActionHost` and presenters

`actions/ActionHost.ts` implements both `EngineHost` (what the engine calls) and `PresenterContext` (what presenters use).

- **`present(action, engine, actor?)`** looks the action type up in `presenters/index.ts` and returns the presenter's handle. A dialogue spoken by a character also tells the camera who is acting.
- **The "controls"** are functions `PlayScene` sets on the host, pointing at systems: `locateControl` (where a character or a player stands, for bubbles), `animateControl`, `walkControl`, `weatherControl`, `cameraControl`, `actingControl`, `freezeControl`, `avatarControl`, `benchControl`. The host's `animate`, `walk`, `camera`, `freeze`, `avatar`, `bench`, `weather` methods call them.
- **`translate(action)`** tweens what an earlier action put up: a world object (a Phaser tween) or an HTML overlay (`overlay.transition`). Presenters register targets with `track(actionId, target, handle)`.
- **`award`**: online, `connection.award(id)`; offline, `ctx.previewAward` shows what it would give. **`glossary`**: `ctx.learn`, with a toast for a new word.
- **`travel`** and **`openUrl`** return a "go" function or null (see [the engine](/docs/codebase/event-engine/#how-each-action-type-is-handled)). `openUrl` fills placeholders, refuses anything but http and https (`openableUrl`), opens new tabs with `opener` cleared, and offers a button when the browser blocks the tab. A preview never leaves the editor.
- **`teardown()`** (on scene shutdown) stops the scene's sounds and synthesised voices and clears overlays. **Background music is not stopped**: it belongs to `ctx.music`.

### The presenters

A presenter is a function `(action, pc, actor?) => ActionHandle`. `PresenterMap` requires one for every type in `PresentedAction`.

Type | File | How it ends
---- | ---- | -----------
`audio` | `presenters/audio.ts` | When the sound ends; a `persist` audio becomes the background music (`playSceneMusic`, `stopMusic`); `sound` plays a built-in synthesised sound
`dialogue` | `presenters/dialogue.ts` | A bubble over the speaker (for its duration, or `dialogueDuration(text)`), or a portrait story box the player clicks on from. Speech can be read aloud or play a recording with word timings
`narration` | `presenters/narration.ts` | The story box with no close-up or name
`infobox` | `presenters/infobox.ts` | Only once the box is closed **and** the chosen button's action has run to its end (`engine.runAction`), so "ask, then show the next step" waits for the feedback. Typed answers are written to variables; the choice is tracked. A `try_again` button runs while the box stays open
`text_overlay`, `image_overlay`, `video` | `presenters/overlays.ts` | HTML overlays; after `duration`, or when cancelled
`image_fixed`, `spritemap` | `presenters/world.ts` | Phaser objects in the world (above, sorted among, or behind figures), after `duration` or cancel
`shop` | `presenters/index.ts` | `ctx.rewards.openShop()`: when the marketplace is closed

Conversations are not in the map: the engine walks the tree and calls `ActionHost.converse`, which uses `conversationLine` in `presenters/conversation.ts`.

## Features: what lasts the whole session

```ts
interface GameFeature { start(ctx: GameContext): () => void }   // returns a stop function
```

Add a feature to `gameFeatures()` in `features/index.ts`.

Feature | What it does
------- | ------------
`ConnectionFeature` | "Reconnecting…", notices as toasts, the message for each close code, and reloading on back/forward cache restores
`ChatFeature` | Emotes, chat and private messages according to `chat_mode` and `private_messages`
`ObjectivesFeature` | Re-evaluates the checklist on every variable change (`evaluateObjectives`) and announces newly completed ones
`AttachmentsFeature` | Buttons to take off what the player wears or rides
`BagFeature` | The bar of carried things
`ProgressFeature` | `saveProgress()` every 5 s and on `pagehide`
`RewardsFeature` | Stars, XP and rank on screen, the marketplace, awards from the server, announcing outfit changes
`MovesFeature` | Move buttons (jump, dance...) that ask the room to animate the avatar
`PlayersFeature` | The list of players and their profiles
`TeamsFeature` | For staff: the team being followed, and switching to another
`LaunchFeature` | For staff: launching an assignment for the class. For everyone: receiving a launch and going
`GlossaryFeature` | The glossary panel

## The UI layer

**Everything screen-space is HTML over the canvas**: text, overlays, infoboxes, chat, the side panel, the account menu. That gives sharp text, real buttons, keyboard and screen-reader access, and nothing affected by camera zoom. World-space things (fixed images, spritemaps, labels, figures) are Phaser objects.

- **`ui/UiPort.ts`** is the interface the game uses: overlays, `infobox`, `dialogue`, `portraitDialogue`, `choose`, `rewards`, `moves`, `account`, `shop`, `chat`, `attachments`, `bag`, `storyBar`, `objectives`, `players`, `teams`, `launches`, `messaging`, `message`, `glossary`, `profile`, `narration`, `toast`, `linkOffer`, `benchPanel`, `buildButton`, `buildPanel`, `status`, plus `capturesInput` (the game ignores movement while a box is open or a field has focus) and `videoPlaying`/`videoTime`.
- **`ui/Ui.ts`** implements it in the DOM. Helpers live beside it: `Sidebar.ts` (the side panel's tabs, docked at the bottom on an upright phone or tablet), `AccountMenu.ts`, `Narrator.ts` (reading aloud with the browser's voice and lighting each word), `bubble.ts` (placing speech bubbles), `benchPanel.ts`, `buildPanel.ts`, `rolePicker.ts`, `picture.ts`, `icons.ts`, `sanitize.ts`.
- **`ui/infobox/`** draws an infobox (`view.ts`: the box, pages, buttons; `content.ts`: slideshows, cards, callouts, answer boxes, words, zoom; `controls.ts`: sliders, switches, wheels). It uses the DOM only, because **the editor imports it for its preview** (`apps/editor/src/rich/game.ts`). Keep Phaser and game state out of it.
- **`ui/science/`** loads KaTeX, math.js and JSXGraph only when a box uses them.

## Networking

### `net/Api.ts`

The HTTP calls the player needs, with the bearer token kept in `localStorage` (`qbl.token`). `ApiError` carries the status. Groups: accounts (`guest`, `login`, `register`, `providers`, `googleUrl`, `me`, `rename`, `changePassword`, `forgotPassword`, `resetPassword`, `signOut`), playing (`play`, `preview`, `missions`, `avatars`, `setAvatar`, `profile`), the marketplace (`shop`, `buy`, `equip`), builds, teaching (`teamsToFollow`, `launchable`, `teacherDesk`, `resetOwnProgress`), billing (`checkout`, `billingPortal`, `promotion`, `quote`). `takeSignInProblem` reads an error left by a sign-in redirect.

### `net/Connection.ts`

`GameConnection` is an abstract class with `online`, `sessionId`, `state: WorldState`, `welcome`, `me`, `npc(id)`, `tick()`, `on(event, handler)`, `leave()`, and one method per client message (`move`, `changeScene`, `chat`, `emote`, `variable`, `item`, `progress`, `award`, `lookChanged`, `share`, `animate`, `avatarVisible`, `whisper`, `track`, `walk`, `launch`). Events: `chat`, `emote`, `snap`, `notice`, `reward`, `show`, `whisper`, `launch`, `drop`, `reconnect`, `leave`.

- **`OnlineConnection.join(url, options)`** joins with the Colyseus SDK, waits up to 10 s for `welcome`, then for its own player record in the state. Its `state` getter returns the room state **as this player's team has it**: `players` as is, `items`, `vars` and `npcs` through `scopedMap(…, team)`.
- **`OfflineConnection`** runs a `World` over plain `Map`s in the browser and handles every client message in `send()` the way the room would. It keeps `shared` (what would have been shown to others) and `tracked` (what would have been logged) for previews and tests, and has helpers for tests: `addPlayer`, `receive`, `deliver`, `launched`.

## Assets

`core/assets.ts`:

- `mediaKey(id)` is the texture key (`media-<id>`). `queueMedia(scene, ctx, ids)` queues what is not loaded yet; `queueScene` queues a scene's media plus the global set and shop pictures; `preloadJumpTargets` loads every scene reachable from this one in the background.
- `reportLoadErrors` says on screen (in a preview) which media failed and where it is used (`mediaUses`).
- Sprite sheets: `ensureSpritesheet` registers a grid over a loaded image (one image can back several grids), `ensureAnimation`, `mediaSheet`, `mediaAnimation`, `characterAnimation`. Animated PNGs are cut into frames (`apngKey`, `whenApngReady`).
- `core/depth.ts`: `Depth.background`, `floor`, `foreground`, `label`... Figures and items between `background` and `foreground` sort by their feet; `core/sorting.ts` adds items' sort lines (`setSortLine`, `figureDepth`).

## Entities

- **`Figure`** (`entities/Figure.ts`): a picture that can be animated: plays a sheet's named animations, or bends a single picture for the built-in moves (`bend`: lift, lean, stretch), so "jump" always does something.
- **`CharacterFigure`**: someone drawn from their character animations, with poses for standing and walking each way.
- **`Avatar`** extends it: a player, with name, speech bubble, worn and ridden items (`cutBelow` hides legs inside a vehicle), and `animateAttached`.
- **`NpcFigure`**: a scenario's character with its name, walking, scaling and shading with the scene.

## Other pages in the package

- **`home.ts`** and **`teach.ts`**: the missions page (`buildHome`): missions to play, the avatar, the account; for staff, shortcuts into the editor, assignments with "Look in" per team, and their scenarios.
- **`plans.ts`**: `/plans`, the plans, trial and checkout, and the quote form for schools.
- **`site/`** and `index.html`: the marketing page, plain HTML and Tailwind, no game code.
- **`pwa.ts`**: the service worker and the install offer.

## Tests

`npm test -w @qbl/client` runs `tsx --test test/*.test.ts`. `test/fakePhaser.ts` stands in for Phaser with a manual clock (`FakeWorld`, `settle`); `test/harness.ts` has `HeadlessUi` (a `UiPort` with no DOM that records what it was asked and lets a test answer infoboxes) and a `Game` class that plays a whole scenario offline with the real engine, systems, presenters and features. The fake accepts any Phaser call, so these tests prove the game's own logic and wiring, not that real Phaser accepts the same calls. See [Testing](/docs/codebase/testing/).
