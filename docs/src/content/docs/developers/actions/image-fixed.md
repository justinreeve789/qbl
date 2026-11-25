---
title: "Image fixed"
description: "Shows a picture in a fixed position on the screen."
---

`type`: `image_fixed`

Display an image (JPEG or PNG) file in a fixed position on the scene.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
position_x | decimal |  | The X coordinate for the image.
position_y | decimal |  | The Y coordinate for the image.
scale_x | decimal | 1.0 |  | Multiplicator to horizontally stretch the image.
scale_y | decimal | 1.0 |  | Multiplicator to vertically stretch the image.
duration | int |  |  | The number of milliseconds the image displays before disappearing. If “0” the image displays indefinitely, until a jump or cancel action removes it.

More fields:

Parameter | Description
--------- | -----------
layer | `above` (default) draws over avatars and foregrounds. `sorted` depth-sorts with avatars using `position_y`, so players can walk in front of it.
