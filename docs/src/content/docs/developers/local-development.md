---
title: "Run QuestLab locally"
description: "Start the game with one command, run the editor or the whole Docker stack, seed the demo, make a teacher account, and run the tests and the validator."
host:
  who: asimov
  says: "Three ways to run it, from one command to the full set of containers. Pick the smallest one that does the job."
  side: right
---

QuestLab is a monorepo: a shared TypeScript package, a Colyseus game server, a Phaser client, the editor, a Laravel API and this documentation. Which parts you need to run depends on what you are working on. The [architecture](/docs/developers/architecture/) page says what each container does.

Task | Run | Needs
---- | --- | -----
Play and work on the game | [`npm run dev`](#the-game-only) | Node 22+
Work on the editor, with a stand-in API | [`npm run dev:editor`](#the-editor) | Node 22+, PHP 8.2+ with SQLite
Everything, as it runs on a server | [`docker compose up --build`](#the-whole-stack-in-docker) | Docker
Write these docs | [`npm run dev` in `docs/`](#these-docs) | Node 22+

## The game only

```sh
npm install
npm run dev
```

The game server starts on port 2567 and the client on http://localhost:5173. This needs no Laravel and no database: the server reads `scenarios/*.json` and keeps saves in `.data/saves`.

* http://localhost:5173 is the marketing page. The game is at `/missions`, or at `/{code}` for one scenario.
* Open the client in two browser windows to see multiplayer.

These URL parameters help while developing:

Parameter | Effect
--------- | ------
`?scenario=starshipexplorer` | Which scenario to play, by code or shortname, when the path has no code
`?preview=12&scene=40` | Play the unpublished draft of scenario 12, starting in scene 40. This is what the editor's "Test this scene" opens; it needs the editor's sign-in
`?group=red-team` | The instance to play in: players with the same group share its variables, items and saves
`?party=class-5b` | With the file backend, to try teams out: groups with the same party share a room
`?offline` | Single-player, no game server needed
`?debug` | Draws walkable areas, spawn points and hotspot areas

## The editor

```sh
npm run dev:editor
```

This starts a stand-in API on port 8000 (`apps/api/dev/server.php`, which runs the real PHP classes over SQLite), the editor, and the game together. Open http://localhost:5173/editor/. The stand-in API does not serve the [public API](/docs/api-v1/).

## The whole stack in Docker

```sh
docker compose up --build
```

Development is plain HTTP on http://localhost:8080 with no certificate and no `.env`. The containers are described on the [architecture](/docs/developers/architecture/) page; staging and production add HTTPS with two lines in `.env` (see the root `README.md`).

Address | What it is
------- | ----------
http://localhost:8080 | The marketing page
http://localhost:8080/missions | The game: sign in, then the missions page
http://localhost:8080/starshipexplorer | The demo mission, by its code
http://localhost:8080/editor | The editor
http://localhost:8080/docs | This documentation

Starting the containers migrates the database and nothing else. **Seeding is done by hand:**

```sh
docker compose exec app php artisan qbl:seed            # the marketplace catalogue, the Starship Explorer demo and the Science Lab
docker compose exec app php artisan qbl:seed --reset    # put the shipped demo back, replacing edits made to it
```

Until you have run it once there is no scenario to play. To play the demo, choose "Play as a guest instead" on the sign-in screen.

### An account for the editor

The editor needs a teacher or admin account. Who may use the editor, Classes and reports goes by the account's **role** alone, and everyone who signs in with Google starts as a student.

```sh
docker compose exec app php artisan qbl:user you@example.org "Your Name" --role=teacher
docker compose exec app php artisan qbl:update-role you@example.org --role=teacher   # change a role
docker compose exec app php artisan qbl:update-role you@example.org                  # show the current role
```

`php artisan qbl:seed --password=...` also creates `teacher@qbl.test` and two students with that password.

### Editing the code with the containers running

* **API.** `apps/api` is mounted into the `app` container, so an edit is there at once, with no rebuild. Run `artisan` and `composer` in the container, or on your machine with `cd apps/api && php artisan test`.
* **Client and editor.** Their source is mounted read-only and Vite rebuilds within a few seconds of a save (`QBL_CLIENT_WATCH=true`, the default). Reload the page. The output is in `docker compose logs -f app`, labelled `client:` and `editor:`.
* **Game server and docs.** These are copied into their images. After changing `apps/server`, `packages/shared` or `docs`, run `docker compose up -d --build colyseus docs`.
* **Docker files.** `docker compose up --build` is needed only when something in `docker/` changes.

## Check a scenario

From the repository root:

```sh
npm run validate -- path/to/scenario.json
```

This runs the same checks as the editor's **Publish** button, and prints the number of scenes, assets and actions with any warnings and errors. Each message names the path to the field, for example `scenes[0].hotspots[0].actions[0].scene_id`. See [How a scenario fits together](/docs/developers/structure/#what-the-validator-catches).

## Run the tests

Command | Covers
------- | ------
`npm test` | The shared package and the client
`npm run test:editor` | The editor
`npm run test:laravel` | The Laravel feature tests (`cd apps/api && php artisan test`)
`npm run test:api`, `test:progress`, `test:classes`, `test:porting`, `test:activity`, `test:billing`, `test:district`, `test:library`, `test:walk`, `test:speech` | The plain-PHP suites for each part of the backend
`npm run test:api-v1` | The [public API](/docs/api-v1/)
`npm run test:generation`, `test:story-generation`, `test:scene-generation` | The [mission generator](/docs/developers/generation/#testing), and one [scene for a scenario](/docs/developers/generation/#one-scene-for-a-scenario)
`npm run test:all` | All of the above except the Laravel suite and `test:api-v1`
`npm run typecheck` | Types for the shared package, server, client and editor

## These docs

```sh
cd docs
npm install
npm run dev      # http://localhost:4321/docs/ with live reload
npm run build    # into docs/dist; fails on a broken link or anchor
```

Pages link to each other with addresses that include the `/docs` base, for example `/docs/editor/scene-editor/#spawn-points`, and the build checks every one. See `docs/README.md` for the page conventions.
