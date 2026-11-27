---
title: "Testing"
description: "Every test suite in the repository, how each one runs, the harnesses behind them (a fake Phaser and a headless UI, plain-PHP checks over SQLite, a real editor in headless Chromium), and which suites to run for which change."
host:
  who: asimov
  says: "Most of the tests play the real thing with one part swapped for a fake. Know which part, and you know what a green run proves."
  side: right
---

QuestLab's tests are fast and close to the real thing: the shared rules with fake hosts, the whole game played headlessly with a fake Phaser, the PHP core over in-memory SQLite, and the real editor in a headless browser against the dev API. There is no mocking framework; each suite has a small harness of its own.

:::tip[In short]
- `npm test`: the shared package and the headless game (seconds).
- `npm run typecheck`: every TypeScript program. The Docker build skips it, so run it yourself.
- `npm run test:api` and the other `test:*` scripts: plain PHP over SQLite, one script per area.
- `npm run test:editor`: Playwright, the real editor and the dev API (needs `npx playwright install chromium` once).
- `npm run test:laravel`: the same API through real Laravel (needs `composer install`).
- `npm run test:all`: everything except Laravel's own suite.
:::

## The suites

Command | What runs | Harness
------- | --------- | -------
`npm test -w @qbl/shared` | `packages/shared/test/*.test.ts` | Node's test runner (`tsx --test`), fake engine hosts and clocks
`npm test -w @qbl/client` | `apps/client/test/*.test.ts` | A fake Phaser, a headless UI, the real game logic offline
`npm test` | Both of the above |
`npm run typecheck` | `tsc --noEmit` for shared, server, client and editor (shared is built first) |
`npm run test:api` | `apps/api/tests/store.php`: the store, the compiler, codes, publishing, the editor API, uploads | Plain PHP, `check()` and `same()`, `sqlite::memory:`
`npm run test:progress`, `test:classes`, `test:activity`, `test:porting`, `test:billing`, `test:district`, `test:api-v1`, `test:library`, `test:speech`, `test:walk`, `test:builds` | One script each in `apps/api/tests/` | The same
`npm run test:generation`, `test:story-generation`, `test:scenes`, `test:scene-generation` | The generator with a stand-in model and placeholder pictures; the result is validated and played | `tests/fixtures/generation/FakeModel.php`, 2 GB memory limit
`npm run test:editor` | `apps/editor/test/*.test.ts` | Playwright and headless Chromium against the dev API (`test/servers.ts`)
`npm run test:laravel` | `apps/api/tests/Feature/*Test.php` through `php artisan test` | Laravel's test runner, real middleware and routes
`npm run validate -- file.json` | The validator on a document |
Docs | `npm run build` in `docs/` | Fails on broken links and anchors

## The shared package

One file per area: `shared.test.ts` (the engine, variables, conditions, the validator, normalising), `world.test.ts`, `roaming.test.ts`, `conversation.test.ts`, `launch.test.ts`, `story.test.ts`, `builds.test.ts`, `bench.test.ts`, `characters.test.ts`, `walk-cycle.test.ts`, `formula.test.ts`, `infobox.test.ts`, `locate.test.ts`, `rename.test.ts`, `site.test.ts`, `sky.test.ts`, `sorting.test.ts`, `speech.test.ts`, `water-light.test.ts`, `narration.test.ts`, `main-layer.test.ts`, `additions.test.ts`.

The engine tests implement `EngineHost` with a fake whose `delay` and presented actions settle on a manual clock, so ordering, blocking and cancelling can be checked step by step. `World` tests give it plain `Map`s and a fake `now`.

## The game, headless

`apps/client/test/`:

- **`fakePhaser.ts`**: stands in for Phaser. `FakeWorld` holds a manual clock (`schedule`, advancing time), and the fake accepts any Phaser call. `settle()` lets promises run.
- **`harness.ts`**:
  - **`HeadlessUi`** implements `UiPort` with no DOM. It records what the game asked for (`texts`, `images`, `toasts`, `boxes`, `checklist`, `statusText`, `hud`...) and lets a test answer: each open infobox (`OpenInfobox`) has `choose(index, answers?)` and `dismiss()`.
  - **`loadScenario(name)`** reads and normalises `scenarios/<name>.json`.
  - **`Game`** plays a whole scenario offline with the real `GameContext`, `OfflineConnection`, `PlayScene`, systems, presenters and features. It has `sceneName`, `position`, `box`, `var(name)`, `checklist`, and actions: `wait(ms)`, `hold(keys, until)`, `walkOff(direction, toScene)`, `click(x, y)`, `walkTo(x, y)`, `choose(label, answers?)`, `dismiss()`.
