---
title: "Events"
host:
  who: mallory
  says: "Events and hotspots in JSON: the triggers that make a scene come alive."
---

Events are a series of actions that execute in sequential order. There are four types of events:

* start_events: events that occur when the scene first loads
* end_events: events that occur immediately before a jump action to another scene
* hotspots: events that occur when triggered by a hotspot placed at a specific location on the scene
* indirect_events: events that can only be triggered by a run event action

### Primary Attributes

Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | event id
shortname | string |  | A unique code identifying the event.
scene_id | int |  | The scene id the event is associated with.
overridable | bool | false | If false, the event cannot be interrupted if another event is initiated.
block_hotspots | bool | false | If true, no hotspot can be triggered until this event’s actions are complete.
conditions | array |  | A list of conditions which must be met before the event can be triggered.
actions | array |  | A list of actions associated with the event, which sequentially occur when the event is triggered.

## Hotspots

Hotspots contain additional attributes to describe how and when they are triggered. These extra attributes are listed below.

Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
position_x | decimal |  | The X coordinate for the hotspot. If null, the entire x-axis is used.
position_y | decimal |  | The Y coordinate for the hotspot. If null, the entire y-axis is used.
radius | decimal |  | The radius of the circle around the XY position that can trigger this hotspot. If -1, the hotspot effectively covers the whole screen. If two hotspots overlap, both will be triggered (note that this will invalidate one of them if both are flagged as overridable, so this should be avoided if possible).
activate_by_trigger | boolean | false | If true, allow the event to be initiated when a mouse click or screen touch triggers it. The trigger will only work within the radius, unless a radius of -1 is specified.
labels | array |  | A list of labels which appear along with the hotspot. These can be either text, images, or spritemaps.
