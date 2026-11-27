---
title: "Codebase guide: start here"
description: "A developer's tour of the whole QuestLab codebase: the five programs, how they fit, the words the code uses, what to read first, and a map of this guide."
host:
  who: asimov
  says: "Beep! Five programs, one set of rules, one JSON document. Here is the map; the rest of this guide takes you through every room of the ship."
  side: right
---

This guide is for developers who are about to change QuestLab's code. It goes through every part of the repository: what each program does, the classes and methods that matter, how a scenario travels from the editor to a student's screen, and the conventions that keep the parts in step. The other Developers pages describe the scenario JSON and the HTTP contracts. This guide is about the code that reads and writes them.

:::tip[In short]
- QuestLab is **five programs in one repository**: a shared TypeScript package, the Phaser game, the Colyseus game server, the editor and a Laravel API. A sixth folder holds these docs.
- A mission lives as **rows in database tables** while it is edited. Publishing **compiles** the rows into **one JSON document**, and the game only ever plays that document.
- **The rules are written once**, in `packages/shared`: the event engine (`SceneEngine`), the world rules (`World`), the validator and the variable store. The game, the server, the editor and the tests all import the same code.
- The PHP core (`App\Qbl\*`) is **plain PHP over PDO, with no framework calls**. Laravel controllers only translate requests, so the same classes also run in a small dev server and in plain-PHP tests over SQLite.
:::

## The five programs

```text
                        ┌──────────────────────────────┐
  teacher ────────────▶ │ apps/editor  (TypeScript+DOM)│──── /api/editor ───┐
                        └──────────────────────────────┘                    │
                                                                            ▼
                        ┌──────────────────────────────┐          ┌──────────────────┐
  student ────────────▶ │ apps/client  (Phaser 4)      │── /api ─▶│ apps/api         │
                        │  plays the compiled document │          │ (Laravel + PHP   │
                        └──────────────┬───────────────┘          │  core over PDO)  │
                                       │ WebSocket /game          └────────▲─────────┘
                                       ▼                                   │
                        ┌──────────────────────────────┐   /api/internal   │
                        │ apps/server  (Colyseus 0.18) │───────────────────┘
                        │  one room per party          │   (service key)
                        └──────────────────────────────┘

        packages/shared: types, validator, SceneEngine, World, protocol (used by all three TS apps)
```

Program | Folder | Language | Runs where | What it owns
------- | ------ | -------- | ---------- | ------------
Shared rules | `packages/shared` | TypeScript, no framework | Imported, as TypeScript source, by every TS program | Scenario types, normalising, validation, conditions and variables, the event engine, the world rules, geometry and pathfinding, the message protocol, and many small rule modules (characters, conversations, builds, launches...)
The game | `apps/client` | TypeScript, Phaser 4, Vite | The browser (`/missions`, `/{code}`, `/play`) | Drawing and running a scenario: one `PlayScene` with pluggable systems, action presenters, session features, an HTML UI over the canvas. Also the marketing page (`/`) and the plans page (`/plans`)
The game server | `apps/server` | TypeScript, Colyseus, Express | The `colyseus` container | Rooms that hold players, positions, shared variables and unique items; checks every move; saves progress; relays shown events, chat and launches
The editor | `apps/editor` | TypeScript and DOM, no UI framework | The browser (`/editor/`) | Editing a scenario's rows through `/api/editor`, with forms generated from field lists, a scene canvas, a scene map, undo and redo, and publishing
The API | `apps/api` | PHP 8.3, Laravel | The `app` container (PHP-FPM) | The database, accounts and sign-in, the scenario store and compiler, classes and assignments, rewards, reports, the public API, billing, districts, the AI generator, voices, the asset library

## The one idea that explains most of the code

A scenario exists in four shapes, and every program works on one of them:

Shape | Where it lives | Who reads and writes it
----- | -------------- | -----------------------
**Rows** | The tables `scenarios`, `scenes`, `events`, `actions`, `conditions`, `labels`, `media`, `variables`, `items`, `characters`, `shop_items` | `ScenarioStore` (PHP) is the only code that writes them
**Bundle** | The same rows, JSON decoded and typed, as one object (`GET /api/editor/scenarios/{id}`) | The editor's `Store` holds it in memory and sends changes back row by row
**Document** | The scenario JSON described in the [JSON reference](/docs/developers/structure/). Stored in `scenarios.document` when published | `ScenarioCompiler` makes it from rows; `ScenarioDecompiler` makes rows from it; the validator checks it
**Normalised document** | The document with defaults filled in, lists ordered and type names made canonical | `normalizeScenario()` in `packages/shared`. The game, the server and the tests only ever run a normalised document

The [lifecycle page](/docs/codebase/lifecycle/) follows one scenario through all four shapes, from the first click in the editor to a student walking through a door.

## Words the code uses

The code and its comments are consistent about these words. Learn them first.

