---
title: "Dialogue, conversations and infoboxes"
description: "The dialogue, narration and conversation actions, reading text aloud, the glossary and rich infoboxes."
host:
  who: pinta
  says: "Everything that talks: bubbles, story boxes, the narrator, dialogue trees and infoboxes."
  side: right
---

## Dialogue

A new action type, `dialogue`, shows what someone says: in a speech bubble over them, or in a story box with their portrait.

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

The bubble follows the speaker and keeps itself on screen. It sits above them when there is room, below when they are near the top of the screen, and to the right or left when there is room neither above nor below; sideways it slides along to stay inside the screen while its tail keeps pointing at the speaker. A sequence of dialogue actions is a conversation; put a `freeze` before it to hold the player still. For one where the player chooses what to say, use a [conversation](#conversations-dialogue-trees).

**The story box** (`style: "portrait"`) is for the characters and moments that carry the story. It is a panel across the bottom of the screen with the speaker's close-up portrait standing on its edge, their name, and the words appearing a few at a time. The player clicks, or presses Enter or Space, to continue: once to show the whole line, again to go on. The portrait is the speaker's `portrait` animation (or the character standing, if it has none): a character's, or for the player their avatar's.

```json
{ "type": "dialogue", "style": "portrait", "speaker": "character", "character_id": 1, "text": "Welcome aboard, {{QL_PlayerName}}! I am Captain Vega." }
```

A story conversation is normally the player's own (`audience: player`, the default), as the captain's greeting in the demo is. If its event is shown to the scene, the other players get a smaller version at the top of the screen that closes by itself and never takes their clicks or keys.

## The narrator

A new action type, `narration`, is the narrator speaking: the same story box as a portrait dialogue, with no close-up and no name, its words centred. It is for what no character says: setting the scene, what happens next, a word from the storyteller.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
text | string | | What the narrator says. May contain `{{variable}}` placeholders.
duration | int | 0 | Milliseconds it stays. 0 or absent: until the player clicks, or presses Enter or Space, to continue (once to show the whole line, again to go on). With a duration it closes by itself, but not before the voice has finished.
narrate | bool | true | A narration is read aloud whatever the scenario's `narration` setting, unless this is `false`.
narration_media_id | int | | Its recording, made in the scenario's [narrator's voice](#reading-text-aloud) by "Record voices".

```json
{ "type": "narration", "text": "Long ago, beyond the edge of every map, there was a valley where the rivers ran uphill." }
```

Shown to the scene (`audience: scene`), the other players get the smaller box at the top of the screen that closes by itself, as with a story conversation.

## Conversations (dialogue trees)

A new action type, `conversation`, is a conversation the player takes part in: a **dialogue tree**. It is a list of lines, each said by the player or a character. After a line the player picks what to say next from its **choices**, and each choice leads to another line, or ends the conversation. Choices can lead back to a line already said, so a conversation can return to a "hub" ("Anything else?"). A line without choices goes straight on to its `next` line.

It is separate from `dialogue`, which says one line. The whole tree lives inside the one action, so it travels with the event, is duplicated and exported with it, and needs no ids of its own beyond the lines' names.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
lines | array | | The lines, below. At least one. Their order is the author's (the editor lets it be changed); the conversation goes by `start`, `next` and the choices. Lines that run on with `next` and no choices are said one after another, each in its own box, before the player answers the last.
start | string | the first line | The `id` of the line it starts with.
style | string | portrait | `portrait`: each line in a story box with the speaker's close-up. `bubble`: each line in a bubble over its speaker. Either way a line's choices come after it, once it has been said: as a story box of the player's own (their close-up and name), or for bubbles a plain box at the bottom of the screen.
narrate | bool | the scenario's | Read the lines aloud, each in its speaker's voice. See [Reading text aloud](#reading-text-aloud).

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

## Reading text aloud

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

## Glossary

A scenario can teach words. `glossary` on the scenario lists them; players see the ones they have in the side panel, in alphabetical order, and can search them.

Parameter | Type | Description
--------- | ---- | -----------
id | string or int | Unique within the scenario.
term | string | The word.
definition | string | What it means. `{{variable}}` placeholders work.
media_id | int | A picture, optional.
initial | bool | In every player's glossary from the start. Otherwise a `glossary` action adds it.

A new action type, `glossary`, gives the player a word:

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
entry_id | string or int | | The entry's `id`.
quiet | bool | false | Add it without telling the player.

```json
{ "type": "glossary", "entry_id": "ph" }
```

A player gets each word once (they are told, and the word is marked as new in the panel). Words are kept with the player's save, as flags (`glossary:<id>`), so they are still there next visit. The action never holds up the sequence. Which words each student has is part of the teacher's report.

## Rich infoboxes

An infobox's `content` is still one string of HTML, so a document written for the original spec plays unchanged and HTML can still be written by hand. Richer parts are ordinary HTML marked with `data-qbl`; the game makes them interactive, and anything else reading the document sees plain HTML. They are listed in `packages/shared/src/infobox.ts`.

Markup | What players get
------ | ----------------
`<hr data-qbl="page">` | A new page. The box steps through its pages with Next and Back (and ← →), with dots showing where the player is; its buttons are offered on the last page. Each page is read aloud as it is shown.
`<img src="{{media:ID}}">`, `<figure data-size="small\|medium">…<figcaption>` | A picture, tapped to see it large. `data-size` on the `figure` or the `img`; full width without it.
`<video src="{{media:ID}}">`, `<audio src="…">` | Played with their controls. `autoplay` (a video then starts muted) and `loop` are kept.
`<div data-qbl="gallery">` of `<figure>`s or `<img>`s | A slideshow: swipe, arrows, dots, ← →.
`<details><summary>Prompt</summary>…</details>` | A card that opens smoothly. What it hides is not read aloud.
`<div data-qbl="flip"><div>front</div><div>back</div></div>` | A card that turns over when tapped. The back is not read aloud.
`<div data-qbl="callout" data-tone="tip\|fact\|warn\|think">` | A coloured note with an icon.
`<input data-qbl="answer" data-var="name" placeholder="…">` | A box to type in. When a button is chosen, what was typed is saved in the variable (`set`; a number when it reads as one) before the button's action runs. The first button waits until every answer box has something in it. The answer is logged with the choice for the report: `“7” (Check)`.
`<span data-qbl="word" data-word="ID">word</span>` | A glossary word. Tapped, a card says what it means and the entry is added to the player's glossary (logged as a `glossary` activity, like a `glossary` action).

A `{{media:ID}}` written on its own in the text, not inside a tag, shows the media itself: a picture, a video or a sound.

**Controls**, for hands-on instruments with many parts side by side. Each control has a variable (`data-var`, which must be declared) that its value is saved in when a button of the box is chosen, before the button's action runs, as an answer box's is; until then the box shows what it would do. The values are logged with the choice, like answers. `{{name}}` in an attribute puts a variable's value there, so `data-value="{{rope}}"` opens the box as the player left it.

Markup | What players get
------ | ----------------
`<div data-qbl="panel">…</div>` | A bench: what is in it stands side by side, two or three across (one column on a narrow screen).
`<input data-qbl="slider" data-var="rope" data-min="0" data-max="20" data-step="1" data-value="8" data-unit=" m" data-label="Rope">` | A number set by sliding, with its label, its value and both ends. The value is saved as a number.
`<input data-qbl="switch" data-var="brake" data-value="1" data-label="Brake">` | A switch, on (1) or off (0).
`<div data-qbl="wheel" data-var="wind" data-options="Calm\|Breezy\|Calm" data-label="Wind"></div>` | A wheel of chance. Spin turns it for a couple of seconds and it lands on one of its options at random; repeat an option to make it likelier. `data-spins` limits how often it can be spun in one showing; `data-value` shows where it last landed (kept unless spun again). Nothing is saved until it has landed.
`<span data-qbl="value" data-var="rope"></span>` | A control's value as it is now (or any variable's).
`<div data-qbl="meter" data-var="rope" data-min="0" data-max="20" data-label="Rope out"></div>` | A bar showing a value between its ends.
`<div data-qbl="when" data-when="rope >= 12; brake = 1">…</div>` | Shown only while every condition holds (`=`, `!=`, `<`, `>`, `<=`, `>=`, `%`, `!%`, separated by `;` or `,`), on the controls as they are set now and on variables. It appears with a little lift, and a screen reader hears it.

**Maths, worked-out values and graphs.** Formulas are worked out with math.js (`@qbl/shared/formula`, an entry of its own so that only a box with a formula loads it), typeset with KaTeX and drawn with JSXGraph. Each is loaded the first time a box needs it.

Markup | What players get
------ | ----------------
`<div data-qbl="math" data-tex="\frac{m}{V}">m / V</div>`, `<span data-qbl="math" data-tex="x^2">x^2</span>` | Maths typeset by KaTeX, on a line of its own (`div`) or in a line of text (`span`). `\ce{2H2 + O2 -> 2H2O}` sets chemistry (KaTeX's mhchem). What is inside the tag is what a reader without KaTeX shows. It is not read aloud.
`<span data-qbl="calc" data-formula="mass / volume" data-digits="2" data-unit="g/mL" data-var="density"></span>` | A formula's value, from the controls as they are now and from variables. With `data-var` (which must be declared) it is saved there when a button is chosen, and values, meters and `when` blocks of the box can read it at once. A dash when the formula has no value.
`<input data-qbl="answer" data-var="a" data-accept="9.8 m/s^2" data-tolerance="2%" data-check="a_right">` | An answer box that is checked. When a button is chosen, `data-check` (declared) is set to 1 if what was typed is `data-accept`, else 0. `data-accept` is a number, a quantity with a unit (right in any unit of its kind; a bare number is then wrong), a formula of variables, or words; `\|` separates several. `data-tolerance` is a share (`5%`) or an amount. What is typed is worked out with no variables.
`<div data-qbl="graph" data-fn="a*x^2; sin(x)" data-x="-5,5" data-y="-5,5" data-points="px,py=1,2; qx,qy=3,1" data-join="line" data-snap="1" data-series="log" data-xlabel="t" data-ylabel="h" data-label="Title"></div>` | Axes with a curve for each formula of `x` in `data-fn` (other names are controls and variables: curves follow sliders), points the player drags (`xVar,yVar=x,y`; saved in their two declared variables when a button is chosen; `data-snap` makes them land on multiples), joined as `data-join` says (`line` through the first two, `segment`s in order, a `polygon`), and the data recorded in the variable `data-series` as `x,y;x,y` (what a bench's graph keeps).

A formula is written as math.js reads it: `+ - * / ^`, brackets, `sqrt`, `sin`, `round(x, 1)`, `pi`, and quantities with units (`(2 m + 50 cm) to cm`). A variable with nothing in it counts as 0. The parts of math.js that reach outside a formula (`import`, `createUnit`, `evaluate`, `parse` and the like) are switched off, since formulas are written by authors and answers typed by players. The validator reports a formula whose brackets do not match, a point, worked-out value or check whose variable is not declared, and warns of a name a formula reads that is neither a control of the box nor a variable.

The buttons do the testing: a "Test" button sets a variable, and conditions on the following actions read the controls' variables (see how the generator builds an [instrument](/docs/developers/generation/)). The validator reports a control whose variable is not declared, and a value, meter or `when` block that reads a variable that is neither a control in the box, an answer, a declared variable nor a reserved one.

Each button in `call_to_actions` can have a `mark`. `right`: the button turns green with a tick and a burst of stars for about 650 ms before the box closes and the button's action runs. `wrong`: it turns red and shakes, then the same. `try_again`: it shakes and is crossed out and **the box stays open**; its action, if any, runs while it does, and the box waits for it. The choice is logged either way, so the report's first answer is still the first one chosen. A box with `dismissible: false` needs at least one button that is always offered and is not `try_again`.

The box opens with a short spring and closes with a fade. When a button's action opens another infobox, the two share the backdrop and cross over. A box opened over another (a `try_again` button's infobox) leaves the one below inert until it closes. Everything moves less when the player's system asks for reduced motion.

When a scenario is copied or imported, `{{media:ID}}` placeholders in any text are pointed at the copied media.
