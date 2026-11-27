---
title: "Recipes"
description: "Step-by-step checklists for the changes developers make most: a new field on an action or a scene, a new action type, a condition operator, a system variable, a scene system, a game feature, a UI method, a client-server message, a game server endpoint, a table column, an editor page or field kind, and a docs page."
host:
  who: asimov
  says: "Every common change, as a checklist. Each one names every file to touch, so nothing is left half done in one program and missing in another."
  side: right
---

Each recipe lists every place a change has to reach, in the order that is easiest to work in. TypeScript catches some of them (a missing entry in a `Record<ActionType, …>` is a compile error), but not all, so go through the list.

:::tip[Before any recipe]
- Find a similar thing that already exists and follow it through the code with a search (`rg "spritemap_repeat"`). The code is consistent, so the nearest neighbour is the best template.
- Most new attributes need **no migration**: they are keys in an existing JSON column. Add a column only when the API must query it.
- Finish every recipe with `npm test`, `npm run typecheck`, the relevant PHP suite, and a look in a browser.
:::

## A new field on an action

Example: an `outline` colour for `text_overlay`.

1. **Type**: add the optional field, with a doc comment, to its interface in `packages/shared/src/types.ts` (`TextOverlayAction`). Mark it `[ext]` if it is not in the original QBL spec.
2. **Validator**: check its type and range in the action's `case` in `packages/shared/src/validate.ts`. An error if the runtime cannot cope; a warning if it is merely odd.
3. **Runtime**: use it where the action is played: the presenter (`apps/client/src/actions/presenters/overlays.ts`), and the `UiPort` method if it reaches the HTML layer (then `Ui.ts` and `HeadlessUi`).
4. **Editor**: add a `Field` to `ACTIONS.text_overlay.fields` in `apps/editor/src/schema.ts`. It is saved into the action's `params` automatically, and the compiler spreads `params` into the document, so **no API change is needed**.
5. **Summary** (optional): mention it in `actionSummary` in `apps/editor/src/describe.ts` if it changes what the card's one-line summary should say.
6. **Docs**: the action's page in `docs/src/content/docs/developers/actions/`.
7. **Tests**: a validator case in `packages/shared/test/`, and a headless game test if it changes behaviour.

If the generator should use it, also teach `MissionBuilder` (and the blueprint schema, if the model chooses it).

## A new action type

Example: `shake` (shake the screen; it is in the code, so follow it through with `rg "shake"`). This touches every program.

**Shared**

1. `types.ts`: an interface `ShakeAction extends ActionBase { type: 'shake'; … }`; add it to the `Action` union and `'shake'` to `ActionType`.
2. `scenario.ts`: add `'shake'` to `ACTION_TYPES` (or `normalizeActionType` will not recognise it).
3. `validate.ts`: a `case 'shake'` with its checks. If it uses media, add it to `MEDIA_FOR_ACTION`.
4. Decide **where it runs**:
   - **Pure logic** (it only changes state, like `variable` or `wait`): a `case` in `SceneEngine.runList` in `engine.ts`. Stop here for the runtime.
   - **It acts on the world** (like `walk` or `camera`): an optional method on `EngineHost` (`shake?(action): ActionHandle | null`) and a `case` in `runList` that calls it, tracks the handle and awaits it when blocking.
   - **It shows or plays something** (like `dialogue`): add `'shake'` to the `PresentedAction` union in `engine.ts`; the `default` case then calls `host.present`. If it should stay up until cancelled, add it to `isIndefinite`.
5. If other players should see it when the event's audience is the scene, add it to `SHOWN_TO_SCENE` in `types.ts` and handle it in `SceneEngine.watch` if it is not a presented action.
6. If it can jump to another scene, walk it in `computeJumpTargets`/`walkActions` (`scenario.ts`), or the server will refuse the scene change. If it uses media, add it to `collectSceneMediaIds` so the media is loaded first.

**Client**

7. For a presented action: a presenter in `apps/client/src/actions/presenters/` returning an `ActionHandle`, registered in `presenters/index.ts` (`PresenterMap` will not compile without it).
8. For a host method: implement it on `ActionHost`, usually as a "control" that `PlayScene.create` points at a system (`this.host.shakeControl = (a) => this.runtime.system(CameraSystem).shake(a)`).

**API**

9. `ScenarioStore::ENUMS['actions.type']` in `apps/api/app/Qbl/ScenarioStore.php`: **without this the editor cannot save the new type** (422).
10. If it can jump, `ScenarioCompiler::collectJumps` must find it, as `computeJumpTargets` does.

**Editor**

11. `ACTIONS.shake` in `apps/editor/src/schema.ts`: label, `about`, fields (`Record<ActionType, ActionDef>` will not compile without it).
12. Put it in a group of `ACTION_GROUPS` and give it an icon in `ACTION_ICONS` (also a `Record<ActionType, …>`).
13. Starting values in `actionDefaults(type)` so a new one is valid at once.
14. A summary in `describe.ts` `actionSummary`.

