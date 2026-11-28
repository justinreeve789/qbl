---
title: "The event engine"
description: "SceneEngine in depth: how events start, run, block, override and end; how every action type is handled; the EngineHost contract; conversations, cancelling, freezing, jumps and events shown to the whole scene."
host:
  who: asimov
  says: "Every mission is events and actions, and every event runs through one class. Know SceneEngine and you know why a mission behaves the way it does."
  side: right
---

`SceneEngine` (`packages/shared/src/engine.ts`, about 600 lines) runs the events of **one scene for one player**. It decides when an event starts, which of its actions run, in what order, what waits for what, and what stops when. It never touches Phaser, the network or real timers: everything it needs from its surroundings comes through the `EngineHost` interface. The game implements the host with `ActionHost`; the tests implement it with a fake and a manual clock.

:::tip[In short]
- One `SceneEngine` per visit to a scene. `PlayScene` makes it in `create()` and stops it in `shutdown()`.
- An event runs as a **run**: its actions execute one after another; a **blocking** action is awaited before the next starts. Actions whose own conditions fail are skipped; an event whose conditions fail does not start.
- Starting any event cancels every running **overridable** one. A running event with **`block_hotspots`** stops hotspots from firing.
- **Logic** actions are handled inside the engine. Everything else goes to the host: `present()` for things shown or played, and specific methods (`walk`, `animate`, `camera`...) for things that act on the world.
- Every running action is an **`ActionHandle`** `{done, cancel}`. The engine tracks handles by action id (for `cancel` and `translate`) and by event (for `cancel_event`).
- A `jump`, `travel` or same-tab `open_url` **ends the scene**: end events run, everything stops, then the host leaves.
:::

## Where it sits

```text
 PlayScene.create()
   ├── host   = new ActionHost(this, ctx, onJump)      ← implements EngineHost
   ├── engine = new SceneEngine(def, ctx.index, ctx.vars, host, ctx.flags)
   └── engine.start()                                   ← start events

 HotspotSystem ── engine.triggerHotspot(h)              ← clicks and walk-ins
 LocalPlayerSystem ── engine.triggerHotspot(door) / engine.leave(...)   ← a scripted walk through a door
 PropsSystem ── engine.triggerById(eventId)             ← clicking an item or a character
 BenchSystem ── engine.triggerById(watch.event_id)      ← a bench watch noticed something
 StorySystem ── engine.leave(next)                      ← "Skip" in a story scene
 infobox presenter ── engine.runAction(button.action)
 ctx.bag.run / ctx.inScene ── engine.runActions(list)
 connection 'show' ── engine.watch(eventId, actionId, actor)
 PlayScene.shutdown() ── engine.stop()
```

## The constructor and its state

```ts
new SceneEngine(scene: Scene, index: ScenarioIndex, vars: VariableStore, host: EngineHost, flags: Iterable<string> = [])
```

- `scene`: the normalised scene. Events must already have `actions`, `conditions`, `overridable`, `block_hotspots` and `audience` filled in (`normalizeScenario` does that).
- `index`: lookups across the scenario; the engine uses `index.events` to find events by id for `run_event`, `cancel_event` and `watch`.
- `vars`: the player's `VariableStore`. Conditions read `vars.get`; `variable` actions call `vars.apply`.
- `flags`: the player's one-shot markers. `PlayScene` passes `ctx.flags`, but the engine **copies** them into a set of its own (`this.flags = new Set(flags)`). It adds `hotspot:<id>` there when a `once` hotspot fires, which holds for this visit. What makes it last is `HotspotSystem.fire`, which adds the same marker to `ctx.flags` and marks progress dirty, so it is saved.

Private state:

Field | What it holds
----- | -------------
`runs: Map<Id, Run>` | Running events by event id. A `Run` is `{event, cancelled, handles, finished, wake, woken}`
`actions: Map<Id, ActionHandle>` | The live handle of each action id, for `cancel` and `translate`
`shownBy: Map<Id, Set<ActionHandle>>` | What each event has put up that is still showing, **even after the event finished** (a looping spritemap, a picture with no duration), for `cancel_event`
`watched: Set<ActionHandle>` | What this player is being shown of other players' events
`frozenBy: Set<Id>` | Events that froze the player and are still running
`leaving`, `stopped` | Set once the scene is being left, and once everything has been cancelled
`adHocId` | Counts down from -1: ids for actions and events made outside the scene's own (infobox buttons, bag combinations, conversation choices)
`hotspotCoordinates` | `"x,y"` of the hotspot whose event started most recently, while it runs: the value of `QL_HotspotCoordinates`

