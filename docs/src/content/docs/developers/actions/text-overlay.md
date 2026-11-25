---
title: "Text overlay"
description: "Shows a line of text over everything else."
---

`type`: `text_overlay`

Display a text string on the screen, overlaying everything else.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
text | string |  | The text to display (256-character limit).
alignment | string | center center | A positioning for the text when it pops up.
text_font_size | int | 24 | Size for the font, defined in pixel height.
text_font_color | string | white | Color for the font.
text_font_style | string |  | Style for the font (leave blank, or “italic”).
duration | int |  | The number of milliseconds the text displays before disappearing. If “0” the text displays indefinitely, until a jump or cancel action removes it.

## Text Alignment
The text alignment is used when the text is fixed, and will pop up at a certain position on the screen according to the chart below.

Value | Description
----- | -----------
top left | top center | top right
center left | center center | center right
bottom left | bottom center | bottom right
