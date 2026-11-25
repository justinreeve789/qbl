---
title: "Repeat"
description: "Starts the event again from its first action."
---

`type`: `repeat`

Repeat the actions for the event, starting with the first action. If there are any actions after a repeat action, they will never execute, unless the repeat is conditional.

* A `repeat` with no `wait` in its loop runs about once per frame rather than freezing the page.
