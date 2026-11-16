# QBL client

A Phaser 4 game that plays any QBL scenario. Nothing in here knows about a particular mission: scenes,
hotspots, events and the mission checklist all come from the scenario JSON.

## Layout

```
src/
  main.ts            sign-in, load the scenario, connect, start Phaser
  config.ts          URLs and URL parameters
  core/              what everything else is built on
    GameContext.ts     the scenario, variables, connection and UI for one play session
    SceneRuntime.ts    the SceneSystem interface, and what a system can see
    GameFeature.ts     the GameFeature interface
    assets.ts          media loading, preloading, sprite sheets
    depth.ts           draw order
  scenes/
    BootScene.ts       loads the first scene's media
    PlayScene.ts       plays one QBL scene by running the registered systems
  systems/           everything that happens inside a scene, one concern per file
    index.ts           the list of systems, in order
  actions/           how each action type is shown or played
    ActionHost.ts      the scene engine's link to Phaser and the UI
    presenters/        one presenter per action type; index.ts is the registry
  entities/          display objects with behaviour (Avatar)
  features/          things that last the whole session: checklist, chat, saving
    index.ts           the list of features
  net/               the HTTP API and the room connection (online and offline)
  ui/                HTML drawn over the canvas, behind the UiPort interface
test/                a fake Phaser and a headless UI, and tests that play the game with them
```

The rules of the game (how events run, where avatars may walk, what the server allows) are not in the
client. They are in `packages/shared`, which the server uses too.

## The three extension points

**1. A scene system** is something that exists while a scene is on screen: layers, the local player,
other players, hotspots, speech bubbles, the camera. To add one (weather, a mini-map, footstep sounds):

```ts
// src/systems/RainSystem.ts
export class RainSystem implements SceneSystem {
  constructor(private rt: SceneRuntime) {}
  create() { /* add display objects to this.rt.scene */ }
  update(time: number, delta: number) { /* every frame */ }
  variablesChanged() { /* a variable changed */ }
  destroy() { /* remove what create() added */ }
}
```

Then add `RainSystem` to the array in `systems/index.ts`. A system reaches others with
`this.rt.system(LocalPlayerSystem)`, and reads the scene definition from `this.rt.def`.

**2. An action presenter** shows or plays one action type. To add an action type:

1. Add its interface to the `Action` union in `packages/shared/src/types.ts`, its name to `ACTION_TYPES`
   in `scenario.ts`, and its checks to `validate.ts`.
2. If it only changes state (like `variable` or `wait`), handle it in `SceneEngine.execute` and stop here.
3. Otherwise add it to `PresentedAction` in `engine.ts`, write a presenter in `actions/presenters/`
   that returns an `ActionHandle`, and register it in `actions/presenters/index.ts`.

**3. A game feature** lasts the whole session and usually owns a piece of UI: the mission checklist,
chat, connection status. Implement `GameFeature` (one `start(ctx)` method that returns a stop function)
and add it to `features/index.ts`. If it needs new UI, add a method to `UiPort`, implement it in `Ui.ts`,
and add a no-op or recording version to `HeadlessUi` in `test/harness.ts`.

## Rules that keep it modular

- Game code talks to the UI only through `UiPort`, never to the DOM. That is what lets the tests run headless.
- Game code reads the room through `GameConnection`, never through Colyseus directly. Offline mode
  (`?offline`) and the tests use `OfflineConnection`, which runs the same rules locally.
- Systems read the room state every frame instead of subscribing to changes, so they behave the same
  online and offline.
- Screen-space things (text, overlays, infoboxes, the checklist) are HTML. World-space things are Phaser objects.
- Nothing mission-specific goes in the client. If a mission needs something new, it is a new field in the
  JSON plus a system, presenter or feature that reads it.

## Tests

```sh
npm test -w @qbl/client
```

`test/fakePhaser.ts` stands in for Phaser with a manual clock, and `test/harness.ts` runs a whole game in
offline mode: the real scenario, engine, systems, presenters and features. `test/quest.test.ts` plays the
Wilting Stream quest from the landing site to the final report.

The fake accepts any Phaser call, so these tests prove the game's own logic and wiring. They cannot tell
whether real Phaser accepts the same calls; that still needs a browser.