- **`fakeColyseus.ts`**: a fake room for connection tests.

`quest.test.ts` plays the Wilting Stream quest from landing to report; others cover conversations, the bag, builds, critters, launching, narration, riding, the science lab, generated missions and stories, rejoining, system variables, water light and more.

```ts
// A sketch: scenarios/my-test.json is a scenario of your own, and the numbers are its coordinates.
import { Game, loadScenario } from './harness';

test('a locked gate says so', async () => {
  const g = new Game(loadScenario('my-test'));
  await g.walkTo(800, 600);
  await g.click(820, 560);
  assert.match(g.box!.html, /locked/);
  await g.dismiss();
  assert.equal(g.var('gate_open'), 0);
});
```

:::caution[What these tests cannot prove]
The fake Phaser accepts any call, so a headless test proves the game's logic and wiring, not that real Phaser accepts the same calls. A change to how something is drawn still needs a look in a browser (`npm run dev`, `?debug` for outlines).
:::

## The PHP core

The scripts in `apps/api/tests/*.php` `require` the classes they need (no Composer autoload), build a `PDO('sqlite::memory:')`, create the tables from each store's `sqliteSchema()`, and check results with two helpers:

```php
check(bool $ok, string $what);                     // a failure prints "FAIL: …"
same(mixed $actual, mixed $expected, string $what); // with what it got and expected
```

They exit non-zero if anything failed. They exercise the **same classes** Laravel runs, through their `*Api` front doors as well as directly (for example `EditorApi::handle('PATCH', 'scenarios/1/rows/actions/5', …)`), and compile and validate what they build. `tests/Feature/*Test.php` cover what only real Laravel has: middleware, routes, Sanctum, Google sign-in, mail, the queue.

## The editor

`apps/editor/test/servers.ts` `startSite(env?)`: bundles the editor from source with esbuild, starts the PHP dev API on a fresh SQLite folder, and serves both on one address, as in production. The tests then drive Chromium with Playwright: a teacher signs in, builds scenes by clicking, typing and dragging, publishes, and the published JSON is played by the game's headless harness.

Files by area: `editor.test.ts` (the main walkthrough), `scene-map.test.ts`, `scene-tools.test.ts`, `infobox-editor.test.ts`, `conversation.test.ts`, `action-cards.test.ts`, `action-picker.test.ts`, `undo.test.ts`, `history.test.ts`, `clipboard.test.ts`, `publish-check.test.ts`, `variable-rename.test.ts`, `sliders.test.ts`, `spot-pick.test.ts`, `sort-line.test.ts`, `media-picker.test.ts`, `sound-picker.test.ts`, `webp-uploads.test.ts`, `voices.test.ts`, `routines.test.ts`, `walk-maker.test.ts`, `science.test.ts`, `classes.test.ts`, `student-builds.test.ts`, `district.test.ts`, `generator.test.ts`, `scene-generator.test.ts`, `library-admin.test.ts`, `questlab-assets.test.ts`, `porting.test.ts`, `profile.test.ts`, `staff.test.ts`, `change-code.test.ts`, `additions.test.ts`, `animation-choices.test.ts`. Set `QBL_SHOTS` to a folder to keep screenshots from the scene map test.

## What to run for which change

You changed | Run at least
----------- | ------------
`packages/shared` | `npm test`, `npm run typecheck`
`apps/client` | `npm test -w @qbl/client`, `npm run typecheck`, and look in a browser
`apps/server` | `npm run typecheck`, `npm test`; play with two windows (`npm run dev`)
`apps/editor` | `npm run test:editor` (or the one file you touched: `cd apps/editor && npx tsx --tsconfig tsconfig.test.json --test test/undo.test.ts`), `npm run typecheck`
`ScenarioStore`, the compiler, `EditorApi` | `npm run test:api`, `npm run test:porting`, `npm run test:editor`
Classes, rewards, activity, builds | `npm run test:classes`, `test:progress`, `test:activity`, `test:builds`
The generator | `npm run test:generation` and the other generation suites
Billing, districts, the public API | `npm run test:billing`, `test:district`, `test:api-v1`
Routes, middleware, auth | `npm run test:laravel`
A scenario document | `npm run validate -- path.json`
The docs | `npm run build` in `docs/`
