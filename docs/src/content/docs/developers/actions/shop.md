---
title: "Shop"
description: "Opens the marketplace, and what the marketplace sells."
---

`type`: `shop`

The `shop` action opens the marketplace. It has no parameters. The sequence waits until the player closes the window.

```json
{ "type": "shop" }
```

Players can also open the marketplace at any time from the stars shown in the corner of the screen, so a scenario needs no shop action; it is there for scenarios that want a place for it, as the demo's marketplace room does.

## What the marketplace sells

Every scenario sells the platform's catalogue (`apps/api/database/seeders/data/shop.php`). A scenario can also sell items of its own, which exist only there: a mission badge, a tool for this planet. Authors add them on the editor's **Shop** page; they are in the document as `shop_items`.

Parameter | Type | Description
--------- | ---- | -----------
id | int |
name, description | string |
kind | string | `wearable`, `pet`, `animation`, `move` or `ability`.
price | int | In stars.
media_id | int | The item's picture, one of the scenario's media. (Platform items have an `image_url` instead.)
slot | string | Wearables: `head`, `body`, `back` or `hand`. One item per slot is worn at a time.
scale | decimal | Wearables and pets: height as a fraction of the avatar's height, so an item fits avatars of any size.
offset_x, offset_y | decimal | Wearables and pets: a nudge forward and down, in avatar heights.
animation | string | Animations: `bounce`, `float`, `sway` or `pulse`. How the avatar moves while standing.
move | string | Moves: the animation a button on the player's screen plays, in every scenario. See [Moves](/docs/developers/extensions/animations/#moves-what-players-can-do-themselves).
ability | string | Abilities: a key. While equipped, `QL_Ability_<key>` is 1.

```json
"shop_items": [
  { "id": 101, "name": "Wilting Stream patch", "kind": "wearable", "slot": "body", "price": 20, "media_id": 46, "scale": 0.14 },
  { "id": 102, "name": "Stream survey map", "kind": "ability", "price": 15, "media_id": 47, "ability": "stream_map" }
]
```

A player owns what they buy for good, and chooses what to have on: one wearable per slot, one pet, one animation (a way of standing: bounce, float, sway, pulse), and any number of moves and abilities. What a player wears is drawn on their avatar in every scenario and is seen by the other players.

**Abilities do nothing by themselves.** They are a flag scenarios can test, so what an ability unlocks is up to each author: a hotspot only its owners see, an extra line of dialogue, a shortcut. They never change walking speed or how far away a hotspot is revealed. In the demo, the survey map makes a map table appear at the landing site:

```json
{ "shortname": "survey-map", "conditions": [{ "variable": "QL_Ability_stream_map", "operator": "=", "operand": 1 }], "...": "..." }
```
