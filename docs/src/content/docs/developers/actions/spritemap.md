---
title: "Spritemap"
description: "Shows and animates a sprite sheet."
---

`type`: `spritemap`

Display and animate a spritemap (JPEG or PNG) file (PNG recommended). Spritemap attributes follow a standard format regardless of whether they occur in an action, hotspot, or other data structure in the JSON specification.

See the Spritemap specification for more details.

More fields:

Parameter | Description
--------- | -----------
layer | `above` (default) draws over avatars and foregrounds. `sorted` depth-sorts with avatars using `position_y`, so players can walk in front of it.
