# Architecture

```
                               browser
                                  |
                          apache  (port 80, published)
      /            |              |               |              \
 game files     /media         /editor          /api/*          /game  (WebSocket)
 and /{code}    uploaded          |               |                |
 from the app   files         editor:         app: Laravel      colyseus
 container's    (volume)      static files    (PHP-FPM)            |
 public/ volume                                   |                |  /api/internal via apache:8081
                                                  db  <------------+  (Docker network only)
```

Docker runs five containers: `app` (Laravel and the built Phaser frontend), `db` (MariaDB), `colyseus`, `editor` and `apache`. The Phaser build is copied into Laravel's `public/` directory; Apache serves those files from a shared volume and forwards PHP requests to FPM. Any path Apache has no file for loads the game, which is how `/{code}` works: the game reads the 16-letter code from its address and asks the API for that scenario.

The `editor` container is static files behind its own small Apache, reached through the front one at `/editor`. It holds no data and no secrets; everything it does is a call to `/api/editor`. Because the game and the editor share an address, they share a sign-in, and the editor's "Test this scene" can open the game on a draft.

For development without Docker, `npm run dev` needs none of this: the game server's file backend reads `scenarios/*.json`, keeps saves in `.data/saves`, and answers the few `/api` calls the client makes. `npm run dev:editor` runs the editor and the game against `apps/api/dev/server.php`, a stand-in API that runs the real PHP classes over SQLite.

## Repository layout

Path | What it is
---- | ----------
`packages/shared` | Framework-free TypeScript used by everything: scenario types, normaliser, validator, variable store, condition evaluator, the scene event engine, walkability geometry, the multiplayer world rules and the message protocol. Fully unit-tested.
`apps/server` | Colyseus game server. `ScenarioRoom` is a thin adapter around the shared `World`; `backend/` hides whether data comes from files or the API.
`apps/client` | Phaser client. One data-driven `PlayScene` plays every scene of every scenario.
`apps/editor` | The scenario editor: TypeScript and DOM, no framework. Forms are generated from lists of fields in `schema.ts`. See `apps/editor/README.md`.
`apps/api` | Laravel overlay: the QBL tables, seed data for the demo mission, the store the editor and the seeder write through, the compiler that generates scenario JSON from the tables, and the controllers implementing the API contract.
`scenarios` | Scenario JSON and media for the file backend. `starship.json` is generated from the API's seed data (`npm run seed:export`); do not edit it by hand.
`docs` | This documentation.
`docker` | Dockerfiles for the app, colyseus, editor and apache containers, the app entrypoint and the Apache configuration.
`tools` | `validate-scenario.ts`, `make-demo-audio.py`.

## Design decisions

**One engine, written once.** `SceneEngine` interprets events and actions (ordering, blocking, conditions, overridable, block_hotspots, repeat, run event, cancel, jump with end events) against a small `EngineHost` interface. The Phaser client implements the host; tests implement a fake with a manual clock. A server-side runner could reuse it if events ever need to be authoritative.

**One set of world rules, written once.** `World` (movement limits, scene changes, items, shared variables, save data) runs against any object with the right shape. On the server that is the Colyseus room state; in the client's offline mode (`?offline`) it is plain Maps in the browser. Offline play therefore behaves exactly like online play with one player, which is what an editor preview needs.

**One room per scenario instance, not per scene.** Class-sized groups make this cheap, and it lets shared variables and unique items span scenes without cross-room coordination. If a scenario ever needs hundreds of players in one instance, per-scene filtering with Colyseus state views is the next step.

**No physics engine.** Movement is "feet inside polygons", checked by the same function on client and server. Arcade physics would add a second, slightly different opinion about where a player can be.

**Screen-space UI in the DOM.** Infoboxes, overlays, chat and video are HTML over the canvas: sharp text, real buttons, keyboard and screen-reader access, and no interaction with camera zoom. World-space things (fixed images, spritemaps, labels) are Phaser objects.

**The runtime reads one compiled document.** Scenario content lives in tables that mirror the docs (scenarios, scenes, events, actions, conditions, labels, media, variables, items, characters). `ScenarioCompiler` generates the JSON from those rows, and publishing stores the result on the scenario. The game only ever reads the published document, so half-finished edits never reach players.

**One way into the tables.** The seeder and the editor both write through `ScenarioStore`, so seeded content and authored content cannot differ in shape, and both become JSON through the same compiler. The store, the editor's API rules and the compiler are plain PHP with no framework calls, which lets them be tested on SQLite and lets the editor's browser tests run against the real thing.

**A scenario's address is a code, not a name.** Each scenario gets sixteen random lowercase letters when it is created, unique and never changed. Titles and shortnames can be edited freely without breaking a link a teacher has already shared, and codes cannot be guessed by counting.

**Testing a draft is playing it.** The editor does not imitate the game. "Test this scene" opens the real client on the JSON generated from the rows as they are now, offline (the same `World` rules run in the browser), starting in the chosen scene. What an author sees is what players will get after publishing.

**Scenes connect through jump actions.** A scene edge is a walk-in hotspot spanning one axis whose action is a jump. There is no separate "exit" concept; anything a hotspot or action can do (conditions, sounds, end events) applies to leaving a scene.

## Client modules

Module | Responsibility
------ | --------------
`main.ts` | Sign-in, scenario fetch, avatar choice, connection, boot.
`net/Api.ts` | The public API calls.
`net/Connection.ts` | `OnlineConnection` (Colyseus) and `OfflineConnection` (local `World`) behind one interface.
`core/GameContext.ts` | What outlives a scene: scenario, variables, flags, music, progress saving.
`core/SceneRuntime.ts` | The `SceneSystem` interface and what a system can see.
`scenes/PlayScene.ts` | Creates the event engine and the registered systems for one scene; handles the jump to the next.
`systems/*` | One concern each: layers, props, local player, remote players, hotspots, speech, camera, preloading, debug overlay. `systems/index.ts` is the list.
`actions/ActionHost.ts` | The engine's link to Phaser and the UI.
`actions/presenters/*` | One presenter per action type; `index.ts` is the registry.
`features/*` | Session-long features: mission checklist, chat, connection status, attachments, progress saving.
`entities/Avatar.ts` | A player figure with name, speech bubble and attachments.
`core/assets.ts` | Media loading, preloading of jump targets, sprite sheets.
`ui/UiPort.ts`, `ui/Ui.ts` | The interface the game uses for on-screen UI, and its HTML implementation.

`apps/client/README.md` explains how to add a system, a presenter or a feature.

## Adding an action type

1. Add its interface to the `Action` union in `packages/shared/src/types.ts` and its name to `ACTION_TYPES` in `scenario.ts`.
2. Add its checks to `validate.ts`.
3. If it is pure logic, handle it in `SceneEngine.execute`. If it shows or plays something, add it to `PresentedAction`, write a presenter in `apps/client/src/actions/presenters/` and register it in that folder's `index.ts`.
4. Give it a form: add it to `ACTIONS` in `apps/editor/src/schema.ts`, and its name to `ScenarioStore::ENUMS`.
5. Document it and add a test.
