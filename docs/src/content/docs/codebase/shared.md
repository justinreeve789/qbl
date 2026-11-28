---
title: "Shared rules (packages/shared)"
description: "Every module of @qbl/shared: the scenario types, normalising and indexing, variables and conditions, the world rules the server enforces, the protocol, the validator, geometry, walking, characters, conversations and the smaller rule modules."
host:
  who: asimov
  says: "Anything two programs must agree on is written here, once. If you find the same rule in two places, one of them is a bug waiting to happen."
  side: right
---

`@qbl/shared` is framework-free TypeScript that every other TypeScript program imports: the game, the game server, the editor, the tools and the tests. Anything two programs must agree on lives here, written once. It has two dependencies (`mathjs`, `navmesh`) and no DOM, Phaser or Node APIs, except in the separate `browser/` folder and the `bin/walk.ts` script.

:::tip[In short]
- **Types** (`types.ts`) describe the scenario JSON. Fields marked `[ext]` are QuestLab's additions to the original QBL spec.
- **`normalizeScenario`** fills defaults and canonicalises; **`ScenarioIndex`** gives fast lookups. Every runtime works on a normalised scenario.
- **`SceneEngine`** runs events ([its own page](/docs/codebase/event-engine/)). **`World`** enforces the rules of an instance: movement, scene changes, items, shared variables, saves. Both run unchanged in the browser and on the server.
- **`validateScenario`** is the one validator: the editor's Publish, the game, the game server and `npm run validate` all call it.
- **`protocol.ts`** names every message between client and server.
- Many small modules hold one rule each, so the game, the editor's preview, the server and the generator agree: characters, conversations, the bag, builds, launches, the sky, weather, water light, sorting, speech timings, formulas.
:::

## How it is built and imported

