---
title: "Avatar"
description: "Shows or hides the player's own avatar."
---

`type`: `avatar`

The `avatar` action shows or hides the player's own avatar.

Parameter | Type | Default | Description
--------- | ---- | ------- | -----------
visible | bool | | `false` hides the avatar, `true` shows it.
duration | int | 0 | Fade time in milliseconds.

```json
{ "type": "avatar", "visible": false, "duration": 400 }
```

The change goes through the game server, so every player in the scene sees it. A hidden player can still use hotspots, but clicking the walkable area and the arrow and WASD keys do nothing until they are shown again (walk actions aimed at the player still move them). Avatars are **always shown again when a player arrives in a scene**: to keep them hidden in a scene, hide them in one of its start events. The demo's rocket hides the avatar as the player steps aboard, and the player reappears in the control room. (The scene attribute `show_avatars: false` from the base docs still hides every avatar in a scene, for everyone, for the whole visit; there, too, the player does not walk by clicks or keys, and the camera does not follow them.)
