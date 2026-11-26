---
title: "Scenes"
host:
  who: mallory
  says: "A scene is one place: its pictures, its walkable floor, and everything that can happen there."
  side: right
---

A scene consists of a single media item as the background, namely an image. A scenario is composed of multiple scenes, and scenes contain events which describe interactions within the scene.

:::note[Also see]
Scene size, walkable areas, spawn points, layers, music, skies, weather and water are described in [Scenes, layers and spawn points](/docs/developers/extensions/scenes/) and [Skies, weather, water and story scenes](/docs/developers/extensions/atmosphere/).
:::

## Primary Attributes

Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int    |  | scene id
shortname | string |  | A unique code identifying the scene.
scenario_id | int    |  | The scenario id the scene is associated with.
sequence | int    |  | The order the scene appears in the management tool. This also specifies the order of scenes used by showGroundPanel for navigating between scenes.
group_id | int    |  | A group id this scene is associated with. This is used only in the management tool for organization.
subtitle | string |  | A subtitle of the scene. This appears in the management tool.
description | string |  | A text summary of the scene.
user_id | int    |  | User id of the scene creator.
locked_by | int    |  | User id of the person who has a lock on the scene, making it unable to be edited by others.
is_intro_scene | bool   | false | Indicates if this is designated as an introductory scene for the scenario, which appears before the main scenario runs.
background_media | array  |  | An array of media objects describing the background images for the scene.
foreground_media | array  |  | An array of media objects describing the foreground images for the scene.
zoom | decimal | 1.0 | A scale factor for avatars and objects on the scene.
show_avatars | bool | true | If true, display avatars on the scene. If false, no avatars are drawn, the player cannot walk by clicking or with the keys (walk actions aimed at the player still move them), and the camera stays where the player arrived unless a camera action moves it.
params | array |  | A list of arbitrary parameters that may further define the scene.
start_events | array |  | A list of events which describe actions that occur when the scene first loads.
end_events | array |  | A list of events which describe actions that occur immediately before a jump action to another scene.
hotspots | array |  | A list of events which describe actions that occur when triggered by a hotspot placed at a specific location on the scene.
