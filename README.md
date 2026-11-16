# Quest-Based Learning

A multiplayer, walk-around educational game in the spirit of Club Penguin. Every scenario is a JSON document: the client builds scenes, hotspots and events from it, and a Colyseus server keeps players in sync. Teachers and content creators build scenarios in a browser editor; players open one at `/{code}`, its unique 16-letter code.

```
packages/shared   scenario types, validator, event engine, world rules, protocol (TypeScript, unit-tested)
apps/server       Colyseus 0.18 game server
apps/client       Phaser 4 client (Vite): systems, action presenters and features; see apps/client/README.md
apps/editor       the scenario editor (TypeScript, no framework); see apps/editor/README.md
apps/api          the Laravel application: QBL tables, seed data, JSON generation, editor API, logins, saves
docker            Dockerfiles and config for the app, colyseus, editor and apache containers
scenarios         scenario JSON + media for local play; starship.json is generated from the seed data
docs              the QBL JSON docs plus pages for everything added
tools             scenario validator CLI
```

## Run it

Requires Node 22+.

```sh
npm install
npm run dev          # game server on :2567, client on http://localhost:5173 (no Laravel or database needed)
```

Open the client in two browser windows to see multiplayer. To work on the editor without Docker (needs PHP 8.2+ with SQLite as well):

```sh
npm run dev:editor   # dev API on :8000, editor and game together at http://localhost:5173/editor/
```

Players open a scenario at `/{code}`. Other URL parameters:

| Parameter | Effect |
| --------- | ------ |
| `?scenario=starshipexplorer` | Which scenario to play, by code or shortname, when the path has no code |
| `?preview=12&scene=40` | Play the unpublished draft of scenario 12, starting in scene 40. This is what the editor's "Test this scene" opens; it needs the editor's sign-in |
| `?group=red-team` | Players with the same group share a room |
| `?offline` | Single-player, no game server needed (for previews) |
| `?debug` | Draw walkable areas, spawn points and hotspot areas (including scene edges) |

## Docker

```sh
docker compose up --build
```

| Address | What it is |
| ------- | ---------- |
| http://localhost:8080 | The game, playing the demo mission |
| http://localhost:8080/starshipexplorer | The demo mission by its code. Every scenario is at `/{code}` |
| http://localhost:8080/editor | The editor |
| http://localhost:8080/docs | The documentation |

Six containers:

| Container | What runs in it |
| --------- | --------------- |
| `app` | The Laravel backend (PHP-FPM) and the built Phaser frontend, which lives in Laravel's `public/` directory |
| `db` | MariaDB |
| `colyseus` | The multiplayer game server |
| `editor` | The scenario editor: a static web application served by its own small Apache |
| `docs` | The documentation in `docs/`, built with MkDocs into a static site |
| `apache` | Apache httpd: the only published port. Serves the game's files and uploaded media, and passes `/api` to Laravel, `/game` (WebSocket) to Colyseus, `/editor` to the editor and `/docs` to the documentation |

Starting the containers migrates the database and nothing else. **Seeding is done by hand:**

```sh
docker compose exec app php artisan qbl:seed            # the marketplace catalogue and the Starship Explorer demo
docker compose exec app php artisan qbl:seed --reset    # put the shipped demo back, replacing edits made to it
```

The first is safe to run again: a demo that is already there is left as it is, and so are prices changed in the catalogue. Until it has been run once there is no scenario to play. To play the demo, choose "Play as a guest instead" on the sign-in screen. Compose uses local-only default secrets; copy `.env.example` to `.env` and set real ones for anything shared.

**An account for the editor.** The editor needs a teacher or admin account. Either seed demo accounts (`php artisan qbl:seed --password=...` creates `teacher@qbl.test` and two students with that password), or create one at any time:

```sh
docker compose exec app php artisan qbl:user you@example.org "Your Name" --role=teacher
```

**Upgrading a database from an earlier build.** `docker compose up --build` is enough: migrations run on start and are written so that tables and columns that already exist are left alone. Changes to the shipped demo arrive only when you run `qbl:seed --reset`.

### HTTPS

Every container speaks plain HTTP, including the one published port. For HTTPS, TLS ends at your firewall or load balancer, which forwards to that port:

```
browser ──https/wss──▶ firewall (certificate) ──http/ws──▶ apache :80 ──▶ app, colyseus, editor, docs
```

What the firewall has to do:

- Forward to the published port (`QBL_HTTP_PORT`, 8080 by default) over HTTP, keeping the `Host` header.
- Send `X-Forwarded-Proto: https` and `X-Forwarded-For`.
- Allow WebSocket upgrades on `/game/` (forward the `Upgrade` and `Connection` headers; allow long-lived connections, an hour or more of idle timeout).
- Redirect port 80 to 443 and send HSTS, if you want them. Nothing in the containers does.

