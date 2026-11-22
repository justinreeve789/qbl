---
title: "Global Variables"
host:
  who: sam
  says: "Variables are a mission's memory. Here's how to declare them, and the ones the game keeps for you."
  side: right
---

Custom global variables can be declared by a user, and can be used throughout the project by storing numbers and strings. They are particularly useful when defining conditions for events and actions. A certain number of global variables are reserved for system use. Reserved variables are used for reference by the user in their scripting; the system keeps their values, so actions cannot change them. They are all prefixed with “QL_”.

### Primary Attributes
Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | variable id
scenario_id | int |  | The scenario id the variable is associated with.
variable_name | string |  | The name of the variable; this cannot be any of the reserved variables, or start with `QL_` or `QBL`.
default_value | string |  | The initial value of the variable when the scenario first loads.

## Reserved Variables

These are hardcoded into the system. The game keeps their values up to date; a variable action cannot change them. Use them in conditions like any other variable, and write them in `{{ … }}` in dialogue, infoboxes, conversations, text overlays and other actions' text, where they are replaced with their value when the text plays: `Hi {{QL_PlayerName}}, ask {{QL_TeacherName}} if you get stuck.` The editor lists them as **built in** wherever a condition's variable is chosen, and under **🔢 Variable** in an infobox.

Value | Description
----- | -----------
QL_HotspotCoordinates | If a hotspot is currently executing, this is the XY coordinates of the hotspot, as `x,y` (such as `640,410`). Empty when no hotspot's event is running.
QL_ScenarioLanguage | Two-digit country code specifying the currently selected language for the scenario (`en`, `es`, …).
QL_TimeElapsed | The number of seconds the user has currently spent in the scenario, over all their visits.
QL_VideoPlaying | If the current scene has a video, this indicates whether or not that video is currently playing: 1 or 0. This could be useful if a scene needs to end when the video is finished; a start event could be created that continually checks for the video to be finished (with a `repeat` action), and jumps to the next scene when it has.
QL_VideoTimeIndex | If the current scene has a video, this is the time index, by number of seconds, the video is currently at.
QL_PlayerName | The player's name.
QL_TeacherName | The name of the player's teacher, if there is one: the teacher who assigned the scenario to the player's class or team. Empty otherwise.
QL_HasTeacher | 0 if the player has no teacher assigned for the scenario they're in, 1 if the player does have a teacher assigned for the scenario they're in. A player in the public game (not one assigned to their class) has none, and teachers and administrators never have one.
QL_IsTeacher | 0 if the player is not a teacher in the scenario, 1 if the player is a teacher in the scenario: an account with the teacher, content admin or administrator role, including a teacher looking in on a team.
QL_PhysicsEnabled | 0 if the current scene does not have physics enabled, 1 if the current scene does have physics enabled (it is a physics experiment).

QL_PlayerStars | How many stars the player has.
QL_PlayerXP | The player's experience points (XP).
QL_PlayerRank | The name of the player's rank.
QL_PlayerCount | How many players are playing together: the player's team, when there are teams.
QL_SceneId | The id of the scene the player is in.
QL_Holding | The id of the thing the player is using from their bag, while they use it; 0 otherwise. A hotspot or a character's event whose conditions test it takes things from the bag. See [The bag](/docs/developers/extensions/#the-bag-point-and-click-things).
`QL_Ability_<key>` | 1 while the player has a marketplace ability with that key equipped, otherwise 0.

### Older names
Before these were called `QL_…`, some had other names: `QBLPlayerName`, `QBLPlayerCount`, `QBLStars`, `QBLXp`, `QBLRank`, `QBLSceneId`, `QBLHolding` and `QBLAbility_<key>`. Scenarios that still use them play as before (the game reads each as its new name), but the publish check warns about each one so it can be changed. Variable names starting with `QBL` stay reserved.
