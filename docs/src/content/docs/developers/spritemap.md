---
title: "Spritemaps"
---

A spritemap is an animation that can be used in a label or as an action. A PNG containing all the frames for an animation shown together, called a sprite sheet, is referenced by the spritemap to produce the animation.

A single sprite sheet can be used for multiple animations. In fact, this is preferred, so only one image has to be retrieved for all animations for a particular object or character. Each time a spritemap action is executed, it contains extra details about how to interpret the sprite sheet.

Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
position_x | decimal |  | The X coordinate for the spritemap on the scene.
position_y | decimal |  | The Y coordinate for the spritemap on the scene.
scale_x | decimal | 1.0 |  |
scale_y | decimal | 1.0 |  |
spritemap_tiles_num | integer |  |  | The total number of tiles contained on the sprite sheet itself. Each tile must be exactly the same width and height.
spritemap_tiles_horizontal | integer |  |  | The number of columns in the sprite sheet.
spritemap_tiles_vertical | integer |  |  | The number of rows in the sprite sheet.
spritemap_height | integer |  |  | If not specified in the media object of the action, this is the heigth of the sprite sheet image.
spritemap_width | integer |  |  | If not specified in the media object of the action, this is the width of the sprite sheet image.
spritemap_tile_sequence | array |  |  | An ordered list of the tiles to use in the animation. Note that tiles are numbered 0 through (spritemap_tiles_num - 1), instead of 1 through spritemap_tiles_num. The number of each tile starts at the top left, then reads to the right and works down to the bottom row.
spritemap_duration | integer |  |  | The milliseconds a full loop of spritemap_tile_sequence will take to animate.
spritemap_repeat | boolean | true |  | If true, when spritemap_tile_sequence reaches the end, it will loop back to the beginning. If false, it will end the animation after the final specified tile, and the spritemap will disappear.
spritemap_show_first_as_fixed | boolean | true |  | If true, the first tile in spritemap_tile_sequence will display in events where the spritemap shows, but the animation has to be manually triggered.
