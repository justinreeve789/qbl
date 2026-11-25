---
title: "Run event"
description: "Runs an indirect event."
---

`type`: `run_event`

Execute an indirect event.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
event_id | int |  | The event id to execute.

More fields:

Parameter | Description
--------- | -----------
target_event_id | The event to run. Use this rather than `event_id`, which the base action attributes already use for "the event this action belongs to". `event_id` is still read if `target_event_id` is absent.
