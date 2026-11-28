---
title: "The API (apps/api)"
description: "The Laravel application from a developer's side: the framework-free core and why it exists, every route group and controller, ScenarioStore, the compiler and decompiler, archives, avatars, roles, rewards, classes, activity, student builds, the internal API for the game server, models, migrations, commands, configuration and the dev server."
host:
  who: asimov
  says: "Laravel is the door; the rooms behind it are plain PHP. Most of what you change here runs the same in Laravel, in the dev server and in the tests."
  side: right
---

`apps/api` is a Laravel 13 application on PHP 8.3, with MariaDB in production and SQLite in the dev server and the plain-PHP tests. It is the largest part of the repository (about 40,000 lines in `app/`), but most of it is in one namespace with one pattern: **`App\Qbl\*`, plain PHP over PDO, with no framework calls**.

:::tip[In short]
- **Controllers only translate.** Each turns a Laravel request into plain values and calls a framework-free class, then turns its `[status, body]` answer back into a response. The rules are never in the controller.
- **`*Api` classes** (`EditorApi`, `ClassApi`, `BuildApi`, `LibraryApi`, `BillingApi`, `DistrictApi`, `GenerationApi`, `Api\V1\Api`) are request → response functions with a route list in their doc comment. **`*Store` classes** (`ScenarioStore`, `ClassStore`, `ProgressStore`, `ActivityStore`, `BuildStore`) own tables.
- **`ScenarioStore`** is the only code that writes a scenario's rows. **`ScenarioCompiler`** turns rows into the document; **`ScenarioDecompiler`** turns a document back into rows; **`ScenarioArchive`** reads and writes ZIPs.
- `AppServiceProvider` builds each core class as a singleton, handing it **Laravel's own PDO connection**.
- `apps/api/dev/server.php` serves the editor's API with the same classes over SQLite; the plain-PHP tests (`apps/api/tests/*.php`) do the same.
:::

## Why the core has no framework

The same classes run in three places:

Where | How it gets a PDO | Used for
----- | ----------------- | --------
Laravel (production, Docker) | `DB::connection()->getPdo()` in `AppServiceProvider` | Everything
`dev/server.php` (`npm run dev:api`, `npm run dev:editor`) | A SQLite file in `.data/dev-api`, tables from `ScenarioStore::sqliteSchema()` and friends | Working on the editor without Docker; the editor's browser tests
`tests/*.php` (`npm run test:api` and the others) | `new PDO('sqlite::memory:')` | Fast tests of the store, compiler, editor API, classes, billing, generation...

So:

- **Write SQL that both MariaDB and SQLite accept.** Identifiers are quoted with backticks. Avoid engine-specific functions; where one is needed, branch on the driver, as `ProgressStore::run` does to spell a two-argument maximum `GREATEST` on MariaDB and `MAX` on SQLite (`getAttribute(PDO::ATTR_DRIVER_NAME)`).
- **Every table a store uses needs a SQLite form** in that store's `sqliteSchema()` (`ScenarioStore`, `ClassStore`...), kept in step with the Laravel migration. Forgetting this is the most common way to break the dev server and the tests while production still works.
- **No facades, no Eloquent, no helpers** like `config()` or `now()` inside `App\Qbl`. Pass configuration in through the constructor.
- Errors are thrown as `StoreError($status, $message)` (or `Api\ApiError` in the public API); the `*Api` classes catch them and answer with that status.

## Request flow

```text
routes/api.php ─▶ middleware (auth:sanctum, throttle, ServiceKey) ─▶ Controller
                                                                       │ plain values
                                                                       ▼
                                                     App\Qbl\XxxApi::handle(method, path, body, user, files)
                                                                       │
                                                                       ▼
                                                     App\Qbl\XxxStore (PDO) ─▶ tables
```

`EditorController` is the model to copy: it passes `$request->method()`, the path after `/api/editor/`, the JSON or form body, `['id', 'name', 'role']` of the signed-in user and any uploaded `file`, and turns the answer into JSON, `204`, or a file download (`download` in the body).