## Starting events

Method | Use
------ | ---
`start()` | Fire every start event (not awaited: they run side by side)
`trigger(event)` | Start an event. Resolves when it finishes or is cut short
`triggerHotspot(h)` | A hotspot was clicked or walked into. Returns false if it did not fire
`triggerById(eventId)` | Start an event of this scene by id (what `run_event` uses). Warns and resolves if the id is not in this scene
`runAction(action)` | Run one action outside any event, as a one-action event with a negative id: an infobox button
`runActions(list)` | Run several actions in order as a made-up event: putting two bag things together, a teacher's launch
`hotspotAvailable(h)` | Whether a hotspot would fire now (not stopped or leaving, not a spent `once`, conditions hold). Drives label visibility
`hotspotsBlocked` | True while any running event has `block_hotspots`
`isRunning(id)`, `finished(id)` | Whether an event is running, and a promise for when it ends

### `trigger(event)` step by step

1. If the engine is stopped, resolve at once.
2. **If the event is already running, return its `finished` promise.** An event never runs twice at once; clicking a busy hotspot does nothing new.
3. If `testConditions(event.conditions, vars.get)` fails, resolve at once. The event is bypassed.
4. **Cancel every running overridable event** (`cancelRun`).
5. Make a `Run` with a `woken` promise. `cancelRun` calls `wake()`, which is how an awaited action is abandoned when its event is cancelled.
6. `execute(run)` runs the actions. When it settles, the run is removed and, if this event froze the player and no other freezer is left, the player is unfrozen. **A freeze never outlives the event that asked for it.**

### `triggerHotspot(h)`

Refuses when hotspots are blocked, when `hotspotAvailable` is false, or when that hotspot's event is already running. Otherwise it adds the `once` flag, sets `hotspotCoordinates`, tells the host (`started(h, true)`, which logs a `hotspot` line for the teacher's report) and triggers it.

## Running the actions

`runList(run, list, nested)` is the loop. `nested` is true for a conversation choice's actions: they get ad hoc ids, are not shown to the scene, cannot `repeat`, and stop when the scene is being left.

For each action, in order:

1. Stop if the run was cancelled, the engine stopped, or (nested) the scene is being left.
2. **Skip the action if its own `conditions` fail.** Conditions are tested when the action is reached, not when the event started.
3. If `sharesWithScene(event, action)` (the event's `audience` is `scene` and `isShownToScene(action)`, or the action is a `shake` whose own `audience` says so), call `host.share(event, action)` first, so other players see it at the same moment.
4. Handle it by type (below).
5. If it is **blocking** (the default; normalising sets `blocking: true`), await its handle, raced against `run.woken`.

### How each action type is handled

Type | Handled by | Waits? (when blocking)
---- | ---------- | ----------------------
`variable` | `vars.apply(name, operator, operand)` | No
`wait` | `host.delay(duration)`, tracked | Yes, for `duration` ms
`run_event` | `triggerById(target_event_id ?? event_id)`. Running itself is ignored | Yes, until that event finishes
`repeat` | Jumps back to the first action, after a 16 ms yield (`REPEAT_YIELD_MS`) so a loop with no wait is paced at about one pass a frame | n/a
`cancel` | `cancelAction(action_id)`: cancels that action's handle, and `host.cancelPersistent` for background music from an earlier scene | No
`cancel_event` | `cancelEvent(target_event_id)`: stops the run and everything it left showing | No
`jump` | `leave(scene_id, spawn_point)`, not awaited. **This event's sequence ends here** | n/a
`travel` | `host.travel(action)` returns a "go" function, or null (no mission launched: the event carries on). With one, `depart(go)` and the sequence ends | n/a
`open_url` | `host.openUrl(action)`: a new tab opens and returns null (carry on); the same tab returns "go" and the scene is left like `travel` | n/a
`conversation` | `converse(run, action)`, see below | Yes, until it ends
`award` | `host.award(action)`: the game server is asked to grant it | No
`glossary` | `host.glossary(action)` | No
`bench` | `host.bench(action)` | No
`freeze` | Adds or clears the event in `frozenBy`, then `host.freeze(frozen)` | No
`avatar` | `host.avatar(visible, duration)`, tracked | Yes, for the fade
`animate` | `host.animate(action)`, tracked | Yes, for a one-pass animation; a loop returns no handle
`walk` | `host.walk(action)`, tracked | Yes, until they arrive
`weather`, `camera` | `host.weather(action)` / `host.camera(action)`, tracked | Yes, until the change is done
`shake` | `host.shake(action)`, tracked | Yes, for its `duration`; one with no `duration` shakes until cancelled and never waits (`shakesUntilStopped`)
`translate` | Only if the target action (`target_id`) is still live in `actions`; then `host.translate(action)`, tracked | Yes, for `duration`
everything else | `host.present(action, engine)`, tracked: `audio`, `dialogue`, `narration`, `shop`, `image_fixed`, `image_overlay`, `infobox`, `spritemap`, `text_overlay`, `video` (the `PresentedAction` union) | Yes, **unless it is indefinite**

### Indefinite actions

`isIndefinite(action)` is true for things that stay up until a jump or a cancel removes them:

- `image_fixed`, `image_overlay`, `text_overlay` with no `duration` (or `duration <= 0`);
- `audio` with `repeat: true`;
- `spritemap` unless `spritemap_repeat: false`.

These **never hold up the sequence**, even when blocking. That is how "show a picture, then carry on" works without a separate flag.

### Tracking handles

`track(run, action, handle)`:

- cancels any previous handle of the **same action id** (an action restarted by `repeat` replaces itself);
- records the handle under the action id (`actions`) and in the run (`handles`) and in `shownBy[event.id]`;
- removes all three when the handle's `done` settles.

So `cancel` finds any live action by id, `cancelRun` cancels what the run is doing, and `cancelEvent` cancels what an event left up after it finished.

## Stopping things

Method | What it does
------ | ------------
`cancelAction(actionId)` | Cancel one action's live handle. Also `host.cancelPersistent(actionId)`: a persistent audio action started in an earlier scene is not in this engine's map, but the host knows it (`ctx.music.actionIds`)
`cancelEvent(eventId)` | Remove the run from `runs` and cancel it (it counts as finished at once, so it can be started again straight away), then cancel everything in `shownBy[eventId]`. **Background music it started plays on** (the host owns music)
`leave(sceneId, spawn?)` | `depart(() => host.jump(...))`
`depart(go)` (private) | Once only: set `leaving`, trigger every end event and **await them all**, `stop()`, then `go()`
`stop()` | Once only: set `stopped`, cancel every run and every handle, clear the maps. The host decides what survives

While `leaving` is set, hotspots are unavailable and `watch` ignores other players' shows. End events still run normally: `leaving` does not stop `trigger`.

## Conversations

A `conversation` action is a dialogue tree kept inside the action (`lines`, each with `choices`). The rules of the tree (which line starts, which line is said given the variables, which choices are offered, which lines are reachable) are in `packages/shared/src/conversation.ts` so the editor can draw the tree with the same logic. The engine only walks it, in `converse(run, action)`:

1. `id = startLineId(action)`.
2. Loop while the conversation is live (not ended, cancelled, stopped or leaving):
   - `line = lineToSay(action, id, vars.get)`: the line, or the next one whose conditions hold. None: the conversation ends;
   - `choices = offeredChoices(line, vars.get)`;
   - `host.converse(action, line, choices, engine)` shows the line and returns a `ChoiceHandle` `{choice: Promise<number | null>, cancel}`;
   - a wrapper handle is tracked under the conversation's action id, so a `cancel` action naming the conversation ends **the whole conversation**, not just the line on screen;
   - await the choice (or the run being woken);
   - **no choices**: go to `line.next`. After 200 lines in a row without a choice (`MAX_LINES_WITHOUT_CHOICE`) the engine gives up: the lines go round in a circle;
   - **a choice**: run its `actions` as a nested list, then go to `choice.next`. A choice whose actions jump ends the event, as a jump of the event's own would.

On the client, `ActionHost.converse` calls `conversationLine` in `actions/presenters/conversation.ts`, which shows the line like a dialogue (a story box or a bubble), then the answers in a box of the player's own, and tracks the answer for the teacher's report.

## Events shown to the whole scene

An event's `audience` is `player` (default) or `scene`. With `scene`, **what the event shows** is seen by every player who can see the one who set it off; **what it does** (variables, awards, jumps, infoboxes, the player's progress) stays the player's own.