- `package.json` exports two entries: `.` (`src/index.ts`, which re-exports almost everything) and `./formula` (`src/formula.ts`, separate because math.js is large and only some pages need it).
- **Almost everything imports the TypeScript source directly.** Vite aliases `@qbl/shared` to `packages/shared/src/index.ts` for the client and the editor (see `apps/client/vite.config.ts`). The game server runs under `tsx` (`tsx watch src/index.ts` in development, `node --import tsx src/index.ts` in its Docker image), and its `tsconfig.json` maps `@qbl/shared` to the source with `paths`. So there is no build step and a change reloads at once.
- **The built output** (`dist/`, `npm run build -w @qbl/shared`) is what the package's `main` points at. It is needed by scripts run with plain Node, such as `tools/make-science-lab.mjs`, and by `npm run build`.
- Imports inside the package use `.js` extensions (`./types.js`) because it is compiled as an ES module.
- Tests: `npm test -w @qbl/shared` runs `tsx --test test/*.test.ts` (Node's built-in test runner).

## The modules, by importance

### `types.ts`: the scenario document

About 1,700 lines of interfaces and a few helper constants. The ones to know:

Type | What it is
---- | ----------
`Scenario` | The whole document. Original fields (`id`, `shortname`, `title`, `start_scene_id`, `global_variables`, `assets`, `scenes`, `jump_targets`...) plus extensions (`code`, `items`, `characters`, `avatars`, `objectives`, `shop_items`, `glossary`, `moves`, `scene_groups`, `combinations`, `narration`, `narrator_voice`, `chat_mode`, `move_speed`...). Also `session` and `instance`, added when the document is served
`Scene` | One place: layers (`background_media`, `foreground_media`), events (`start_events`, `hotspots`, `indirect_events`, `end_events`), and extensions: size, `walkable_areas`, `blocked_areas`, `spawn_points`, `scale_areas`, `shadow_spots`, `sky`, `lights`, `atmosphere`, `weather`, `flows`, `water_lights`, `fogs`, `critters`, `items`, `characters`, `bench`, `building`, `story`, `launcher`, `team_only`, music
`GameEvent` | `{id, shortname?, overridable?, block_hotspots?, audience?, conditions?, actions}`
`Hotspot` | A `GameEvent` with `position_x`/`position_y` (null means "the whole axis"), `radius` (-1: default), `activate_by_trigger`, `labels`, `once`, `reveal_radius`, `reveal_full_radius`
`Action` | The union of 30 action interfaces (`AudioAction`, `DialogueAction`, `JumpAction`...), each extending `ActionBase` `{id, event_id?, sequence?, blocking?, media_id?, conditions?}`
`ActionType` | The 30 type names
`Condition` | `{variable, operator, operand}`; operators `= != > < >= <= % !%`
`Variable` | `{variable_name, default_value, scope?: 'player' | 'room', persist?}`
`Media` | A picture, sound or video: `url` or `filepath`+`filename`, size, scale, `sheet` (grid), `animations`, `apng`, `speech` (word timings)
`Character`, `Npc`, `AvatarCharacter` | Characters drawn from named animations; `Npc` adds a routine, a voice, conditions; `AvatarCharacter` is a player avatar
`Item` | Things to pick up, wear (`wearable`), ride (`vehicle`), carry in the bag (`carried_when`), block (`blocking`); `unique` items exist once per instance
`Session` | Save data: scene, position, player variables, attachments, flags, time
`Objective`, `GlossaryEntry`, `ShopItem`, `Move`, `SceneGroup`, `Combination` | The scenario-wide lists

Constants worth knowing: `SHOWN_TO_SCENE`, `AUTOMATIC_ANIMATIONS`, `BUILT_IN_MOVES`, `ANIMATION_NAME` (the regex animation names must match), `DEFAULT_RANKS` and `rankFor(xp)`, `CRITTER_BEHAVIORS`, `OVERLAY_MOTIONS`, `ROUTINE_STEP_TYPES`.

The [JSON reference](/docs/developers/structure/) documents every field for authors. `types.ts` is where to look for exact optionality and defaults.

### `scenario.ts`

Function or class | What it does
----------------- | ------------
`normalizeScenario(input)` | Returns a new scenario: scenes and actions ordered by `sequence`; action type names canonicalised (`"Image Fixed"`, `imageFixed` → `image_fixed`); `blocking` defaulted to true; events given `overridable`, `block_hotspots`, `audience`, `conditions`; hotspots given `radius: -1`, `activate_by_trigger: false`, `labels: []`; scenes given `zoom: 1`, `show_avatars` (false in a story scene), empty lists; inline media on layers and labels hoisted into `assets`; vehicles made unique; characters normalised (`normalizeNpc`, `normalizeRoutine`, `roams`); avatars from `scenarioAvatars`; assets sorted by `priority`; `jump_targets` computed
`normalizeActionType(raw)` | The canonical type name, or null
`ScenarioIndex` | Maps by id: `scenes`, `media`, `items`, `characters`, `avatars`, `events` (each with its scene), `hotspots`. Methods `scene(id)`, `startScene()`, `jumpTargets(sceneId)` (both document shapes), `spawn(scene, name?)` (named, else `default`, else the first)
`computeJumpTargets(scenario)` | Scene id → scenes reachable by `jump`, including from infobox buttons and conversation choices. **The server only lets a player change to a scene in this list**
`forEachAction(scene, visit)` | Every action of every event of a scene, including nested ones
`collectSceneMediaIds(scenario, scene)` / `collectGlobalMediaIds(scenario)` | What to load before showing a scene, and what is needed everywhere (avatars, wearables, vehicles, shop pictures, glossary pictures, roaming characters)
`resolveMediaUrl(scenario, media)` | Absolute URLs and site-root paths as they are; anything else under `asset_base_url`
`sceneSize(scenario, scene)` | Explicit size, else the first background's display size, else its media size; null if the document does not say (the server falls back to 1920×1080)
`sceneCompany(scenario, scene)` / `sceneTeamOnly` | Who a scene shows a player: `everyone`, `team` or `alone`, from the scene's `team_only`, else its group's
`sceneMusic(scenario, scene)` | The music a scene starts with, or null when a start event starts its own
`storyNext(scene)` | Where a story scene's "Skip" goes: the first jump in its start events
`labelPlacement`, `mainLayerIndex`, `layerMediaId`, `labelMediaId`, `glossaryOf`, `glossaryFlag`, `dialogueDuration` | Small rules used by the game and the editor

### `variables.ts`: variables and conditions

- **`VariableStore`** holds one player's values. It is built from the definitions and a save (only persistent player variables are restored). Methods: `get(name)` (providers first, then values; legacy names are translated with `currentName`; an unknown `QL_Ability_*` reads as 0), `apply(name, operator, operand)` (unknown and reserved names are ignored; **room-scoped variables go to `remote` when it is set**), `setFromRemote`, `provide(name, fn)` for system variables, `onChange(listener)`, `touch(name)`, `snapshot(scope)`.
- **`applyOperator(current, operator, operand, random?)`**: `set`, `+ - * / %` (non-numbers and division by zero leave the value as it was), `random` (0 to the operand inclusive; with no operand, 1 to 1,000,000,000 as older scenarios expect).
- **`testCondition` / `testConditions`**: numbers compare as numbers when both sides are numeric, otherwise as lower-case strings. `>`, `<`, `>=`, `<=` need numbers. `%` is "is a multiple of", `!%` "is not" (`isMultiple` allows tiny float error). An empty list passes.
- **System variables**: `SYSTEM_VARIABLES` lists every `QL_*` name with its explanation, in the order the editor offers them. `RESERVED_PREFIXES` (`QBL`, `QL_`) may not start an author's variable. `LEGACY_VARIABLES` maps the old `QBL*` names. `HOLDING` is `QL_Holding`; `ABILITY_PREFIX` is `QL_Ability_`.

Who provides each system variable: `GameContext` (player name, teacher, counts, time, language, video, launch, holding) and `PlayScene` (scene id, hotspot coordinates, physics).

### `engine.ts`

`SceneEngine`, `EngineHost`, `ActionHandle`, `ChoiceHandle`, `PresentedAction`, `isIndefinite`, `isShownToScene`, `resolvedHandle`. All on [The event engine](/docs/codebase/event-engine/).

### World, the rules of an instance

In `world.ts`.

`World` is everything the game server enforces, independent of Colyseus. It mutates a `WorldState` it is given (`players`, `items`, `vars`, `npcs`, each a `MapLike`): on the server those are the synchronized Colyseus maps (or a team's slice of them, via `scopedMap`); offline and in tests they are plain `Map`s.

```ts
new World(scenario, deps: { state, newPlayer, newItem, newNpc?, now, random? }, instance: InstanceData | null, team = '')
```

The constructor writes room-scoped variables into `state.vars` (saved value or default, JSON-encoded so numbers stay numbers), places every unique item once (its saved place if that scene still exists, else its first placement), works out static obstacles (blocking items without conditions) and starts the `Roamers` for characters that walk around on their own.

Method | Rule
------ | ----
`addPlayer(sessionId, user, saved, avatarId?, startSceneId?)` | Start from the save if saves are on (a requested start scene wins, for staff); else the start scene's spawn point. Snap to the nearest walkable point. Keep only non-unique worn or ridden items. Pick an allowed avatar. Returns the `Session` they start from
`removePlayer(sessionId)` | Drop unique items they held where they stand; return their save
`move(sessionId, {x, y, facing})` | Refuse non-numbers, moves faster than `MoveBudget` allows for their speed (vehicles multiply it), and points that are not walkable. Walking clears a running avatar animation. On refusal returns where to snap back to
`changeScene(sessionId, {scene_id, spawn_point?})` | Only a scene in `jumpTargets(current)` (or the same scene). Places at the spawn point, unhides the avatar, resets the budget
`sendToScene(sessionId, sceneId)` | A teacher's launch to a launcher scene, from anywhere. Remembers where they were (`launchedFrom`): until they leave that scene they are saved as if they had not gone
`show(sessionId, {event_id, action_id})` | May this action be shown to the scene? Returns the audience or null
`audience(sessionId)` | Other players who can see this one: same scene, and same team if the scene is limited (`canSee`); nobody in an `alone` scene
`animate(sessionId, {name})` | Name must match `ANIMATION_NAME`; at most one every 250 ms. Stored as `name:count` so the same move twice plays twice
`setAvatarVisible`, `setLook` | Hide or show; what they wear (`look` comes from the backend, never the client)
`setVariable(sessionId, {name, operator, operand})` | Only room-scoped variables, known operators, operands up to 1,000 characters. Marks the world dirty
`walk(sessionId, msg)` | A player's event sending a roaming character somewhere: only a walk that an action of the player's scene describes exactly (`sameWalk`), at most every 250 ms
`item(sessionId, {item_id, action})` | Attach or detach a wearable or vehicle. Only one vehicle at a time; a unique item must be free and in the same scene; the player must be within 260 px (`REACH`)
`progress(sessionId, msg)` | Keep the client's player variables (known, persistent, player-scoped, short), flags (strings up to 64 characters, at most 500) and time (never goes backwards)
`sessionOf(sessionId)` | The save to write now
`instanceData()` | What the team keeps: room variables, where unique items are (a held one at its holder's feet), roaming characters
`tick()` | Let roaming characters move. The room calls it every 50 ms; offline, `OfflineConnection.tick` each frame
`playerCount`, `findSessionByUser`, `userOf`, `dirty`, `teamName` | Bookkeeping

Also exported: `canSee(viewer, subject, company)`, `scopedMap(map, scope)` (keys stored as `scope|key`), `blockingRadius`, `parseIds`, and the record types `PlayerRec`, `ItemRec`, `InstanceData`, `User`.

:::note[Why the server is lenient about item conditions]
An item with conditions may exist for one player and not another, and its conditions can read player variables the server never sees. So `blocksForEveryone` only treats unconditional blocking items as obstacles on the server; the client handles the rest. Keep this in mind before adding server-side checks that depend on player variables: the server does not have them.
:::

### `protocol.ts`

The message names and shapes. Continuous state (positions, attachments, shared variables, items, roaming characters) travels in the synchronized room state instead.

- `ROOM_NAME = 'scenario'`, `JoinOptions` (scenario, group, party, token, scene_id, name, avatar_media_id).
- **`C2S`**, client to server: `move`, `scene`, `chat`, `emote`, `var`, `item`, `progress`, `avatar`, `award`, `look`, `show`, `animate`, `whisper`, `track`, `walk`, `launch`.
- **`S2C`**, server to client: `welcome`, `chat`, `emote`, `snap`, `notice`, `progress` (an award's result), `show`, `whisper`, `launch`.
- Message interfaces (`MoveMessage`, `WelcomeMessage`, `RewardMessage`, `LaunchBroadcast`...), `TRACK_TYPES` (`hotspot`, `choice`, `objective`, `glossary`, `narration`), `ActivityEntry`, `MessageEntry`, `EMOTES`, `CHAT_MAX_LENGTH` (140), and `CloseCodes` (4101 unavailable, 4102 unauthorised, 4103 replaced by a new session, 4104 progress reset).

[Multiplayer protocol](/docs/developers/protocol/) documents the contract for client authors.

### `validate.ts`

`validateScenario(doc): { ok, errors, warnings }`. Each `Issue` has a `level`, a `path` (`scenes[2].hotspots[0].actions[3].scene_id`) and a message for a person. **Errors** mean the runtime cannot be trusted with it; **warnings** are things an author probably did not intend.

It checks, among much else: ids are numbers and unique per kind; media exist and are of the right type for each use; variable names are not reserved and are declared where used (in conditions, variable actions, `{{placeholders}}`, infobox blocks); every reference (scene, event, action, item, character, spawn point, glossary entry, conversation line) resolves; spawn points and hotspots are on walkable ground; each action type's required attributes; conversations (line ids, unreachable lines); characters' animations and routines (doors between scenes); benches (`bench-validate.ts`); builds; launcher scenes; sky, weather, flows and water lights; old system variable names (with the new name in the message).

`locate.ts` turns a path back into a place (`locateIssue`: the scene, event, action, button, field), which the editor's Publish page uses to link each issue to the form that fixes it.

### Geometry, walking and roaming

Module | What it has
------ | -----------
`geometry.ts` | `pointInPolygon`; `walkContext(scene, size, obstacles)` and `isWalkable` ("feet inside a walkable polygon, outside blocked ones and obstacle circles"; no walkable areas means the whole scene); `resolveMove` (slide along edges); `nearestWalkable`; `stepToward`; `inHotspot`; `MoveBudget` (a speed allowance with 0.6 s reserve and 25% slack, which the server spends on every move); `scaleAt` and `speedFactorAt` (scale areas); `revealAmount` (hotspot reveal fade); `shadeAt` and `shadeTint` (shadow spots)
`pathfinder.ts` | `Pathfinder`: the way around obstacles for click-to-walk, from a navigation mesh built with the `navmesh` library; `walkSignature` to know when to rebuild it
`walking.ts` | Rules shared by roaming characters (server) and walking characters (browser): `characterRoams`, `startPlacement`, `walkSpeed`, `roomConditions` (a character's conditions may only use room variables if it roams), `doorsOf(scene)` (walk-in hotspots whose action jumps), `routeBetween` (scenes through doors), `doorPoint`, `normalizeRoutine`, `moveDuration`
`roaming.ts` | `Roamers`: characters with a routine walk around the world on their own, one copy per instance. `tick()` steps them, `command()` sends one somewhere for a player's walk action, `saved()` is what the instance keeps. `NpcRec` is what the room state carries for each

There is **no physics engine**. Movement is "feet inside polygons", checked by the same `isWalkable` on client and server.

### Characters and animation

- `characters.ts`: `CHARACTER_POSES` (`stand_right`, `stand_left`, `walk_right`, `walk_left`, `portrait`), `resolvePose` (a missing pose is another one mirrored), `resolvePortrait`, `animationFrames`, `animationDuration`, `characterMediaIds`, `characterMoves`, `animationsFromPicture` and `normalizeNpc` (older characters with a picture and a portrait become animations), `scenarioAvatars`, `characterPicture` (a standing or portrait picture, for HTML).
- `walkCycle.ts`: a six-frame side walk made from one standing picture (legs cut out and stepped, with two-bone inverse kinematics). Pure pixel buffers, so it runs in Node: `apps/api` calls it through `bin/walk.ts` for "Make walk".
- `apng.ts`: reads animated PNGs byte by byte and cuts them into frames, because browsers give only the first frame to a canvas.
- `sorting.ts`: who is drawn in front of whom. Figures sort by their feet; an item can have a **sort line** along its base (`sortLineOf`, `placeSortLine`, `lineYAt`, `sortDepth`).

### Conversations, text and speech

- `conversation.ts`: dialogue trees. `LINE_ID`, `conversationLines`, `findLine`, `startLineId`, `lineToSay` (skips lines whose conditions fail), `offeredChoices`, `lineTargets`, `reachableLines`, `newLineId`, `conversationRef`. The engine walks the tree with these; the editor draws it with them.
- `text.ts`: `interpolate(text, get, {mediaUrl, escape})` fills `{{variable}}` and `{{media:ID}}` (unknown names are left visible, on purpose); `placeholderVariables`; `escapeHtml`; `evaluateObjectives`; word timing helpers (`speechWords`, `wordAt`, `estimateWordTimes`, `speechDuration`) and `isNarrated`.
- `speech.ts`: recorded lines with word timings (`MediaSpeech`), `alignWordTimes`, `wordAtTime`.
- `rename.ts`: `renameVariable(doc, old, new)` and `renameVariableInText`: renaming a variable everywhere it is named (conditions, variable actions, `{{name}}`, infobox blocks, bench readouts).

### Infoboxes, benches and formulas

- `infobox.ts`: rich infobox content is plain HTML with `data-qbl` blocks (`page`, `gallery`, `flip`, `callout`, `answer`, `word`, `panel`, `slider`, `switch`, `wheel`, `value`, `meter`, `when`, `math`, `calc`, `graph`). `infoboxRefs` finds the media, variables and words a box uses; graph and series parsers; `parseWhen`; sizes, button marks (`right`, `wrong`, `try_again`) and callout tones.
- `formula.ts` (entry `@qbl/shared/formula`): formulas with math.js: `formula`, `formulaProblem`, `evaluateNumber`, `formulaFunction`, `formatNumber`, `checkAnswer` (with units).
- `bench.ts`, `bench-sim.ts`, `bench-validate.ts`: the close-up bench. Types (substances, vessels, tools, reactions, readouts, watches, graph), the simulation `BenchSim` that the game steps and draws, and its checks.

### The world's look

`sky.ts` (time-of-day keyframes, `skyLook`, `skyHour`), `weather.ts` (`weatherSettings`, `flowSettings`, `flowSound`), `fog.ts` (fog: `fogSettings`, `fogArea`, the `FOG_FRAG` shader), `waterLight.ts` and `waterLightShaders.ts` (underwater light, with the GLSL the game and the editor preview share), `sounds.ts` (`BUILT_IN_SOUNDS`, sounds the client synthesises).

### Site, roles, launches, builds, the bag

Module | Rules
------ | -----
`site.ts` | `codeProblem(code)`, `normalizeCode`, `RESERVED_CODES`, `codeFromPath`, `siteLinks(role)`, `homePath`. **Must agree with `ScenarioStore::codeProblem` and `RESERVED_CODES` in PHP**
`roles.ts` | `Role`, `isStaff`, `editsAllScenarios`, `managesLibrary`, `roleLabel`. **Must agree with `App\Qbl\Roles`**
`launch.ts` | A teacher sending their students into another mission: `planLaunch`, `planRelay` (other rooms), `launchReport`, detours (`detourKey`, `detourPath`, `DETOUR_SECONDS`), `LAUNCH_TOPIC`, `isLauncherScene`, `launcherScenes`, `launchPath`, `LAUNCH_URL_PLACEHOLDER`, `isLaunchUrlOnly`, `parseLaunchParam`
`builds.ts` | Student building: `SceneBuilding`, `BuildPiece`, `buildingRules`, `buildProblems`, `tidyPiece`, `BUILD_LIMITS`, `cleanLabel`, `cleanNote`. **Must agree with `App\Qbl\Builds\BuildRules`**
`bag.ts` | The point-and-click bag: `isCarried`, `carriedItems`, `takesItems`, `combinationFor`
`icons.ts`, `twemoji.ts` | Interface icons by meaning; `twemoji.ts` is generated by `tools/make-twemoji-map.mjs`

### `browser/` and `bin/`

- `browser/profile.ts`: the profile dialog (name, password, reset link), shared by the game's missions page and the editor. It uses the DOM, so it is not exported from the package index; both apps import it by path.
- `bin/walk.ts`: a Node script around `walkCycle` that the API's `WalkMaker` runs to make a walk from a standing picture.

## Tests

`packages/shared/test/` has one file per area (`shared.test.ts` for the engine, variables, validator and normaliser; `world.test.ts`, `roaming.test.ts`, `conversation.test.ts`, `builds.test.ts`, `walk-cycle.test.ts` and more). They are plain Node tests with fake hosts and clocks. Run them with `npm test -w @qbl/shared`.
