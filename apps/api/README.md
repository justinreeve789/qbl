# QBL API (Laravel)

`overlay/` contains only what QBL adds to a stock Laravel application:

| File | Purpose |
| ---- | ------- |
| `database/migrations/*` | The QBL tables: scenarios (with the unique 16-letter `code`), media, variables, items, characters, scenes, events, actions, conditions, labels, plus saves |
| `database/seeders/data/starship.php` | Seed rows for the demo mission, Starship Explorer |
| `database/seeders/*Seeder.php` | Seed the demo once and publish its JSON; optional demo accounts |
| `app/Qbl/ScenarioStore.php` | Reads and writes scenarios as rows: seeding, the editor's create/update/delete, uploads, codes, publishing. Plain PHP over PDO |
| `app/Qbl/EditorApi.php` | The editor's routes and who may use them. Plain PHP |
| `app/Qbl/ScenarioCompiler.php` | Generates the scenario JSON from table rows. Plain PHP |
| `app/Http/Controllers/EditorController.php` | Hands `/api/editor/*` requests to `EditorApi` |
| `app/Models/*` | `Scenario`, `ScenarioSession`, `ScenarioInstance`, `User` with a role |
| `routes/api.php` and `app/Http/*` | The endpoints in `docs/docs/api.md`, and the service-key guard for `/api/internal` |
| `app/Console/Commands/*` | `qbl:publish [code-or-shortname] [--print]`, `qbl:user <email> <name> [--role=]` |
| `config/qbl.php` | `QBL_SERVICE_KEY`, `QBL_ALLOW_GUESTS`, `QBL_SEED`, `QBL_MEDIA_DIR`, `QBL_MEDIA_URL` |

Outside the overlay:

| File | Purpose |
| ---- | ------- |
| `bin/export-seed.php` | Runs the compiler on the seed data with no Laravel or database and prints the JSON |
| `tests/store.php` | Tests the three `app/Qbl` classes over SQLite: `npm run test:api` |
| `dev/server.php` | A stand-in API for developing and testing the editor without Docker: `npm run dev:api`. Not for deployment |

## Why three plain PHP classes

Everything that decides what a scenario is lives in `app/Qbl` and makes no framework calls: which tables and
columns exist, what must be removed with a row, who may edit what, how rows become JSON. Laravel hands
`ScenarioStore` its database connection and translates requests; the dev server and the tests hand it a SQLite
connection. The same code is therefore tested without a framework or a database server, and the editor's
browser tests run against it.

## Seeding

`StarshipSeeder` calls `ScenarioStore::seedScenario()` with the rows in `data/starship.php`, then publishes.
The rows go into the same tables the editor writes to, and the JSON players get is generated from those tables.

- The demo is seeded **once**. If it is already in the database it is left as it is, so edits made to it in
  the editor survive restarts. `QBL_SEED=reset` replaces it with the shipped version (players' saves are kept).
- Seed rows carry their own ids, because actions refer to each other by id. Seeding refuses, and changes
  nothing, if any of those ids already belongs to another scenario.
- `QBL_SEED=false` skips seeding.

## Codes and publishing

Each scenario has a `code`: sixteen lowercase letters, unique, generated when the scenario is created and never
changed. Players open `/{code}`. `scenarios.document` holds the published JSON, which is what
`GET /api/scenarios/{code}/play` and the game server return. Editing changes rows only; players keep the last
published document until the scenario is published again, from the editor or with:

```sh
docker compose exec app php artisan qbl:publish starshipexplorer
```

The game server caches a scenario for 30 seconds, and rooms already open keep the version they started with.

## Uploads

The editor uploads media to `POST /api/editor/scenarios/{id}/media/upload`. The file's type is taken from its
content, not its name: PNG, JPEG, WebP and GIF images, MP3, WAV and OGG audio, MP4 and WebM video, up to 25 MB.
SVG is refused because it can carry script. Files are stored under `QBL_MEDIA_DIR/{scenario id}/` with a random
name and served by Apache as `/media/...`. Deleting the media row deletes the file.

## Accounts

```sh
docker compose exec app php artisan qbl:user you@example.org "Your Name" --role=teacher
```

Teachers can edit their own scenarios and the shared samples that have no owner (the seeded demo). Admins can
edit everything. Students and guests cannot use the editor API at all.

## Status

`ScenarioStore`, `EditorApi`, `ScenarioCompiler`, the seed data, the tests and the dev server have been run.
Everything that needs the framework (migration, service provider, seeders, controllers, commands, the Docker
image) was written without network access; it has been built and started, but treat the thin Laravel glue
around the editor API as new.

## Not here yet

Sharing a scenario between authors, classes and groups, roles and permissions beyond the `role` column,
and moving uploads to object storage.
