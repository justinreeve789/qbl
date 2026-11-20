---
title: "Architecture"
---

```
                               browser
                                  |  https
                          edge: Caddy  (ports 80 and 443; ends TLS; staging and production only)
                                  |  plain http from here on       (development: http://localhost:8080
                          apache                                     goes straight to apache)
      /            |              |               |              \
 game files     /media         /editor          /api/*          /game  (WebSocket)
 and /{code}    uploaded          |               |                |
 from the app   files         editor:         app: Laravel      colyseus
 container's    (volume)      static files    (PHP-FPM)            |
 public/ volume                                   |                |  /api/internal via apache:8081
                                                  db  <------------+  (Docker network only)
```

Docker runs seven containers: `edge` (Caddy, started on staging and production by `COMPOSE_PROFILES=https`: it ends HTTPS with a Let's Encrypt or your own certificate and passes everything on as plain HTTP; development leaves it out and uses Apache directly at http://localhost:8080), `apache`, `app` (Laravel, and Vite building the Phaser frontend and the marketing page; both are mounted from the checkout, not copied into the image), `db` (MariaDB, whose start script keeps the `qbl` account's password equal to `DB_PASSWORD`), `colyseus`, `editor` and `docs` (this documentation, built with Astro Starlight and served at `/docs`). `/` is the marketing page; every other path Apache has no file for loads the game. Vite builds the frontend into a shared volume next to Laravel's `public/` files; Apache serves that volume (and `scenarios/assets` as `/scenario-assets`) and forwards PHP requests to FPM. That fallback is how `/{code}` works: the game reads the scenario code from its address and asks the API for that scenario.

The `editor` container is static files behind its own small Apache, reached through the front one at `/editor`. Like the game, it is built by Vite in the `app` container from the checkout (`apps/editor`, mounted) into a volume the `editor` container serves, so no image holds its code. It holds no data and no secrets; everything it does is a call to `/api/editor`. Because the game and the editor share an address, they share a sign-in, and the editor's "Test this scene" can open the game on a draft.

For development without Docker, `npm run dev` needs none of this: the game server's file backend reads `scenarios/*.json`, keeps saves in `.data/saves`, and answers the few `/api` calls the client makes. `npm run dev:editor` runs the editor and the game against `apps/api/dev/server.php`, a stand-in API that runs the real PHP classes over SQLite.

## Repository layout

Path | What it is
---- | ----------
`packages/shared` | Framework-free TypeScript used by everything: scenario types, normaliser, validator, variable store, condition evaluator, the scene event engine, walkability geometry, the multiplayer world rules and the message protocol. Fully unit-tested.
`apps/server` | Colyseus game server. `ScenarioRoom` is a thin adapter around the shared `World`; `backend/` hides whether data comes from files or the API.
`apps/client` | Phaser client. One data-driven `PlayScene` plays every scene of every scenario.
`apps/editor` | The scenario editor: TypeScript and DOM, no framework. Forms are generated from lists of fields in `schema.ts`. See `apps/editor/README.md`.
`apps/api` | The Laravel application: the QBL tables, the demo mission (shipped as an exported scenario ZIP), the store the editor and the seeder write through, the compiler that generates scenario JSON from the tables, and the controllers implementing the API contract.
`scenarios` | Scenario JSON and media for the file backend. `starship.json` is generated from the demo's ZIP (`npm run seed:export`), with the files uploaded for it in `assets/starship/uploads`; do not edit them by hand.
`docs` | This documentation.
`docker` | Dockerfiles for the app, colyseus, editor, docs, apache and edge containers, the app entrypoint, the Apache configuration and the start scripts that write Apache's and Caddy's settings from `QBL_PUBLIC_URL`.
`tools` | `validate-scenario.ts`, `make-demo-audio.py`.

## Design decisions

**One engine, written once.** `SceneEngine` interprets events and actions (ordering, blocking, conditions, overridable, block_hotspots, repeat, run event, cancel, jump with end events) against a small `EngineHost` interface. The Phaser client implements the host; tests implement a fake with a manual clock. A server-side runner could reuse it if events ever need to be authoritative.

