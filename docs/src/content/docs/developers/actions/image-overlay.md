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

## Image Alignment
The image alignment is used when the image is fixed, and will pop up at a certain position on the screen according to the chart below.

Value | Description
----- | -----------
top left | top center | top right
center left | center center | center right
bottom left | bottom center | bottom right
