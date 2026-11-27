---
title: "The editor: pages and views"
description: "Every page and panel of the editor and the code behind it: the workspace, the scene editor (model, canvas, outline, inspector), the scene map, events, actions and conditions, conversations, the rich infobox editor, the library pages, voices, publishing, and the pages outside a scenario."
host:
  who: asimov
  says: "Each page is a function that returns an element and redraws when the store changes. Here is which function draws what, and where its data is kept."
  side: right
---

This page goes through `apps/editor/src/views/` and `apps/editor/src/rich/`. [The editor's architecture](/docs/codebase/editor/) explains the `Store`, forms and panels they are built on.

:::tip[In short]
- **`workspace()`** draws one scenario: a header (title, publish state, Test, Record voices, Publish) and the page for the tab.
- **The scene editor** has three panes: the **outline** (everything in the scene), the **canvas** (the scene to scale, everything draggable) and the **inspector** (the form for the selection). `SceneModel` reads and writes the scene's JSON columns; `Selection` says what is selected.
- **Events and actions** are rows (`events`, `actions`, `conditions`, `labels`). An action's type-specific values live in its `params` JSON.
- **The scene map** is a graph of scenes and the jumps between them, laid out from each scene's `params.editor_map`.
- **The infobox editor** (`rich/`) edits HTML as it looks, with blocks, and previews it with the game's own code.
- Scenario-wide lists (media, variables, items, characters, objectives, glossary, moves, shop) are **card pages** whose cards open **panels**.
:::

## The workspace

`views/workspace.ts`, `workspace(store, {tab, sceneId}, go)` returns `{element, dispose}`.

- The header: the scenario's title, its state (`Draft`, `Unpublished changes`, `Published`, from `store.unpublished` and `published_at`), **▶ Test** (`previewUrl`), **Record voices** (`recordVoicesButton`) and **🚀 Publish** (`checkAndPublish`, which goes to the Publish page if there is anything to fix).
- The tab bar from `TABS`, and the page for the tab: `scenesPage`, `mediaPage`, `variablesPage`, `itemsPage`, `charactersPage`, `objectivesPage`, `glossaryPage`, `movesPage`, `shopPage`, `settingsPage`, `publishPage`; or, with a scene id, `sceneEditor`.
- It listens to the store and redraws the page on structural changes, the header on every change. `dispose` stops listening.

## The scene editor

`views/scene/`. Opened at `#/s/{id}/scene/{sceneId}`.

### `SceneModel` (`model.ts`)

Reads and writes the parts of a scene kept as JSON in its row, through the store:

- `row`, `exists`;
- `layers(which)` / `setLayers(which, layers)` for `background_media` and `foreground_media` (bare media objects from older documents are read as layers);
- `layout(key)` / `setLayout(key, list)` for the lists in the `layout` column: `spawn_points`, `items`, `characters`, `walkable_areas`, `blocked_areas`, `scale_areas`, `shadow_spots`, `lights`, `flows`, `water_lights`;
- `bench()` / `setBench()` / `setBenchPart()` for `layout.bench`;
- `events(kind?)`: the scene's event rows, ordered;
- `resize(from, width, height)`: changes the scene's size and moves everything in it to match (areas, spawn points, lights, flows, water light shapes...).

`Selection` is a union: `scene`, `layer`, `event`, `spawn`, `item`, `character`, `area`, `scale`, `shadow`, `light`, `flow`, `water_light`, `bench`, `bench-vessel`, `bench-tool`.

### `sceneEditor()` (`sceneEditor.ts`)

Puts the panes together and owns the selection. `drawAll()` redraws the outline, the inspector and the canvas; a store change redraws the canvas (and the outline and inspector on structural changes). The **＋ Add to scene** menu (`ADD_MENU`) adds:

What | How
---- | ---
Hotspots (click, walk-in) | `addEvent('hotspot', …)` at the centre of the view
Exits along an edge | A walk-in hotspot spanning the edge (`position_x` or `position_y` null) with a `jump` action to the next scene (`addEdge`)
Start, end, indirect events | `addEvent(kind)`
Spawn points, items, characters, areas, scale areas, shadow spots, lights, flows, water lights | `addToLayout(key, entry)`
Bench containers and tools | `addToBench`
Layers | A new entry in `background_media` or `foreground_media`

`selectOnOpen(sceneId, selection)` lets the scene map open the editor with something already selected.

### `SceneCanvas` (`canvas.ts`)

The scene's picture: layers as images and everything placed drawn over them in SVG. Hotspots, labels, spawn points, items, characters, area corners, light and flow boxes, the positions of "image in scene" and spritemap actions can all be dragged. **The canvas only draws: it keeps nothing the store does not have.** Its host tells it the selection and is told about selections, drags and the pointer position. `pick(request)` lets a form choose a spot by clicking (the "Pick on the scene" button of fields with `spot`); `cancelPick()`; `natural(url)` reports an image's natural size (for "Make the scene that size"); `size()`; `draw()`. Drags use `store.live()` so they save as they go.

### `outline()` and `inspector()`

- **`outline.ts`** lists everything in the scene by group (layers, events by kind, spawn points, items, characters, areas, bench things...), each with an icon and a colour (`LOOK`). Layers can be dragged into another order.
- **`inspector.ts`** draws the form for the selection: the scene's own settings (`SCENE_FIELDS`, music, sky, atmosphere, weather, story, launcher, company, group, building), a layer, an event (`eventPanel`), a placed thing, an area, a light, a bench part (`benchPanels.ts`), the building settings (`buildingPanel.ts`). `startBench(model)` switches a scene's bench on.

Beside them: `sceneClipboard.ts` (copy, cut and paste of what is selected on the canvas, including JSON list entries), `spotPicker.ts` (`pickSpotInPopup`, choosing a spot in a pop-up of any scene, for forms not beside the canvas, such as a routine's steps), `waterLightPreview.ts` (underwater light on the canvas with the game's own shaders, one WebGL canvas per light kept across redraws), `benchPanels.ts` (`freshBenchId`, `withoutVessel`, the bench forms).

## Events, actions and conditions

- **`eventPanel(ctx, event, refresh, onDeleted)`** (`eventPanel.ts`): one event: its kind, for hotspots where and how (position, radius, click or walk-in, `once`, reveal), conditions, labels, audience, overridable and block hotspots, and its actions.
- **`actions.ts`**: the action list of an event. Each action is a card that opens one at a time (`open`, kept outside the view so a redraw does not close it). The card's form is `ACTIONS[type].fields`; values are committed to the `media_id` and `blocking` columns or to `params`. Changing the type resets `media_id` and `params` (`startingParams`). Infobox buttons (`call_to_actions`) are edited in the card, each with its own action and conditions. Cards can be ticked to copy, cut, delete and paste (`pickedActions`, `copyActions`, `pasteActionsInto`, `deleteActions`), reordered, duplicated, and found from elsewhere (`revealAction`).
- **`conditions.ts`**: `conditionList(source, ctx)`: "variable operator value" rows, all of which must hold. Two adapters: `rowConditions(ctx, owner, ownerId)` for conditions kept as rows (events, actions, items, characters) and `inlineConditions(...)` for conditions kept inside JSON (infobox buttons, objectives, conversation lines).
- **`conversation.ts`**: a conversation is one action whose lines are kept inside it. `conversationMap(ctx, actionId)` draws the tree in the action's card, branch by branch; `openConversation(ctx, actionId, lineId?)` opens the panel that lists every line on the left (in an order the author sets) and edits one on the right: who says it, what, and what comes next (choices leading to lines, or the next line). It uses `reachableLines` and the other rules in `packages/shared/src/conversation.ts`.
- **`routine.ts`**: `gettingAround(ctx, row)`: a character's routine (walk, wait, say, animate, set a variable), for characters that walk around on their own.

## The scene map

`views/sceneMap/`. The Scenes page shows scenes as **Cards** or a **Map**.

- **`graph.ts`** (no DOM): `scenesInOrder`, `startScene`, `hotspotSide` (which edge an exit hotspot is on), `sceneExits(store)` (every way from one scene to another: walk-ins, clicks, events, infobox buttons, with whether a condition guards it), the layout (`BOX` size, places from `params.editor_map`, "Arrange for me" from the start scene) and making and removing links (an exit on the facing edge, arriving at the spawn point nearest the opposite edge, and optionally the way back).
- **`sceneMap.ts`**: `sceneMap(ctx, open)`: boxes and arrows in SVG. Drag a box to move it (saved in its `params.editor_map`); drag a box's **+** onto another to link them, or onto empty space to make a new scene; click an arrow to see and change its exits; scenes not reachable from the start and exits that go nowhere are pointed out.

## The infobox editor: `rich/`

Infobox content is one HTML string (`content` in the action's params); richer things are HTML marked with `data-qbl` (see `packages/shared/src/infobox.ts`).

File | What it does
---- | ------------
`editor.ts` | `richEditor(options)`: the content edited as it looks: formatted text, and blocks between paragraphs inserted with ＋ Insert or by dropping or pasting files. ⤢ Designer opens it large with a live preview; `</>` shows the HTML, which is what is saved
`model.ts` | HTML ↔ editable text and blocks: `parse`, `blockOf`, `blockHtml`, `serialize`, `heldMedia`, `words`
`blocks.ts` | The kinds of block (`BLOCKS`: picture, gallery (slideshow), video, audio, callout, reveal and flip cards, answer boxes, controls (sliders, switches, wheels), maths, calculations, graphs, page breaks), `newBlock`, `editBlock` (each block's pop-up), `miniEditor`
`pickers.ts` | Choosing or uploading media (`upload`, `mediaGrid`, `pickMedia`), variables (`pickVariable`) and glossary words (`pickWord`)
`preview.ts` | The box as a player sees it, drawn by the game's own code over a stand-in for the scene
`game.ts` | Re-exports the game's `infoboxView` and `sanitizeHtml`, so the editor draws and cleans HTML exactly as the game does

## Scenario-wide pages

Page | File | Where its data is kept
---- | ---- | ----------------------
Scenes (cards and map) | `pages.ts` `scenesPage`, `sceneMap/` | `scenes` rows; start scene on the scenario
Media | `library.ts` `mediaPage`, `openMedia`; `sheet.ts` (sprite sheets: frames across and down, named animations, frames picked by clicking) | `media` rows; grid and animations in `params`
Variables | `variables.ts` `variablesPage`, `variableUses`; renaming follows every use (`renameVariable`) | `variables` rows
Items | `items.ts` `itemsPage`, `openItem`; `sortLine.ts` (where an item meets the floor) | `items` rows; most fields in `settings` (`sort_line` there too)
Characters | `characters.ts` `charactersPage`, `openCharacter`, `openAnimation`; `routine.ts`; `voices.ts` | `characters` rows; animations, size, voice, routine in `settings`
Objectives | `objectives.ts` | `scenario.settings.objectives`
Glossary, scene groups | `glossary.ts` `glossaryPage`, `sceneGroupsCard`, `sceneGroupControl` | `scenario.settings.glossary`, `settings.scene_groups`
Moves | `moves.ts` | `scenario.settings.moves`
Shop | `shop.ts` | `shop_items` rows
Settings | `pages.ts` `settingsPage` | Scenario columns and `settings`; also Export as a ZIP, Duplicate and Delete scenario
Publish | `pages.ts` `publishPage`, `checkAndPublish`; `issues.ts` | The code, the checks, publishing

### Publishing and issues

`publishPage` shows the player code (and changes it with `store.changeCode`, whose rules are `codeProblem`), runs the checks and lists errors and warnings. `issues.ts` makes each issue useful: `whereIs(ctx, doc, issue)` follows the issue's path (`locateIssue`) to a trail ("Scene 'Pond' › Hotspot 'Gate' › Action 3 › Button 2") and a field label, and `issueItem` makes a link that opens that place with the field revealed (`flushReveal`).

### Voices

`voices.ts`: `voiceSection(ctx, row)` gives a character a voice from the server's catalog (`tts_voice`); `narratorPicker` chooses the scenario's narrator; `recordVoicesButton` and `recordAllButton` call `POST …/voices/record` a few lines at a time until everything is recorded. The server side is on [Other API subsystems](/docs/codebase/subsystems/#voices).

### The asset library in a scenario

`questlab.ts`: "Add QuestLab Assets", the asset library as cards on the Characters and Items pages. "Add to scenario" calls `store.addFromLibrary`; `keepInLibraryButton` lets a content admin keep one of the scenario's characters or items in the library.

## Pages outside a scenario

Page | File | API
---- | ---- | ---
Sign-in, scenario list, new scenario | `home.ts` (`loginView`, `scenarioListView`) | `/api/auth/*`, `/api/editor/scenarios`
Classes: students, assignments, teams, reports | `classes.ts`, `reports.ts` (`reportView`, `reportCsv`), `studentBuilds.ts` | `/api/teach/*`, `/api/builds/teach`
The AI generator | `generate.ts`, `sceneGenerate.ts`, `../generations.ts` (the tracker that follows runs from every page) | `/api/editor/generations`
Plan and credits | `plan.ts` | `/api/billing`
The asset library's admin screen | `libraryAdmin.ts` | `/api/editor/library`
The district admin panel | `district.ts` | `/api/district`

## Tests for views

`apps/editor/test/` has one Playwright file per area (`editor.test.ts` builds a two-scene scenario by clicking and dragging, publishes it, and plays the result in the game's headless harness; `scene-map.test.ts`, `infobox-editor.test.ts`, `conversation.test.ts`, `undo.test.ts`, `publish-check.test.ts` and more). See [Testing](/docs/codebase/testing/#the-editor).
