---
title: "Cancel action"
description: "Stops another action that is running."
---

`type`: `cancel`

Cancel an action that’s currently executing.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
action_id | int |  | An action id of a currently-running action. Actions do not necessarily need to be from the same event sequence in a scene to be cancelled, but they do need to be from the same scene (with the exception of persistent audio).
