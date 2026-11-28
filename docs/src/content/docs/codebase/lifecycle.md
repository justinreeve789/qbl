---
title: "The lifecycle of a scenario"
description: "One scenario followed from the editor's first click to a student walking through a door: every program, class and method on the way, in order."
host:
  who: asimov
  says: "Follow one mission from a teacher's first click to a student's footsteps. Every hand-over is named, so you can set a breakpoint anywhere."
  side: right
---

This page follows one scenario through its whole life. Each stage names the files, classes and methods involved, in the order they run. When something goes wrong between "I changed it in the editor" and "the student sees it", this is the page that tells you where to look.

:::tip[In short]
1. **Authoring.** The editor's `Store` changes rows in memory and queues one HTTP call per change to `EditorApi`, which writes through `ScenarioStore`.
2. **Preview.** "Test this scene" opens the real game on `/play?preview=ID`. It fetches the rows compiled *now* by `ScenarioCompiler`, validates and normalises them, and plays alone in the browser with `OfflineConnection`.
3. **Publish.** The editor validates the compiled draft with the shared `validateScenario`, then `POST …/publish` stores the compiled document in `scenarios.document`.
4. **Serve.** `GET /api/scenarios/{code}/play` returns that document, plus the platform's avatars, the player's save and the instance they are joining.
5. **Join.** The client joins a Colyseus room (`scenario` + `party`). The room checks the token and the instance with the API, makes a `World` per team, loads the save and sends `welcome`.
6. **Play.** `BootScene` loads the first scene's media; `PlayScene` makes a `SceneEngine` and the systems; start events run. Clicks and walking fire hotspots; actions are presented; jumps run end events and restart `PlayScene` on the next scene.
7. **Save.** The client reports progress every 5 s; the room saves sessions every 30 s, on leaving and on dropping, and saves each team's shared state when it changed.
:::

## The stages at a glance

```text
 EDITOR (browser)                   API (PHP)                         DATABASE
 ───────────────                    ─────────                         ────────
 Store.patch / add / remove ──────▶ EditorController ─▶ EditorApi ─▶ ScenarioStore ─▶ rows
 Store.load()  ◀───────── bundle ── ScenarioStore::bundle ◀─────────────────────────── rows
 "Test" ─▶ /play?preview=12 ─────▶ …/preview ─▶ ScenarioCompiler::compile(rows) + Avatars::inject
 "Publish" ─ validateScenario(preview) ─▶ …/publish ─▶ ScenarioStore::publish ─▶ scenarios.document

 GAME (browser)                     API                               GAME SERVER
 ──────────────                     ───                               ───────────
 main.ts loadScenario ───────────▶ PlayController::show ─▶ document + session + instance
 OnlineConnection.join ──────────────────────────────────────────▶  ScenarioRoom.onCreate (getScenario,
                                                                       validate, normalise)
                                    InternalController::verify ◀───  onAuth (verifyToken, mayJoin)
                                    …::access / loadSession    ◀───  onJoin (World.addPlayer) ─▶ welcome
 BootScene ─▶ PlayScene ─▶ SceneEngine.start() ─▶ presenters, systems
 moves, scene changes, variables, items ───────────────────────▶  World.move / changeScene / …
 ProgressFeature (5 s) ──────────────── progress ─────────────────▶  World.progress
                                    …::saveSession / saveInstance ◀── persist / saveInstance (30 s)
```

## 1. A scenario is created

**Editor:** the Scenarios page (`views/home.ts`, `scenarioListView`) calls `Api.create(title, template?)`, which is `POST /api/editor/scenarios`.

**API:**

1. `routes/api.php` sends every `/api/editor/*` request to `EditorController::__invoke`, behind `auth:sanctum`.
2. The controller turns the Laravel request into plain values and calls `EditorApi::handle($method, $path, $body, $user, $files)`. It never contains rules.
3. `EditorApi::route` refuses anyone who is not staff (`Roles::isStaff`), then matches `['scenarios']` + `POST` and calls `ScenarioStore::createScenario`.
4. `createScenario` either imports the starship hub template (`template: 'starship'`, rows from `database/seeders/data/hub.php` through `importRows`) or, in one transaction:
   - generates a **code** of 16 random letters (`generateCode`, unique), also used as the first shortname;
   - inserts the `scenarios` row with defaults (`enable_save_session`, `require_login: false`, `allow_groups`, `settings: {spec_version: 2, chat_mode: 'emotes', move_speed: 420}`);
   - creates a first scene with `createRow($id, 'scenes', …)` and sets `start_scene_id`.

