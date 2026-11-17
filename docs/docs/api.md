# HTTP API contract

The player, the editor and the game server depend on a small set of endpoints. Two things implement the player's and the game server's:

* the **Laravel API** in `apps/api` (production), and
* the **game server's file backend** (development and previews), which serves the public endpoints itself from JSON files so the game runs without Laravel.

Anything that honours this contract can be swapped in.

## Public endpoints (called by the browser)

All responses are JSON. Authenticated requests send `Authorization: Bearer <token>`.

### `POST /api/auth/login`

Body `{ "email": "...", "password": "..." }`. Returns `{ "token": "...", "user": User }`, or 422 with `{ "message": "..." }`.

### `POST /api/auth/guest`

Body `{ "name": "..." }`. Returns `{ "token": "...", "user": User }` with role `guest`. The Laravel API only offers this when `QBL_ALLOW_GUESTS=true`. A guest token is accepted by the game server only for scenarios with `require_login: false`.

### `POST /api/auth/logout`

Ends the token it is called with, so signing out works everywhere that token was kept. The game and the editor call it from their "Sign out" buttons and then forget the token.

### `GET /api/auth/providers`

`{ "google": true, "guest": true }`: which optional ways of signing in this installation offers. The sign-in screens show a Google button when `google` is true.

### Signing in with Google

Google sign-in is on when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. It is a redirect flow, not a JSON call:

1. The sign-in screen sends the browser to `GET /api/auth/google/redirect?return=/editor/`. `return` is a path on this site to come back to; anything else is replaced with `/`.
2. Google asks the person and sends the browser to `GET /api/auth/google/callback` (register this address with Google: `https://your-host/api/auth/google/callback`. It is built from `APP_URL`).
3. The API finds the account by Google's id for it, or joins an existing account with the same verified address, or creates a new one. It issues a token and answers with a small page that stores the token where the game and the editor look for it (`localStorage["qbl.token"]`) and goes to `return`. The token is never put in an address.

If nobody is signed in, the browser is sent to `return` with the reason after the `#`: `#signin=cancelled`, `domain` (the address is not at an accepted domain), `unverified`, `expired` or `failed`.

New accounts are students. `QBL_GOOGLE_DOMAINS` limits who may sign in to those domains; accounts at `QBL_GOOGLE_TEACHER_DOMAINS` start as teachers. An account that has only ever signed in with Google has no password.

### `GET /api/me`

Returns `{ "user": User }` or 401.

### `GET /api/scenarios/{code}/play`

`{code}` is the scenario's unique 16-letter code, the same one players have in their address bar (`/{code}`). A shortname is accepted too.

Returns `{ "scenario": Scenario }`: the published scenario document with the caller's save data in `scenario.session` (null if none). Returns 401 when the scenario has `require_login: true` (or is private) and there is no valid token, and 404 for an unknown or unpublished scenario.

`?group=` names the instance being joined (`public` if absent, `a12` for an assignment, `t7` for a team; see [Classes, missions and teams](classes.md)). The save returned is the caller's save in that instance. 403 if the caller does not belong to it, or if the scenario is private and was not assigned to them.

The document's avatars (`avatar_media_ids`, `avatar_portraits` and their images in `assets`) are the platform's, added as the document is served.

### Missions and avatars

All need a token.

Endpoint | Body | Returns
-------- | ---- | -------
`GET /api/missions` | | `{ "missions": [Mission] }`: every public scenario, and everything assigned to the caller (assigned first, soonest due first)
`GET /api/avatars` | | `{ "avatars": [{ media_id, name, image_url, portrait_url, sheet }], "avatar_media_id": 900004 or null }`
`PUT /api/me/avatar` | `{ "avatar_media_id": 900004 }` | The same. 422 if it is not one of the platform's avatars

```json
{
  "id": 1, "code": "starshipexplorer", "title": "Starship Explorer", "subtitle": null, "description": "...",
  "image": "/scenario-assets/starship/backgrounds/bridge.png", "visibility": "public",
  "kind": "assigned", "group": "t7", "assignment_id": 12, "teacher": "Ms Tan", "team": "Comets",
  "due_at": "2026-12-01 15:00:00", "note": "Read chapter 4 first", "started_at": null
}
```