What to set in `.env`:

| Setting | Value |
| ------- | ----- |
| `QBL_PUBLIC_URL` | The address people type, e.g. `https://qbl.example.org`. Laravel's `APP_URL`; the Google sign-in address is built from it |
| `QBL_HTTP_BIND` | The address the published port listens on. Make it one only the firewall can reach (`127.0.0.1` if the firewall is on the same host) |
| `QBL_TRUSTED_PROXIES` | Whose `X-Forwarded-*` headers are believed: the firewall's address and the Docker network, comma-separated. The default is every private range, which suits a firewall on a private network |

How it works inside: Apache passes the forwarded headers on to Laravel, which believes them only from the trusted addresses and then knows the site is https (its links, redirects and cookies follow) and what the visitor's real address is. Apache rewrites any redirect of its own, or of the editor and docs containers, from `http://` to `https://` when the visitor came by https, and logs the visitor's address. The game builds its socket address from the page's own, so an https page uses `wss://`. **The published port must be reachable only through the firewall**: anyone who can reach it directly can send those headers themselves.

### Google sign-in

1. In the Google Cloud console create an OAuth client ID of type "Web application", with the authorised redirect URI `https://your-host/api/auth/google/callback` (for a local try-out, `http://localhost:8080/api/auth/google/callback`).
2. Put its id and secret in `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, set `QBL_PUBLIC_URL` to the same host, and restart `app`.

The game's and the editor's sign-in screens then show "Sign in with Google". Someone signing in for the first time gets an account straight away: a student, with stars and progress that are kept. Someone whose address matches an existing account is joined to it and keeps its role.

| Setting | Effect |
| ------- | ------ |
| `QBL_GOOGLE_DOMAINS` | Only addresses at these domains may sign in with Google (`school.org,students.school.org`). Empty: any Google account |
| `QBL_GOOGLE_TEACHER_DOMAINS` | New accounts at these domains start as teachers, who can use the editor |

Without them anyone with a Google account can register as a student, and teachers are made with `qbl:user` or by changing `users.role`. For a school, set `QBL_GOOGLE_DOMAINS`.

How the pieces connect:

- Apache reads the frontend and the demo's media from a volume that `app` fills from its `public/` directory on each start.
- Files uploaded in the editor are written by `app` to a `media` volume, which Apache serves read-only as `/media`.
- The editor container holds no data. It is static files; everything it does goes through `/api/editor`, where Laravel checks who is asking.
- Colyseus calls Laravel's `/api/internal` routes through a second Apache port (8081) that exists only on the Docker network. The public port answers 404 for `/api/internal`.

Other commands:

```sh
npm test                                   # shared unit tests + client tests that play the game headlessly
npm run test:api                           # seeding, JSON generation, codes, publishing, editor API (needs PHP with SQLite)
npm run test:laravel                       # the same API through real Laravel (needs `composer install` in apps/api)
npm run test:editor                        # the editor in a headless browser (needs PHP; once: npx playwright install chromium)
npm run validate -- scenarios/starship.json    # check a scenario document
npm run seed:export                        # regenerate scenarios/starship.json from the seed data (needs PHP)
npm run typecheck
npm run build
```

## How a mission is put together

A **scenario** is a whole mission a group of students goes on together. It contains **scenes**. Each scene has a background, and **events** made of **actions** that run in order: start events when the scene loads, end events just before leaving, hotspots, and indirect events run by other actions. All of it is in `docs/docs`.

- **Moving between scenes** is a `jump` action. Scene edges are walk-in hotspots that span one axis (a null `position_x` or `position_y`) and jump when an avatar reaches them.
- **Background music** is an `audio` action with `repeat` and `persist` in a scene's start events. It carries on across scenes that use the same track and changes when a scene starts a different one.
- **Hotspots** fire on a click (`activate_by_trigger: true`) or when an avatar walks in (`false`), and can show labels.
- **Who sees an event** is its `audience`: only the player who sets it off (the default), or everyone in the scene, who then see and hear its pictures, text, sounds and dialogue as they happen. What an event does (variables, awards, jumps, infoboxes) is always the player's own.
- **Variables are a player's own or shared.** A player's own variable has a separate value for each player (how many animals this student has greeted). A shared one has a single value for everyone playing together, so one student changing it changes it for all (the boulders have fallen; the path is closed). The variable's `scope` decides, once, where it is defined.
- **Dialogue** is a speech bubble over the speaker, or a story box across the screen with the speaker's close-up portrait, for the characters that carry the story. Characters and avatars can each be given a portrait.

`docs/docs/extensions.md` lists the fields added for the walk-around runtime (walkable areas, spawn points, item and character placement, shared variables, chat mode).

## The demo mission

**Starship Explorer** has thirteen scenes: five on the planet and eight aboard the ship. From the control room, the laboratory is east, the observation deck is up the ramp, and the main corridor to the south leads to the crew quarters, the hydroponics bay, the engine room and the marketplace. The corridor is drawn in perspective and uses a scale area, so avatars shrink as they walk away. On the rocket pad, the exoplanets marker only fades in as you walk under it, and boarding the rocket hides your avatar until you arrive.

It has one full quest, The Wilting Stream:

1. A console in the starship control room gives the mission: plants along a stream are dying.
2. West of the landing site, students walk the stream from the marsh (downstream) past an old lander to the spring meadow (upstream), observing and collecting a plant sample at each site.
3. In the ship's laboratory they test each sample's water with pH strips, look at the cells under a microscope, and keep the results in a notebook.
4. They report the source of the contamination, and can neutralise a beaker of the stream water by adding drops of base or acid.

Five questions are built into the play (why collect a healthy control, what a pH of 3 means, what "no microbes" implies, what cancels an acid, and the final conclusion). Each first answer is recorded in a variable and scored, and every answer gets an explanation. A checklist on screen tracks progress.

Three things in it show the storytelling tools. Captain Vega greets each player in a **story box** with her portrait, a conversation only that player sees. Above the spring meadow, any player can push loose boulders onto the cliff path: the **rockfall is shown to everyone in the meadow**, and a **shared variable** closes the shortcut for every player until someone sends the repair drone from the engine room. In the hydroponics bay the seed vault opens only for a player who has greeted all three critters, counted in **each player's own variable**.

Along the way the quest awards stars and XP (16 awards: 56 stars and up to 245 XP, enough for the second rank). The marketplace sells the platform's items and two that exist only on this mission: a patch to wear, and a survey map, an ability that makes a map table appear at the landing site for the players who own it.

All of this is data: scenes, hotspots, events, actions, variables and the checklist in the seed rows. The quest's artwork is placeholder art made by `tools/make-quest-art.py`.

## Stars, XP, ranks and the marketplace

- **Stars** are earned through `award` actions and spent in the marketplace. **XP** is earned the same way, is never spent, and adds up to a **rank** (Cadet, Explorer, Navigator, Specialist, Commander, Admiral; thresholds in `apps/api/config/qbl.php`).
- Both belong to the player's account and are the same in every scenario. **Guests have neither**: sign in to earn them.
- An award is given **once per student** unless the author marks it repeatable. An award can also take stars or XP away; totals stop at zero.
- The **marketplace** sells things to wear (head, body, back, hand), pets that follow the avatar, ways for the avatar to move, and abilities. Players open it from their stars in the top-left corner of the game, or through a `shop` action, and choose what to have on under "My things". Other players see what they wear.
- Every scenario sells the platform's catalogue (`apps/api/database/seeders/data/shop.php`; there is no screen for editing it yet). Authors add **mission-specific items** on the editor's Shop page.
- **Abilities** are flags: while a player has one equipped, the variable `QBLAbility_<key>` is 1, and a scenario decides what that unlocks. They do not change walking speed or reveal distances.
- The backend grants awards, checking each against the published scenario, and keeps a ledger of every change. See "Stars, XP and the marketplace" in `docs/docs/extensions.md`.

## The editor

Open `/editor`, sign in, and create a scenario. It gets its permanent 16-letter code and a first scene.

- **Scenes** are drawn to scale with everything in them. Add background and foreground layers (stretched to the scene, or repeated with a drift and parallax), walkable and blocked areas, spawn points, items and characters, and drag any of them into place. A scene larger than the screen scrolls as players walk.
- **Depth and discovery**: scale areas draw avatars, vehicles and items smaller towards the back of a scene; a hotspot can be given a distance within which it fades into view.
- **Events**: start, end, hotspot and indirect events, each with conditions and an ordered list of actions. Every action type in the docs has a form, as do the added actions: `avatar` (hide or show the player), `freeze` (hold the player still), `dialogue` (a speech bubble or a story box with a portrait), `award` (give or take stars and XP) and `shop` (open the marketplace). Each event says who sees it: the player who sets it off, or everyone in the scene. "Exit along the left edge" and its siblings create the walk-in hotspot and jump action that move players between scenes.
- **Library**: media (upload, or by address; filed under backgrounds, characters, avatars, items, vehicles, shop items, sounds, video), variables (each marked as a player's own or shared), items, characters with their portraits, and the objectives checklist.
- **Shop**: the items only this scenario sells, with their price, picture and what they do.
- **Test this scene** opens the game on the draft, in that scene, playing alone with nothing saved, so you can check that actions behave. Nothing has to be published first.
- **Publish** checks the scenario with the validator the game uses, then generates the JSON players get at `/{code}`. Players keep the last published version until you publish again.

Everything can be edited and deleted, and every change is saved as it is made. See `apps/editor/README.md`.

## Where the JSON comes from

The database holds a scenario as rows: scenes, events, actions, conditions, labels, media, variables, items and characters, as in the docs. `ScenarioCompiler` generates the scenario JSON from those rows. Publishing stores the generated document; that is what players and the game server get.

The demo mission, **Starship Explorer**, is seed data: rows for those tables in `apps/api/database/seeders/data/starship.php`.

- With the Laravel API, `StarshipSeeder` puts the rows into the tables through the same store the editor writes through, then publishes. This happens when you run `php artisan qbl:seed`, never by itself. The scenario is seeded once; after that it can be edited like any other, and seeding again leaves it alone. `qbl:seed --reset` puts the shipped version back.
- Without Laravel, `npm run seed:export` runs the same compiler from the command line (PHP only, no database) and writes `scenarios/starship.json` for the game server's file backend.

Both paths play the same document. `npm run test:api` checks that JSON generated from the seeded database equals JSON generated from the seed rows, that `scenarios/starship.json` is current, that seeding again does not disturb an edited scenario, and that seeding refuses to overwrite rows belonging to another scenario.

The demo's music and rocket sound are synthesised by `tools/make-demo-audio.py`, so the repo contains no third-party audio.

## What has and has not been run

Most of this codebase was written in an environment without network access. Composer has since been run there, so the Laravel application is real and tested; `npm install` and `docker build` have not.

**Run and passing**

- `packages/shared`: type-checks cleanly; 32 unit tests cover variables and conditions, placeholders and objectives, geometry and movement limits, normalisation, validation, the event engine, the world rules, and the generated mission.
- `apps/client`: 18 tests run the real client code (scene, systems, presenters, features, offline connection) against a **fake Phaser** with a manual clock. One plays the whole Wilting Stream quest and checks the stars and XP it earns; others buy and wear marketplace items.
- `apps/api`: 89 checks on the framework-free PHP classes over SQLite (seeding to JSON, seed-once and reset, codes, publishing, the whole editor API including ownership rules, uploads), 32 more on stars, XP, ranks and the marketplace (`npm run test:progress`), and 17 Laravel feature tests that run the real framework: migrations (fresh, and over a database made by the earlier all-in-one migrations), seeding by command, sign-in with a password and with Google (Google itself replaced by a stand-in), forwarded HTTPS headers, the editor routes, upload, publish, play and the game server's routes.
- `apps/editor`: 23 tests drive the real editor in headless Chromium against those PHP classes. A scenario is built by clicking, typing and dragging, published, and the published JSON is then played by the game's headless harness.
- The game's DOM UI (infobox, HTML sanitiser, overlays, checklist, marketplace, story box) was exercised in headless Chromium.
- Client, server and editor were bundled with esbuild to confirm every import resolves; the Compose file parses; the PHP files pass `php -l`.

**Written against current documentation but never executed**

- Nothing here has run against **real Phaser 4** or **Colyseus 0.18** in this environment. The client tests use a fake Phaser that accepts any call, so they prove the game's logic, not that Phaser accepts each call.
- MariaDB itself has not been exercised from here, only SQLite. Your Docker runs are the MariaDB test.
- **The Apache configuration, including everything for HTTPS behind a firewall, has never been loaded by an Apache**: there is none in the authoring environment. Laravel's side of it (trusting the forwarded headers) is tested.
- **Google sign-in has not been run against Google.** The flow is tested with Socialite's stand-in for Google; the real exchange needs your client id and secret.
- Events shown to the whole scene are tested in the shared rules, the room's rule for passing them on, and the client with a simulated second player, not with two real browsers through Colyseus.
- The `editor` image, the changes to the Apache configuration (`/editor` proxy, `/media`), the upload limits in `docker/app/php.ini`, and the Vite development wiring for `npm run dev:editor`. `docker compose config` parses.
- The game's preview path in a real browser (`/?preview=…`): the pieces are tested (the draft endpoint, starting in a given scene), the page that joins them is not.
- No `package-lock.json` exists yet. Commit the one `npm install` creates, then change `npm install` to `npm ci` in the Dockerfiles.

Game positions for the ported demo scenes were converted from the demo's code by arithmetic, not by eye. Open a scene in the editor to adjust walkable areas and positions against the artwork.

## Next

1. Editor: undo, copying events and scenes, drawing areas by clicking, a rich-text field for infobox content, sharing a scenario between authors.
2. Accounts: classes and groups, roles beyond a `role` column, a group-picking lobby.
3. From the JSON docs, still open: `physical` items, intro splash media, animated avatars.
