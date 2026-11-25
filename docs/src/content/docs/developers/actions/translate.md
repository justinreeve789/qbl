---
title: "Translate"
description: "Moves, resizes or fades a picture, video or sprite sheet that is on screen."
---

`type`: `translate`

A translation is the movement or alteration of the object in an image, video, or spritemap action, or a hotspot label. Attributes can be overridden as well. A “targetId” must be specified, or this action will be bypassed. Also, the original action must still be running, or this action will be bypassed. (Under revision.)

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
target_id | int |  | An action id of a currently-running action. Actions do not necessarily need to be from the same event sequence in a scene to be translated.

## Image Translation
(Under revision.)

## Video Translation
(Under revision.)

More fields:

Parameter | Description
--------- | -----------
position_x, position_y, scale_x, scale_y, alpha, duration | Values present are animated on the target over `duration` milliseconds. Position applies to `image_fixed` and `spritemap` targets; overlays support scale and alpha.