## Routes

All in `routes/api.php` (everything is under `/api`; `routes/web.php` is nearly empty):

Route group | Middleware | Controller → core
----------- | ---------- | -----------------
`POST auth/login`, `auth/register`, `auth/guest`, `auth/forgot-password`, `auth/reset-password`, `auth/logout`; `GET/PATCH me`, `PUT me/password` | throttles; Sanctum where signed in | `AuthController`
`GET auth/providers`, `auth/google/redirect`, `auth/google/callback` | throttle | `GoogleAuthController`
`GET me/progress`, `GET shop`, `POST shop/{item}/buy`, `POST shop/{item}/equip` | Sanctum | `ProgressController` → `ProgressStore`
`missions`, `avatars`, `me/avatar`, `me/progress/reset`, `players/{id}/profile`, `teach/*` | Sanctum | `ClassController` → `ClassApi` (→ `ClassStore`, `ActivityStore`)
`builds/files/{key}` (no token), `builds/*` | Sanctum, throttle | `BuildController` → `Builds\BuildApi` → `BuildStore`
`GET scenarios/{key}/play` | optional Sanctum | `PlayController::show`
`billing/webhook`, `billing/quote`, `billing/*` | Stripe signature; throttles | `BillingController` → `Billing\BillingApi`
`editor/generations/*` | Sanctum, throttle 90/min | `GenerationController` → `Generation\GenerationApi`
`district/*`; `sso/{org}/saml/*`, `sso/clever/*` | Sanctum; throttles | `DistrictController` → `District\DistrictApi`; `SsoController`
`editor/library/*` | Sanctum | `LibraryController` → `Library\LibraryApi`
`editor-export/{ticket}` (no token) | throttle | `EditorController::exportByLink`
`editor/*` | Sanctum | `EditorController` → `EditorApi` → `ScenarioStore`
`v1/*` | `throttle:qbl-api-v1` (its own OAuth tokens) | `ApiV1Controller` → `Api\V1\Api`
`internal/*` | `ServiceKey` | `InternalController`

Middleware of our own: `ServiceKey` (only the game server, with `X-QBL-Service-Key`, may call `/api/internal`; Apache also refuses those paths on the public port) and `PublicAddress` (builds every link from `QBL_PUBLIC_URL` and marks requests secure when it is https, because TLS ends at the edge container).

[HTTP API contract](/docs/developers/api/) documents the internal contract the player, editor and game server rely on.

## `ScenarioStore`

`app/Qbl/ScenarioStore.php`, about 1,300 lines. "The one place that knows which tables and columns make up a scenario, who owns a row, and what has to be removed with it."

### Its constants

Constant | What it is
-------- | ----------
`SCHEMA` | For each table, the columns a caller may write and their type: `int`, `num`, `bool`, `str`, `json`. **A column not listed here cannot be written through the store**
`CONTENT` | The content tables, parents before children: `media`, `shop_items`, `variables`, `items`, `characters`, `scenes`, `events`, `actions`, `conditions`, `labels`
`PARENTS` | For tables without `scenario_id`, the columns that point at a parent (`events.scene_id`, `actions.event_id`, `labels.event_id`, `conditions.event_id/action_id/item_id/character_id`)
`ENUMS` | Allowed values: `media.type`, `variables.scope`, `events.kind`, `events.audience`, `labels.type`, `shop_items.kind`/`slot`, `conditions.operator`, **`actions.type`** (must list every `ActionType`)
`REFERENCES` | Keys that hold a row id wherever they appear in a row's JSON, and the table they point into (`media_id`, `scene_id`, `event_id`, `target_event_id`, `action_id`, `target_id`, `item_id`, `character_id`...). Used to follow references when rows are copied or imported
`UPLOADS`, `MAX_UPLOAD_BYTES` | Allowed upload MIME types (no SVG: it can carry script) and the 25 MB limit
`IMPORT_DEFAULTS` | What a row gets on import when the file does not say
`RESERVED_CODES` | Paths a scenario code may not take. **Must match `RESERVED_CODES` in `packages/shared/src/site.ts`**
`HUB_TEMPLATE` | The starship hub rows a new scenario can start from

