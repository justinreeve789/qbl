---
title: "Actions"
description: "Every action a mission can take, grouped as the editor groups them, with one page for each."
host:
  who: mallory
  says: "Every action a mission can take, field by field."
  side: right
---

An event consists of actions, and actions describe what happens when the user interacts with a scene. Actions are executed in sequential order, and actions from different events can be run simultaneously. There are 29 kinds, grouped here as they are in the editor's **Add action** menu; each has its own page.

## Attributes every action has

Parameter | Type | Default | Description
--------- |-----|---------| -----------
id | int |  | action id
event_id | int |  | The event id the action is associated with.
type | string |  | The type of action. Different actions may require different attributes to be present, and these are listed on each action's page.
sequence | int |  | The order the action executes in the event.
blocking | bool | true | If true, this action must complete before the next action in the sequence executes. If false, the next action will execute immediately after this action executes. This is used in situations where two or more actions must occur simultaneously, such as an audio and text action to show a character speaking with subtitles.
media_id | int |  | An id for a media object defined at the project level, in the assets. Not all action types require media.

Action `type` values are matched loosely: `Image Fixed`, `imageFixed` and `image_fixed` are the same. The canonical names are the ones in the tables below.

Actions may carry their own `conditions` array (see [Conditions](/docs/developers/condition/)). An action whose conditions fail is skipped.

An action with no end (an image or text with `duration` 0, repeating audio, a repeating spritemap) never holds up the sequence, whatever `blocking` says. It stays until a cancel or a jump.

## Talking and storytelling

Action | What it does
------ | ------------
[`dialogue`](/docs/developers/actions/dialogue/) | Says a line: a speech bubble over someone, or a story box with their portrait
[`narration`](/docs/developers/actions/narration/) | The narrator speaks: a story box with no portrait
[`conversation`](/docs/developers/actions/conversation/) | A dialogue tree the player takes part in

Text can be read aloud with each word highlighted as it is spoken: see [Reading text aloud](/docs/developers/actions/reading-aloud/).

## Boxes and words on screen

Action | What it does
------ | ------------
[`infobox`](/docs/developers/actions/infobox/) | A box of pages, pictures, questions, instruments, formulas and graphs, with buttons
[`text_overlay`](/docs/developers/actions/text-overlay/) | A line of text over everything else

## Characters and the player

Action | What it does
------ | ------------
[`walk`](/docs/developers/actions/walk/) | Walks a character or the player somewhere, around obstacles
[`animate`](/docs/developers/actions/animate/) | Plays an animation on something in the scene
[`freeze`](/docs/developers/actions/freeze/) | Stops the player from walking, or lets them walk again
[`avatar`](/docs/developers/actions/avatar/) | Shows or hides the player's own avatar

## Pictures, video and sound

Action | What it does
------ | ------------
[`image_fixed`](/docs/developers/actions/image-fixed/) | A picture fixed in one place on the screen
[`image_overlay`](/docs/developers/actions/image-overlay/) | A picture shown over the scene
[`spritemap`](/docs/developers/actions/spritemap/) | A sprite sheet, animated
[`video`](/docs/developers/actions/video/) | A video
[`audio`](/docs/developers/actions/audio/) | A sound file, or one of the game's own sounds
[`translate`](/docs/developers/actions/translate/) | Moves, resizes or fades something already on screen

## Scenes, camera and weather

Action | What it does
------ | ------------
[`jump`](/docs/developers/actions/jump/) | Goes to another scene
[`camera`](/docs/developers/actions/camera/) | Points the player's view
[`weather`](/docs/developers/actions/weather/) | Changes the weather
[`travel`](/docs/developers/actions/travel/) | Takes the player to the mission their teacher launched
[`open_url`](/docs/developers/actions/open-url/) | Opens a web address, such as `{{QL_SCENARIO_LAUNCH_URL}}`

## Timing and flow

Action | What it does
------ | ------------
[`wait`](/docs/developers/actions/wait/) | Pauses before the next action
[`run_event`](/docs/developers/actions/run-event/) | Runs an indirect event
[`repeat`](/docs/developers/actions/repeat/) | Starts the event again from its first action
[`cancel`](/docs/developers/actions/cancel/) | Stops another action that is running
[`cancel_event`](/docs/developers/actions/cancel-event/) | Stops a whole event that is running

## Rewards and progress

Action | What it does
------ | ------------
[`award`](/docs/developers/actions/award/) | Gives stars, XP and badges
[`glossary`](/docs/developers/actions/glossary/) | Gives the player a glossary word
[`variable`](/docs/developers/actions/variable/) | Sets or changes a variable
[`shop`](/docs/developers/actions/shop/) | Opens the marketplace

## Science

Action | What it does
------ | ------------
[`bench`](/docs/developers/actions/bench/) | Works the scene's close-up bench