**Docs and tests**

15. A page in `docs/src/content/docs/developers/actions/`, its entry in the sidebar (`docs/astro.config.mjs`) and in `developers/actions/index.md`.
16. Engine tests in `packages/shared/test/shared.test.ts`, a headless game test, an editor test if its form is unusual.

## A new scene setting or placed thing

The compiler treats the scene's two JSON columns differently, and this catches people out:

- **`layout`**: only the keys the compiler names are copied into the document (`walkable_areas`, `blocked_areas`, `spawn_points`, `scale_areas`, `shadow_spots`, `lights`, `flows`, `water_lights`, `critters`, `items`, `characters`, `bench`). **A new key in `layout` is dropped** unless you add it to `ScenarioCompiler::compile`.
- **`params`**: named keys are lifted to the scene's top level (`sky`, `atmosphere`, `weather`, `story`, `launcher`, `team_only`, `building`, music) and removed from `params`; **any other key stays under `scene.params`** in the document.

So, for a new scene-level attribute:

1. `types.ts`: the field on `Scene`, `[ext]`, documented.
2. `ScenarioCompiler::compile`: lift it from `params` (and add it to the `array_diff_key` list that removes lifted keys) or from `layout`. `ScenarioDecompiler`: put it back in the same column, so export and import keep it.
3. `normalizeScenario` if it needs a default; `validate.ts` for its checks.
4. A system (or an existing one) that reads `rt.def.yourField`.
5. The editor: fields in `schema.ts` (`SCENE_FIELDS` or a list of its own) and, for something placed, `SceneModel.layout`/`setLayout` keys, the canvas drawing it, the outline listing it, the inspector's form and the **＋ Add** menu. `SceneModel.resize` should move it when a scene is resized.
6. Docs: `developers/extensions/scenes.md` or `atmosphere.md`.

Scenario-wide settings are easier: `scenarios.settings` is **spread at the top level** of the document, so a new key there needs only the type, the validator, the editor field (`SCENARIO_SETTINGS_FIELDS`) and the code that reads it. The same goes for the `settings` of items and characters, and the `params` of actions and labels.

## A new condition operator

1. `ConditionOperator` in `types.ts`.
2. `testCondition` in `packages/shared/src/variables.ts`.
3. `CONDITION_OPS` in `validate.ts`.
4. `ScenarioStore::ENUMS['conditions.operator']`.
5. `OPERATORS` in `apps/editor/src/schema.ts` (and `conditionText` in `describe.ts` if it needs words).
6. `docs/src/content/docs/developers/condition.md`, and tests.

## A new system variable

1. An entry in `SYSTEM_VARIABLES` in `packages/shared/src/variables.ts`, with its explanation (the editor lists them in that order; the `QL_` prefix makes it reserved automatically).
2. A provider: `this.vars.provide('QL_Thing', () => …)` in `GameContext`'s constructor for session-wide values, or in `PlayScene.create` for values that belong to the scene. Call `vars.touch('QL_Thing')` when a provider's value changes, so listeners (objectives, labels) update.
3. Docs: `developers/variable.md`.

## A scene system

```ts
// apps/client/src/systems/FootstepsSystem.ts
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

export class FootstepsSystem implements SceneSystem {
  constructor(private rt: SceneRuntime) {}
  create() { /* add display objects to this.rt.scene; read this.rt.def */ }
  update(time: number, delta: number) { const me = this.rt.system(LocalPlayerSystem).position; /* … */ }
  variablesChanged() { /* re-test conditions */ }
  destroy() { /* remove what create() made */ }
}
```

1. Write the class; read the scene from `rt.def`, reach other systems with `rt.system(Class)`, read the room from `rt.ctx.connection.state` every frame.
2. Add it to `sceneSystems` in `systems/index.ts`, at the right place in the order (after what it reads in the same frame).
3. If the engine must reach it, add a control on `ActionHost` and set it in `PlayScene.create`.
4. If it needs on-screen HTML, go through `UiPort` (below), never the DOM.
5. A headless test: systems run under the fake Phaser.

## A game feature

1. A class implementing `GameFeature` (`start(ctx)` returns a function that undoes everything: timers, listeners).
2. Add it to `gameFeatures()` in `features/index.ts`.
3. UI through `ctx.ui`; state through `ctx`; the room through `ctx.connection.on(...)` and its methods.

## A new UI method

1. The method on `UiPort` (`apps/client/src/ui/UiPort.ts`), with the types it needs.
2. Its DOM implementation in `Ui.ts` (or a helper file beside it), and styles in `ui.css`.
3. A no-op or recording version in `HeadlessUi` (`apps/client/test/harness.ts`), so tests compile and can assert on it.

