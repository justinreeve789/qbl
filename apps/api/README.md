# QBL API (Laravel)

A complete Laravel 13 application. Open this folder in your IDE and run `composer install` once so
the framework in `vendor/` is indexed.

    cd apps/api
    composer install
    cp .env.example .env && php artisan key:generate     # only for running it outside Docker
    php artisan test

What QBL adds to stock Laravel:

| File | Purpose |
| ---- | ------- |
| `database/migrations/*` | One file per table, then one per later change. See "Migrations" below |
| `database/migrations/*_create_personal_access_tokens_table.php` | Sanctum's token table under a fixed file name. `install:api` publishes it under a name containing the build time, which would re-run on every rebuild; the Dockerfile removes that copy |
| `database/seeders/data/starship.php` | Seed rows for the demo mission, Starship Explorer |
| `database/seeders/*Seeder.php` | Seed the catalogue and the demo once and publish its JSON; optional demo accounts. Run by hand: `php artisan qbl:seed` |
| `app/Qbl/ScenarioStore.php` | Reads and writes scenarios as rows: seeding, the editor's create/update/delete, uploads, codes, publishing. Plain PHP over PDO |
| `app/Qbl/EditorApi.php` | The editor's routes and who may use them. Plain PHP |
| `app/Qbl/ScenarioCompiler.php` | Generates the scenario JSON from table rows. Plain PHP |
| `app/Qbl/ProgressStore.php` | Stars, XP, ranks, the ledger, and the marketplace: awards, buying, what a player has on. Plain PHP |
| `app/Http/Controllers/ProgressController.php` | `/api/me/progress` and `/api/shop/*` |
| `database/seeders/data/shop.php` | The platform's marketplace catalogue. `ShopSeeder` adds each item once, by id, so prices changed in the database are kept |
| `app/Http/Controllers/EditorController.php` | Hands `/api/editor/*` requests to `EditorApi` |
| `app/Models/*` | `Scenario`, `ScenarioSession`, `ScenarioInstance`, `User` with a role |
| `routes/api.php` and `app/Http/*` | The endpoints in `docs/docs/api.md`, and the service-key guard for `/api/internal` |
| `app/Console/Commands/*` | `qbl:seed [--reset] [--password=]`, `qbl:publish [code-or-shortname] [--print]`, `qbl:user <email> <name> [--role=]` |
| `app/Http/Controllers/GoogleAuthController.php` | Sign in with Google (Laravel Socialite) |
| `config/qbl.php` | `QBL_SERVICE_KEY`, `QBL_ALLOW_GUESTS`, `QBL_MEDIA_DIR`, `QBL_MEDIA_URL`, the Google sign-in domains, and `ranks`: the XP each rank needs |

Beside the framework's usual folders:

| File | Purpose |
| ---- | ------- |
| `bin/export-seed.php` | Runs the compiler on the seed data with no Laravel or database and prints the JSON |
| `tests/store.php` | Tests the three `app/Qbl` classes over SQLite, with no framework: `npm run test:api` |
| `tests/progress.php` | Tests stars, XP and the marketplace the same way: `npm run test:progress` |
| `tests/Feature/QblApiTest.php` | The same API through real Laravel: `php artisan test` |
| `tests/Feature/SignInAndDeployTest.php` | Google sign-in, forwarded HTTPS headers, seeding by command, migrating a database made by the earlier migrations |
| `dev/server.php` | A stand-in API for developing and testing the editor without Docker: `npm run dev:api`. Not for deployment |

## Why three plain PHP classes

Everything that decides what a scenario is lives in `app/Qbl` and makes no framework calls: which tables and
columns exist, what must be removed with a row, who may edit what, how rows become JSON. Laravel hands
`ScenarioStore` its database connection and translates requests; the dev server and the tests hand it a SQLite
connection. The same code is therefore tested without a framework or a database server, and the editor's
browser tests run against it.

## Migrations

One migration per table, in the order the tables depend on each other, then one per later change:

| Files | What they do |
| ----- | ------------ |
| `0001_01_01_*` | Laravel's own: users, cache, jobs |
| `2026_11_15_000000_add_role_and_avatar_to_users` | The role and chosen avatar on `users` |
| `2026_11_15_000001_create_personal_access_tokens_table` | Sanctum's tokens, under a fixed name |
| `2026_11_15_000002` to `000013` | `scenarios`, `media`, `variables`, `items`, `characters`, `scenes`, `events`, `actions`, `conditions`, `labels`, `scenario_sessions`, `scenario_instances` |
| `2026_11_16_000000`, `000001` | The scenario `code`; hotspot reveal distances |
| `2026_11_16_000002` to `000005` | Stars and XP on `users`; `progress_ledger`, `shop_items`, `user_items` |
| `2026_11_16_000006`, `000007` | The event `audience`; Google sign-in on `users` |