`kind` is `public` or `assigned`. A player opens a mission at `/{code}?group={group}`. `image` is the background of the scenario's first scene. Times are UTC. `started_at` is when the caller's save in that instance was last written, or null. The fields from `assignment_id` to `note` are only on assigned missions.

### Classes (teachers and admins)

Under `/api/teach`; 403 for anyone else.

Endpoint | Body | Returns
-------- | ---- | -------
`GET /students` | | `{ "students": [{ id, name, email }] }`
`POST /students` | `{ "email": "..." }` | 201 `{ "student": {...} }`. 404 if nobody has signed in with that address
`DELETE /students/{id}` | | 204. The student also leaves this teacher's assignments
`GET /scenarios` | | `{ "scenarios": [...] }`: published scenarios the caller can assign (public ones and their own; all of them for an admin)
`GET /assignments` | | `{ "assignments": [Assignment] }`
`POST /assignments` | `{ "scenario_id", "student_ids": [], "due_at"?, "note"?, "teams"?: [{ "name", "student_ids": [] }] }` | 201 `{ "assignment": Assignment }`
`PUT /assignments/{id}` | Any of `due_at`, `note`, `student_ids`, `teams` (give a team's `id` to keep its instance) | `{ "assignment": Assignment }`
`DELETE /assignments/{id}` | | 204

An `Assignment` is `{ id, scenario, due_at, note, group, students: [{ id, name, email, team_id }], teams: [{ id, name, group, student_ids }] }`.

### Stars, XP and the marketplace

All need a token except `GET /api/shop`. Guests are answered 403: stars and XP need an account.

Endpoint | Body | Returns
-------- | ---- | -------
`GET /api/me/progress` | | `{ "progress": Progress }`
`GET /api/shop?scenario={code}` | | `{ "items": ShopItem[], "progress": Progress or null }`: the platform's items plus that scenario's own
`POST /api/shop/{item}/buy` | `{ "scenario": "{code}" }` | `{ "progress": Progress }`. 422 without enough stars, 409 if already owned, 404 if the item is not sold in that scenario
`POST /api/shop/{item}/equip` | `{ "equipped": true }` | `{ "progress": Progress }`. Putting something on takes off what was in its place

```json
{ "stars": 56, "xp": 240, "rank": "Explorer", "next_rank_xp": 300, "owned": [1, 102], "equipped": [102] }
```

`ShopItem` is described under [Stars, XP and the marketplace](extensions.md#stars-xp-and-the-marketplace). There is no public endpoint that gives stars: awards come only through the game server (below).

### User

```json
{ "id": 12, "name": "Ada", "role": "student", "avatar_media_id": 103 }
```

`role` is one of `student`, `teacher`, `admin`, `guest`. `avatar_media_id` is optional.

## Internal endpoints (called by the game server)

Under `/api/internal`, authenticated with the header `X-QBL-Service-Key`, which must equal the API's `QBL_SERVICE_KEY`. These must not be reachable from the internet; in the provided Docker setup Apache answers 404 for `/api/internal` on its public port, and the game server reaches those routes through a second Apache port that exists only on the Docker network.

Endpoint | Body | Returns
-------- | ---- | -------
`POST /auth/verify` | `{ "token": "..." }` | `{ "user": User }`, or 401 if the token is not valid
`GET /scenarios/{code}` | | `{ "scenario": Scenario }` (no session), or 404. A shortname is accepted too
`GET /scenarios/{id}/access/{userId}?group=` | | `{ "allowed": true }` if the player may join that instance: asked before a player is let into a room
`GET /scenarios/{id}/sessions/{userId}?group=` | | `{ "session": Session or null }`: the player's save in that instance (`public` if no group is given)
`PUT /scenarios/{id}/sessions/{userId}?group=` | `{ "session": Session }` | 204
`GET /scenarios/{id}/instances/{group}` | | `{ "instance": InstanceData or null }`
`PUT /scenarios/{id}/instances/{group}` | `{ "instance": InstanceData }` | 204
`POST /scenarios/{id}/awards` | `{ "user_id": 12, "action_id": 72090 }` | `Progress` plus `delta_stars`, `delta_xp`, `note`, `rank_up`. The action must be an `award` in the published document; a once-only award already given changes nothing. 403 for a guest
`GET /users/{id}/look` | | `{ "look": "1,102" }`: the ids of what the player has on, for other players to see

`Session` and `InstanceData` are described on the [Save data](session.md) page.

## Editor endpoints (called by the editor)

Under `/api/editor`, with `Authorization: Bearer <token>`. Only the Laravel API implements these (and the development stand-in, `apps/api/dev/server.php`, which runs the same classes).

| Who | May |
| --- | --- |
| `admin` | edit every scenario |
| `teacher` | edit their own scenarios, and shared samples that have no owner |
| anyone else | nothing: 403 |

A scenario the caller may not edit answers 404, the same as one that does not exist. Errors are `{ "message": "..." }` with 401, 403, 404, 409 or 422.

A scenario is stored as rows of these tables: `media`, `variables`, `items`, `characters`, `scenes`, `events`, `actions`, `conditions`, `labels`. The columns are the attributes on the corresponding docs pages; attributes that only some rows have are kept in a JSON column (`params` for actions, labels and media; `settings` for items, characters and the scenario; `layout` for a scene's walkable areas, spawn points and placements). `ScenarioStore::SCHEMA` is the authoritative list.

Endpoint | Body | Returns
-------- | ---- | -------
`GET /scenarios` | | `{ "scenarios": [...] }`: id, code, title, subtitle, owner, `published_at`, `updated_at`
`POST /scenarios` | `{ "title": "..." }` | 201 `{ "scenario": row }`. The scenario gets its code and a first scene
`GET /scenarios/{id}` | | `{ "scenario": row, "media": [...], "variables": [...], ..., "labels": [...] }`: every row of the scenario
`PATCH /scenarios/{id}` | columns to change | `{ "scenario": row }`
`DELETE /scenarios/{id}` | | 204. Removes its rows, players' saves and uploaded files
`POST /scenarios/{id}/rows/{table}` | columns | 201 `{ "row": row }`
`PATCH /scenarios/{id}/rows/{table}/{rowId}` | columns to change | `{ "row": row }`
`DELETE /scenarios/{id}/rows/{table}/{rowId}` | | 204. Also removes what only existed because of it: a scene's events, an event's actions, labels and conditions
`POST /scenarios/{id}/media/upload` | multipart, field `file` | 201 `{ "row": media row }`
`GET /scenarios/{id}/preview` | | `{ "scenario": Scenario }`: the JSON generated from the rows as they are now, published or not
`POST /scenarios/{id}/publish` | | `{ "scenario": row }`. Generates the JSON and makes it what players get

Rules the API enforces whatever the editor sends:

* A row can only be created in, moved to, or made to refer to things in the same scenario (`scene_id`, `event_id`, `media_id`, ...).
* Enumerated columns only take their documented values (action `type`, event `kind`, media `type`, condition `operator`, ...).
* A condition belongs to exactly one of an event, an action, an item or a character.
* Variable names are letters, digits and underscores, and may not start with `QBL`.
* Uploads are identified by their content. Images (PNG, JPEG, WebP, GIF), audio (MP3, WAV, OGG) and video (MP4, WebM) up to 25 MB are accepted; SVG is not.
* A scenario's `code` cannot be changed.

The editor runs the shared validator (`validateScenario` from `@qbl/shared`) on the preview before it publishes and refuses to publish a document with errors. The API does not repeat that check, so a client other than the editor should run `npm run validate` on what it builds; the game server validates every document it loads either way.

### Testing a draft

The game plays a draft when opened as `/?preview={scenario id}&scene={scene id}`. It fetches `GET /api/editor/scenarios/{id}/preview` with the editor's token, checks the document, and plays it alone (no game server, nothing saved), starting in the given scene. This is what the editor's "Test this scene" button opens.
