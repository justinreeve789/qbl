---
title: "Image overlay"
description: "Shows a picture over the scene."
---

`type`: `image_overlay`

Display an image (JPEG or PNG) file.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
alignment | string | center center | A positioning for the image when it pops up.
scale_x | decimal | 1.0 |  | Multiplicator to horizontally stretch the image.
scale_y | decimal | 1.0 |  | Multiplicator to vertically stretch the image.
duration | int |  |  | The number of milliseconds the image displays before disappearing. If “0” the image displays indefinitely, until a jump or cancel action removes it.
panel | bool | false | [ext] Show it as a story panel. See [Story panels](#story-panels).
motion | string | still | [ext] Panels: how the camera moves over it.
tone | string | | [ext] Panels: `memory` or `dream`.

## Image Alignment
The image alignment is used when the image is fixed, and will pop up at a certain position on the screen according to the chart below.

Value | Description
----- | -----------
top left | top center | top right
center left | center center | center right
bottom left | bottom center | bottom right

## Story panels

An `image_overlay` with `panel: true` is shown like a page of a comic or a shot in a film: the picture fills the play area over a dark backdrop (under the captions, so narration reads over it), fades in and out, and a click moves on.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
panel | bool | false | Show it as a story panel.
duration | int | | Milliseconds it stays. Keep it to 20 seconds at most: the validator warns above that (a still picture gets dull), and when it has none.
motion | string | `still` | How the camera moves over it, slowly, over its duration: `push_in`, `pull_out`, `pan_left`, `pan_right`. Off with reduced motion.
tone | string | | `memory` (warm, faded, a dark vignette: a flashback) or `dream` (hazy and bright).
