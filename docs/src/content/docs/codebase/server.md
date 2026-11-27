---
title: "The game server (apps/server)"
description: "The Colyseus game server: start-up and configuration, the Backend interface and its file and API implementations, ScenarioRoom's lifecycle and message handlers, the synchronized room state, teams as instances, saving, logs, launches and the trust model."
host:
  who: asimov
  says: "A thin adapter around the World. The room checks who you are, keeps everyone in step, saves often, and believes nothing a browser says without checking."
  side: right
---

The game server is about 1,100 lines of TypeScript on Colyseus 0.18 and Express. It is deliberately thin: the rules are in [`World`](/docs/codebase/shared/#world-the-rules-of-an-instance), which is unit-tested without Colyseus. The server's own job is identity, rooms, synchronizing state, saving and relaying.

:::tip[In short]
- **One room per scenario and party** (`filterBy(['scenario', 'party'])`). A room holds one or more **teams**, and each team is its own **`World`**: its own shared variables, unique items and roaming characters, over the room's one list of players.
- Every client message is a handler in `ScenarioRoom.onCreate` that calls a `World` method. A refused move or scene change answers `snap`.
- **`Backend`** hides where data comes from: `FileBackend` (JSON files, development) or `ApiBackend` (the Laravel API's `/api/internal`, with a service key).
- Saves: every player every 30 s, on drop, on leave and on takeover; each team's shared state when it changed, and when the room closes. Activity and messages are flushed to the backend every 5 s.
- Awards, what players wear and launches are **decided by the API**, never by the client.
:::

## Files

```text
apps/server/src/
  index.ts              the server: backend, chat filter, room definition, Express routes
  config.ts             environment variables
  backend/
    Backend.ts          the Backend interface, Access, ProgressResetError, withScenarioCache
    ApiBackend.ts       the Laravel API's /api/internal endpoints
    FileBackend.ts      scenarios/*.json and .data/saves (development)
  rooms/
    ScenarioRoom.ts     the room
    state.ts            the synchronized schema: Player, ItemState, NpcState, RoomState
    chat.ts             ChatFilter
```

## Start-up: `index.ts`

1. Picks the backend from `config.backend` and wraps it in `withScenarioCache` (a `Proxy` that caches `getScenario` for `QBL_SCENARIO_CACHE_SECONDS`, dropping failed fetches).
2. Sets `services.backend` and `services.chat` (a module-level object `ScenarioRoom` reads).
3. `defineServer({ rooms: { scenario: defineRoom(ScenarioRoom).filterBy(['scenario', 'party']) }, express })`. Express adds CORS, `GET /healthz`, `/scenario-assets` (static files next to the scenarios) and, **with the file backend only**, a stand-in for the three API routes the client needs: `POST /api/auth/guest`, `GET /api/me`, `GET /api/scenarios/:key/play`.
4. `server.listen(config.port)`.

### Configuration (`config.ts`)

Variable | Default | Meaning
-------- | ------- | -------
`PORT` | 2567 | Listening port
`QBL_BACKEND` | `file` | `file` or `api`
`QBL_SCENARIO_DIR` | `../../scenarios` | File backend: scenario JSON (and `assets/`)
`QBL_SAVE_DIR` | `../../.data/saves` | File backend: saves and logs
`QBL_API_URL` | `http://api:8000` | API backend: the Laravel base URL. Docker uses `http://apache:8081`, Apache's internal-only port
`QBL_SERVICE_KEY` | (none) | Shared secret sent as `X-QBL-Service-Key`. **Required** with the API backend
`QBL_CORS_ORIGIN` | `*` | CORS for the Express routes
`QBL_RECONNECT_SECONDS` | 30 | How long a dropped player's seat is held
`QBL_SAVE_INTERVAL_SECONDS` | 30 | How often everyone is saved
`QBL_SCENARIO_CACHE_SECONDS` | 30 | How long a scenario document is cached
`QBL_CHAT_BLOCKLIST` | (none) | A file of words free chat masks
`QBL_DEV_MODE` | not production | Development mode flag

## The `Backend` interface

```ts
interface Backend {
  getScenario(key): Promise<Scenario>;
  verifyToken(token): Promise<User | null>;
  mayJoin(scenarioId, user, group, party?): Promise<Access>;     // {allowed, party, team_name?}
  loadSession(scenarioId, userId, group): Promise<Session | null>;
  saveSession(scenarioId, userId, group, session): Promise<void>; // may throw ProgressResetError
  loadInstance(scenarioId, group): Promise<InstanceData | null>;
  saveInstance(scenarioId, group, data): Promise<void>;
  award(scenarioId, userId, actionId): Promise<RewardMessage | null>;
  look(userId): Promise<string>;
  logActivity(scenarioId, entries): Promise<void>;
  logMessages(scenarioId, entries): Promise<void>;
  launch(teacherId, assignmentId): Promise<{ok: true, plan} | {ok: false, message}>;
}
```

### `ApiBackend`

Every call goes to `${QBL_API_URL}/api/internal…` with the service key and a 10 s timeout. 404 and 401 mean "null"; a 409 on saving a session throws `ProgressResetError`. The routes are in `routes/api.php` under `Route::prefix('internal')->middleware(ServiceKey::class)` and implemented by `InternalController`:

Backend method | Request
-------------- | -------
`getScenario` | `GET /scenarios/{key}`
`verifyToken` | `POST /auth/verify {token}`
`mayJoin` | `GET /scenarios/{id}/access/{user}?group=`
`loadSession` / `saveSession` | `GET` / `PUT /scenarios/{id}/sessions/{user}?group=[&reset=]`
`loadInstance` / `saveInstance` | `GET` / `PUT /scenarios/{id}/instances/{group}`
`award` | `POST /scenarios/{id}/awards {user_id, action_id}`
`look` | `GET /users/{id}/look`
`logActivity` / `logMessages` | `POST /scenarios/{id}/activity` / `messages {entries}`
`launch` | `POST /assignments/{id}/launch {user_id}`

`ApiBackend` remembers the **reset token** each save was loaded with (`resetTokens`, keyed `scenario/user/group`) and sends it back when saving, so a save loaded before a teacher reset the player is refused.

### `FileBackend`

For development and content previews, never the internet. Scenarios are `<dir>/<key>.json`, or any file whose `code` matches. Guest tokens are `guest.<base64url name>.<random>` and prove nothing; the user id is a hash of name and nonce, so a browser keeps its progress. Anyone may join any group; the party is whatever the client asks for (that is how `?group=red&party=5b` tries teams out). Saves are `session-<scenario>-<user>[-<group>].json` and `instance-<scenario>-<group>.json`, written atomically (temp file and rename). Logs are JSON lines. Awards, looks and launches are not available.

## The room state (`rooms/state.ts`)

Defined with `@colyseus/schema` and synchronized to every client in the room:

Schema | Fields
------ | ------
`Player` (by session id, in `players`) | `user_id`, `name`, `role`, `avatar`, `scene_id`, `x`, `y`, `facing`, `attachments` (CSV of item ids), `connected`, `team`, `team_name`, `hidden`, `look` (CSV of shop item ids), `anim` (`name:count`)
`ItemState` (in `items`, key `team\|itemId`) | `item_id`, `scene_id`, `x`, `y`, `holder` (session id or "")
`NpcState` (in `npcs`, key `team\|characterId`) | `character_id`, `scene_id`, `x`, `y`, `facing`, `moving`, `anim`, `line`, `trip`
`RoomState` | `scenario`, `group` (the party), `players`, `items`, `vars` (key `team\|name`, values JSON-encoded so numbers stay numbers), `npcs`

The shapes match `PlayerRec`, `ItemRec` and `NpcRec` in `packages/shared`, which is what lets `World` write either Colyseus schema objects or plain objects.

## `ScenarioRoom`

### Private state

Field | What it holds
----- | -------------
`scenario` | The normalised scenario
`party` | The room's party key
`worlds: Map<team, Promise<World>>`, `ready: Map<team, World>` | Each team's world, made the first time a member arrives
`teamOf: Map<sessionId, team>`, `teamNames` | Who is in which team, and the teams' names
`lastChat`, `tracked` | Rate limits for chat (one message per 800 ms) and tracking (5 a second)
`stale: Set<sessionId>` | Players whose progress was reset while they played: never saved again
`activityLog`, `messageLog` | Lines waiting to be flushed

### Lifecycle

Hook | What happens
---- | ------------
`onCreate(options)` | Fetch, validate (errors throw: the room is not made) and normalise the scenario; set `maxClients` from `max_players`; subscribe to `qbl:launch` on presence; register the message handlers; start the clocks (`World.tick` every 50 ms, `saveAll` every 30 s, `flushLogs` every 5 s)
`onAuth(client, options, context)` | Verify the token (`options.token` or the auth context). Guests are refused with the API backend when the scenario requires a login. `mayJoin` must allow the group and **return this room's party**. Returns a `Seat` (user plus group and team name)
`onJoin(client, options, seat)` | Take over any other session of the same account (save it, remove it, close it with 4103). Get or make the team's world (`instance(group)`), load the save, `addPlayer` (staff may ask for a start scene), handle an arriving launch detour, send `welcome`, log `join`
`onDrop(client)` | Mark the player disconnected, save, hold the seat for `reconnectSeconds`
`onReconnect(client)` | Mark them connected; if their progress was reset meanwhile, close with 4104
`onLeave(client)` | Log `leave` with the time played, save, remove the player
`onDispose()` | Unsubscribe from presence, save every team's instance (forced), flush the logs

### Message handlers

Every handler finds the player's world with `this.world(client)` (none until they have joined) and calls one `World` method. None of them trusts the payload.

Message (`C2S`) | Handler
--------------- | -------
`move` | `world.move`; refused → `snap`
`scene` | `world.changeScene`; refused → `snap`; logs a `scene` line
`var` | `world.setVariable` (room-scoped only)
`item` | `world.item`; refused → `notice item_unavailable`
`award` | Not for guests. `backend.award(scenario.id, user.id, action_id)`; the answer goes back as `progress`; a real grant is logged
`look` | Not for guests. Reads what the player wears **from the backend**, then `world.setLook`
`show` | `world.show` returns who may see it; they get `show` with the sender's session id
`animate`, `walk`, `avatar`, `progress` | The `World` methods of the same names
`emote` | Not with `chat_mode: off`; only emoji in `EMOTES`; rate-limited; sent to the sender and their audience; kept for auditing
`chat` | Only with `chat_mode: free`; cleaned by `ChatFilter` (markup and control characters removed, blocklisted words masked, 140 characters); rate-limited; sent to the sender and their audience; kept
`whisper` | Only with `private_messages: true`; to one player anywhere in the room; cleaned; kept with who it was for
`track` | Only `TRACK_TYPES`; at most 5 a second; `ref` and `label` trimmed; added to the activity log
`launch` | Staff only: see below

### Teams and instances

`instance(team)` makes a `World` whose state is **the room's `players` map** and **the team's slice** of `items`, `vars` and `npcs` (`scopedMap(this.state.items, team)` stores keys as `team|key`). So:

- every client sees every player in the room (and decides which to draw with `ctx.sees`, from `canSee` and the scene's company);
- each team's world reads and writes only its own shared variables, items and characters;
- `OnlineConnection.state` gives each client the same view of its own team (see [the client](/docs/codebase/client/#netconnectionts)).

A teacher is in one team's game at a time. Switching team (`TeamsFeature`) leaves and joins again with `?group=` of the other team and a start scene, which the room honours for staff only.

### Saving

- `persist(sessionId)`: unless saves are off or the player is `stale`, `backend.saveSession(scenario, user, team, world.sessionOf(sessionId))`. A `ProgressResetError` marks them stale and closes their connection with 4104.
- `saveInstance(team, force?)`: when the world is `dirty` (or forced), `backend.saveInstance(scenario, team, world.instanceData())`. A failure sets `dirty` again so the next tick retries.
- `saveAll()`: persist every client, then every dirty instance.
- `flushLogs()`: hand the activity and message logs to the backend. Lines that fail are put back for the next batch, up to 5,000.

### Launches

A teacher in a game launches one of their assignments (`launch {assignment_id, scene_id?, stay?}`):

1. Only staff. With `scene_id`, it must be a launcher scene of this scenario (`isLauncherScene`).
2. `backend.launch(teacher, assignment)`: the API opens the assignment and returns a `LaunchPlan` naming every one of the teacher's students and the instance each plays in.
3. The room publishes a `LaunchRelay` on the presence topic `qbl:launch`, so **every other room** sends the teacher's students it holds (`onRelay` → `planRelay`): into this room's launcher scene if they are in the same scenario, on a **detour** (a presence key, `detourKey(userId)`, valid for 120 s) through the teacher's scenario's launcher scene if they are in another, or straight to the mission. Each room answers with how many it sent on `launchAnswerTopic(id)`.
4. Locally, `planLaunch` decides who goes; `sendLaunch` puts each in the launcher scene (`World.sendToScene`) and sends `launch` with the code, title, group and URL.
5. After 800 ms the teacher gets a notice with the counts (`launchReport`) and, unless they stay, goes too.

On the client, `LaunchFeature` and `GameContext.launched` take it from there: `QL_NextMission` and `QL_SCENARIO_LAUNCH_URL` are set, and the launcher scene's Open URL or travel action takes the player on.

:::caution[Presence is per process]
Colyseus' default presence is in-process. The Docker setup runs one game server process, so every room hears every launch. Running several game server processes needs a shared presence (Colyseus' Redis presence and driver) for launches and detours to cross between them.
:::

## The trust model

What the browser says | What the server does
---------------------- | --------------------
"I am here" (`move`) | Checked against speed and walkability; corrected with `snap`
"I went through a door" (`scene`) | Only to a scene the current scene can jump to
"Set this shared variable" (`var`) | Only room-scoped variables, known operators, short operands
"Show this to the scene" (`show`) | Only an action of an event with `audience: scene`, in the sender's scene; sent only to those who can see the sender
"I earned this award" (`award`) | The API looks the action up in the **published** document and grants it once
"I am wearing this" (`look`) | Ignored: what they wear is read from the backend
"Walk that character" (`walk`) | Only a walk an action of the player's scene describes exactly
"Here is my progress" (`progress`) | Cleaned against the scenario's definitions; position comes from the room
Chat, emotes, whispers | Filtered, rate-limited, logged

What the server does **not** check: player-scoped variables, flags, objectives, hotspot conditions. Those live in the player's browser and only affect that player's own game and report. Anything that must not be faked has to go through the room or the API.

## Testing

The server's rules are tested in `packages/shared/test/world.test.ts` and through the client's headless tests (which run the same `World` offline). `apps/client/test/fakeColyseus.ts` fakes a room for connection tests. `npm run test -w @qbl/server` only prints a reminder of that.
