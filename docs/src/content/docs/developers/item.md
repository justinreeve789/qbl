---
title: "Items"
---

Items are any object in a scenario that isn't part of the background scene. The player may interact with items set around a scene. Some items may even cross scenes.

Some items can't be moved. Examples may include:

- Trees
- Rocks
- Tables

Some items are rideable. Examples may include:

- Cars
- Horses
- Hot air balloons

Some items move when bumped into. Examples may include:

- Balls
- Boxes
- Chairs

### Primary Attributes
Parameter | Type        | Default | Description
--------- |-------------|---------| -----------
id | int         |         | Item id
scenario_id | int         |         | The scenario the item is associated with.
name | string          |               | Name of the item.                                                                                                                                                                    
unique | bool        |         | If false, every player sees their own "instance" of this item. If true, while this item is acquired (worn/driven) by a player, its position and availability will change for other players, and no other player can use it.
physical | bool | false | If true, the item can be moved around using the physics engine.
blocking | bool        | false   | If true, players can not move through the item.
wearable | bool | false | If true, players can wear the item.
vehicle | bool            | false         | If true, the item is rideable.                                                                                                                                                 
conditions | array       |         | A list of conditions which must be met before the item exists.

## Wearables
TBD

## Vehicles
TBD
