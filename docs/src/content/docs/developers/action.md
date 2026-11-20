---
title: "Actions"
---

An event consists of actions, and actions describe what happens when the user interacts with a scene. Actions are executed in sequential order, and actions from different events can be run simultaneously.

### Primary Attributes
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
content | string | | The text to show in the box (HTML allowed). [ext] Can hold pages, slideshows, video, sound, cards, callouts, answer boxes and glossary words: see [Rich infoboxes](/docs/developers/extensions/#rich-infoboxes).
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
  random | Generate a random number between 1 and 1000000000 and assign it to the variable. To narrow the results, follow it up with another variable action, using modulus (%). For example, to get a number between 1 and 20, generate the random number, then apply “% 20” to it.

## Video
Play a video (MP4) file. Currently under revision.

## Wait
Waits a specified amount of time before proceeding with the next action.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
duration | int |  | The number of milliseconds to wait. If 0 or less, the wait action is bypassed.