`SHOWN_TO_SCENE` in `types.ts` lists the shareable types: `audio`, `image_fixed`, `image_overlay`, `text_overlay`, `spritemap`, `video`, `dialogue`, `narration`, `translate`, `cancel`, `cancel_event`, `animate`, `walk`, `weather`, `shake`. `isShownToScene` removes two cases that already reach everyone through the room state: an `animate` of the player's own avatar, and a `walk` of the player. `sharesWithScene(event, action)` is the rule the engine, `SceneEngine.watch` and `World.show` all use: it adds that a `shake` with its own `audience` follows that instead of its event's (shown to the scene from a player's event, or kept to the player in a scene event).

The round trip:

1. **Sender**, `runList`: `host.share(event, action)` → `connection.share(eventId, actionId)` → `show` message.
2. **Server**, `World.show(sessionId, msg)`: the event must exist, be in the sender's current scene, have `audience: 'scene'`, and the action must be in it and shareable. It returns `audience(sessionId)`: the players in the same scene (and team, if the scene is limited to teams). The room sends them `show` with the sender's session id.
3. **Watchers**, `SceneEngine.watch(eventId, actionId, actor)`: checks the same things again against its own copy of the scenario, then:
   - `cancel` cancels that action here; `cancel_event` cancels what **this player is being shown** of that event (never their own runs);
   - `translate` only if its target is live here; `animate`, `walk`, `weather` go to the host with the actor;
   - anything else is `host.present(action, engine, actor)`. Presenters use the actor to mean "the player" in another player's event (whose bubble, whose position).
   The handle goes into `actions` and `watched`, so a later shown `cancel` or `translate` finds it.

Nothing a watcher is shown changes their variables, position or progress.

## The `EngineHost` contract

Every method the engine calls on its host. Optional ones (`?`) may be missing; the engine then skips the action or warns.

Method | Called for | Must return
------ | ---------- | -----------
`present(action, engine, actor?)` | Presented actions | An `ActionHandle`
`share?(event, action)` | Each shareable action of a `scene` event | nothing
`translate(action)` | `translate` | A handle, or null if the target is gone
`avatar?(visible, duration)` | `avatar` | A handle that ends with the fade, or null
`animate?(action, actor?)` | `animate` | A handle for a one-pass animation, or null
`walk?(action, actor?)` | `walk` | A handle that ends on arrival, or null (nobody to walk)
`weather?(action)`, `camera?(action)` | `weather`, `camera` | A handle, or null (nothing to do here)
`converse?(action, line, choices, engine)` | Each line of a conversation | A `ChoiceHandle`
`freeze?(frozen)`, `bench?(action)`, `award?(action)`, `glossary?(action)` | Those actions | nothing
`started?(event, hotspot)` | A hotspot's event started | nothing
`delay(ms)` | `wait`, and the repeat yield | A handle that ends after `ms`
`jump(sceneId, spawn?)` | After end events, when leaving for a scene | nothing
`travel?(action)`, `openUrl?(action)` | Those actions | A "go" function, or null to carry on
`cancelPersistent?(actionId)` | `cancel` of something this engine did not start | nothing
`warn?(message)` | Problems in the scenario | nothing

`ActionHost` (`apps/client/src/actions/ActionHost.ts`) implements all of them. It is described on [the game client page](/docs/codebase/client/#actionhost-and-presenters).

## Things that surprise people

- **An event that is running cannot be started again**, so a looping start event (`repeat` at the end) keeps its hotspot "busy" if the hotspot is that same event. Use `run_event` to an indirect event.
- **Conditions are checked late.** An action's conditions are tested when the sequence reaches it, so an earlier `variable` action in the same event can switch a later action on or off.
- **`blocking: false` on a `run_event`** starts the other event and carries on; that event then runs side by side and can be cancelled on its own.
- **Overridable cancels on any start**, including an end event, a `run_event` and an infobox button (`runAction` makes an event). Mark only events that really may be interrupted.
- **Hotspot `once`** ends up as a flag in the player's save when the hotspot fires through `HotspotSystem` (a click or a walk-in), so in practice it means once per player per instance, across visits. The comment on `Hotspot.once` in `types.ts` still says "once per visit"; the code is what counts. A door fired by a scripted walk (`LocalPlayerSystem`) only marks the engine's own copy, which lasts for the visit.
- **A jump inside an infobox button** (an ad hoc event) still leaves the scene: `leave` is engine-wide.
- **Indefinite actions are not awaited even when blocking.** An `image_fixed` with no duration followed by a `wait` shows the picture during the wait.
- **The engine does not know about other players' variables.** Room variables change through the room; the engine sees them only when `syncRoomVariables` writes them into the store, usually a frame later.

## Testing the engine

`packages/shared/test/shared.test.ts` (and `conversation.test.ts`, `story.test.ts`, `launch.test.ts`) drive `SceneEngine` with a fake host and a manual clock. The client tests (`apps/client/test/*.test.ts`) play whole scenarios through the real `ActionHost` with a fake Phaser. See [Testing](/docs/codebase/testing/).