### Its methods

Group | Methods
----- | -------
Reading | `rows($id)` (raw rows, for the compiler), `bundle($id)` (decoded and typed, for the editor), `scenario($id)`, `listFor($user)`, `canEdit($scenario, $user)`, `scenarioOf($table, $rowId)`, `decode($table, $row)`
Publishing | `compile($id)` (a draft document), `publish($id)` (compile and store in `document` with `published_at`), `findPublished($key)`
Codes | `generateCode()`, `codeProblem($code)` (static), `changeCode($id, $code)`
Scenarios | `createScenario($attrs, $userId)`, `updateScenario($id, $attrs)`, `deleteScenario($id)` (and its uploaded files)
Rows | `createRow`, `updateRow`, `deleteRow` (with cascades: a scene's events; an event's actions, conditions and labels; an action's conditions; a media row is cleared from everything that used it, characters lose animations drawn from it, and its file is deleted), `restore($id, $steps)` (undo and redo, in one transaction; a delete here keeps the file)
Files | `addMediaFile($id, $tmpPath, $name)` (detects the type, converts PNG to WebP unless disabled, notes animated PNGs, stores under the scenario's folder), `mediaFile($media)`
Copies and imports | `importRows($rows, $userId, $overrides, $fileFor)` (a new scenario from rows: new ids, references followed, files copied), `mergeRows($id, $rows, $fileFor)` (add rows to an existing scenario: a generated scene), `copyRows($id, $rows)` (copy and paste within a scenario), `duplicate($rows, $userId, $title)`, `seedScenario($rows, $reset)`, `replaceScenario($rows)`
Dev and tests | `sqliteSchema()` (static)

Internally, `encode` and `decode` convert by `SCHEMA` types, `assertOwned` and `assertValid` guard every write, `touch` updates `scenarios.updated_at` (what makes "Unpublished changes"), `follow` rewrites references in JSON when ids change, and `transaction` nests safely.

## The compiler, decompiler and archives

- **`ScenarioCompiler::compile($rows)`**: rows → document. Static, pure, tolerant of driver types (strings for numbers, text for JSON). Step by step on the [lifecycle page](/docs/codebase/lifecycle/#what-the-compiler-does); column by column on [the data model](/docs/codebase/data-model/).
- **`ScenarioDecompiler::rows($document)`**: document → rows, keeping the document's ids so references hold (`importRows` then renumbers). Top-level keys that are not columns go into `scenarios.settings` (`NOT_SETTINGS` lists the columns). Compiling the result gives the same document apart from ids.
- **`ScenarioArchive`**: a ZIP with `scenario.json`, `assets/…` and a README. `export($id)` writes one; `import($path, $userId, $title)` creates a new draft from one (never replaces). Read entry by entry, never unpacked to a path taken from the ZIP, with limits (`MAX_FILES`, `MAX_DOCUMENT_BYTES`, `MAX_TOTAL_BYTES`). `shipped()` lists the ZIPs in `database/seeders/scenarios/` that `qbl:seed` installs; `forFileBackend($document)` rewrites a document for the game server's file backend (`npm run seed:export`).
- **`ExportLinks`**: short-lived signed links so the browser can download a big export itself (`POST …/export-link`, then `GET /api/editor-export/{ticket}`).

## Who may do what: `Roles`

`App\Qbl\Roles`: `student`, `teacher`, `content_admin`, `admin`, `guest`, with `isStaff`, `editsAllScenarios` (admins and content admins), `managesLibrary`. **Must agree with `packages/shared/src/roles.ts`.** `ScenarioStore::canEdit`: admins and content admins edit everything; a teacher edits their own scenarios and the shared samples (no owner).

## Avatars

`App\Qbl\Avatars` and `Characters\*`. Avatars belong to the platform, not to scenarios, so a player keeps theirs everywhere. Each is a row of `avatars` (an `AvatarCharacter` with animations) whose pictures are rows of `platform_media`. `Avatars::inject($pdo, $document)` adds them to every document as it is served (and to previews), with ids in ranges of their own: an avatar is `900000 + id` (`BASE`), a platform picture `800000 + id` (`MEDIA_BASE`). `Character`, `NpcCharacter` and `AvatarCharacter` mirror the rules of `packages/shared/src/characters.ts` (poses, older picture fields, cleaning settings). `WalkMaker` makes a walk from a standing picture by running `packages/shared/bin/walk.ts` with Node.

## Stars, XP and the marketplace: `ProgressStore`

Stars and XP belong to the account and carry across scenarios. **Only `ProgressStore` changes them.**

- `award($userId, $scenarioId, $document, $actionId)`: finds the award action **in the published document**, takes its `stars`, `xp` and `note`, and grants them once per player (a `grant_key` of `s<scenario>:a<action>` with a unique index in `progress_ledger`, unless `repeatable`). Totals never go below zero. Returns the new totals with `delta_stars`, `delta_xp`, `rank_up`; a repeat comes back with zero deltas and `already`.
- `progress($userId)`, `catalogue($scenarioId?)`, `buy`, `equip`, `look($userId)` (what the avatar wears, as the game server asks).
- Badges are granted by `ActivityStore::grantBadge` from an award with a badge.

## Classes and missions: `ClassStore` and `ClassApi`

`ClassStore` owns teachers' students (`teacher_student`), assignments (`assignments`, `assignment_student`) and teams (`teams`).

- **Instances are named by group keys**: `public`, an assignment's `a<id>` (its students not in a team), a team's `t<id>`.
- `mayJoin($userId, $role, $scenarioId, $group)`: admins always; the plan check for curricular missions; the author; for `a`/`t` groups, the assignment's teacher, or a student in exactly that instance once the mission is launched if it waits for its teacher; for any other group, a public scenario (one that waits for a teacher is open to staff only).
- `access(...)`: `mayJoin` plus the **party** (a team belongs to its assignment's party `a<id>`), the team's name and the teacher's name (`QL_TeacherName`).
- `missions($userId)`, `assign`, `update`, `unassign`, `launch`, `unlaunch`, `needsPlan`, `waitingForLaunch`, `reportOn`, `resetProgress`, `resetOwnProgress`.
- `ClassApi::handle(...)`: the routes `missions`, `avatars`, `me/avatar`, `me/progress/reset`, `players/{id}/profile`, and for staff `teach/students`, `teach/scenarios`, `teach/assignments` (and their report, activity, messages, reset and launch).

## What players did: `ActivityStore`

Written by the game server in batches; read for teachers' reports and the public API.

- `logActivity($scenarioId, $entries)` → `activity_log`: joins, leaves, scenes, hotspots, choices, objectives, words, narration, awards, and progress resets.
- `logMessages` → `chat_messages`: every message, in a scene or private, for auditing.
- `grantBadge`, `badges`, `profile` (what others see of a player).
- `report($scenarioId, $students, $document)`: time, objectives, answers, words and evidence per student, worked out from the logs and saves. `Api\Reports` uses the same report, so the numbers agree everywhere.
- `resetToken($scenarioId, $userId, $group)`: the id of the latest reset line (see [saving](/docs/codebase/lifecycle/#11-saving)).

## Student building: `Builds\*`

What students add to scenes that allow it is a layer over the scene, never part of the scenario: `scene_builds` (one per student per scene per instance) and uploaded pictures. `BuildRules` is **the server's copy of `packages/shared/src/builds.ts`** (`buildingRules`, `buildProblems`, `tidyPiece`...), and the two must agree. `BuildStore` keeps builds, their review status (`pending`, `approved`, `hidden`) and uploads; `BuildApi` is the HTTP face (`GET/PUT builds/{scenario}…`, uploads, and `teach` routes for review). Resetting a student's progress deletes their builds too.

## The internal API: `InternalController`

What the game server calls (see [the game server](/docs/codebase/server/#apibackend)): `verify` (a Sanctum token → user), `scenario` (the published document with avatars), `access`, `loadSession` (with the reset token), `saveSession` (409 for a stale save), `loadInstance`, `saveInstance`, `award`, `look`, `launch`, `logActivity`, `logMessages`, and the asset library for platform services.

## Models

Eloquent is used only at the edges: `User` (Sanctum tokens, roles, stars and XP columns), `Scenario` (`publish()`, `findPublished()`, `toDocument()`), `ScenarioSession`, `ScenarioInstance`, `LibraryAsset`, `LibraryAssetFile`. Everything else reads tables with PDO.

## Migrations

`database/migrations/` has one file per table or change (about 60). They are **idempotent**: a `create_*` migration returns early if the table exists, and `add_*` migrations check for the column, so `php artisan migrate` (run on every start of the `app` container) can upgrade any earlier database. Follow the same pattern. When a migration adds a scenario column, add it to `ScenarioStore::SCHEMA` and to the SQLite schema, and to `ScenarioCompiler` if it belongs in the document.

## Commands

All are `php artisan qbl:*` (in Docker: `docker compose exec app php artisan …`):

Command | What it does
------- | ------------
`qbl:seed [--reset] [--password=]` | Avatars, the marketplace catalogue, the asset library and the shipped scenarios (the Starship Explorer demo, the Science Lab); `--password` also makes demo accounts
`qbl:user`, `qbl:update-role`, `qbl:reset-link` | Make an account; show or change a role; print a password link
`qbl:publish [key] [--print]` | Compile and publish from the tables (no validation)
`qbl:generate`, `qbl:generation-log`, `qbl:generation-trace`, `qbl:art-style`, `qbl:standards` (alias `qbl:standards-library`) | The AI generator, its logs and traces, art styles, the curriculum standards library
`qbl:voice`, `qbl:tts`, `qbl:chatterbox-clips` | Recording characters' lines, trying voices, Chatterbox reference clips
`qbl:walk` | Make walking animations from standing pictures
`qbl:library` | List, import, add and keep library assets
`qbl:billing`, `qbl:org`, `qbl:api-client`, `qbl:privacy-purge` | Stripe, organizations and licenses, public API clients, data retention

Two queued jobs run on the worker in the `app` container: `RunGeneration` (a generator run started from the editor) and `SyncRoster` (a district roster sync).

## Configuration

- `config/qbl.php`: `service_key`, `allow_guests`, `allow_registration`, `allow_teacher_registration`, `site_name`, `google.domains`, `ranks`, `seed`, `seed_password`, `media_dir`, `media_url`, `png_to_webp`, `library_dir`, `library_url`, `assets_dir`, `node`, `walk_script`, `api_rate_limit`.
- `config/qbl_billing.php`, `config/qbl_generation.php`, `config/qbl_speech.php`: billing, the generator and voices.
- Every value comes from an environment variable; `.env.example` at the repository root lists them with explanations.

## The dev server

`apps/api/dev/server.php` (`php -S 127.0.0.1:8000 apps/api/dev/server.php`) requires the core classes directly and autoloads the rest. It serves uploaded media, `/scenario-assets`, sign-in (**any email and password, always a teacher**), `/api/me`, the classes API, student builds, `/api/scenarios/{key}/play`, the marketplace, billing, the generator's routes, the district panel, the library and the editor API, over a SQLite file seeded with the demo. Each route block hands the request to the same `*Api` class Laravel uses. It is for development and tests only; it refuses to run outside PHP's built-in server.
