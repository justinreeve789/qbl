---
title: "The editor: architecture (apps/editor)"
description: "How the scenario editor is built without a UI framework: routing by fragment, the Api client, the Store and its ordered save queue, undo and redo, forms generated from field lists, the DOM helpers, panels and pages, and the clipboard."
host:
  who: asimov
  says: "No framework, no build-time magic: a store that saves every change in order, and forms that are lists of fields. Learn those two and the rest of the editor reads easily."
  side: right
---

The editor is about 20,000 lines of TypeScript and DOM with **no UI framework**. Every page is a function that returns an `HTMLElement`, redrawn when the store changes. Forms are generated from lists of fields in `schema.ts`. It is served at `/editor/` and talks only to `/api/editor`, `/api/editor/library`, `/api/editor/generations` and a few other API routes.

:::tip[In short]
- **`main.ts`** routes by the URL fragment (`#/s/12/scene/40`). It keeps one `Store` for the open scenario.
- **`Store`** holds the scenario's rows (the bundle) in memory. Every change is applied locally at once, then sent to the API **in order**, one request at a time. A refused change reloads everything.
- **`History`** records each change's before and after; **Ctrl+Z** sends the "before" rows back in one `restore` request.
- **`schema.ts`** says what can be edited, as data; **`fields.ts`** turns a list of fields into a form. A new attribute is usually one line in `schema.ts`.
- Changes are **values** (redraw lists and the canvas, keep forms) or **structural** (rows added or removed, or a change that alters which fields exist: rebuild forms too).
- The editor never imitates the game: **Test** opens the real client on a draft, and the infobox preview uses the game's own drawing code.
:::

## Files

```text
apps/editor/src/
  main.ts              header, sign-in, routing, keyboard undo and shortcuts
  config.ts            gameUrl, previewUrl, playUrl
  api.ts               every call the editor makes; row types (Row, Bundle, Table...)
  store.ts             the open scenario in memory; the ordered save queue
  history.ts           undo and redo
  schema.ts            what can be edited: one list of fields per thing; the 30 action types
  fields.ts            form(): a list of fields as a form; field kinds; tidy helpers
  describe.ts          names and one-line summaries of rows (actions, events, media, conditions)
  dom.ts               h(), s(), clear(), redraw(), toast(), fold(), help() ...
  panel.ts             pop-up panels (modal <dialog>) for editing one thing
  clipboard.ts         copy, cut and paste of scenes, events and actions
  shortcuts.ts         Delete, Ctrl+C/X/V for the scene editor and the scene map
  actionPicker.ts      the "add an action" menu, grouped
  mediaPicker.ts       choosing a picture or video (or uploading one)
  soundPicker.ts       choosing a sound: a file, a recording or a built-in sound
  mediaCategories.ts   media tabs (backgrounds, sprites...) by use
  characters.ts        character helpers: animations, frames, previews
  generations.ts       the AI generator's progress tracker and bar
  rename.ts            variable name rules for renaming
  apng.ts              animated PNG conversion on upload
  icons.ts             interface icons (Twemoji)
  session.ts           the signed-in role, for views that need it
  rich/                the infobox content editor (see the next page)
  views/               every page and panel (see the next page)
  editor.css           all the styles
```

## Routing: `main.ts`

The address is kept in the fragment, so the server needs no rules for it:

Fragment | Page
-------- | ----
`#/` | The scenarios you can edit (`scenarioListView`)
`#/new` | The same, with the "new scenario" dialog open
`#/classes` | Your students and their assignments (`classesView`)
`#/generate` | The AI mission generator (`generateView`)
`#/plan` | Your plan and credits (`planView`)
`#/library[/{slug}]` | The asset library's admin screen, for content admins and admins (`libraryAdminView`)
`#/district[/{id}]` | The district admin panel (`districtView`)
`#/s/{id}` | One scenario: its scenes
`#/s/{id}/{tab}` | One of its pages: `scenes` (the default), `media`, `variables`, `items`, `characters`, `objectives`, `glossary`, `moves`, `shop`, `settings`, `publish` (`TABS` in `views/workspace.ts`)
`#/s/{id}/scene/{sceneId}` | The scene editor

`route()` runs on every `hashchange`. It counts turns (`routing`) so a slow load for an address the user has already left is ignored. Who sees what:

- not signed in: `loginView`;
- signed in as a district admin only: the district panel;
- signed in, but not staff: `loginView` again, saying which account the browser is signed in with (the game and the editor share one sign-in, so a student or guest sign-in left from playing is the usual cause);
- staff: everything else. The scenario pages make a `Store` when the scenario changes and keep it while you move between its pages.

`main.ts` also draws the header (site links from `siteLinks(role)`, the editor's own pages, "Saving…", the generator's progress chip, the account) and owns two keyboard handlers: undo and redo, and the clipboard shortcuts.

## `api.ts`

`Api` wraps `fetch('/api' + path)` with the bearer token (shared with the game in `localStorage`), JSON, and an `onBusy` callback that drives the header's "Saving…". `ApiError` has the status and the server's message.

The types every view uses:

```ts
type Table = 'shop_items' | 'media' | 'variables' | 'items' | 'characters' | 'scenes' | 'events' | 'actions' | 'conditions' | 'labels';
interface Row { id: number; [column: string]: unknown }
interface Bundle extends Record<Table, Row[]> { scenario: Row }
type RestoreStep = {op: 'insert', table, row} | {op: 'update', table, id, attrs} | {op: 'delete', table, id} | {op: 'scenario', attrs};
```

Methods by area: scenarios (`list`, `create`, `duplicate`, `importZip`, `exportZip` (through a signed export link), `bundle`, `patchScenario`, `changeCode`, `publish`, `preview`, `deleteScenario`), rows (`createRow`, `updateRow`, `deleteRow`, `upload` for a media file, `copy`, `restore`), voices, the library, the generator, classes and reports, billing, the district panel, student builds, and the account (`login`, `me`, `rename`, `changePassword`, `forgotPassword`, `signOut`).

## The `Store`

`store.ts`. The single source of truth for the open scenario.

### Reading

- `bundle`: every row, as the API sent it and as changed since.
- `scenario`, `settings` (the scenario's `settings` column).
- `rows(table)`, `byId(table, id)`, `where(table, column, value)`.
- `unpublished`: true when there are changes players do not have yet.
- `onChange(listener)`: `listener(structural)` after every change.

### Writing

Method | What it does
------ | ------------
`add(table, attrs)` | `POST rows/{table}`; the new row is pushed into the bundle once the API answers (it needs the id)
`patch(table, id, attrs, structural?)` | Applies locally **at once**, emits, then queues `PATCH rows/{table}/{id}`; reloads on refusal
`remove(table, id)` | `DELETE rows/{table}/{id}`, then **reloads** (the API deletes what depended on the row)
`patchScenario(attrs)`, `patchSettings(attrs)` | The scenario row, or its `settings` merged
`paste(rows, keepIds?)` | Copies of rows in one request (`POST copy`); with `keepIds` (pasting what was cut) the rows go back under their own ids through `restore`, or are copied if an id is taken
`addFromLibrary(asset, name?)` | The server copies an asset's files and makes its character or item
`takeIn()` | Reload after something was added elsewhere (a generated scene), recorded as one undo step
`changeCode(code)` | Not an unpublished change: it applies to players at once
`publish()` | `POST publish`
`live(fn)` | Make changes as a slider is dragged (see below)
`settled()` | Resolves when everything queued has been sent
`undo()`, `redo()` | See below

### The save queue

```text
 patch(row A) ──▶ local copy changed ──▶ emit(false) ──▶ views redraw
        └──▶ queue: ─[PATCH A]─▶ ─[POST B]─▶ ─[PATCH A']─▶ …   (one at a time, in order)
```

- **`send(change)`** chains every request on `this.queue`. Changes reach the server in the order they were made, so "add an action, then set its text" can never arrive the other way round.
- **Coalescing.** If the last queued request is a patch of the same row and has not been sent yet, a new patch is merged into it (`coalesced`). Typing fast into one field sends one request per pause, not one per key.
- **`live()`.** Inside `store.live(() => …)`, patches of a row wait until 150 ms (`PATCH_GAP`) after that row's last request. A slider drag sends a few requests with the latest value while the canvas follows every step. The wait counts as "Saving…".
- **Failure.** A refused request shows the server's message as a toast. `patch` then reloads the bundle, so the screen shows what the database holds.

### Values and structural changes

`emit(structural)`:

- **`false`, a value change**: lists, summaries and the canvas redraw; forms are left alone, so the field being typed in keeps its focus and caret.
- **`true`, a structural change**: rows were added or removed, everything was reloaded, or the change alters which fields exist (an action's type, a hotspot's kind, a field marked `structural: true`). Forms are rebuilt.

Getting this wrong shows up as a form that loses focus on every key (structural when it should not be) or a form that does not show a field that should now appear (not structural when it should be).

## Undo and redo

`history.ts`, with the keyboard handling in `main.ts`.

- **Steps.** Everything done between one gesture and the next (a pointer down, a drop, a focus change, a key press that is not a modifier or an undo key) is one step: adding a hotspot and the actions that come with it, a whole slider drag. Keys typed into one field within 1.5 s are one step (`TYPING_GAP`, keyed by row and columns). The last 50 steps are kept (`HISTORY_LIMIT`).
- **Recording.** `Store` calls `history.take(typing?)` when a change is made and `history.record(step, change)` once the API accepts it, with each row's columns before and after (`noted` diffs against `saved`, a copy of the rows as last saved, because forms may change a row's lists in place before patching). Deletes and pastes record the difference between the whole bundle before and after (`diff`).
- **Undoing.** `history.undo()` returns the step's rows as they were before, as `RestoreStep`s in parent-to-child order (`ORDER`, the same as `ScenarioStore::CONTENT`). The store sends them in **one** `POST …/restore`; `ScenarioStore::restore` applies them in one transaction: re-inserts deleted rows under their own ids, deletes added ones, sets changed columns back. The answer is the whole bundle.
- **What clears history.** Deleting a media row deletes its file from disk, which cannot be undone, so the history is cleared.
- **Keys.** Ctrl+Z (Cmd+Z) undoes; Ctrl+Y and Ctrl+Shift+Z redo. In a text field that has been typed in since it was focused, the keys belong to the field; once it holds what it held when focused, they undo scenario edits again.

