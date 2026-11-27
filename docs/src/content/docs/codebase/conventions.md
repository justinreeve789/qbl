---
title: "Conventions and gotchas"
description: "The design rules the codebase keeps to, the things that must agree in two places, naming and comment style, and the mistakes that are easy to make: what silently drops a field, what needs a rebuild, and where a change shows up later than you expect."
host:
  who: asimov
  says: "The rules that keep five programs in step, and the traps I have watched developers fall into. Read this one before your first pull request."
  side: right
---

:::tip[In short]
- **Write a rule once**, in `packages/shared` for TypeScript. Where PHP must apply the same rule, there is a named twin, and the two are changed together.
- **Never trust the browser**; **keep offline and online the same**; **keep the client mission-agnostic**; **keep the PHP core framework-free**; **keep game code off the DOM** (`UiPort`) and off Colyseus (`GameConnection`).
- The traps: unknown scene `layout` keys are dropped by the compiler; the server does not validate on publish; open rooms keep the scenario they started with; the game server needs a rebuild in Docker; a missing SQLite schema breaks only the dev server and tests.
:::

## Design rules

These come from [Architecture](/docs/developers/architecture/#design-decisions) and are kept throughout.

1. **One engine and one set of world rules, written once.** `SceneEngine` and `World` run in the browser, on the server and in tests. Do not reimplement a rule in a program; import it.
2. **The runtime reads one compiled document.** The game never reads tables. Half-finished edits never reach players because only the published document is served.
3. **One way into the tables.** The seeder, the editor, imports and the generator all write through `ScenarioStore`.
4. **Nothing mission-specific in the client or server.** A new need is a field in the JSON and a system, presenter or feature that reads it.
5. **The browser is not trusted.** Events run there, so anything that matters is checked again by `World`, the room or the API (see [the trust model](/docs/codebase/server/#the-trust-model)).
6. **Offline is online with one player.** `OfflineConnection` runs the same `World`. Previews, tests and the editor's "Test" depend on it.
7. **Systems read state every frame** rather than subscribing to individual changes, so they behave the same online and offline.
8. **Screen-space is HTML, world-space is Phaser.** Text, boxes, overlays and panels are DOM behind `UiPort`; figures, labels and pictures in the scene are Phaser objects.
9. **The PHP core has no framework calls.** It runs in Laravel, the dev server and the tests alike.
10. **Testing a draft is playing it.** The editor never imitates the game: it opens the real client, and its infobox preview is the game's own code.

## Things that must agree in two places

Rule | TypeScript | PHP (or elsewhere)
---- | ---------- | ------------------
Action type names | `ActionType`, `ACTION_TYPES` (`scenario.ts`), `ACTIONS` and `ACTION_ICONS` (editor `schema.ts`) | `ScenarioStore::ENUMS['actions.type']`
Condition operators | `ConditionOperator`, `CONDITION_OPS` (`validate.ts`), editor `OPERATORS` | `ENUMS['conditions.operator']`
Scenario codes | `codeProblem`, `RESERVED_CODES` (`site.ts`) | `ScenarioStore::codeProblem`, `RESERVED_CODES`
Roles | `roles.ts` | `App\Qbl\Roles`
Student building rules | `builds.ts` | `App\Qbl\Builds\BuildRules`
Character rules | `characters.ts` | `App\Qbl\Characters\Character`, `NpcCharacter`, `AvatarCharacter`
Jump targets | `computeJumpTargets` (`scenario.ts`) | `ScenarioCompiler::collectJumps`
Content table order | `ORDER` (editor `history.ts`) | `ScenarioStore::CONTENT`
Writable columns | (the editor sends what forms produce) | `ScenarioStore::SCHEMA`, the migrations, every `sqliteSchema()`
Game server endpoints | `Backend`, `ApiBackend` | `routes/api.php` `internal` group, `InternalController`
Messages | `protocol.ts`, `ScenarioRoom` handlers | `OfflineConnection.send` (the same TypeScript, but easy to forget)
Report figures | `Api\Reports`, `ActivityStore::report` | `docs/src/content/docs/api-v1/reports.mdx` "How the numbers are worked out"
Editor labels | `apps/editor/src/schema.ts` and `views/` | The editor pages of these docs quote them

When you change one side, search for the other.

## Naming

- **JSON fields are `snake_case`** (`activate_by_trigger`, `spawn_point`), as in the original QBL spec. TypeScript code is `camelCase`; PHP methods `camelCase`, constants `UPPER_CASE`.
- **`[ext]`** in a doc comment in `types.ts` marks a QuestLab extension to the original spec. Extensions are always optional, so documents written for the original spec still play.
- **System variables** start with `QL_` (`QL_PlayerName`); old names started with `QBL` and are still read (`LEGACY_VARIABLES`). Both prefixes are reserved for authors.
- **Ids are numbers.** Rows have positive database ids. Actions and events made at run time (infobox buttons, bag combinations, conversation choices) get **negative** ids from the engine's `adHocId`, so they can never collide with a real one. Avatars and platform media have ids from 900000 and 800000.
- **Instance keys**: `public`, `a<assignment id>`, `t<team id>`. Room keys (parties) are the same strings.
- **Shortname vs code**: players use the code (`/{code}`); the shortname is a readable name that may also be used as a key and is not guaranteed unique.

## Comments and writing

The code is heavily commented, in a consistent voice. Follow it:

- **Every exported function, class and interface has a doc comment** saying what it is and, where it is not obvious, *why* it is that way.
- Comments are full sentences in plain English (British spelling: "colour", "behaviour"), written for someone who has not seen the code before. Prefer explaining the reason ("A freeze never outlives the event that asked for it, so nobody is left unable to move") to restating the code.
- Big classes begin with a comment that explains the whole: `ScenarioStore`, `World`, `SceneEngine`, `GameContext`, `EditorApi` (whose comment is also its route list). Keep those route lists up to date when you add a route.
- Docs pages say what the user sees, in the user's words, and quote the editor's labels exactly.

## Gotchas

### Data and documents

- **The compiler drops unknown `layout` keys.** A new list placed in a scene must be named in `ScenarioCompiler::compile` (and `ScenarioDecompiler`), or it silently disappears from the document. Unknown `params` keys are kept, but under `scene.params`, not at the scene's top level. See [the recipe](/docs/codebase/recipes/#a-new-scene-setting-or-placed-thing).
- **`ScenarioStore` silently ignores columns not in `SCHEMA`.** If a new column is never saved, check there first.
- **The server does not validate on publish.** `checkAndPublish` in the editor does; `qbl:publish` does not. The game server refuses to open a room for a document with errors, so an invalid document fails when someone tries to play it.
- **Deleting a media row deletes its file**, clears it from everything that used it, and clears the editor's undo history.
- **`{{unknown}}` placeholders are left as they are**, on purpose, so a typo shows on screen instead of a blank.
- **PNG uploads become WebP** unless `QBL_PNG_TO_WEBP=false`; animated PNGs are kept and noted in `params.apng`.

### Timing and caching

- **An open room keeps the scenario it was created with.** `ScenarioRoom.onCreate` loads the document once. After publishing, players already in a room play the old version until the room closes (everyone has left), while a player joining a *new* room gets the new one. The game server also caches documents for 30 s (`QBL_SCENARIO_CACHE_SECONDS`).
- **Saves are periodic.** The server writes sessions every 30 s and on leave or drop; the client reports progress every 5 s. A crash of the game server loses up to that much.
- **Room variables arrive a frame late.** A room-scoped `variable` action goes to the server and comes back in a state patch; a condition tested in the same event, right after, still sees the old value.

### Building and running

- **Docker rebuilds the client and editor by itself, not the game server.** After changing `packages/shared` or `apps/server`, run `docker compose up -d --build colyseus`. After changing `docs/`, rebuild `docs`.
- **The Docker build skips the type check.** Run `npm run typecheck` before you push.
- **Every table needs a SQLite form** (`sqliteSchema()`), or the dev server and the plain-PHP tests fail while production works.
- **SQL must run on MariaDB and SQLite.** Quote identifiers with backticks; branch on the driver for engine-specific functions.
- **`scenarios/starship.json` is generated** (`npm run seed:export`). Change the demo in the editor and export it, not by hand.
- **`FileBackend` proves nothing about identity.** Never expose a game server with `QBL_BACKEND=file` to the internet.
- **Presence is per process.** Launches cross rooms through Colyseus presence, which is in-process by default; several game server processes need a shared (Redis) presence.

### The editor

- **Structural or not.** Patch with `structural: true` when a change alters which fields a form shows (and mark such fields `structural: true` in `schema.ts`); otherwise the form will not show the new fields. Use the default for everything else, or the field being typed in loses focus on every key.
- **Wait for `store.settled()`** before anything that reads the server's copy (preview, publish, export).
- **Patches are folded together.** Two quick patches of one row become one request; do not rely on the server seeing an intermediate value.

### The game

- **An event cannot run twice at once.** Triggering a running event returns its existing run.
- **Overridable events are cancelled by any event starting**, including end events and infobox buttons.
- **Indefinite actions do not block** (pictures with no duration, looping audio and spritemaps), even when `blocking` is true.
- **`once` hotspots are remembered in the save** when fired through `HotspotSystem`. See [the event engine](/docs/codebase/event-engine/#things-that-surprise-people).
- **The fake Phaser accepts anything.** A green headless test does not prove the drawing is right; look in a browser.
- **Background music outlives the scene.** It belongs to `ctx.music`, not to the scene's sounds; stop it with a `cancel` of its action, or another persistent audio action.

## Security notes

- Uploaded media are served with `Content-Security-Policy: default-src 'none'; sandbox`; SVG uploads are refused.
- Infobox HTML is cleaned by `sanitizeHtml` (`apps/client/src/ui/sanitize.ts`) in the game and the editor's preview alike.
- Open URL actions only open http and https addresses (`openableUrl`), and new tabs have their `opener` cleared.
- `/api/internal` needs the service key and is not reachable on Apache's public port.
- Free chat is off unless a scenario sets `chat_mode: free`; the filter is a baseline (markup and control characters removed, a blocklist masked, 140 characters). Schools turning it on should supply their own blocklist.
- The public API never takes personal information about students (`Api\Privacy`).
