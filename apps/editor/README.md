# QBL editor

The web application teachers and content creators use to build scenarios. It is served at
`/editor/` from its own container and talks to the Laravel API under `/api/editor`.

It is plain TypeScript and DOM, with no UI framework: a few hundred lines of helpers
(`dom.ts`, `fields.ts`) and one list of fields per thing that can be edited (`schema.ts`).

## What it does

- **Scenarios**: list the ones you may edit, create one. A new scenario gets a code of 16
  random letters (changeable on the Publish page) and a first scene.
- **Scenes**: create, order, delete, choose the start scene. The page shows scenes as **Cards**
  or as a **Map** (a switch at the top; each browser remembers its choice). On the map every scene
  is a box and every jump an arrow, coloured by how players take it (walk in, click, an event or
  an infobox button) and dashed when a condition guards it. Boxes are dragged to lay the mission
  out (their places are kept in each scene's `params.editor_map`, so they travel with the
  scenario). Dragging a box's **+** onto another box links them: a walk-in exit on the edge that
  faces the other scene on the map, arriving at the spawn point nearest the opposite edge, and
  (with "Link both ways") the way back. Dropping the **+** on empty space makes a new scene there.
  Clicking an arrow shows its exits, to change where they go or where players arrive, remove them,
  or open them in the scene editor; the pencil on a box opens the scene. The map points out
  scenes players cannot reach from the start and exits that go nowhere. "Arrange for me" lays
  the map out from the start scene, each scene beside the edge that leads to it.
- **Scene editor**: the scene drawn to scale with everything in it. Background and foreground
  layers (stretched, or repeated with drift and parallax), walkable and blocked areas, spawn
  points, placed items and characters, hotspots and their labels, and the positions of
  "image in scene" and spritemap actions can all be dragged. A scene larger than the screen
  scrolls in the game; "Make the scene that size" sizes a scene to a wide background.
- **Events**: start, end, hotspot and indirect events, each with conditions and an ordered list
  of actions. All fourteen action types in the docs have a form, including infobox buttons with
  their own actions and conditions, and so do the added ones: avatar, freeze, dialogue, award
  (stars and XP) and shop (open the marketplace). A conversation (dialogue tree) is drawn as a
  map in its action card and edited line by line in a pop-up panel (`views/conversation.ts`).
- **Library**: media (upload or by address, in sub-tabs by what it is used for), variables,
  items, characters, objectives.
- **Moves**: what players can do from buttons on their screen (jump, crouch, dance), each with
  optional conditions.
- **Sprite sheets** (on a media card): frames across and down, named animations, frames picked
  by clicking the sheet, and a preview. Animated PNGs are converted on upload (`src/apng.ts`).
- **Shop**: the items only this scenario sells in the marketplace: something to wear, a pet, a
  way of moving, or an ability, with a price in stars. Taking an item off sale keeps it for the
  players who bought it.
- **Test**: "Test this scene" opens the game on the unpublished draft, starting in that scene,
  playing alone with nothing saved. "With outlines" also draws hotspots and walkable areas.
- **Publish**: checks the scenario with the validator the game uses, then generates the JSON
  players get at `/{code}`.

Every change is saved as it is made. There is no save button.

## Layout

    src/
      main.ts            sign-in and addresses (#/, #/s/{id}, #/s/{id}/scene/{scene}, ...)
      api.ts             calls to /api/editor
      store.ts           the open scenario in memory; sends changes in order
      schema.ts          what can be edited: one list of fields per thing, and the 14 action types
      fields.ts          draws a list of fields as a form
      describe.ts        names and one-line summaries for rows
      dom.ts             element helpers
      views/
        home.ts          sign-in, scenario list
        workspace.ts     one scenario: tab bar and pages
        pages.ts         scenes, settings, publish
        library.ts       media, variables, items, characters, objectives
        eventPanel.ts    one event: kind, hotspot geometry, conditions, labels
        actions.ts       the actions of an event, and infobox buttons
        conditions.ts    "variable operator value" lists
        scene/
          sceneEditor.ts the three panes and the "add to scene" menu
          canvas.ts      the scene picture and dragging
          outline.ts     the list of what is in the scene
          inspector.ts   the form for the selection
          model.ts       reading and writing a scene's JSON columns
        sceneMap/
          graph.ts       which scenes lead where, the map's layout, making and removing links
          sceneMap.ts    the Scenes page's map: boxes, arrows, dragging, the side panel

## Adding things

**A new attribute** of an action, scene, layer, item or anything else: add one entry to its list
in `schema.ts`. The form, saving and (for actions) the generated JSON follow from that. If it
is a new column rather than something kept in `params`/`settings`/`layout`, also add it to
`ScenarioStore::SCHEMA` and the migration. A number with a natural range (a volume, a radius,
parallax, a percentage) gets a slider beside its box with `slider: { min, max }`; `max: 'scene'`
is the longer side of the scene being edited. The box still takes any value within the field's
own `min`/`max`, and a value past the slider's end moves the end out to it.

**A new action type**: add it to `ACTIONS` in `schema.ts` (and to `ActionType` in
`packages/shared`, `ScenarioStore::ENUMS`, and a presenter in the game client).

**A new kind of field** (say, a point picked on the canvas): add a case to `control()` in
`fields.ts`.

## How saving works

`Store` applies a change to its in-memory copy at once and queues it for the API, so changes
arrive in the order they were made. If the API refuses one, the scenario is loaded again and the
screen goes back to what the database holds. Forms are rebuilt only when rows are added or
removed ("structural" changes); otherwise the canvas and lists redraw and the field being typed
in is left alone.

A patch of a row made while the same row's previous patch is still waiting in the queue is folded
into it. A slider saves as it is dragged, inside `store.live()`: those patches also wait 150 ms
after the row's last one, so a drag sends a few requests with the latest value while the canvas
follows every step. The wait counts as "Saving…".

## Running it

With Docker it is part of `docker compose up --build`: http://localhost:8080/editor.

Without Docker, from the repository root (needs PHP 8.2+ with SQLite):

    npm run dev:editor      # PHP dev API + editor + game; open http://localhost:5173/editor/

The dev API (`apps/api/dev/server.php`) runs the same PHP classes Laravel uses over a SQLite
file in `.data/dev-api`, seeded with the demo mission. It accepts any email and password and
makes you a teacher. It is not for deployment.

## Tests

    npx playwright install chromium     # once
    npm run test:editor

The tests drive the real editor in a headless browser against the dev API: a teacher builds a
two-scene scenario by clicking, typing and dragging, publishes it, and the published JSON is then
played by the game's headless harness. A second file covers layers, areas, spawn points,
placements, objectives, settings and deleting, checking the generated JSON after each.
`scene-map.test.ts` builds three scenes on the Scenes page's map by dragging (set `QBL_SHOTS` to
a folder to keep screenshots).