**One set of world rules, written once.** `World` (movement limits, scene changes, items, shared variables, save data) runs against any object with the right shape. On the server that is the Colyseus room state; in the client's offline mode (`?offline`) it is plain Maps in the browser. Offline play therefore behaves exactly like online play with one player, which is what an editor preview needs.

**Teams are instances; a room holds the instances that may meet.** Each team has its own `World` (shared variables, items, saves), and the teams of one assignment run side by side in one room, over one list of players, so that a scene can show everyone or only a player's team. The server sends chat and shown events only to those who can see the sender.

**One room per party, not per scene.** Class-sized groups make this cheap, and it lets shared variables and unique items span scenes without cross-room coordination. If a scenario ever needs hundreds of players in one instance, per-scene filtering with Colyseus state views is the next step.

**No physics engine.** Movement is "feet inside polygons", checked by the same function on client and server. Arcade physics would add a second, slightly different opinion about where a player can be.

**Screen-space UI in the DOM.** Infoboxes, overlays, chat and video are HTML over the canvas: sharp text, real buttons, keyboard and screen-reader access, and no interaction with camera zoom. World-space things (fixed images, spritemaps, labels) are Phaser objects.

**The runtime reads one compiled document.** Scenario content lives in tables that mirror the docs (scenarios, scenes, events, actions, conditions, labels, media, variables, items, characters). `ScenarioCompiler` generates the JSON from those rows, and publishing stores the result on the scenario. The game only ever reads the published document, so half-finished edits never reach players.

**One way into the tables.** The seeder and the editor both write through `ScenarioStore`, so seeded content and authored content cannot differ in shape, and both become JSON through the same compiler. The store, the editor's API rules and the compiler are plain PHP with no framework calls, which lets them be tested on SQLite and lets the editor's browser tests run against the real thing.

**A scenario's address is a code, not a name.** Each scenario gets sixteen random lowercase letters when it is created, unique, so codes cannot be guessed by counting. Titles and shortnames can be edited freely without breaking a link a teacher has already shared. The code changes only when its editor chooses a new one on the Publish tab (`PUT /api/editor/scenarios/{id}/code`); the old code then stops working. The rules for a code are in `packages/shared/src/site.ts` (`codeProblem`) and `ScenarioStore::codeProblem`, which must agree.

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
`features/*` | Session-long features: mission checklist, chat and private messages, players and profiles, the glossary, connection status, attachments, progress saving, and stars, XP and the marketplace (`RewardsFeature`).
`core/Rewards.ts` | The player's stars, XP, rank and marketplace items as the game knows them; talks to the API for purchases and pretends in a preview.
`entities/Avatar.ts` | A player figure with name, speech bubble and attachments.
`core/assets.ts` | Media loading, preloading of jump targets, sprite sheets.
`core/Pathfinder.ts` | The way around obstacles for click-to-walk, from a navigation mesh (the `navmesh` library).
`ui/Sidebar.ts` | The side panel: mission, inventory, moves and emotes, players, messages, glossary.
`ui/Narrator.ts` | Reading text aloud with the browser's voice, and which word it has reached.
`ui/icons.ts` | Icons: Twemoji, drawn through the Twemoji Awesome stylesheet.
`ui/UiPort.ts`, `ui/Ui.ts` | The interface the game uses for on-screen UI, and its HTML implementation.

`apps/client/README.md` explains how to add a system, a presenter or a feature.

## Adding an action type

1. Add its interface to the `Action` union in `packages/shared/src/types.ts` and its name to `ACTION_TYPES` in `scenario.ts`.
2. Add its checks to `validate.ts`.
3. If it is pure logic, handle it in `SceneEngine.execute`. If it shows or plays something, add it to `PresentedAction`, write a presenter in `apps/client/src/actions/presenters/` and register it in that folder's `index.ts`.
4. Give it a form: add it to `ACTIONS` in `apps/editor/src/schema.ts`, and its name to `ScenarioStore::ENUMS`.
5. Document it and add a test.
