---
title: "Infobox"
description: "Opens a box of text, pictures, questions, instruments and buttons."
---

`type`: `infobox`

Open an informational box.

Parameter | Type   | Default         | Description                                                    
--------- |--------|-----------------|----------------------------------------------------------------
content | string | | The text to show in the box (HTML allowed). Can hold pages, slideshows, video, sound, cards, callouts, answer boxes and glossary words: see [Rich infoboxes](/docs/developers/actions/infobox/#rich-infoboxes).
call_to_actions | json   | null | A list of buttons, each containing (1) a string, and (2) an action that is performed when clicked or tapped. A button can have a `mark`: `right`, `wrong` or `try_again`.

More fields:

Parameter | Description
--------- | -----------
dismissible | Default true. See below.
media_id, size, accent | A picture or video (`media_id`) drawn across the top; `small`, `medium` (default) or `large`; a CSS colour for the edge and main buttons. See [Rich infoboxes](/docs/developers/actions/infobox/#rich-infoboxes).
mark | `right`, `wrong` or `try_again`. See [Rich infoboxes](/docs/developers/actions/infobox/#rich-infoboxes).

* `call_to_actions` is a list of `{"text": "...", "action": {...}, "conditions": [...]}`. The action needs no `id`. A button with `conditions` is only offered while they hold, so one infobox can serve as a menu that changes.
* An infobox has a close button unless `dismissible` is `false`. A box that cannot be dismissed must be answered with one of its buttons, which is how questions are asked.
* An infobox action is not finished until the box is closed **and** the chosen button's action has run to its end. A sequence such as "ask a question, then open a menu" therefore waits for the feedback the answer triggers.
* Infobox `content` is sanitised. Formatting, lists, tables, links, images, video, sound and the blocks below are kept; scripts, styles, classes, frames, forms and event handlers are removed.

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