The editor then goes to `#/s/{id}`.

## 2. The editor opens it

`apps/editor/src/main.ts`, `route()`:

1. The hash `#/s/{id}[/tab | /scene/{sceneId}]` is matched.
2. If the open `Store` is for another scenario, a new `Store(api, scenarioId)` is made and `store.load()` runs: `GET /api/editor/scenarios/{id}` returns the **bundle**, `ScenarioStore::bundle`: every row of every content table, with JSON columns decoded and numbers and booleans typed (`decode`).
3. `Store.hold(bundle)` keeps it in memory, copies every row into `saved` (what later patches are diffed against for undo), and works out `unpublished` from `published_at` and `updated_at`.
4. `workspace(store, place, go)` draws the tab bar and the page for the tab (`views/workspace.ts`). The scene editor is `views/scene/sceneEditor.ts`.

The bundle is the editor's whole world. Every page reads it through `store.rows(table)`, `store.byId(table, id)` and `store.where(table, column, value)`, and redraws when the store emits.

## 3. An author changes something

Say the author drags a hotspot on the scene canvas and then types into a dialogue action's text.

**In the editor:**

1. The canvas (`SceneCanvas`) or a form (`form()` in `fields.ts`, from field lists in `schema.ts`) calls a store method:
   - `store.patch(table, id, attrs, structural?)` to change columns;
   - `store.add(table, attrs)` to make a row;
   - `store.remove(table, id)` to delete one;
   - `store.patchScenario(attrs)` / `store.patchSettings(attrs)` for the scenario row and its `settings` column.
2. `patch` applies the change to the in-memory row **at once** and emits, so every view redraws before the server answers. `structural: false` (the default) redraws lists and the canvas but leaves forms alone, so the field being typed in keeps its focus.
3. It notes the row's columns before and after (`noted`) for the undo history (`History.take` / `record`).
4. The HTTP call is queued (`send` chains promises), so changes reach the server **in the order they were made**. A patch of the same row while its previous patch is still waiting is folded into it (`coalesced`); inside `store.live()` (a slider being dragged) patches also wait 150 ms (`PATCH_GAP`).
5. If the API refuses a change, the store shows a toast and reloads the bundle, so the screen goes back to what the database holds.

**In the API:** `EditorApi` matches `scenarios/{id}/rows/{table}/{rowId}` + `PATCH` and calls `ScenarioStore::updateRow`, which:

1. checks the row belongs to the scenario (`assertOwned`, through `PARENTS` for tables without a `scenario_id`);
2. encodes the columns by type from `SCHEMA` (`encode`: `int`, `num`, `bool`, `str`, `json`) and drops columns not in `SCHEMA`;
3. checks enums and references (`assertValid`, `ENUMS`);
4. updates the row and touches `scenarios.updated_at` (`touch`), which is what makes the editor say "Unpublished changes".

