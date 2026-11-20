---
title: "Public API (v1)"
description: "The versioned API schools, districts and businesses use to roster people, assign missions, import avatars, sign people in and read reports."
---

The public API lets a school, district or business connect its own systems to QBL: a student information system (SIS) that rosters classes, a learning management system (LMS) that assigns missions and takes grades back, a portal that signs people in, and a data warehouse that collects everything students did.

Everything is under **`/api/v1`**. The player, editor and game server keep using the unversioned endpoints in the [HTTP API contract](/docs/developers/api/); those are internal and may change. This one may not.

- [Versioning](#versioning)
- [Getting access](#getting-access)
- [Conventions](#conventions)
- [Privacy: what QBL will and will not store](#privacy)
- [Organization and schools](#organization-and-schools)
- [Teachers and students](#teachers-and-students)
- [Enrollments](#enrollments)
- [Missions and assignments](#missions-and-assignments)
- [Signing people in: launch links](#launch-links)
- [Avatars](#avatars)
- [Reports](#reports)
- [How the numbers are worked out](#how-the-numbers-are-worked-out)
- [Export, deletion and the audit log](#export-deletion-and-the-audit-log)

## Versioning

The version is in the path: `/api/v1/…`. Every answer also carries the header `QBL-API-Version: 1`.

Within version 1, QBL will only ever:

- **add** endpoints, optional request fields, response fields, error codes, scopes and values of open-ended fields (activity `type`, say), and
- **loosen** rules (a longer limit, a field that becomes optional).

Clients must ignore fields they do not know. Anything that would break a client that follows that rule (renaming or removing a field, changing a type or a meaning, tightening a rule) is a new version, `/api/v2`, served **beside** v1. A version is supported for at least 12 months after its successor is released; its answers carry `Deprecation` and `Sunset` headers ([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745), [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594)) during that time.

## Getting access

An administrator of the QBL server makes the organization and a client for it, and sends the organization the client id and secret:

```sh
docker compose exec app php artisan qbl:api-client create "Riverside School District" --kind=district --name="SIS sync" --scopes=roster:read,roster:write,assignments:write,launch,reports:read
docker compose exec app php artisan qbl:api-client list
docker compose exec app php artisan qbl:api-client rotate qbl_…   # new secret; the old one and its tokens stop working
docker compose exec app php artisan qbl:api-client revoke qbl_…
docker compose exec app php artisan qbl:api-client scopes         # what each scope allows
```

The secret is printed once; only a hash is kept. A client belongs to one **root organization** (a district, a school on its own, a business) and can reach that organization and its schools, nothing else.

### Tokens

Clients sign in with **OAuth 2 client credentials** ([RFC 6749 §4.4](https://www.rfc-editor.org/rfc/rfc6749#section-4.4)):

```http
POST /api/v1/oauth/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=roster:read reports:read
```

The id and secret may instead go in the body as `client_id` and `client_secret`. `scope` is optional: without it the token has all the client's scopes; with it, only those named (never more than the client has).

```json
{ "access_token": "qbla_…", "token_type": "Bearer", "expires_in": 3600, "scope": "roster:read reports:read" }
```

Send it on every other request as `Authorization: Bearer qbla_…`. When it expires (after an hour), get another. These tokens work only under `/api/v1`, and a player's sign-in does not work here.

### Scopes

Scope | Allows
--- | ---
`roster:read` | Read schools, teachers, students and enrollments.
`roster:write` | Create, change and deactivate schools, teachers, students and enrollments.
`assignments:read` | Read the mission catalogue, assignments and teams.
`assignments:write` | Create, change and remove assignments and teams.
`avatars:read` | Read the avatars players can choose.
`avatars:write` | Import, change and retire the organization's own avatars.
`reports:read` | Progress, grades, engagement and learning reports, and the activity feed.
`messages:read` | The chat messages students sent in assigned missions, for safety review.
`launch` | One-time sign-in links for teachers and students.
`privacy` | Export everything kept about a student; delete a teacher or student and all their data.
`audit:read` | The record of requests made with the organization's clients.

Give each system only what it needs: a reporting warehouse needs `reports:read`, not `privacy`.

### Limits

600 requests a minute per access token (the server's `QBL_API_RATE_LIMIT`), 20 a minute per address to `oauth/token`. Over the limit: `429` with `Retry-After`. Batch endpoints take up to 1,000 people per request.

## Conventions

- JSON in and out (`Content-Type: application/json`), UTF-8. Avatar uploads may be `multipart/form-data`.
- A single thing comes back as `{ "data": {…} }`; a list as `{ "data": […], "meta": {…} }`.
- **Ids** are QBL's integers. Wherever a teacher or student is named in a path or a field ending `_id`, you may write `ext:` and your own `external_id` instead: `GET /api/v1/students/ext:8f1c2e`. Fields ending `_external_ids` take lists of your ids.
- **Times** are ISO 8601 in UTC (`2026-11-20T15:04:05Z`). Times you send may carry any offset.
- **Pages**: lists of people and the activity feed take `limit` and `cursor`. `meta.next_cursor` is the cursor for the next page, or `null` on the last.
- **CSV**: grades and per-student engagement also come as CSV with `?format=csv`. Nested values are flattened to `parent.child` columns; values that a spreadsheet would read as a formula are prefixed with `'`.
- **Errors** have a status and a body like this. Switch on `code`, not on `message`, which may be reworded.

```json
{ "error": { "code": "pii_not_accepted", "message": "QBL does not store personally identifiable information. Remove: first_name.", "fields": { "first_name": "Not accepted: personally identifiable." } } }
```

Status | `code` | When
--- | --- | ---
400 | `unsupported_grant_type`, `invalid_scope` | A token request QBL cannot grant.
401 | `unauthenticated`, `invalid_token`, `invalid_client` | No token, a bad or expired one, or wrong client credentials.
403 | `insufficient_scope`, `forbidden` | The token lacks the scope named in the message.
404 | `not_found` | It does not exist, or it is not your organization's.
409 | `conflict`, `inactive`, `limit_reached` | An `external_id` already used; a launch link for a deactivated account.
410 | `launch_expired` | A launch link already used or more than five minutes old.
422 | `invalid_request`, `pii_not_accepted` | A field is wrong (see `fields`), or would identify someone.
429 | | Too many requests.

## Privacy

QBL is built so that it **never holds personally identifiable information about a student**. That is what lets a school use it under FERPA's *school official* exception (34 CFR 99.31(a)(1)(i)(B)) and give consent on parents' behalf under COPPA's school-authorization provisions (16 CFR 312.5) without QBL keeping records that identify a child. It is enforced by the API, not left to good intentions:

- **No names, emails, birth dates, addresses, phone numbers, demographics or photos.** Requests about people that carry any field such as `name`, `first_name`, `email`, `dob`, `address`, `phone`, `gender` or `photo` are refused with `422 pii_not_accepted`, so a mistake is found at once rather than kept quietly.
- **People are known by your `external_id`**: 1–64 letters, digits and `._:-`, and never an email address. We recommend a keyed hash of your SIS id (HMAC-SHA256 with a key only you hold), so that even QBL's copy is not your SIS id.
- **Students play under a pseudonym** QBL makes up ("Brave Otter 417"), shown to other players and in reports. You keep the only key from pseudonym to child, in your own system. A student cannot be given a display name; `regenerate_display_name: true` gives them a new pseudonym.
- **Teachers** may have a `display_name` they choose ("Ms. R"), checked so it holds no email address or phone number.
- **Free text you send** (assignment notes, team names, avatar names) is checked the same way.
- Accounts made through the API have a placeholder address at `.invalid` that cannot receive mail and is never shown, and no password: they sign in only through [launch links](#launch-links).
- **Grade level** (`K`, `1`–`12`, …) and school are the only facts about a student QBL keeps, because reports need them.
- **Avatars are uploaded, never linked**, so no player's browser contacts a third-party server.
- **Records of disclosure**: every API request is logged with the students whose records it reached ([audit log](#export-deletion-and-the-audit-log)), as FERPA requires a school to be able to show.
- **Retention**: set `data_retention_days` on the organization and QBL deletes activity and chat older than that (the server runs `qbl:privacy-purge` daily).
- **Access and deletion requests**: `GET /students/{id}/export` returns everything kept about a student; `DELETE /students/{id}` removes it for good.

What remains the school's responsibility: keeping the pseudonym key, not putting identifying details in free text QBL cannot recognise, and what students type in chat. Chat is logged and readable with `messages:read` for safety review; a mission's author can turn chat off or limit it in the mission's settings.

## Organization and schools

`GET /organization` — your organization: `id`, `name`, `kind` (`district`, `school`, `business`, `other`), `external_id`, `settings`.

`PATCH /organization` (`roster:write`) — change `name`, `external_id`, or `data_retention_days` (`null` to keep until deleted, or 30–3650).

`GET /schools`, `POST /schools` `{name, external_id?}`, `GET|PATCH|DELETE /schools/{id}` — the schools under a district (one level). Deleting a school leaves its people in the organization, in no school.

## Teachers and students

A **person** looks like this. Students have `grade_level` and `teacher_ids`; teachers have `student_count`.

```json
{
  "id": 1042, "type": "student", "external_id": "a91f0c7e", "display_name": "Brave Otter 417",
  "school_id": 7, "grade_level": "7", "teacher_ids": [88],
  "avatar_media_id": 900003, "status": "active",
  "created_at": "2026-09-01T14:00:00Z", "updated_at": "2026-09-02T08:12:44Z"
}
```

Endpoint | Scope | Notes
--- | --- | ---
`GET /students`, `GET /teachers` | `roster:read` | Filters: `school_id`, `status` (`active`/`inactive`), `external_id`, `updated_since`, and for students `teacher_id`. Paged.
`POST /students`, `POST /teachers` | `roster:write` | `external_id` (required), `school_id`, `grade_level` (students), `display_name` (teachers), `status`, and `teacher_ids`/`teacher_external_ids` (students) or `student_ids`/`student_external_ids` (teachers). `409` if the `external_id` is taken.
`POST /students/batch`, `POST /teachers/batch` | `roster:write` | `{"students": [ … ]}` (or `"teachers"`): up to 1,000, **created or updated by `external_id`**. Each entry gets a result; one bad entry does not stop the rest.
`GET /students/{id}`, `GET /teachers/{id}` | `roster:read` |
`PATCH /students/{id}`, `PATCH /teachers/{id}` | `roster:write` | Any of the fields above, plus `regenerate_display_name`. Lists of teachers or students **replace** the current ones. `status: "inactive"` signs the person out everywhere and stops launch links; their data stays.
`DELETE /students/{id}`, `DELETE /teachers/{id}` | `privacy` | Deletes the person and everything about them; see [deletion](#export-deletion-and-the-audit-log).

A nightly sync is usually one `POST /students/batch` and one `POST /teachers/batch`, then `PATCH … {"status": "inactive"}` for people who left.

```json
POST /api/v1/students/batch
{ "students": [
  { "external_id": "a91f0c7e", "school_id": 7, "grade_level": "7", "teacher_external_ids": ["t-5512"] },
  { "external_id": "c0ffee12", "school_id": 7, "grade_level": "8" }
] }
```

```json
{ "data": [
  { "index": 0, "external_id": "a91f0c7e", "result": "updated", "id": 1042 },
  { "index": 1, "external_id": "c0ffee12", "result": "created", "id": 1188 }
], "meta": { "created": 1, "updated": 1, "errors": 0 } }
```

## Enrollments

An enrollment puts a student in a teacher's class: the teacher can then assign them missions and see their reports (in the editor's Classes page as well as here).

- `GET /enrollments?teacher_id=&student_id=` (`roster:read`): `[{teacher_id, student_id, created_at}]`.
- `POST /enrollments` (`roster:write`): `{teacher_id | teacher_external_id, student_ids | student_external_ids}`. Already enrolled is fine; `meta.added` lists who is new.
- `DELETE /enrollments?teacher_id=&student_id=` (`roster:write`): also takes the student out of that teacher's assignments.

## Missions and assignments

`GET /scenarios` (`assignments:read`) — the catalogue: every published public mission, and private ones written by your teachers. Each has `id`, `code`, `title`, `description`, `visibility`, `max_players`, `play_url`, `standards` (`[{code, framework, description, alignment}]`), and counts of `objectives` and `glossary_terms`. `GET /scenarios/{id}` adds `learning_objectives`, `objective_list` and `glossary`. A private mission can be assigned only by the teacher who wrote it.

An **assignment** gives a mission to some of a teacher's students, with a due date. Its students may be split into **teams**; each team plays its own copy of the game, and students in no team play together.

```json
POST /api/v1/assignments
{
  "teacher_external_id": "t-5512", "scenario_id": 12, "external_id": "canvas-assignment-9931",
  "due_at": "2026-12-05T23:59:00-07:00", "note": "Work with your team; finish by Friday.",
  "student_external_ids": ["a91f0c7e", "c0ffee12", "badd00d5"],
  "teams": [ { "name": "Comets", "student_external_ids": ["a91f0c7e", "c0ffee12"] } ]
}
```

Students named only in a team are added to the assignment too, and anyone assigned is enrolled with the teacher if they were not already. `external_id` (unique in the organization) is for your LMS's id for the assignment or gradebook column; `GET /assignments?external_id=` finds it again.

Endpoint | Scope | Notes
--- | --- | ---
`GET /assignments` | `assignments:read` | Filters: `teacher_id`, `student_id`, `scenario_id`, `external_id`.
`POST /assignments` | `assignments:write` | As above.
`GET /assignments/{id}` | `assignments:read` | `id`, `external_id`, `teacher_id`, `scenario_id`, `scenario_title`, `due_at`, `note`, `student_ids`, `teams`, `play_url`, `created_at`.
`PATCH /assignments/{id}` | `assignments:write` | `due_at`, `note`, `external_id`, `student_ids`, `teams`. A team given with its `id` keeps its game when renamed or reshuffled; a team left out is removed.
`DELETE /assignments/{id}` | `assignments:write` |
`GET /assignments/{id}/teams` | `assignments:read` |
`POST /assignments/{id}/teams` | `assignments:write` | `{name, student_ids}`. Its students leave any other team.
`PATCH /teams/{id}`, `DELETE /teams/{id}` | `assignments:write` | A removed team's students play with those in no team.

## Launch links

Accounts made through the API have no password. To send someone into QBL from your portal or LMS, ask for a **launch link** and redirect their browser to it:

```json
POST /api/v1/students/1042/launch      { "assignment_id": 77 }
POST /api/v1/teachers/88/launch        { "to": "editor" }
```

```json
{ "data": { "url": "https://qbl.example/api/v1/launch/Jx3…", "expires_at": "2026-11-20T15:09:05Z", "return_path": "/kvmhqbzrtwplcaey?group=t31" } }
```

Where it goes: for students, `to: "missions"` (default) or an `assignment_id`, which opens that mission in the student's own team; for teachers, `missions`, `editor` (their dashboard), `classes`, or an `assignment_id` of theirs to look in on it. A link works **once, within five minutes**; ask for a new one each time someone clicks "Open QBL". Opening it shows a page that redeems it with a `POST`, so a chat app or mail scanner that fetches the link for a preview does not use it up. Deactivated accounts get `409 inactive`.

## Avatars

Players choose an avatar from the platform's set and their organization's own. Others' players do not get yours in their list, but can see them on players they meet in a public mission.

`GET /avatars` (`avatars:read`, `?include=inactive` for retired ones): `[{id, media_id, name, external_id, owner: "platform"|"organization", image_url, portrait_url, scale, width, height, sheet, animations, active, sequence}]`. A player's `avatar_media_id` is a `media_id` from here.

`POST /avatars` (`avatars:write`) imports one. Send the picture as `multipart/form-data` (`image`, and optionally `portrait`), or in JSON as `image_base64` / `portrait_base64` (base64, or a `data:` URL). PNG, WebP, GIF or JPEG, up to 5 MB and 4096 px a side; at most 200 active per organization. Links to pictures elsewhere (`image_url`) are refused: see [Privacy](#privacy).

Field | Notes
--- | ---
`name` | Required, up to 64 characters.
`external_id` | Optional, your id for it.
`scale` | 0.1–4, how large it is drawn (default 1). The platform's are about 0.85.
`sheet` | For a sprite sheet: `{"columns", "rows"}` (1–32 each). Frames are numbered left to right, top to bottom, from 0.
`animations` | With a sheet: `[{name, frames, duration?, repeat?}]`, as in [Animations](/docs/developers/extensions/#sprite-sheets-and-named-animations). `idle` and `walk` (or `walk_left` and `walk_right`) play by themselves.
`sequence` | Order in the list.

In multipart, send `sheet` and `animations` as JSON strings. `PATCH /avatars/{id}` changes any of these (a new picture too) or `active`; `DELETE /avatars/{id}` retires it: it is kept so games in progress can still draw it, and whoever wore it chooses again. Platform avatars cannot be changed.

```sh
curl -H "Authorization: Bearer $TOKEN" -F name="Riverside Otter" -F scale=0.9 \
  -F image=@otter-sheet.png -F portrait=@otter-face.png \
  -F 'sheet={"columns":6,"rows":2}' -F 'animations=[{"name":"idle","frames":[0,1]},{"name":"walk","frames":[6,7,8,9,10,11]}]' \
  https://qbl.example/api/v1/avatars
```

## Reports

All need `reports:read` (messages need `messages:read`). Students appear by `student_id`, `external_id` and pseudonym. Filters taken by the organization-wide reports: `school_id`, `teacher_id`, `grade_level`.

### One assignment

- **`GET /assignments/{id}/report`** — the full picture, as the teacher sees it in the editor:
  - `summary`: students, started, finished, `completion_rate`, `average_score`, average time and objectives done, questions answered and answered in one try, average words learned.
  - `objectives`: each objective and how many completed it. `learning_objectives`: what the mission teaches, with standards.
  - `students[]`: for each student, `started`, `time_spent` (seconds), `visits`, `first_seen`, `last_seen`, current `scene`, `scenes_visited`, each objective's state, `hotspots_used`, `questions[]` (`action_id`, `prompt`, `attempts`, `first_answer`, `last_answer`, and where the author marked right answers, `first_answer_correct` and `last_answer_correct`), `words_learned` of `words_total`, `stars_earned`, `xp_earned`, `badges`, `messages`, `learning[]` (the evidence each learning objective recorded, with this student's values) and `grade`.
- **`GET /assignments/{id}/grades`** — one row per student for a gradebook (also `?format=csv`): `status` (`not_started`, `in_progress`, `completed`), `score` (0–100, `null` before starting), `score_parts`, objectives done and total, questions answered and answered first try, words learned, `time_spent`, `started_at`, `completed_at`, `late` and `missing`.
- **`GET /assignments/{id}/activity?student_id=&limit=`** — what students did, newest first (`join`, `leave`, `scene`, `hotspot`, `choice`, `objective`, `glossary`, `narration`, `award`).
- **`GET /assignments/{id}/messages`** (`messages:read`) — every chat, emote and private message in the assignment's games, with sender and recipient.

### One student

**`GET /students/{id}/report?from=&to=&timezone=`** — every assignment with its grade, time, words and evidence; `totals` (assignments, completed, missing, late, average score, time, words, stars, XP, rank, badges); `engagement` over the period; and `standards`: each curriculum standard the student's missions address, with how many they completed and their average score.

### The organization

- **`GET /reports/summary`** — schools, teachers, students, assignments (and how many are open), student-assignments, completion rate, missing, average score, students active in the last 7 and 30 days, participation rate and active minutes over 30 days.
- **`GET /reports/engagement`** — who took part, how often and how long. `from`, `to` (default: the last 30 days), `timezone` (IANA, for where days begin; default UTC), `interval` (`day` or `week`), `group_by` (`school`, `grade_level` or `teacher`), `include=students` for a row per student (or `format=csv` for that as CSV).
  - `totals`: students, active students, participation rate, sessions, active minutes, actions, messages, and per active student the average minutes, sessions and active days.
  - `series`: per day or week, active students, sessions, active minutes and actions: the trend to chart.
  - `groups` (with `group_by`) and `students` (with `include`).
- **`GET /reports/learning`** — per mission (assignments made between `from` and `to`, or `scenario_id`): students, started, completed, completion rate, average score and time, first-try rate, vocabulary rate; each objective's completion rate; **each question**: prompt, students, average attempts, first-try rate, first-answer-correct rate where answers are marked, and the distribution of first answers (common misconceptions); and each learning objective's evidence (how many students produced it, and the values recorded). `standards`: the same rolled up by curriculum standard.
- **`GET /reports/standards`** — just the `standards` part: per standard, the missions that address it, how many students were taught it, their completion rate and average score.

### The activity feed

**`GET /activity?cursor=&limit=&since=&types=`** — every line of activity of your students, **oldest first**, up to 5,000 a page, each with `id`, `student_id`, `external_id`, `scenario_id`, `assignment_id`, `team_id`, `scene_id`, `type`, `ref`, `label`, `value`, `at`. Keep the last `meta.next_cursor` and ask from it next time to load only what is new: this is how to feed a data warehouse, or an analysis of learning gains against your own assessment data.

## How the numbers are worked out

- **Time spent** is the game's own clock for the student's save in that instance (seconds actually in the mission).
- **Sessions and active minutes** (engagement) come from the activity log: a gap of more than 15 minutes between two things a student did starts a new session; a session lasts from its first to its last line, at least one minute.
- **Active student**: did anything in the period. **Participation rate**: active ÷ active-status students in the population.
- **Actions**: hotspots used, answers chosen, objectives completed, words learned and awards earned.
- **First try**: a question answered once. Missions usually ask again until the answer is right, so one attempt usually means right first time. Where the author marks answers (`"correct": true|false` on an infobox's `call_to_actions`), the report also gives `first_answer_correct`, and the score uses it.
- **Score** (0–100) = 60% objectives (required objectives done ÷ required objectives) + 25% accuracy (first answers right, or first-try rate where answers are not marked) + 15% vocabulary (glossary words learned ÷ words). A part the mission does not have is left out and the others share its weight. No score until the student has started.
- **Completed**: every required objective done. **Late**: completed after `due_at` (the time of the last objective completed). **Missing**: past `due_at` and not completed.
- **Learning objectives' evidence** is whatever the mission's author recorded in variables for each learning objective (`curriculum.evidence`), with each student's values; reports count how many students produced each value.

## Export, deletion and the audit log

- **`GET /students/{id}/export`** (`privacy`) — everything kept about a student: the account, enrollments, assignments, saved games, every line of activity, messages sent, badges, the rewards ledger, items, and the record of disclosures. For a parent's request to inspect records (FERPA) or review a child's information (COPPA).
- **`DELETE /students/{id}`** (`privacy`) — the student and all of the above, for good; messages others sent them stay, without naming them. Answers with how many records went from each table.
- **`DELETE /teachers/{id}?transfer_to=`** (`privacy`) — a teacher. With `transfer_to` (another teacher), their classes and assignments move to that teacher; without, the assignments go too. Missions they wrote stay, with no owner.
- **`GET /audit-log?student_id=&limit=&cursor=`** (`audit:read`) — every request made with your clients, newest first: client, method, path, status, the students whose records it reached, and when.
