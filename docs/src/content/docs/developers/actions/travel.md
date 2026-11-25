---
title: "Travel"
description: "Takes the player to the mission their teacher launched."
---

`type`: `travel`

The `travel` action takes the player out of this scenario to the mission their teacher has just launched. It is how a **departure scene** ends: a teacher, playing with the class, launches one of their assignments from the game's 🚀 tab and may choose a scene of the current scenario for everyone to go through first (into the time portal, aboard the shuttle). The game server puts every student of that assignment who is in the room into that scene, door or no door; its events play; their `travel` action takes each student into their own instance of the launched mission (`/{code}?group=…`). Launched with no departure scene, the client runs a `travel` in whatever scene the player is in.

Parameter | Type | Description
--------- | ---- | -----------
to | string | Where to. `launched` (the default, and the only value so far): the mission the teacher launched for the player.

```json
{ "type": "travel" }
```

* Like `jump`, it ends the event, and the scene's end events run before the player goes. It works on infobox buttons and conversation choices too.
* With nothing launched for the player (they walked into the departure scene another day) nothing happens and the event carries on with its next action. The system variable `QL_NextMission` tells the cases apart: the title of the launched mission while one is waiting for the player to go, and empty otherwise (test it with `!=` and an empty value).
* A teacher is offered as departure scenes only the scenes with a `travel` action somewhere in their events (`departureScenes`).
* While a player is still in the departure scene a launch put them in, they are saved where they were before it, so coming back to the scenario another day does not start them mid-countdown.
* In a preview there is no launch: a toast says where players would go, and the event carries on.
