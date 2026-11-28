---
title: "The data model"
description: "Every table QuestLab keeps, which columns and JSON columns a scenario is spread over, where each kind of value is kept (columns, params, layout, settings), and how each reaches the scenario document."
host:
  who: asimov
  says: "Where does this field live? Column, params, layout or settings? Here is the answer for every part of a scenario, and how the compiler carries each one into the JSON."
  side: right
---

The question developers ask most is "where is this value kept?". A scenario is spread over eleven tables, and most rows have a JSON column that holds everything that is not worth a column of its own. This page says which, for every part of a scenario, and lists the other tables the platform keeps.

:::tip[In short]
- A scenario is **one `scenarios` row plus content rows** in `media`, `shop_items`, `variables`, `items`, `characters`, `scenes`, `events`, `actions`, `conditions` and `labels`.
- Each content table has **real columns** for what is queried or referenced, and **one JSON column** (`params`, `settings` or `layout`) for the rest. The editor writes the JSON; the compiler **spreads it into the document**.
- **Writable columns are listed in `ScenarioStore::SCHEMA`.** If a column is not there, the store will not write it.
- The published document is kept whole in `scenarios.document`. Saves are in `scenario_sessions` (per player and instance) and `scenario_instances` (per instance).
:::

## The scenario tables

```text
scenarios ─┬─ media            (scenario_id)
           ├─ shop_items       (scenario_id; platform items have none)
           ├─ variables        (scenario_id)
           ├─ items            (scenario_id) ──┐
           ├─ characters       (scenario_id) ──┤
           └─ scenes           (scenario_id)   │
                └─ events      (scene_id)      │
                     ├─ actions    (event_id)  │
                     │    └─ conditions (action_id)
                     ├─ conditions (event_id)  │
                     └─ labels     (event_id)  │
                          conditions (item_id, character_id) ◀┘
```

`conditions` rows have one of four owners: an event, an action, an item or a character. The editor's `Store` and `ScenarioStore` deal with these tables as a set; `CONTENT` (PHP) and `ORDER` (`apps/editor/src/history.ts`) list them parents first.

### `scenarios`

Column | Type | Reaches the document as
------ | ---- | -----------------------
`id` | id | `id`
`code` | string, unique | `code` (also added when served, from the row)
`shortname`, `title`, `subtitle`, `description` | strings | the same
`user_id` | owner; null for shared samples | `user_id`
`start_scene_id` | scene id | `start_scene_id`
`enable_save_session`, `require_login`, `allow_groups` | booleans | the same
`max_players`, `default_language`, `intro_media_portrait_id`, `intro_media_landscape_id` | | the same
`settings` | JSON | **spread at the top level**: `chat_mode`, `move_speed`, `private_messages`, `narration`, `narrator_voice`, `music_media_id`, `music_volume`, `asset_base_url`, `objectives`, `moves`, `glossary`, `scene_groups`, `combinations`, `spec_version`... Also `visibility` (`public`/`private`), `tier` (`free`/`curricular`, admins only) and `wait_for_launch`, which the API reads
`document` | JSON | The published document itself (`ScenarioStore::publish`)
`published_at`, `updated_at` | timestamps | Not in the document. `updated_at > published_at` is "Unpublished changes"

### `scenes`

Column | Reaches the document as
------ | -----------------------
`id`, `shortname`, `sequence`, `group_id`, `subtitle`, `description`, `is_intro_scene`, `zoom`, `show_avatars`, `width`, `height` | the same
`background_media`, `foreground_media` (JSON) | the same: lists of layers `{media_id, …}`
`layout` (JSON): **what is placed in the scene** | `walkable_areas`, `blocked_areas`, `spawn_points`, `scale_areas`, `shadow_spots`, `lights`, `flows`, `water_lights`, `critters`, `items` (placements), `characters` (placements), `bench`
`params` (JSON): **the scene's settings** | `sky`, `atmosphere`, `weather`, `story`, `launcher`, `team_only`, `building` (only when enabled), `music_media_id`, `music_volume`; **everything else in `params` stays under `params`** (for example `editor_map`, the scene map's box position, which the game ignores)
`user_id`, `locked_by` | Not used by the game

The rule of thumb: **if it has a position in the scene, it is in `layout`; if it is a setting of the scene, it is in `params`.** The editor's `SceneModel.layout(key)` / `setLayout` and the scene form's fields follow this.

### `events`

Column | Reaches the document as
------ | -----------------------
`kind` | Which list of its scene: `start` → `start_events`, `end` → `end_events`, `hotspot` → `hotspots`, `indirect` → `indirect_events`
`id`, `scene_id`, `shortname`, `sequence`, `overridable`, `block_hotspots` | the same
`audience` | written only when `scene`
`position_x`, `position_y`, `radius`, `activate_by_trigger`, `once`, `reveal_radius`, `reveal_full_radius` | Hotspots only. **A null coordinate means "the whole axis"** (an exit along an edge) and is kept; a null radius becomes -1
conditions with `event_id` | `conditions`
labels | `labels` (hotspots only)

### `actions`

Column | Reaches the document as
------ | -----------------------
`id`, `event_id`, `type`, `sequence`, `blocking`, `media_id` | the same
`params` (JSON) | **spread beside them**: every type-specific attribute (`text`, `scene_id`, `name`, `operator`, `operand`, `call_to_actions`, `lines`, `stars`...)
conditions with `action_id` | `conditions`

So a dialogue action's text is `actions.params.text` in the database and `text` on the action in the document. In the editor, `views/actions.ts` writes `media_id` and `blocking` as columns and every other field into `params`.