## Forms as data: `schema.ts` and `fields.ts`

Every form in the editor is a list of `Field`s drawn by `form(fields, values, commit, ctx)`.

```ts
interface Field {
  key: string; label: string; kind: FieldKind;
  hint?: string; placeholder?: string; options?: [value, label][];
  mediaType?: 'image' | 'audio' | 'video' | 'visual'; mediaCategory?; soundGroup?; soundKey?;
  sceneKey?: string; eventKinds?: string[]; eventHere?: boolean; bench?: ...;
  default?: boolean | string; min?; max?; step?; slider?: { min, max | 'scene', step? };
  structural?: boolean;          // changing it changes which fields show: rebuild the form
  wide?: boolean;                // full width
  when?: (values) => boolean;    // shown only when this holds
  locked?: (values) => { value, why } | null;
  spot?: { y: string; prompt: string };   // "Pick on the scene" for an x/y pair
}
```

Field kinds (`FieldKind`): `text`, `textarea`, `html` (the rich infobox editor), `number`, `bool`, `select`, `color`, `value` (a number when it looks like one, else text), `numbers` (comma-separated), `tristate` (yes, no, or absent), `media`, `scene`, `spawn`, `event`, `action`, `variable`, `item`, `character`, `animation`, `glossary`, `group`, `voice`, `bench`. Each is a `case` in `control()` in `fields.ts`.

`FormContext` is `{store, sceneId?, pickSpot?, spotScene?, characterId?}`: what pickers need to list the right things.

`schema.ts` holds the lists:

- **`ACTIONS: Record<ActionType, ActionDef>`**: for each of the 30 action types, a label, a one-line `about` for the menu, and its fields. `ACTION_GROUPS` groups them for the picker, in seven groups (talking and storytelling; boxes and words; characters and the player; pictures, video and sound; scenes, camera, weather and bench; timing and flow; rewards and progress); `ACTION_LOOK` gives each an icon and colour; `ACTION_COMMON` are the fields every action has (blocking); `actionDefaults(type)` and `starterConversation` give a new action its first values.
- **Fields for everything else**: `SCENARIO_FIELDS`, `SCENARIO_SETTINGS_FIELDS`, `SCENE_FIELDS`, `SCENE_MUSIC_FIELDS`, `LAYER_FIELDS`, `SPAWN_FIELDS`, `SCALE_AREA_FIELDS`, `SHADOW_SPOT_FIELDS`, `LIGHT_FIELDS`, `SKY_FIELDS`, `ATMOSPHERE_FIELDS`, `WEATHER_FIELDS`, `FLOW_FIELDS`, `WATER_LIGHT_FIELDS`, `ITEM_PLACEMENT_FIELDS`, `CHARACTER_PLACEMENT_FIELDS`, `EVENT_FIELDS`, `HOTSPOT_FIELDS`, `LABEL_FIELDS` (and `LABEL_SOLID`, `LABEL_HINT`, `LABEL_PULSE`...), `MEDIA_FIELDS`, `VARIABLE_FIELDS`, `ITEM_FIELDS`, `ITEM_SETTINGS_FIELDS`, `SHOP_ITEM_FIELDS`, `CHARACTER_FIELDS`, `CHARACTER_SETTINGS_FIELDS`, `MOVE_FIELDS`, `OBJECTIVE_FIELDS`, `WALK_FIELDS`, `OPERATORS`.

