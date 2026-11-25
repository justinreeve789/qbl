---
title: "Items, the bag and vehicles"
description: "Item placements, blocking and solid items, wearables, the bag, and vehicles as single objects."
host:
  who: sam
  says: "Things to place, pick up, wear and ride."
  side: right
---

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
media_id | int | | Image for the item.
scale | decimal | 1.0 | Display scale.
blocking_radius | decimal | 40 | Size of the obstacle for `blocking` items.
placement | string | object | `object`: sorted among the players by where it stands. `background`: it lies on the floor and everyone walks over it.
sort_line | array | | Objects only: where the item meets the floor, for something that runs into the room at an angle (a counter, a bench seen from the side). At least two `[x, y]` points along its base, each a fraction of its picture (0 left/top, 1 right/bottom), e.g. `[[0, 0.6], [0.5, 0.93], [1, 1]]`. A figure (avatar, character or pet) overlapping the picture whose feet are below the line where it stands is drawn in front of the item; one above it is drawn behind it. The line is straight between its points and level beyond its ends, and is mirrored with the picture. The item itself is drawn at the depth of the line's lowest point. Unset: the bottom edge of the picture is the line.
attach_offset_x, attach_offset_y | decimal | 0 | Where the item sits relative to the avatar's feet while worn or ridden. X is mirrored when the avatar faces left.
attach_layer | string | front | `front` or `behind` the avatar.
art_faces | string | right | Which way the artwork faces. It is mirrored to match the avatar.
hide_rider_below | decimal | | While worn or ridden, the avatar (and what it wears) is not drawn below this line: a fraction of the item's picture height, 0 at its top and 1 at its bottom. Lets a rider sit in a UFO or a car instead of their legs showing beneath it. Unset: the whole avatar is drawn.
speed_multiplier | decimal | 1.5 | Vehicles: walking speed while riding.

Items are positioned by the bottom centre of their image, like avatars.

**Wearables and vehicles** work the same way: clicking one within reach attaches it to the avatar, and a button on screen removes it. A player can ride one vehicle at a time.

* `unique: true`: one exists per room. While someone has it nobody else can take it, and when they let go (or disconnect) it stays where they stood, in whatever scene that is. Its position is saved with the room.
* `unique: false`: every player has their own. It disappears from the floor for the player using it and is saved with that player.

`blocking` is implemented. `physical` (pushable objects) is **not implemented yet**.

## The bag: point-and-click things

An item with `carried_when` is something players carry, as in a point-and-click adventure. While its conditions hold (usually a player's own variable, set to 1 by the event that picks it up and back to 0 when it is used up) it is in the player's **bag**: a bar of pictures at the foot of their screen.

Parameter | Type | Description
--------- | ---- | -----------
carried_when | conditions | The item is in the player's bag while these hold. Absent: it is never carried.
description | string | What the player reads when they point at it in their bag.

Using a thing works through one reserved variable, `QL_Holding`. The player picks a thing in the bag (it is marked, with a line saying what to do), then:

* **clicks something in the scene.** Only hotspots that **take things** run: those whose conditions, or the conditions of one of their own actions or of an event they run, test `QL_Holding`. Give the hotspot that uses the rope the condition `QL_Holding = <the rope's id>` and it is there only while the rope is picked. Anything else clickable under the pointer says "That does not work there." Clicking empty floor walks there, still holding the thing.
* **clicks a character.** Their click event runs if it takes things (tests `QL_Holding`), so it can thank them for the right thing and turn down anything else; otherwise the player is told the character does not need that.
* **picks a second thing.** If `combinations` has the pair, its actions are done; otherwise the player is told the two do not go together. Picking the same thing again, or pressing Escape, puts it back.

`QL_Holding` keeps the thing's id until whatever the click started has finished, so every action of the event can test it; the bag lets go at once. What happens to the thing is up to the event: set its variable to 0 to use it up, or leave it to keep it.

```json
"combinations": [{
  "items": [21, 22],
  "actions": [
    { "type": "variable", "name": "has_rope", "operator": "set", "operand": 0 },
    { "type": "variable", "name": "has_hook", "operator": "set", "operand": 0 },
    { "type": "variable", "name": "has_grapple", "operator": "set", "operand": 1 },
    { "type": "text_overlay", "text": "You tie the hook to the rope.", "duration": 3000 }
  ]
}]
```

A combination's actions need no ids and are done in whatever scene the player is in, so they are the kinds that work anywhere: `variable`, `text_overlay`, `audio`, `glossary`, `infobox`, `wait`, and `dialogue` said by the player. A combination can have `conditions`. The validator checks that both items exist and can be carried.

## Vehicles are single objects

A vehicle is always `unique`, whatever the document says: there is one of it in the room. It goes with whoever is riding it, across scenes. When the rider gets out it stays in that scene at that spot, where any player can climb in. Where vehicles were left is part of the room's saved data, so a vehicle left on the planet is still on the planet next lesson.
