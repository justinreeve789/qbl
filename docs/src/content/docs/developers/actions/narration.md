---
title: "Narration"
description: "The narrator speaks: a story box with no portrait and no name."
---

`type`: `narration`

The `narration` action is the narrator speaking: the same story box as a portrait dialogue, with no close-up and no name, its words centred. It is for what no character says: setting the scene, what happens next, a word from the storyteller.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | What the narrator says. May contain `{{variable}}` placeholders.
duration | int | 0 | Milliseconds it stays. 0 or absent: until the player clicks, or presses Enter or Space, to continue (once to show the whole line, again to go on). With a duration it closes by itself, but not before the voice has finished.
narrate | bool | true | A narration is read aloud whatever the scenario's `narration` setting, unless this is `false`.
narration_media_id | int | | Its recording, made in the scenario's [narrator's voice](/docs/developers/actions/reading-aloud/) by "Record voices".

```json
{ "type": "narration", "text": "Long ago, beyond the edge of every map, there was a valley where the rivers ran uphill." }
```

Shown to the scene (`audience: scene`), the other players get the smaller box at the top of the screen that closes by itself, as with a story conversation.
