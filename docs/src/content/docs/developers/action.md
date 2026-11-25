---
title: "Actions"
host:
  who: mallory
  says: "Every action a mission can take, field by field."
  side: right
---

An event consists of actions, and actions describe what happens when the user interacts with a scene. Actions are executed in sequential order, and actions from different events can be run simultaneously.

:::note[Spec v2]
The runtime adds actions such as `dialogue`, `walk`, `award` and `bench`. They are all listed, with where each is described, on [Actions overview](/docs/developers/extensions/actions/).
:::

## All action types
Every value `type` can take. The first fourteen are described on this page; the rest were added by the runtime and are described on the pages linked.

`type` | What it does | Described in
------ | ------------ | ------------
`audio` | Plays a sound or music | [Audio](#audio)
`cancel` | Stops another action | [Cancel](#cancel)
`image_fixed` | Shows a picture fixed to the screen | [Image Fixed](#image-fixed)
`image_overlay` | Shows a picture in the scene | [Image Overlay](#image-overlay)
`infobox` | Opens a box of text, questions and buttons | [Infobox](#infobox)
`jump` | Goes to another scene | [Jump](#jump)
`repeat` | Repeats actions | [Repeat](#repeat)
`run_event` | Starts another event | [Run Event](#run-event)
`spritemap` | Plays a sprite sheet | [Spritemap](#spritemap)
`text_overlay` | Shows text | [Text Overlay](#text-overlay)
`translate` | Moves, resizes or fades another action's picture or video | [Translate](#translate)
`variable` | Sets or changes a variable | [Variable](#variable)
`video` | Plays a video | [Video](#video)
`wait` | Pauses | [Wait](#wait)
`dialogue` | Says a line | [Dialogue](/docs/developers/extensions/dialogue/#dialogue)
`narration` | The narrator speaks | [The narrator](/docs/developers/extensions/dialogue/#the-narrator)
`conversation` | A dialogue tree | [Conversations](/docs/developers/extensions/dialogue/#conversations-dialogue-trees)
`glossary` | Gives the player a glossary word | [Glossary](/docs/developers/extensions/dialogue/#glossary)
`animate` | Plays an animation | [Animate](/docs/developers/extensions/actions-world/#animate)
`walk` | Walks a character or the player | [Walk](/docs/developers/extensions/actions-world/#walk)
`freeze` | Stops or frees the player's walking | [Freeze](/docs/developers/extensions/actions-world/#freeze)
`avatar` | Shows or hides the player's avatar | [Avatar](/docs/developers/extensions/actions-world/#avatar)
`weather` | Changes the weather | [Weather action](/docs/developers/extensions/actions-world/#weather-action)
`camera` | Points the player's view | [Camera](/docs/developers/extensions/actions-world/#camera)
`cancel_event` | Stops a running event | [Cancel event](/docs/developers/extensions/actions-world/#cancel-event)
`travel` | Takes the player to the launched mission | [Travel](/docs/developers/extensions/actions-world/#travel)
`award` | Gives stars, XP and badges | [Award](/docs/developers/extensions/rewards/#award)
`shop` | Opens the marketplace | [Shop](/docs/developers/extensions/rewards/#shop)
`bench` | Works the close-up bench | [The bench action](/docs/developers/extensions/bench/#the-bench-action)

## Primary Attributes
Parameter | Type | Default | Description
--------- |-----|---------| -----------
id | int |  | action id
event_id | int |  | The event id the action is associated with.
type | string |  | The type of action. Different actions may require different attributes to be present, and these are listed separately below.
sequence | int |  | The order the action executes in the event.
blocking | bool | true | If true, this action must complete before the next action in the sequence executes. If false, the next action will execute immediately after this action executes. This is used in situations where two or more actions must occur simultaneously, such as an audio and text action to show a character speaking with subtitles.
media_id | int |  | An id for a media object defined at the project level, in the assets. Not all action types require media.

## Audio
Play an audio (MP3) file.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
volume | decimal | 1.0 | Volume range from 0.0 to 1.0.
repeat | bool | false | If true, play the audio file on an infinite loop once it reaches the end, until a jump or cancel action stops the file.
persist | bool | false | If true, do not stop playing the audio file after a jump action. Audio actions are the only action types that can persist across scenes.
sound | string | | [ext] One of the game's own sounds instead of a file: `thunder`, `car`, `rain`, `river`, `bell`... See [the game's own sounds](/docs/developers/extensions/actions-world/#the-games-own-sounds).

##  Cancel
Cancel an action that’s currently executing.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
action_id | int |  | An action id of a currently-running action. Actions do not necessarily need to be from the same event sequence in a scene to be cancelled, but they do need to be from the same scene (with the exception of persistent audio).

## Image Fixed
Display an image (JPEG or PNG) file in a fixed position on the scene.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
position_x | decimal |  | The X coordinate for the image.
position_y | decimal |  | The Y coordinate for the image.
scale_x | decimal | 1.0 |  | Multiplicator to horizontally stretch the image.
scale_y | decimal | 1.0 |  | Multiplicator to vertically stretch the image.
duration | int |  |  | The number of milliseconds the image displays before disappearing. If “0” the image displays indefinitely, until a jump or cancel action removes it.

## Image Overlay
Display an image (JPEG or PNG) file.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
alignment | string | center center | A positioning for the image when it pops up.
scale_x | decimal | 1.0 |  | Multiplicator to horizontally stretch the image.
scale_y | decimal | 1.0 |  | Multiplicator to vertically stretch the image.
duration | int |  |  | The number of milliseconds the image displays before disappearing. If “0” the image displays indefinitely, until a jump or cancel action removes it.

### Image Alignment
The image alignment is used when the image is fixed, and will pop up at a certain position on the screen according to the chart below.

Value | Description
----- | -----------
top left | top center | top right
center left | center center | center right
bottom left | bottom center | bottom right

## Infobox
Open an informational box.

Parameter | Type   | Default         | Description                                                    
--------- |--------|-----------------|----------------------------------------------------------------
content | string | | The text to show in the box (HTML allowed). [ext] Can hold pages, slideshows, video, sound, cards, callouts, answer boxes and glossary words: see [Rich infoboxes](/docs/developers/extensions/dialogue/#rich-infoboxes).
call_to_actions | json   | null | A list of buttons, each containing (1) a string, and (2) an action that is performed when clicked or tapped. [ext] A button can have a `mark`: `right`, `wrong` or `try_again`.

## Jump
Load another scene, ending all actions in the current scene (except persistent audio).

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
scene_id | int |  | The scene id to jump to.

## Repeat
Repeat the actions for the event, starting with the first action. If there are any actions after a repeat action, they will never execute, unless the repeat is conditional.

## Run Event
Execute an indirect event.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
event_id | int |  | The event id to execute.

## Spritemap
Display and animate a spritemap (JPEG or PNG) file (PNG recommended). Spritemap attributes follow a standard format regardless of whether they occur in an action, hotspot, or other data structure in the JSON specification.

See the Spritemap specification for more details.

## Text Overlay
Display a text string on the screen, overlaying everything else.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
text | string |  | The text to display (256-character limit).
alignment | string | center center | A positioning for the text when it pops up.
text_font_size | int | 24 | Size for the font, defined in pixel height.
text_font_color | string | white | Color for the font.
text_font_style | string |  | Style for the font (leave blank, or “italic”).
duration | int |  | The number of milliseconds the text displays before disappearing. If “0” the text displays indefinitely, until a jump or cancel action removes it.

### Text Alignment
The text alignment is used when the text is fixed, and will pop up at a certain position on the screen according to the chart below.

Value | Description
----- | -----------
top left | top center | top right
center left | center center | center right
bottom left | bottom center | bottom right

## Translate
A translation is the movement or alteration of the object in an image, video, or spritemap action, or a hotspot label. Attributes can be overridden as well. A “targetId” must be specified, or this action will be bypassed. Also, the original action must still be running, or this action will be bypassed. (Under revision.)

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
target_id | int |  | An action id of a currently-running action. Actions do not necessarily need to be from the same event sequence in a scene to be translated.

### Image Translation
(Under revision.)

### Video Translation
(Under revision.)

## Variable
Set or modify a global variable.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
name | string |  | A global variable that has been defined at the project level. Only dynamic variables by a variable action.
operator | string |  | One of six data manipulation operators to perform on the variable: set, +, -, *, /, %
operand | multiple |  | A number (integer or decimal), or a string, for which the variable is manipulated according to the operator.

### Operator
Value | Description
----- | -----------
set | Assign the variable to the value specified in operand.
+ | Add the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
- | Subtract the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
* | Multiply the numeric variable by the value specified in operand. If the operand is non-numeric, this does nothing.
  / | Divide the numeric variable by the value specified in operand. if the operand is non-numeric, this does nothing.
  % | Modulo the numeric variable by the value specified in operand. if the operand is non-numeric, this does nothing.
  random | Generate a random whole number from 0 up to and including the operand, and assign it to the variable. For example, an operand of 20 gives a number from 0 to 20. A decimal operand is rounded down, and a negative one gives 0. If there is no operand, the number is between 1 and 1000000000 (the original behaviour); narrow that with a following variable action using modulus (%).

## Video
Play a video (MP4) file. Currently under revision.

## Wait
Waits a specified amount of time before proceeding with the next action.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
duration | int |  | The number of milliseconds to wait. If 0 or less, the wait action is bypassed.
