---
title: "Reading text aloud"
description: "How dialogue, narration, infoboxes and text overlays are read aloud, with each word highlighted."
---

Dialogue, infoboxes and text overlays can be read aloud, with **each word highlighted as it is spoken**. The voice is the one built into the player's browser (the Web Speech API): it costs nothing, needs no recordings and no server, and works with whatever voices the device has. The browser reports each word as it starts speaking it, and that is what moves the highlight; where a voice does not report its progress, the words are paced evenly over the time the line takes, allowing for longer words and for the pauses punctuation makes.

Parameter | Applies to | Default | Description
--------- | ---------- | ------- | -----------
narration | scenario | off | `on`: read everything unless an action says otherwise.
narrate | dialogue, narration, conversation, infobox, text_overlay | the scenario's (a narration's: `true`) | `true` or `false` for this action.
narration_media_id | dialogue, narration, infobox, text_overlay, a conversation's line | | An audio recording to play instead of the browser's voice. When the recording has word timings (`speech`, below), each word is lit as the recording says it; otherwise the words are paced evenly over its length.
speech | media (audio) | | The recording's words and when each is said: `{text, line?, voice?, engine?, words: [{w, s, e}], duration?}`, in milliseconds. Recordings made by the server's text-to-speech service have it. See [Characters' voices](/docs/developers/voices/).
narrator_voice | scenario | the default narrator | The voice what no character says is recorded in: narrations, and the text overlays and infoboxes read aloud. `none`: the browser reads them. See [Characters' voices](/docs/developers/voices/#the-narrator).
tts_voice | character | | The voice the character's lines are recorded in: a key of the server's voice catalog ("heart", "captain", "robot"). See [Characters' voices](/docs/developers/voices/).
voice_pitch, voice_rate | character | 1 | How the browser's voice sounds reading the character's lines that have no recording: 0 to 2, and 0.5 to 2.
voice_name | character | | For lines with no recording: part of the name of a browser voice to prefer ("female", "Daniel"). Devices differ; where none matches, the default voice reads.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "narrate": true, "text": "Welcome aboard, {{QL_PlayerName}}!" }
```

A speech bubble that is being read stays until the voice has finished. One thing is read at a time: a new line stops the one before. Players have a switch for reading aloud at the foot of the side panel (it is offered when the scenario has anything to read) and their choice is kept in their browser. In the demo the story's portrait dialogue is read.

Browser voices vary in quality from device to device. For a consistent voice, give characters a recorded voice: the server records their lines once with its text-to-speech service (Kokoro, in the `tts` container), with the time of every word, and the highlight follows the recording exactly. See [Characters' voices](/docs/developers/voices/). A recording of your own can be attached with `narration_media_id` too; its words are paced evenly.
