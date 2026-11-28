---
title: "Infrastructure and tooling"
description: "How QuestLab runs: the three ways to run it in development, the Docker containers and volumes, how Apache routes one address to five services, what the app container does on start, configuration, the scenarios folder, and the scripts in tools/."
host:
  who: asimov
  says: "One address, eight containers. Here is what answers each path, what gets built when, and which knob to turn."
  side: right
---

[Run QuestLab locally](/docs/developers/local-development/) and the root `README.md` say how to run QuestLab and how to deploy it. This page says how the pieces are wired, so you know what to restart after changing what.

:::tip[In short]
- **Development** is one of: `npm run dev` (game and game server, file backend, no PHP), `npm run dev:editor` (PHP dev API, editor, game), or `docker compose up --build` (everything).
- In Docker, **`app` mounts your checkout** and builds the client and the editor with Vite on start (and watches them by default). **`colyseus` and `docs` copy the code into their images**, so they need `docker compose up -d --build colyseus docs` after a change.
- **Apache** is the one front door: files for the game, `/api` to PHP-FPM, `/game` (WebSocket) to Colyseus, `/editor` and `/docs` to their containers, `/media` and `/scenario-assets` from volumes. **`edge`** (Caddy) adds HTTPS on a server.
- The **game server reaches Laravel** on Apache's internal port 8081, which is the only port where `/api/internal` answers.
:::

## Three ways to run it in development

Command | Runs | Backend | Use it for
------- | ---- | ------- | ----------
`npm run dev` | `@qbl/server` (`tsx watch`, :2567) and `@qbl/client` (Vite, :5173) | `FileBackend`: `scenarios/*.json`, saves in `.data/saves`, guest names | The game, the engine, systems, presenters, multiplayer (two windows)
`npm run dev:editor` | `php -S 127.0.0.1:8000 apps/api/dev/server.php`, the editor's Vite server (:5174), the client in `authoring` mode (:5173) | The PHP core over SQLite in `.data/dev-api` | The editor and the editor API; "Test" opens the real game on the draft
`docker compose up --build` | Every container | Laravel and MariaDB | Everything, as on a server; the API, accounts, classes, billing, the generator