## A new client-to-server message

Example: `wave {to}`.

1. `packages/shared/src/protocol.ts`: a name in `C2S` (and `S2C` for a reply), and the message interfaces.
2. The rule in `World` (`packages/shared/src/world.ts`) if it changes state or needs checking, with a unit test in `world.test.ts`.
3. `apps/server/src/rooms/ScenarioRoom.ts`: an `onMessage(C2S.Wave, …)` handler that finds the world (`this.world(client)`), calls the rule, and replies or broadcasts (`sendTo`, `world.audience`). Rate-limit anything a player can repeat.
4. `apps/client/src/net/Connection.ts`: a method on `GameConnection` (`wave(to) { this.send(C2S.Wave, { to }) }`); for a reply, an entry in `ConnectionEvents` and `onMessage` in `OnlineConnection`.
5. **`OfflineConnection.send`**: handle it the way the room would. Previews and the headless tests use this path.
6. `docs/src/content/docs/developers/protocol.mdx`.

## A new call from the game server to the API

1. A method on `Backend` (`apps/server/src/backend/Backend.ts`).
2. `ApiBackend`: the request to `/api/internal/...`. `FileBackend`: a file-based version, or a refusal that says the API is needed.
3. A route in the `internal` group of `apps/api/routes/api.php` and a method on `InternalController`, calling a core class (not putting rules in the controller).
4. Tests on both sides.

## A new API route for the editor or the game

1. The rule in a core class (`ScenarioStore`, `ClassStore`...) over PDO, throwing `StoreError` for refusals.
2. The route in the matching `*Api` class's `route()` (and its doc comment, which is the route list).
3. Usually nothing in `routes/api.php`: the catch-all routes (`editor/{path}`, `teach(/.*)`, `builds/{path}`, `district/{path}`...) already hand everything to the `*Api` class. A new top-level path needs a route and a controller method.
4. The dev server (`apps/api/dev/server.php`) if the path is outside what it already passes on.
5. The client method (`apps/editor/src/api.ts` or `apps/client/src/net/Api.ts`).
6. A plain-PHP test in `apps/api/tests/`.

## A new database column or table

1. A migration in `apps/api/database/migrations/`, **idempotent** (`if (Schema::hasTable(...)) return;`, `Schema::hasColumn` for added columns).
2. The SQLite form: `ScenarioStore::SCHEMA` for the scenario tables (which `sqliteSchema()` reads), or the owning store's `sqliteSchema()` for others. The dev server and every PHP test use it.
3. For a scenario column: `SCHEMA` (so it can be written), `IMPORT_DEFAULTS` if it needs one, the compiler and decompiler.
4. A test that writes and reads it on SQLite; `npm run test:laravel` for MariaDB-specific SQL.

## A new editor page

1. A view function in `apps/editor/src/views/`, returning an `HTMLElement` and redrawing on `store.onChange`. Use `listPage`, `chip`, `tileActions` from `views/kit.ts`, and `openPanel` for editing one thing.
2. For a scenario tab: an entry in `TABS` (`views/workspace.ts`: address, label, icon name) and a `case` in its `page()` switch. Icon names are the keys of `ICONS` in `packages/shared/src/icons.ts`; an emoji not used before also needs `tools/make-twemoji-map.mjs` run again.
3. For a page outside a scenario: a fragment in `route()` in `main.ts`, and a link in `PAGES` if it belongs in the header.
4. A Playwright test in `apps/editor/test/`.

## A new kind of editor field

1. A name in `FieldKind` and any options it needs on `Field` (`apps/editor/src/fields.ts`).
2. A `case` in `control()` that draws it and calls `commit(key, value, field)`.
3. Use it in `schema.ts`.

## A new generation step or method

See [Generation methods and traces](/docs/developers/generation-methods/): subclass `GenerationMethod`, override `steps()` (or the `make*()` hooks), write a `Step` with `name()`, `stage()` and `run(GenerationRun $run)`, and register the method in `GenerationMethods::BUILT_IN` or through `QBL_GEN_METHODS`.

## A new text-to-speech service

See [Characters' voices](/docs/developers/voices/): a class implementing `SpeechEngine` with a static `fromConfig()`, an entry under `engines` in `config/qbl_speech.php`, and what each catalog voice is on it in `resources/speech/voices.json`.

## A docs page

1. A `.md` or `.mdx` file under `docs/src/content/docs/`, with `title`, `description` and optionally a `host` (one of the cast: `asimov`, `buck`, `gil`, `lucy`, `mallory`, `pinta`, `riona`, `sam`, `val`).
2. Its entry in the `sidebar` of `docs/astro.config.mjs`.
3. Links as `/docs/...` with a trailing slash. `npm run build` in `docs/` fails on a broken link or anchor.
4. If you moved a page, add the old address to `redirects`.
