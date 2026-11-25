---
title: "Dialogue"
description: "Says a line: a speech bubble over someone, or a story box with their portrait."
---

`type`: `dialogue`

The `dialogue` action shows what someone says: in a speech bubble over them, or in a story box with their portrait.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | What is said. `{{variable}}` placeholders work.
speaker | string | player | `player`, or `character`.
character_id | int | | The character, when `speaker` is `character`. For a bubble it must be placed in the scene; a story box can carry a voice from anywhere.
style | string | bubble | `bubble`: a speech bubble over the speaker. `portrait`: a story box.
duration | int | | Milliseconds on screen. Absent: a bubble stays long enough to read, and a story box stays until the player continues. A click closes either sooner.

```json
{ "type": "dialogue", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QL_PlayerName}}!" }
```

The bubble follows the speaker and keeps itself on screen. It sits above them when there is room, below when they are near the top of the screen, and to the right or left when there is room neither above nor below; sideways it slides along to stay inside the screen while its tail keeps pointing at the speaker. A sequence of dialogue actions is a conversation; put a `freeze` before it to hold the player still. For one where the player chooses what to say, use a [conversation](/docs/developers/actions/conversation/).

**The story box** (`style: "portrait"`) is for the characters and moments that carry the story. It is a panel across the bottom of the screen with the speaker's close-up portrait standing on its edge, their name, and the words appearing a few at a time. The player clicks, or presses Enter or Space, to continue: once to show the whole line, again to go on. The portrait is the speaker's `portrait` animation (or the character standing, if it has none): a character's, or for the player their avatar's.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QL_PlayerName}}! I am Captain Vega." }
```

A story conversation is normally the player's own (`audience: player`, the default), as the captain's greeting in the demo is. If its event is shown to the scene, the other players get a smaller version at the top of the screen that closes by itself and never takes their clicks or keys.