Word | Meaning in the code
---- | -------------------
**Scenario** | A mission. One row of `scenarios`, one JSON document. Players open it at `/{code}`
**Code** | The scenario's address: 16 random lowercase letters when created, changeable on the Publish page. Rules in `codeProblem` (TS, `site.ts`) and `ScenarioStore::codeProblem` (PHP), which must agree
**Scene** | One place in a scenario. The game shows one at a time
**Event** | A list of actions with conditions. Four kinds: start, end, hotspot and indirect (`events.kind`; in the document `start_events`, `end_events`, `hotspots`, `indirect_events`)
**Hotspot** | An event with a position and a radius, fired by a click (`activate_by_trigger: true`) or by walking in
**Action** | One step of an event: `dialogue`, `variable`, `jump`, `infobox` and 26 more (`ACTION_TYPES`)
**Presented action** | An action that shows or plays something, handled by a client presenter (`PresentedAction` in `engine.ts`). The others are handled inside the engine
**Run** | One running instance of an event inside `SceneEngine`
**Handle** | `ActionHandle`: `{ done: Promise<void>, cancel() }`, what every running action returns
**Group** | The instance key a player plays in: `public`, an assignment's `a12` or a team's `t7`. Saves and shared variables belong to it
**Party** | The room key. The teams of one assignment share a room (`a12`) so they can meet in scenes not limited to a team
**Instance / World** | One group's copy of the scenario on the server: a `World` with its own shared variables, unique items and roaming characters
**Session** (save data) | A player's save in one instance: scene, position, player variables, flags, attachments, time. Type `Session` in `types.ts`. Not a web session
**Flags** | One-shot markers in the save, such as `hotspot:12` for a `once` hotspot, or `glossary:7`
**System** (client) | A `SceneSystem`: one concern inside a scene (layers, the local player, hotspots, the camera...)
**Feature** (client) | A `GameFeature`: one concern across the whole session (chat, the checklist, rewards, saving...)
**Staff** | Teachers, content admins and admins (`isStaff`). They use the editor
**Preview** | Playing an unpublished draft from the editor, offline, with nothing saved (`/play?preview=12&scene=40`)

## What to read first

If you have one afternoon, read these files in this order. Together they are under 3,000 lines and explain how everything else hangs together.

1. `packages/shared/src/types.ts`, the top and bottom: `Scenario`, `Scene`, `GameEvent`, `Hotspot`, `ActionBase`, `Session`.
2. `packages/shared/src/scenario.ts`: `normalizeScenario`, `ScenarioIndex`, `computeJumpTargets`, `collectSceneMediaIds`.
3. `packages/shared/src/engine.ts`: `SceneEngine` and the `EngineHost` interface. This is the heart of the game. See [The event engine](/docs/codebase/event-engine/).
4. `packages/shared/src/world.ts`: `World`, the rules the server enforces. See [Shared rules](/docs/codebase/shared/#world-the-rules-of-an-instance).
5. `apps/client/src/scenes/PlayScene.ts` and `apps/client/src/actions/ActionHost.ts`: how the engine is wired to Phaser.
6. `apps/server/src/rooms/ScenarioRoom.ts`: how a room wraps `World`.
7. `apps/api/app/Qbl/ScenarioCompiler.php`: how rows become the document.
8. `apps/editor/src/store.ts`: how the editor saves.

## A first day

```sh
npm install
npm run dev                  # game server :2567 and client :5173, no PHP or database
# open http://localhost:5173/missions in two windows to see multiplayer

npm run dev:editor           # PHP dev API :8000 + editor + game, http://localhost:5173/editor/
npm test                     # shared unit tests and headless game tests
npm run typecheck
```

Then make a small change end to end, for example a new optional field on an action, following the [recipe](/docs/codebase/recipes/#a-new-field-on-an-action). It touches the types, the validator, the editor's schema and a presenter, and is the quickest way to learn where things are. [Run QuestLab locally](/docs/developers/local-development/) has every way to run the platform.

:::caution[Three rules that are easy to break]
1. **Never put mission-specific code in the client or server.** A new need is a new field in the JSON plus a system, presenter or feature that reads it.
2. **Never trust the browser.** Events run in the player's browser. Anything that matters (movement, scene changes, shared variables, items, awards, purchases) is checked again by `World`, the room or the API.
3. **Keep offline and online the same.** `OfflineConnection` runs the same `World` in the browser. If you add a message, handle it in both `ScenarioRoom` and `OfflineConnection.send`.
:::

## This guide

Page | What it covers
---- | --------------
[The lifecycle of a scenario](/docs/codebase/lifecycle/) | One scenario from creation to play: every class and method on the way, in order
[The event engine](/docs/codebase/event-engine/) | `SceneEngine` in depth: runs, blocking, overridable events, conditions, cancelling, conversations, jumps, shown events
[Shared rules (`packages/shared`)](/docs/codebase/shared/) | Every module of the shared package: `World`, the variable store, the validator, geometry, walking, characters and the rest
[The game client](/docs/codebase/client/) | Boot, `GameContext`, `PlayScene`, every system, presenter and feature, the UI layer, networking, assets
[The game server](/docs/codebase/server/) | `ScenarioRoom`, the room state, backends, saving, logs, launches and the trust model
[The editor: architecture](/docs/codebase/editor/) | Routing, the `Store` and its save queue, undo and redo, forms as data, the building blocks
[The editor: pages and views](/docs/codebase/editor-views/) | The scene editor, the scene map, events and actions, the infobox editor, every library page
[The API (PHP)](/docs/codebase/api/) | The framework-free core, routes, `ScenarioStore`, the compiler, classes, rewards, activity, builds
[The data model](/docs/codebase/data-model/) | Every table, which JSON column holds what, and how each column reaches the document
[Other API subsystems](/docs/codebase/subsystems/) | The AI generator, voices, the asset library, billing, districts and the public API, from a developer's side
[Infrastructure and tooling](/docs/codebase/infrastructure/) | Docker containers, Apache routing, environment variables, the dev servers, `tools/`
[Testing](/docs/codebase/testing/) | Every test suite, its harness, and what to run for which change
[Recipes](/docs/codebase/recipes/) | Step-by-step: a new action, field, system, feature, message, table column, editor page and more
[Conventions and gotchas](/docs/codebase/conventions/) | Things that must agree in two places, naming, comments, and mistakes that are easy to make