**Where a field's value is saved** depends on who draws the form. For actions (`views/actions.ts`), `media_id` and `blocking` are columns (`COLUMNS`); everything else goes into the action's `params` JSON, which the compiler spreads into the document. For scenes, layout lists go into `layout`, settings into `params`. For items and characters, most fields go into `settings`. [The data model](/docs/codebase/data-model/) lists them.

Helpers in `fields.ts`: `withValue(bag, key, value, field)` (sets or removes a key, respecting defaults), `parseValue`, `select`, `animationChoices` and `tidyAnimate` (which animations an animate action can choose for its target), and in `schema.ts` `tidyWalk` (drops attributes that do not belong to the new destination).

## Building blocks

- **`dom.ts`**: `h(tag, props, ...children)` makes an element (props: attributes, `class`, `on*` handlers, `null` to skip); `s()` the same for SVG; `clear(node, ...children)`; `redraw(container, ...children)` keeps scroll position; `toast(message, kind, action?)`; `confirmDelete`; `fold(key, title, open, ...children)` (a `<details>` that remembers whether it was open); `openOneAtATime`, `rememberOpen`; `help(text)`.
- **`panel.ts`**: `openPanel({key, kind, changes, title, body, tone, ...})` opens a modal `<dialog>` over the page for editing one thing (a media file, a character, an animation, a conversation). It lives on the document, so the page redrawing beneath it does not close it; it redraws its body on structural changes and its title on every change; it closes when what it edits is deleted (title or body returns null) or the address changes. Opening a panel that is already open brings it forward.
- **`views/kit.ts`**: what list pages are made of: `listPage`, `emptyState`, `chip`, `thumbButton`, `tileTitle`, `tileActions`.
- **`describe.ts`**: names and summaries: `mediaLabel`, `sceneLabel`, `eventLabel`, `EVENT_KINDS`, `params(row, column)` (a JSON column as an object), `actionSummary`, `actionLabel`, `actionValues`, `walkDestination`, `conditionText`.

## Clipboard and shortcuts

- **`clipboard.ts`** holds one clip per scenario (`hold`, `holding`, `pasted`, `onClipboard`, `clearClipboard`) and turns selections into rows: `sceneRows`, `eventRows`, `actionRows` (each with the conditions and labels that belong to them). Pasting goes through `Store.paste`, so references among the copied rows follow the copies (`ScenarioStore::copyRows`) and the whole paste is one undo step. `freeName` makes "Gate (2)"; `NUDGE` (40 px) offsets pasted things on the canvas.
- **`shortcuts.ts`**: `useShortcuts(element, target)` registers what Delete, Ctrl+C, Ctrl+X and Ctrl+V do in the scene editor and on the scene map; `keysBelongElsewhere` leaves the keys to text fields.

## Talking to the game

- **Test**: `previewUrl(id, sceneId?, debug?)` opens `/play?preview=…` in a tab named `qbl-preview`. See [the lifecycle](/docs/codebase/lifecycle/#4-the-author-tests-a-scene).
- **The infobox preview** imports the game's own `infoboxView` and `sanitizeHtml` (`rich/game.ts` re-exports them from `apps/client/src/ui/infobox/` and `ui/sanitize.ts`), so the preview is the box players get.
- **The profile dialog** is `packages/shared/browser/profile.ts`, shared with the missions page.

## Running and testing

`npm run dev:editor` runs the PHP dev API (`apps/api/dev/server.php` over SQLite in `.data/dev-api`, any email and password, always a teacher), the editor's Vite server and the game in authoring mode, all on http://localhost:5173 (the editor is proxied under `/editor/`). In Docker, the `app` container builds the editor into a volume the `editor` container serves.

`npm run test:editor` drives the real editor in headless Chromium (Playwright) against the dev API; see [Testing](/docs/codebase/testing/#the-editor).
