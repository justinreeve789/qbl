---
title: "How a scenario fits together"
description: "The shape of a scenario document: what holds what, which fields point at which, where each part is documented, and a complete small example."
host:
  who: asimov
  says: "One JSON document, four levels deep. Learn the shape once and every reference page makes sense."
  side: right
---

A scenario is one JSON document. It is a tree four levels deep, with a few shared lists (media, characters, variables) that the tree points into by `id`.

```text
scenario
├── assets[]            every picture, sound and video, listed once
├── characters[]        who can be talked to (and the avatars players choose from)
├── items[]             things to pick up, wear and ride
├── global_variables[]  the mission's memory
└── scenes[]            one place each
    ├── background_media, walkable_areas, spawn_points, characters[], items[] ...
    ├── start_events[]      run when the scene loads
    ├── hotspots[]          run when a player walks into, or clicks, a place
    ├── indirect_events[]   run only when something asks: a run_event action, a button, a character
    ├── end_events[]        run just before a jump to another scene
    └── each event
        └── actions[]       run one after another: dialogue, variable, jump, award ...
```

An event can carry `conditions`, and so can each action in it: one that fails is skipped. That is all the logic a mission has. The rest is *what* the actions do.

## Where each part is documented

The first version of the format has one reference page per object. Everything the walk-around runtime added is optional and lives in the [spec v2 section](/docs/developers/extensions/).

Object | Original reference | Added by spec v2
------ | ------------------ | ----------------
Scenario | [Scenarios](/docs/developers/scenario/) | [Scenario fields](/docs/developers/extensions/scenario/)
Scene | [Scenes](/docs/developers/scene/) | [Scenes, layers and spawn points](/docs/developers/extensions/scenes/), [skies, weather and water](/docs/developers/extensions/atmosphere/)
Event, hotspot | [Events](/docs/developers/event/) | [Events and hotspots](/docs/developers/extensions/events/)
Action | [Actions](/docs/developers/action/) | [Actions overview](/docs/developers/extensions/actions/)
Condition | [Conditions](/docs/developers/condition/) | [Variables](/docs/developers/extensions/variables/) (the `>=`, `<=`, `%` and `!%` operators)
Variable | [Global variables](/docs/developers/variable/) | [Variables](/docs/developers/extensions/variables/) (player and shared scope)
Character | [Characters](/docs/developers/character/) | [Characters that live in the world](/docs/developers/extensions/characters/)
Item | [Items](/docs/developers/item/) | [Items, the bag and vehicles](/docs/developers/extensions/items/)
Media | [Media](/docs/developers/media/) | [Animations](/docs/developers/extensions/animations/) (sprite sheets and named animations)
Spritemap, label | [Spritemaps](/docs/developers/spritemap/), [Labels](/docs/developers/label/) | [Animations](/docs/developers/extensions/animations/)
Save data | [Save data](/docs/developers/save-data/) | [Instances, teams and save data](/docs/developers/instances/)

## What points at what

Things refer to each other by `id`. A reference to something that does not exist is the most common mistake in a hand-written scenario, and the validator reports it.

Field | Points at
----- | ---------
`start_scene_id` | A scene's `id`
`scenes[].background_media[].media_id` (and `foreground_media`) | An entry of `assets[]`
`characters[].media_id` | An entry of `assets[]`
`scenes[].characters[].character_id` | An entry of the scenario's `characters[]`
`scenes[].characters[].event_id` | An **indirect event** of the same scene: what runs when the player clicks that character
`jump` action: `scene_id` | A scene's `id`
`jump` action: `spawn_point` | The `name` of a spawn point in the **target** scene
`run_event` action: `event_id` | An indirect event of the same scene
`dialogue` action: `character_id` | An entry of `characters[]`
Any `conditions[].variable`, or a `variable` action's `name` | A `variable_name` in `global_variables[]`, or a reserved `QL_` variable

Two things in a document are **generated**, not written by hand. `jump_targets` is worked out from the jump actions (the runtime computes it when a document has none), and `session` is the requesting player's [save data](/docs/developers/save-data/), added when the API serves the document. The editor's **Publish** writes both. `assets` is different: it is the list the `media_id` fields point into, so every picture, sound and video a scene or character uses must be listed there (media written inline on a layer or label is gathered into it for you).

## A complete small example