Undo and redo go through `POST …/restore` with a list of steps (`ScenarioStore::restore`), applied in one transaction. See [The editor: architecture](/docs/codebase/editor/#undo-and-redo).

## 4. The author tests a scene

"Test this scene" is a link built by `previewUrl(scenarioId, sceneId, debug)` in `apps/editor/src/config.ts`: `/play?preview=12&scene=40`. It opens the **real game**, not an imitation.

1. `apps/client/src/config.ts` reads `preview` and `scene` from the address and sets `offline: true`.
2. `main.ts` `loadScenario()` sees `config.preview` and calls `loadDraft(id)`:
   - `Api.preview(id)` is `GET /api/editor/scenarios/{id}/preview`. `EditorApi` answers with `Avatars::inject($pdo, $store->compile($id))`: the rows compiled **as they are now**, plus the platform's avatars;
   - the client runs the shared `validateScenario` and refuses to play a draft with errors, listing up to eight;
   - `normalizeScenario` fills defaults;
   - `scenario.session` is set to `{ scene_id: config.startScene }` so the draft starts in the scene asked for, with nothing saved.
3. `start()` makes an `OfflineConnection` instead of joining the game server, gives the rewards a pretend balance (`ctx.rewards.pretend(500)`) and builds in memory (`pretendBuilds`).

`OfflineConnection` runs the same `World` the server runs, over plain `Map`s. What the author sees is what players get after publishing, minus other players.

## 5. The scenario is published

The **🚀 Publish** button (on every page) and the Publish page both call `checkAndPublish(store)` in `views/pages.ts`:

1. `await store.settled()`: every queued change has been sent.
2. `validateScenario(await store.api.preview(id))`: the same validator the game and the game server use, on the same compiled draft. Errors stop publishing and go to the Publish page, where `views/issues.ts` turns each issue's `path` into "where is this in the editor" (`whereIs`, using `locateIssue` from `packages/shared/src/locate.ts`).
3. `store.publish()` is `POST /api/editor/scenarios/{id}/publish`, which calls `ScenarioStore::publish`: it compiles once more and writes the JSON to `scenarios.document` with `published_at`.

:::caution[The server does not validate on publish]
`ScenarioStore::publish` writes whatever `ScenarioCompiler` produces. Validation before publishing is the editor's job (`checkAndPublish`, in the browser). `php artisan qbl:publish` does not validate at all: run `npm run validate` on its `--print` output when you publish from the command line. The game server validates again when it creates a room and refuses to open a scenario with errors, so a bad document fails loudly, but only when someone tries to play it.
:::

### What the compiler does

`ScenarioCompiler::compile($rows)` is a pure function from the rows (as the database driver returns them, so values may be strings and JSON may be text) to the document. In order:

1. Conditions are grouped by owner (`event_id`, `action_id`, `item_id`, `character_id`).
2. Actions are sorted by `sequence`, their `params` JSON is spread beside the common columns (`id`, `event_id`, `type`, `sequence`, `blocking`, `media_id`) and their conditions added.
3. Labels are grouped by event, their `params` spread likewise.
4. Events are sorted by `sequence` and put into their scene's list by `kind`: `start_events`, `end_events`, `hotspots` (with position, radius, `activate_by_trigger`, `once`, reveal radii and labels) and `indirect_events`. `audience: 'scene'` is only written when set.
5. Scenes are sorted by `sequence`. The `layout` JSON column becomes the placed things (`walkable_areas`, `spawn_points`, `items`, `characters`, `lights`, `flows`, `bench`...); the `params` column gives the scene settings (`sky`, `atmosphere`, `weather`, `story`, `launcher`, `team_only`, `building`, `music_media_id`); what is left of `params` stays as `params`.
6. Media are sorted by `priority`; a sprite sheet's grid, animations, animated-PNG facts and speech timings come out of `params`.
7. Variables, items (with `settings` spread) and characters (with `settings` spread) follow.
8. `jump_targets` is worked out from every `jump` action, including those on infobox buttons and conversation choices (`collectJumps`).
9. The scenario row's `settings` JSON is spread at the top level (objectives, glossary, moves, chat mode, narration...), then the columns go on top.
10. `strip` drops nulls everywhere, so optional attributes are simply absent.

[The data model](/docs/codebase/data-model/) has the full mapping, column by column.

## 6. A student opens it

The student opens `/{code}`. Apache (or the Vite dev plugin) serves `play.html` for every path except `/` and files. `apps/client/src/main.ts`:

1. `config.ts` reads the code from the path with `codeFromPath`, plus `?group=`, `?party=`, `?scene=`, `?launch=`, `?debug` and the rest.
2. `loadScenario()`:
   - `Api.me()` checks the stored Sanctum token (`localStorage` `qbl.token`); if there is none, `signIn()` draws the sign-in form (log in, register, guest, forgot or reset password, Google);
   - with no code in the address (`/missions`), `showHome(user)` draws the missions page (`home.ts`, and `teach.ts` for staff) and never returns;
   - otherwise `Api.play(code, group, party)`, which is `GET /api/scenarios/{code}/play?group=…`.
3. **API**, `PlayController::show`:
   - `Scenario::findPublished($key)`: by code, or by shortname, a code winning a tie;
   - refuses with 401 when a login is required and missing (guests count as missing) or when the scenario is private and nobody is signed in, or with 403 when a curricular mission needs a plan (`ClassStore::needsPlan`), when the player may not join that instance (`ClassStore::mayJoin`), or when the mission waits for its teacher to launch it (`waitingForLaunch`);
   - `Scenario::toDocument()` takes the stored `document`, adds the code and calls `Avatars::inject` to add the platform's avatars and their pictures (avatar ids are `900000 + row id`, their media `800000 + row id`, far above any scenario's ids);
   - adds `session`: the player's save for this scenario and **group** (`scenario_sessions` keyed by scenario, user and `group_key`);
   - adds `instance`: `{group, party, team_name?, teacher_name?}` from `ClassStore::access` (a team `t7` belongs to the party of its assignment, `a12`).