In both npm modes **the browser talks to one origin** (http://localhost:5173): Vite's proxy (`apps/client/vite.config.ts`) sends `/api`, `/game` (WebSocket), `/scenario-assets` and, in authoring mode, `/media` and `/editor` to the right server. The `gameFallback` plugin sends every path except `/` and files to `play.html`, as Apache does in production.

## The containers

From `docker-compose.yml` and `docker/`:

Container | Image from | Holds code? | Job
--------- | ---------- | ----------- | ---
`edge` | `docker/edge` (Caddy) | no | Only with `COMPOSE_PROFILES=https`: ports 80 and 443, TLS (Let's Encrypt or your own certificate), passes everything to `apache` as plain HTTP and sets true `X-Forwarded-*` headers
`apache` | `docker/apache` (httpd) | no | The front door. Serves the built game from the `public` volume, `scenario-assets` and `media`; FastCGI to `app`; proxies `/game`, `/editor`, `/docs`. A second port, 8081, only on the Docker network, for `/api/internal`
`app` | `docker/app` (PHP-FPM, Composer, Node) | **mounted**: `apps/api` at `/app`; `apps/client`, `apps/editor`, `packages/shared`, `scenarios/assets` read-only under `/repo` | Laravel, the queue worker, and Vite building the game and the editor
`db` | `docker/db` (MariaDB) | no | The database. Its start script makes `DB_PASSWORD` the `qbl` account's password on every start
`colyseus` | `docker/colyseus` | **copied**: `packages/shared` and `apps/server` | The game server, `QBL_BACKEND=api`, `QBL_API_URL=http://apache:8081`
`editor` | `docker/editor` (a small httpd) | no | Serves the `editor-dist` volume at `/editor/`
`docs` | `docker/docs` | **copied**: `docs/` | These docs, built with Astro Starlight, served at `/docs/`
`tts` | Kokoro-FastAPI | no | Text-to-speech, reachable only inside the network
`chatterbox` | `docker/chatterbox` | its own `server.py` | Only with the `chatterbox` profile: heavier, livelier text-to-speech

Volumes: `public` (the built game and Laravel's public files), `editor-dist`, `client-modules` (the client's `node_modules`, installed in the container), `media` (uploads, served read-only), `app-data` (the generated app key, generator work folders), `db-data`, `edge-data` and `edge-config` (certificates), `chatterbox-models`, `chatterbox-voices`.

### What `app` does when it starts

`docker/app/entrypoint.sh`, in order:

1. Gives `www-data` the uid and gid of whoever owns your `apps/api` folder, so files PHP writes stay yours (`php-as-owner.sh` makes `php` and `composer` run as that user too; `QBL_PHP_AS_ROOT=1` overrides).
2. `composer install` into `apps/api/vendor` if it is missing or older than `composer.lock`.
3. Generates an `APP_KEY` once into the `app-data` volume, unless one is set.
4. `php artisan migrate --force`. **Nothing is seeded**: run `php artisan qbl:seed` by hand.
5. Copies `apps/api/public` to Apache's volume (so changes there need `docker compose restart app`) and empties the editor's.
6. Installs the client's and the editor's npm packages into `client-modules` when one of their `package.json` files changed (a hash is kept in `node_modules/.qbl-installed`). With the watcher on, the hash is checked again every 15 seconds while the container runs: on a change the Vite watchers are stopped, the packages installed and the watchers started again. Without this, a pull that adds a package would make every rebuild fail and Vite would keep serving the build from before the pull.
7. Builds the game and the marketing page (`apps/client`) and the editor (`apps/editor`) with Vite, **watching them** with `QBL_CLIENT_WATCH=true` (the default; output in `docker compose logs -f app`, labelled `client:` and `editor:`). The build skips the type check, so a typing mistake cannot take the site down: run `npm run typecheck` yourself. A failed build is reported and the API keeps running.
8. Starts the queue worker (`php artisan queue:work`, restarted if it stops; `QBL_QUEUE_WORKER=false` turns it off), then PHP-FPM.

### What to restart after a change

You changed | Then
----------- | ----
`apps/api` PHP | Nothing: it is mounted, and picked up within seconds
`apps/api/public` | `docker compose restart app`
`apps/client` or `apps/editor` | Nothing with the watcher on: reload the page. With `QBL_CLIENT_WATCH=false`, `docker compose restart app`
A `package.json` (new npm packages) | Nothing with the watcher on: they are installed within about 15 seconds and the builds restart. With `QBL_CLIENT_WATCH=false`, `docker compose restart app`
`packages/shared` | The game and the editor rebuild by themselves; **the game server does not**: `docker compose up -d --build colyseus`
`apps/server` | `docker compose up -d --build colyseus`
`docs/` | `docker compose up -d --build docs`
A migration | `docker compose restart app` (it migrates on start)
`docker/` | `docker compose up -d --build`

## How Apache routes one address

`docker/apache/qbl.conf` (and `public-address.sh`, which writes the public name and the https redirects from `QBL_PUBLIC_URL`):

Path | Goes to
---- | -------
`/` | `index.html`: the marketing page
any other path with no file | `play.html` (`FallbackResource`): the game, which reads `/{code}`, `/missions`, `/play?...` itself
`/assets/*` | Built files, cached a year (`immutable`)
`/scenario-assets/*` | `scenarios/assets` from the checkout, cached an hour
`/media/*` | Uploaded media, read-only, with a `sandbox` Content-Security-Policy
`/api/*` | PHP-FPM in `app` (`public/index.php`); `/api/internal` refused here
`/game` | Colyseus (WebSocket)
`/editor/` | The `editor` container
`/docs/` | The `docs` container
`:8081/api/internal/*` | PHP-FPM; this port exists only on the Docker network, for the game server

## Configuration

Everything is configured with environment variables, set in `.env` next to `docker-compose.yml`. `.env.example` lists and explains every one, in groups:

Group | Examples
----- | --------
Site and secrets | `QBL_APACHE_PORT`, `DB_PASSWORD`, `QBL_SERVICE_KEY`, `APP_KEY`, `QBL_SEED_PASSWORD`
Sign-up and sign-in | `QBL_ALLOW_GUESTS`, `QBL_ALLOW_REGISTRATION`, `QBL_ALLOW_TEACHER_SIGNUP`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `QBL_GOOGLE_DOMAINS`
Building and media | `QBL_CLIENT_WATCH`, `QBL_PNG_TO_WEBP`
Email | `MAIL_*`, `QBL_SITE_NAME`
HTTPS | `COMPOSE_PROFILES`, `QBL_PUBLIC_URL`, `QBL_ACME_EMAIL`, `QBL_CERTS_DIR`, `QBL_TLS_CERT`, `QBL_TLS_KEY`, `QBL_TRUSTED_PROXIES`
Voices | `QL_TTS_DRIVER`, `QL_TTS_URL`, `QL_TTS_NARRATOR`, `QL_TTS_FLAIR`, `QL_TTS_*`, `QL_CHATTERBOX_*`
The generator | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `SCENARIO_API_*`, `QBL_GEN_*` (models, image driver, style, judge, budget, limits)
Billing | `QBL_BILLING_ENABLED`, `STRIPE_*`, `QBL_TRIAL_*`, `QBL_PRICE_*`, `QBL_*_CREDITS`, `QBL_SALES_*`
Workers and districts | `QBL_QUEUE_WORKER`, `CLEVER_CLIENT_ID`, `CLEVER_CLIENT_SECRET`

The game server's own variables are on [the game server page](/docs/codebase/server/#configuration-configts). The client's build-time variables (`VITE_API_URL`, `VITE_SERVER_URL`, `VITE_AUTH_MODE`, `VITE_DEFAULT_SCENARIO`) and the editor's (`VITE_GAME_URL`) are only needed when the pieces are on different origins.

## The `scenarios/` folder

- `scenarios/starship.json` and `scenarios/science-lab.json`: documents for the file backend. **`starship.json` is generated** from the shipped demo ZIP (`npm run seed:export`, which needs PHP with SQLite and zip, then validates it); do not edit it by hand.
- `scenarios/assets/`: media served at `/scenario-assets/` (`starship`, `sciencelab`, `hub`, `library`, `platform`, `shop`). The shipped scenarios' uploaded files are in `starship/uploads`.
- The shipped scenarios themselves live as ZIPs in `apps/api/database/seeders/scenarios/`, which `qbl:seed` installs.

## The `tools/` folder

Script | What it makes
------ | -------------
`validate-scenario.ts` (`npm run validate -- file.json`) | Runs `validateScenario` on files; exits non-zero on errors
`make-hub.php` (`npm run make:hub`) | The starship hub template (`apps/api/database/seeders/data/hub.php`) from the demo ZIP: the ship without a mission
`make-science-lab.mjs` | The Science Lab demo (needs `npm run build -w @qbl/shared` first)
`make-twemoji-map.mjs` | `packages/shared/src/twemoji.ts`, from a checkout of Twemoji Awesome
`make-app-icons.mjs` | The app's icons in `apps/client/public/icons/`
`make-*-art.py`, `make-questlab-assets.py`, `make-demo-audio.py` | Placeholder art, library assets and the demo's synthesised sounds, so the repository ships with no third-party art or sound
`android/` | `build-apk.mjs`: the Android app as a Trusted Web Activity around the PWA

## The docs

`docs/` is its own Astro Starlight project (its own `package.json`, not a workspace). `npm run dev` in `docs/` serves it; `npm run build` builds it and **fails on a broken link or anchor** (`starlight-links-validator`). The sidebar is in `docs/astro.config.mjs`; pages are in `docs/src/content/docs/`; the page hosts (the cast in speech bubbles) are `frontmatter host:` and `src/components/Host.astro`. Old addresses are kept working with `redirects` in the config.
