---
title: "Animate"
description: "Plays an animation on the player, a character, an item or a picture."
---

`type`: `animate`

The `animate` action plays an animation on something in the scene. See [Animations](/docs/developers/extensions/animations/) for where animations come from.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
animation | string | | The animation's name: one of the character's or avatar's animations (not a pose), one defined on an item's sprite sheet, or a built-in move (`jump`, `spin`, `crouch`, `wave`, `dance`). Empty: stop what is playing and return to standing and walking.
target | string | player | `player`: the avatar of the player whose event this is. `item`: an item or vehicle, on the floor of this scene or being worn or ridden. `character`: a character placed in this scene. `action`: a picture that an `image_fixed` action is showing.
item_id, character_id, target_id | int | | Which item, character or action, for those targets.

```json
{ "type": "animate", "target": "character", "character_id": 1, "animation": "wave", "blocking": false }
```

With `blocking` (the default) the sequence waits until a one-pass animation has finished; a looping one never holds it up. An animation on a **player's avatar goes through the game server**, so everyone in the scene sees it, whatever the event's audience. An animation on an item, a character or a picture is shown to the other players only when the event's `audience` is `scene`, like anything else an event shows.