4. Back in the client, `normalizeScenario(document)` (see [Shared rules](/docs/codebase/shared/#scenariots)) and `chooseAvatar` (asked once, then remembered on the account with `PUT /api/me/avatar`, or in `localStorage` for guests).

## 7. The client joins a room

`start()` in `main.ts` calls `OnlineConnection.join(config.serverUrl, options)` with `JoinOptions`: the scenario's code, the group, the party the API named, the token, the name, the avatar and, for a teacher following a team, a start scene.

**Game server**, `apps/server/src/rooms/ScenarioRoom.ts`. Rooms are defined with `defineRoom(ScenarioRoom).filterBy(['scenario', 'party'])`, so everyone with the same scenario and party shares a room.

1. **`onCreate(options)`**, once per room:
   - `services.backend.getScenario(code)`: with the API backend, `GET /api/internal/scenarios/{key}`; cached for 30 s by `withScenarioCache`;
   - `validateScenario`: a scenario with errors throws and the room is not made;
   - `normalizeScenario`; `maxClients` from `max_players`;
   - subscribes to the presence topic `qbl:launch`, so a teacher's launch from another room reaches it;
   - registers one `onMessage` handler per client message (`C2S`);
   - starts three clocks: `World.tick()` every 50 ms (roaming characters), `saveAll()` every `QBL_SAVE_INTERVAL_SECONDS` (30), `flushLogs()` every 5 s.
2. **`onAuth(client, options)`**, per player: `verifyToken` (`POST /api/internal/auth/verify`); guests are refused when the scenario requires a login; `mayJoin` (`GET /api/internal/scenarios/{id}/access/{user}?group=`) must allow the group **and** name this room's party, so a client cannot put its team into another party's room. Returns a `Seat`.
3. **`onJoin(client, options, seat)`**:
   - one seat per account: an existing session of the same user, in any team, is saved, removed and closed with `CloseCodes.ReplacedByNewSession` (4103);
   - `instance(group)` makes, the first time, that team's `World` over the room's one `players` map and the team's slices of `items`, `vars` and `npcs` (`scopedMap(map, team)`, keys `team|key`), loading what the team left (`loadInstance`);
   - `loadSession` gets the save and the reset token;
   - `World.addPlayer(sessionId, user, saved, avatarId, startScene)` puts the player in the saved scene and position (snapped to the nearest walkable point), or the start scene's spawn point, and keeps their progress;
   - a player sent here by a launch from another scenario is moved to the launcher scene (`arriveOnDetour`);
   - sends **`welcome`**: the authoritative `Session`, the chat mode, the team and whether private messages are allowed.
4. The client waits for `welcome` and for its own player record to appear in the synchronized state, then `OnlineConnection` is ready.

## 8. The game starts

Still in `start()`:

1. `new Ui(app)`: the HTML layer over the canvas, behind the `UiPort` interface.
2. `new GameContext(scenario, user, connection, ui, options)`:
   - `ScenarioIndex` for lookups;
   - `VariableStore` seeded from `global_variables` and the save's player variables; `remote` is set so **room-scoped** variable changes are sent to the server instead of applied;
   - `flags` from the save; providers for the system variables (`QL_PlayerName`, `QL_TimeElapsed`, `QL_PlayerCount`, `QL_Holding`...);
   - `Rewards` and `Bag`.
3. Optional wiring: rewards (`ctx.rewards.connect`), student builds, profiles, team following, launches, leaving the page.
4. `ui.account(…)`: the account button.
5. Every `GameFeature` from `features/index.ts` is started (`feature.start(ctx)`): connection status, chat, objectives, attachments, bag, progress, rewards, moves, players, teams, launches, glossary.
6. `new Phaser.Game({...})`, with `scene: []`, then `game.registry.set('ctx', ctx)` **before** any scene runs, then `PlayScene` is added and `BootScene` started.

### BootScene

`scenes/BootScene.ts` draws a progress bar and calls `queueScene(this, ctx, scene)` for the scene the room put the player in. `queueScene` queues every media id from `collectGlobalMediaIds` (avatars, worn and ridden items, shop pictures, glossary pictures, roaming characters) and `collectSceneMediaIds` (layers, music, labels, action media, items, critters, build pieces, characters). When loading completes, `create()` starts `play` with `{ sceneId }`.

### PlayScene.create

`scenes/PlayScene.ts`, `create(data)`:

1. Reads the scene definition, its zoom and size (`sceneSize`, else the first layer's texture, else 1920×1080).
2. Makes an `ActionHost` (the engine's window onto Phaser) and sets its controls: `locateControl`, `animateControl`, `walkControl`, `weatherControl`, `cameraControl`, `actingControl`, `freezeControl`, `avatarControl`, `benchControl`. Each points at the system that does the work.
3. Makes `new SceneEngine(def, ctx.index, ctx.vars, host, ctx.flags)`.
4. Provides the scene's own system variables (`QL_SceneId`, `QL_HotspotCoordinates`, `QL_PhysicsEnabled`) and points `ctx.bag.run` and `ctx.inScene` at `engine.runActions`.
5. Builds the `SceneRuntime` facade and creates every system in `sceneSystems` order, then calls `create()` on each.
6. Subscribes to variable changes (every system's `variablesChanged()`) and to `show` messages (`engine.watch`).
7. Starts the scene's music (`sceneMusic`: the scene's own, else the scenario's, unless a start event starts its own).
8. **`engine.start()`**: the start events fire.

Every frame, `update()` ticks the connection (offline, that moves roaming characters), copies room variables from the state into the store (`syncRoomVariables`) and calls every system's `update(time, delta)`.

## 9. Playing a scene

**Walking.** `LocalPlayerSystem` reads keys and pointer clicks, moves the avatar inside the walkable area (`resolveMove`, with a `Pathfinder` for click-to-walk), and sends `move` at most every 66 ms. On the server `World.move` checks the speed budget (`MoveBudget`) and walkability; a refused move answers `snap` and the client goes back.

**Hotspots.** `HotspotSystem` draws labels, works out reveal and hints, and on a click or a walk-in calls `engine.triggerHotspot(h)`, which checks `hotspotsBlocked`, conditions and `once` flags, then runs the event.

**Running an event.** `SceneEngine.trigger(event)` makes a run, cancels running `overridable` events and executes the actions in order, awaiting each blocking one. [The event engine](/docs/codebase/event-engine/) has the details. In brief:

- logic actions (`variable`, `wait`, `run_event`, `cancel`, `cancel_event`, `repeat`, `jump`, `travel`, `open_url`, `freeze`) are handled in the engine;
- actions that touch the world (`walk`, `animate`, `camera`, `weather`, `avatar`, `translate`, `bench`, `award`, `glossary`) call an `EngineHost` method that `ActionHost` passes to a system;
- the rest are **presented**: `ActionHost.present` looks up the presenter for the type in `actions/presenters/index.ts` and returns its handle.

**Variables.** A `variable` action calls `VariableStore.apply`. A player-scoped variable changes at once and listeners fire (objectives, labels, lights redraw). A room-scoped one is sent as `var`; `World.setVariable` applies it to the team's state; the next state patch brings it back and `syncRoomVariables` writes it into the store.

**Awards.** An `award` action sends `award` with the action id. The room asks the API (`POST /api/internal/scenarios/{id}/awards`); `ProgressStore::award` finds the action **in the published document**, grants its stars and XP once (unless `repeatable`) through `progress_ledger`, and the answer comes back as `progress` to the player.

**Shown events.** An event with `audience: 'scene'` sends `show` for each action in `SHOWN_TO_SCENE` as it reaches it (and any event sends it for a `shake` whose own `audience` is `scene`). `World.show` checks, with `sharesWithScene`, that the action really may be shown: it belongs to such an event in the sender's scene and returns who can see the sender; the room sends them `show`, and their `SceneEngine.watch` presents the same action, with the sender as the actor. A watched `shake` with no `duration` runs until stopped, so the engine keeps it by actor (`endlessActors`); each frame `PlayScene.forgetDeparted` calls `engine.forget(actor)` for any sender no longer in the scene or no longer seen.

## 10. Going through a door

A scene's exit is a walk-in hotspot whose action is a `jump`.

1. The engine's `jump` case calls `leave(sceneId, spawnPoint)` and ends the current event.
2. `leave` → `depart`: sets `leaving`, runs every **end event** and waits for them, calls `stop()` (cancels every run and handle), then `host.jump(…)`.
3. `ActionHost.jump` → `PlayScene.jump`: saves progress (`ctx.saveProgress(true)`), sends `scene` with the target and spawn point, works out where the spawn point is, and fades the camera out.
4. On the server, `World.changeScene` only allows scenes in `jump_targets` of the current scene, places the player at the spawn point (nearest walkable), shows a hidden avatar again and resets the move budget.
5. When the fade completes, `PlayScene.restart({ sceneId, position })` waits for anything not yet loaded (`queueScene`; usually already done by `PreloadSystem`, which loads every jump target in the background), then `this.scene.restart(data)`.
6. Phaser shuts the scene down: `shutdown()` stops the engine, tears down the host (sounds, voices, overlays; **background music survives**), and destroys the systems in reverse order. Then `init` and `create` run again for the new scene.

If the room ever disagrees with the client about the scene for more than 1.5 s (a launch moved the player, a jump was refused), `LocalPlayerSystem` follows the room with `restart`, without end events.

## 11. Saving

There are two kinds of saved state, kept in two tables:

What | Owner | Table | Written by
---- | ----- | ----- | ----------
A player's **session** in one instance: scene, position, player variables, flags, worn and ridden items, time | The player | `scenario_sessions` (scenario, user, `group_key`) | The game server: `persist()`
A team's **instance**: room variables, where unique items lie, where roaming characters are | The team | `scenario_instances` (scenario, `group_key`) | The game server: `saveInstance()`

The client never saves directly:

1. `ProgressFeature` calls `ctx.saveProgress()` every 5 s (only if something changed) and on `pagehide`. It sends `progress` with the player-scoped variable snapshot, the flags and the time.
2. `World.progress` keeps it in memory, cleaning it against the scenario's definitions (only known player variables, short strings, at most 500 flags).
3. `ScenarioRoom.persist(sessionId)` saves `World.sessionOf(sessionId)`: on the 30 s clock, on `onDrop`, on `onLeave` and when a second tab takes over. Position comes from the room state, not the client's report.
4. `saveInstance(team)` saves `World.instanceData()` when the world is `dirty`, and always on `onDispose`.

**Resetting.** When a teacher starts a student's game again, the API deletes the save and writes a reset line to `activity_log`; the id of the latest such line is the save's **reset token** (`ActivityStore::resetToken`, 0 before any reset). Saves carry the token they were loaded with (`?reset=`); a stale one is refused with 409, `ApiBackend` throws `ProgressResetError`, and the room drops the player's game and closes the connection with `ProgressReset` (4104). Reloading loads the fresh start.

## 12. Leaving

- **Tab closed or another page opened.** `pagehide` saves; the connection closes; `onLeave` logs `leave`, persists and removes the player. Unique items they carried are dropped where they stood (`World.release`).
- **Connection dropped.** `onDrop` marks the player disconnected, persists, and holds the seat for `QBL_RECONNECT_SECONDS` (30). The client shows "Reconnecting…" (`ConnectionFeature`).
- **Back button into a cached page.** `ConnectionFeature` reloads on `pageshow` with `persisted`, to rejoin rather than show a frozen room.
- **Room empty.** Colyseus disposes it; `onDispose` saves every team's instance and flushes the logs.

## The file backend: the same lifecycle without PHP

`npm run dev` runs the game server with `QBL_BACKEND=file` (the default). `FileBackend` reads `scenarios/<key>.json` (by file name, or by a `code` inside the file), keeps saves as JSON under `.data/saves`, issues guest tokens that prove nothing, and lets anyone into any group. `index.ts` also mounts a small stand-in for `/api/auth/guest`, `/api/me` and `/api/scenarios/:key/play`, which validates and normalises the file. Stages 1 to 5 do not exist in this mode: you edit the JSON by hand (or export it from the database with `npm run seed:export`).
