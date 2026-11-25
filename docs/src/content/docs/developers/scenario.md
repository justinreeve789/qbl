---
title: "Scenarios"
host:
  who: asimov
  says: "The scenario is the top of the tree: one JSON document that describes a whole mission."
---

A scenario is the top-level unit, and contains data that applies to all the scenes in the scenario. Some attributes, such as the jumpTargets and assets, are automatically generated from data contained within the scenes, and are presented at the scenario level to optimize the overall experience for a user.

:::note[Also see]
The walk-around runtime adds `code`, `visibility`, `chat_mode`, avatars, objectives, a glossary, narration and more: see [Scenario fields](/docs/developers/extensions/scenario/). For the whole tree at a glance, see [How a scenario fits together](/docs/developers/structure/).
:::

## Primary Attributes

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
id | int |         | scenario id
shortname | string |         | unique code identifying the scenario
title | string |         | title of scenario
subtitle | string |         | subtitle of scenario
description | text |         | text summary of scenario
user_id | int |         | user id of scenario creator
start_scene_id | int |         | scene id to begin scenario at
enable_save_session | bool | true    | Allow this scenario to save its session, so progress can be resumed later.
require_login | bool | true    | Force users to log in before viewing this scenario.
allow_groups | bool | false | Before joining a scenario, allow non-administrator users to join a group of players. 
max_players | int | | The maximum number of non-administrator users that are allowed into one instance of the scenario. Used when teachers want students to work in groups or when a scenario is best suited for smaller teams.
default_language | string | en-us   | The default language to use for this scenario.
intro_media_portrait_id | int | null    | A media id for a “splash screen” to show before the scenario loads in portrait mode.
intro_media_landscape_id | int | null    | A media id for a “splash screen” to show before the scenario loads in landscape mode.
global_variables | array |         | A list of all the global variables that can be set and changed in the scenario
jump_targets | array |         | A list of all the scene ids, with arrays of all possible scenes that can be jumped. Used for optimizing the preloading of assets for next scenes for a seamless experience.
assets | array |         | A list of all the media assets in the scenario, with priority levels to indicate which should load first, and file information.
scenes | array |         | A list of all the scenes in the scenario, with associated events