Nested actions **are not rows**: an infobox button's action (`params.call_to_actions[i].action`) and a conversation choice's actions (`params.lines[i].choices[j].actions`) live inside their action's JSON, with their own inline conditions. They have no ids of their own in the database; the engine gives them negative ids when it runs them.

### `labels`

`id`, `event_id`, `type` (`text`, `image`, `spritemap`), `position_x`, `position_y`, `scale_x`, `scale_y`, `text`, `media_id` (becomes `media` in the document), and `params` spread beside them (`placement`, `solid`, `solid_radius`, `pulse`, `show_near`, spritemap settings).

### `media`

`id`, `type` (`image`, `audio`, `video`), `filename`, `filepath`, `url`, `scale_x`, `scale_y`, `width`, `height`, `priority` (the document's `assets` are sorted by it). `params` holds `sheet` (a sprite sheet's grid), `animations` (its named animations), `apng` (an animated PNG's frames and timing) and `speech` (a recording's words and their times), which the compiler lifts out to the top of the media entry; anything else stays under `params`, such as `crop` (the part of a sound that plays, in seconds: read it with `audioCrop()` in `packages/shared/src/audioCrop.ts`, never by hand). Uploaded files are stored under the media folder, one folder per scenario, with random names; `filepath` points there.

### `variables`

`variable_name`, `default_value` (JSON, so numbers stay numbers), `scope` (`player`, `room`), `persist`. In the document: `global_variables`.

### `items` and `characters`

- **`items`**: `name`, `unique`, `physical`, `blocking`, `wearable`, `vehicle`, `media_id`, and `settings` spread beside them (`scale`, `placement`, `blocking_radius`, `description`, attach offsets and layer, `speed_multiplier`, `carried_when`, `sort_line`...). Conditions with `item_id`.
- **`characters`**: `name`, `media_id` (older characters' picture), and `settings` spread beside them (`animations`, `scale`, voice settings, `tts_voice`, `routine`, `roams`, `portrait_media_id` for older ones...). Conditions with `character_id`. Settings are cleaned on every write (`NpcCharacter::cleanSettings`): every animation must use one of the scenario's own media.

Placements (where an item or a character stands in a scene) are not rows: they are entries in the scene's `layout.items` and `layout.characters`.

### `shop_items`

What a scenario sells in the marketplace (platform-wide items have no `scenario_id`): `name`, `description`, `kind` (`wearable`, `pet`, `animation`, `ability`, `move`), `slot`, `price`, `media_id`, `image_url`, `settings`, `active`, `sequence`. Only active ones are in the document (`shop_items`).

## Generated, not stored

- `jump_targets`: worked out by the compiler (and again by `normalizeScenario` if absent).
- `avatars` and the platform pictures among `assets`: added when served (`Avatars::inject`).
- `session` and `instance`: added per request by `PlayController` (and `InternalController` for the game server's copy).

## Saves and instances

Table | Key | Holds
----- | --- | -----
`scenario_sessions` | scenario, user, `group_key` | `data`: a `Session` (scene, position, player variables, flags, attachments, time)
`scenario_instances` | scenario, `group_key` | `data`: `InstanceData` (room variables, unique items, roaming characters)

Both are written only by the game server through `/api/internal`. [Instances, teams and save data](/docs/developers/instances/) and [Save data](/docs/developers/save-data/) document their contents.

## Everything else

Area | Tables
---- | ------
Accounts | `users` (`role`, `avatar_media_id`, `stars`, `xp`, `google_id`, `self_registered_at`, `organization_id`, `school_id`, `external_id`, `grade_level`, `deactivated_at`), `personal_access_tokens` (Sanctum), `password_reset_tokens`, `sessions`, `cache`, `jobs`
Rewards and the marketplace | `progress_ledger` (every grant; unique `user_id` + `grant_key` makes "once" hold), `shop_items`, `user_items` (owned and equipped), `user_badges`
Avatars | `avatars`, `platform_media`
Classes | `teacher_student`, `assignments` (teacher, scenario, due date, note, `launched_at`, `external_id`), `teams`, `assignment_student` (with `team_id`)
What players did | `activity_log` (also reset lines), `chat_messages`
Student building | `scene_builds` (one per student, scene and instance; `status`, `pieces`), `build_uploads`
The asset library | `library_assets`, `library_asset_files`
The AI generator | `scenario_generations` (prompt, options, status, alignment, blueprint, manifest, progress), `generation_events` (an audit log of time and money). Standards: the `standard_*` tables ([Curriculum standards library](/docs/codebase/standards-library/)); a mission's standards are `standard_alignments` rows with `alignable_type` `scenario`
Organizations and the public API | `organizations` (with `parent_id` for schools, settings, license, `integrations_enabled`), `organization_admins`, `org_integrations`, `integration_runs`, `api_clients`, `api_tokens`, `launch_tokens`, `api_audit_log`
Billing | `subscriptions`, `credit_accounts`, `credit_ledger`, `stripe_events`, `quote_requests`

## Adding a column

1. A migration in `apps/api/database/migrations/`, idempotent like the others (`Schema::hasColumn` first).
2. The column and its type in `ScenarioStore::SCHEMA` (which is also where `sqliteSchema()` gets the SQLite form for the scenario tables).
3. `ScenarioCompiler` (and `ScenarioDecompiler`, so it survives export and import), if it belongs in the document.
4. A field in the editor's `schema.ts`.

**Usually you do not need a column.** A new attribute of an action, a label, an item, a character, a scene setting or the scenario is a key in the existing JSON column, and needs no migration at all: add it to the types, the validator and the editor's field list. Add a column only when the API must query or index it. See the [recipes](/docs/codebase/recipes/).