These tables used to be created by two large migrations. A database made then already has the tables, so
every one of these files checks before it creates and does nothing where the table (or column) exists; the
first also removes the two old files' entries from the `migrations` table. `php artisan migrate` on an
existing database therefore records the new files and changes no data. New changes go in new files.

## Seeding

Seeding is never automatic. Starting the container runs `migrate` only.

```sh
php artisan qbl:seed                      # the marketplace catalogue and the demo mission
php artisan qbl:seed --reset              # put the shipped demo back, replacing edits to it
php artisan qbl:seed --password=secret    # also teacher@qbl.test, student1@qbl.test, student2@qbl.test
```

`qbl:seed` runs `db:seed`: `ShopSeeder` adds each platform item once, by id, and `StarshipSeeder` calls
`ScenarioStore::seedScenario()` with the rows in `data/starship.php`, then publishes. The rows go into the
same tables the editor writes to, and the JSON players get is generated from those tables.

- The demo is seeded **once**. If it is already in the database it is left as it is, so edits made to it in
  the editor are kept. `--reset` replaces it with the shipped version (players' saves and what they own are kept).
- Seed rows carry their own ids, because actions refer to each other by id. Seeding refuses, and changes
  nothing, if any of those ids already belongs to another scenario.

## Signing in

`POST /api/auth/login` (email and password), `POST /api/auth/guest` (a name, when guests are allowed), and
Google: `GoogleAuthController` with Laravel Socialite. Google sign-in is on when `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` are set (`config/services.php`); who may use it and who starts as a teacher is in
`config/qbl.php` (`QBL_GOOGLE_DOMAINS`, `QBL_GOOGLE_TEACHER_DOMAINS`). The API keeps no sessions, so the
OAuth "state" travels in a ten-minute encrypted cookie, and Socialite is used statelessly. The address Google
returns to is `/api/auth/google/callback` on `APP_URL`.

## Behind a TLS-terminating proxy

`bootstrap/app.php` trusts `X-Forwarded-For`, `-Host`, `-Port` and `-Proto` from the addresses in
`TRUSTED_PROXIES` (comma-separated; by default every private range and localhost). Set `APP_URL` to the
https address. Nothing else is needed for HTTPS that ends at a firewall in front of the web server.

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

## What was removed from the stock skeleton

Laravel's own front-end scaffolding (`package.json`, `vite.config.js`, `resources/js`, `resources/css`, the
welcome page), because the game and the editor are separate applications; `routes/web.php` answers with a line
of JSON. The skeleton's `AGENTS.md`, `CLAUDE.md`, changelog and GitHub workflow files were also left out.

## Sanctum's migration

`php artisan install:api` publishes the token-table migration under a file name containing the current time.
This repository has it under a fixed name, and it leaves an existing table alone, so databases created by
earlier builds keep working. Do not run `install:api` again.

## Status

Run and passing here: `tests/store.php` (89 checks), `tests/progress.php` (34 checks), `php artisan test` (18 tests on real Laravel 13 with
SQLite), and a manual pass over HTTP with `php artisan serve`. Not run here: MariaDB and the Docker image.

## Stars, XP and the marketplace

`users.stars` and `users.xp` hold a player's totals; `progress_ledger` records every change (an award, a
purchase) and is what makes an award once-only: a unique index on `(user_id, grant_key)`, where the key
names the scenario and the award action. `shop_items` holds the platform's items (`scenario_id` null)
and each scenario's own; `user_items` what each player owns and has on.

Awards arrive from the game server at `POST /api/internal/scenarios/{id}/awards`. The backend finds the
action in the **published** document, so nothing the browser sends decides how much is given. Guests are
refused. The development stand-in (`dev/server.php`) has the shop routes but no game-server awards;
accounts there start with 100 stars.

## Not here yet

A screen for editing the platform's catalogue and the ranks (they are seed data and configuration).

Sharing a scenario between authors, classes and groups, roles and permissions beyond the `role` column,
and moving uploads to object storage.