Two scenes, one character, one variable and a gate: a player cannot leave the yard until they have spoken to Ms. Okafor. The pictures (`yard.png`, `pond.png`, `guide.png`) are not included, so the example validates but shows nothing when played.

```json
{
  "spec_version": 2,
  "id": 1,
  "shortname": "hello-pond",
  "title": "Hello, pond",
  "start_scene_id": 1,
  "global_variables": [
    { "id": 1, "variable_name": "greeted", "default_value": 0 }
  ],
  "assets": [
    { "id": 1, "type": "image", "url": "yard.png", "width": 1600, "height": 900 },
    { "id": 2, "type": "image", "url": "pond.png", "width": 1600, "height": 900 },
    { "id": 3, "type": "image", "url": "guide.png" }
  ],
  "characters": [
    { "id": 1, "name": "Ms. Okafor", "media_id": 3 }
  ],
  "scenes": [
    {
      "id": 1,
      "shortname": "yard",
      "width": 1600,
      "height": 900,
      "background_media": [{ "media_id": 1, "display_width": 1600, "display_height": 900 }],
      "walkable_areas": [[{ "x": 0, "y": 600 }, { "x": 1600, "y": 600 }, { "x": 1600, "y": 900 }, { "x": 0, "y": 900 }]],
      "spawn_points": [
        { "name": "default", "position_x": 400, "position_y": 760 },
        { "name": "east", "position_x": 1450, "position_y": 760, "facing": "left" }
      ],
      "characters": [
        { "character_id": 1, "position_x": 900, "position_y": 740, "facing": "left", "event_id": 11 }
      ],
      "hotspots": [
        {
          "id": 12,
          "shortname": "to-pond",
          "position_x": 1600,
          "radius": 120,
          "activate_by_trigger": false,
          "actions": [
            {
              "id": 121,
              "type": "jump",
              "scene_id": 2,
              "spawn_point": "west",
              "conditions": [{ "variable": "greeted", "operator": "=", "operand": 1 }]
            }
          ]
        }
      ],
      "indirect_events": [
        {
          "id": 11,
          "shortname": "okafor-talk",
          "actions": [
            { "id": 111, "type": "dialogue", "speaker": "character", "character_id": 1, "text": "Hello, {{QL_PlayerName}}! The pond is to the east." },
            { "id": 112, "type": "variable", "name": "greeted", "operator": "set", "operand": 1 }
          ]
        }
      ]
    },
    {
      "id": 2,
      "shortname": "pond",
      "width": 1600,
      "height": 900,
      "background_media": [{ "media_id": 2, "display_width": 1600, "display_height": 900 }],
      "walkable_areas": [[{ "x": 0, "y": 600 }, { "x": 1600, "y": 600 }, { "x": 1600, "y": 900 }, { "x": 0, "y": 900 }]],
      "spawn_points": [{ "name": "west", "position_x": 150, "position_y": 760 }]
    }
  ]
}
```

Reading it from the top:

1. **`global_variables`** declares `greeted`, starting at 0.
2. **Scene 1** has a character, Ms. Okafor, placed at (900, 740). Her `event_id` is 11, so clicking her runs the indirect event `okafor-talk`.
3. **`okafor-talk`** says a line (`{{QL_PlayerName}}` is replaced with the player's name) and then sets `greeted` to 1.
4. **The `to-pond` hotspot** sits on the right edge. `activate_by_trigger: false` means it fires when an avatar *walks into* its radius. Its one action, a `jump` to scene 2, has a condition, so it is skipped until `greeted` is 1.
5. **Scene 2** has a `west` spawn point: where the jump lands.

## What the validator catches

Run any document through the same checks the editor's **Publish** button runs (see [Run QuestLab locally](/docs/developers/local-development/#check-a-scenario)). Point the jump above at a scene that does not exist, and a background at a missing picture, and it says:

```text
ERROR  scenes[0].hotspots[0].actions[0].scene_id: Scene 9 does not exist (it may have been deleted)
ERROR  scenes[1].background_media[0]: Media 7 is not in the scenario's media (it may have been deleted)
```

Each error names the path to the field, so you can find it in the JSON.

## Bringing a document in

A ZIP holding a `scenario.json` and its pictures can be imported whole from the editor, which renumbers the ids and keeps every reference pointing at the right thing. See [Backups, copies and the starship hub](/docs/editor/backups-and-copies/#making-a-zip-by-hand). To have the platform write a document for you, see [Generating missions with AI](/docs/developers/generation/).
