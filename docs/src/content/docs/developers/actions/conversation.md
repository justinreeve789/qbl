---
title: "Conversation"
description: "A dialogue tree: lines said by the player or a character, with choices that lead to the next line."
---

`type`: `conversation`

The `conversation` action is a conversation the player takes part in: a **dialogue tree**. It is a list of lines, each said by the player or a character. After a line the player picks what to say next from its **choices**, and each choice leads to another line, or ends the conversation. Choices can lead back to a line already said, so a conversation can return to a "hub" ("Anything else?"). A line without choices goes straight on to its `next` line.

It is separate from `dialogue`, which says one line. The whole tree lives inside the one action, so it travels with the event, is duplicated and exported with it, and needs no ids of its own beyond the lines' names.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
lines | array | | The lines, below. At least one. Their order is the author's (the editor lets it be changed); the conversation goes by `start`, `next` and the choices. Lines that run on with `next` and no choices are said one after another, each in its own box, before the player answers the last.
start | string | the first line | The `id` of the line it starts with.
style | string | portrait | `portrait`: each line in a story box with the speaker's close-up. `bubble`: each line in a bubble over its speaker. Either way a line's choices come after it, once it has been said: as a story box of the player's own (their close-up and name), or for bubbles a plain box at the bottom of the screen.
narrate | bool | the scenario's | Read the lines aloud, each in its speaker's voice. See [Reading text aloud](/docs/developers/actions/reading-aloud/).

**A line**

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
id | string | | Unique within the conversation: 1 to 32 letters, digits, `-` and `_`. What choices and `next` point at.
speaker | string | player | `player`, or `character`.
character_id | int | | The character, when `speaker` is `character`. As a bubble it must be placed in the scene; a story box can carry a voice from anywhere.
text | string | | What is said. `{{variable}}` placeholders work.
narration_media_id | int | | A recording of this line, played instead of the browser's voice.
conditions | array | | The line is said only while these hold. Otherwise the conversation passes over it to its `next`, so one line can stand in for another ("Back again?" before "Hello, stranger").
choices | array | | What the player can say in reply, below. Only those whose conditions hold are offered.
next | string | | Where it goes when it has no choices to offer: another line's `id`. Absent: the conversation ends.

**A choice**

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | The answer as the player sees it. `{{variable}}` placeholders work.
next | string | | The line it leads to. Absent: choosing it ends the conversation.
actions | array | | Actions done when it is chosen, in order, before the next line. They need no ids. A `jump` ends the conversation (and the event, as a jump of its own would).
conditions | array | | Offered only while these hold.
correct | bool | | For the teacher's report: a right answer. When any choice of a line is marked, the report says whether each student's first answer to it was right.

```json
{
  "type": "conversation",
  "lines": [
    { "id": "hello", "speaker": "character", "character_id": 1, "text": "Ready for your briefing, {{QL_PlayerName}}?", "next": "ask" },
    {
      "id": "ask", "speaker": "character", "character_id": 1, "text": "What do plants need to grow?",
      "choices": [
        { "text": "Sunlight and water", "correct": true, "next": "right", "actions": [{ "type": "variable", "name": "briefed", "operator": "set", "operand": 1 }] },
        { "text": "Only soil", "next": "wrong" }
      ]
    },
    { "id": "wrong", "speaker": "character", "character_id": 1, "text": "Not quite. Think about the sun.", "next": "ask" },
    { "id": "right", "speaker": "character", "character_id": 1, "text": "Exactly. Off you go!" }
  ]
}
```

How it runs:

* The action waits until the conversation is over (unless `blocking` is `false`), so the event's next action comes after it.
* While the player is choosing they cannot walk away. A line with nothing to choose is shown as a `dialogue` would be: a story box the player clicks on from, or a bubble that stays long enough to read. Players pick an answer by clicking it or pressing its number.
* What a choice does happens inside the event, as if its actions were the event's own: a `freeze` lasts to the end of the event, a `run_event` waits, a `cancel` naming the conversation ends it. A choice's actions cannot `repeat` the event. An `award` in a choice is not granted (awards are checked against the events' own actions): have the choice `run_event` an event that gives it.
* It is the player's own, like an infobox: an event whose audience is the scene does not show it to the other players.
* Each answer is logged as a `choice` with the reference `<action id>:<line id>`, so the report lists every line with choices as a question, with the first answer and how many tries it took.
* Lines that lead round in a circle with no choice to leave are stopped after 200 lines. The validator reports choices and lines that lead to a line that is not there, lines no choice leads to, and duplicate ids.
