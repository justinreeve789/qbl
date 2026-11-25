---
title: "Variables (spec v2)"
description: "Player and shared variables, and the extra reserved variables and operators."
host:
  who: sam
  says: "A player's own memory, and the memory a whole team shares."
  side: right
---

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
scope | string | player | `player`: each player has their own value, saved with their progress. `room`: one value shared by everyone in the group, held by the game server.
persist | bool | true | If false the variable returns to `default_value` on every visit.

**Each variable is one or the other, and its `scope` says which.**

* A **player's own** variable (`player`) has a separate value for every player. Changing it for one player changes nothing for anyone else. Use it for a player's progress: students must greet three animals before a door opens, and each has their own count of how many they have greeted.
* A **shared** variable (`room`) has one value for everyone playing together. When any player changes it, it changes for all of them at once, wherever in the scenario they are. Use it for the state of the world: one student sends boulders down across a path, and after that nobody can use the path.

Conditions and variable actions are written the same way for both; only the variable's scope differs, so a scenario decides this once, where the variable is defined, and not in every action. A variable action on a shared variable is sent to the game server, applied there, and the new value reaches every player; hotspots and objectives whose conditions use it update for everyone. The editor marks shared variables wherever one is chosen.

"Everyone playing together" is a group: the players who joined with the same group key (a class, a team), up to `max_players`. A shared variable with `persist` is saved with the group's game, so the path is still blocked when they come back tomorrow; a different group has its own. A player's own variables are reported by the browser and can be tampered with; shared variables are held by the server, but any player's event can change them, so they are not secrets either.

Both examples are in the demo: the rockfall above the spring meadow (`rockfall`, shared, cleared again by the repair drone in the engine room) and the critters in the hydroponics bay (`critters_met`, each player's own).

`QL_Holding` is the id of the thing the player has picked in their bag to use (see [The bag](/docs/developers/extensions/items/#the-bag-point-and-click-things)), and 0 otherwise.

The other reserved variables these extensions add are in [Reserved Variables](/docs/developers/variable/#reserved-variables): `QL_SceneId`, `QL_PlayerCount`, and for the player's account `QL_PlayerStars`, `QL_PlayerXP`, `QL_PlayerRank` (the rank's name) and `QL_Ability_<key>` (1 while the player has a marketplace ability with that key equipped, otherwise 0). They can be used in conditions and as `{{placeholders}}` like any other variable.

Additional condition operators: `>=`, `<=`, and the modulus pair `%` (the variable is a whole multiple of the operand, e.g. `turns % 2` on even turns) and `!%` (it is not one, e.g. `turns !% 2` on odd turns). See [Conditions](/docs/developers/condition/).
