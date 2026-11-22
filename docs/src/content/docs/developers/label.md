---
title: "Labels"
host:
  who: lucy
  says: "Labels are the little signs over hotspots that say: click me!"
---

Labels are associated with a single hotspot. One hotspot can have many labels. Labels can be text, images, or spritemaps.

### Primary Attributes
Parameter | Type   | Default | Description
--------- |--------| ------- | -----------
id | int |  | label id
event_id | int |  | The event id the label is associated with.
type | string |  | Any one of the following representing the type of labels: text, image, spritemap.
position_x | decimal |  | The X coordinate for the label.
position_y | decimal |  | The Y coordinate for the label.
scale_x | decimal | 1.0 |
scale_y | decimal | 1.0 |
text | string  | null | If the type is "text", this is the text to display for the label.
media | int | null | A media object describing the image or spritemap for the label.
