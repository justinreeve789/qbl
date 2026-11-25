---
title: "Audio"
description: "Plays a sound file or one of the game's own sounds, once or on a loop."
---

`type`: `audio`

Play an audio (MP3) file.

Parameter | Type | Default | Description
--------- | ---- |---------| -----------
volume | decimal | 1.0 | Volume range from 0.0 to 1.0.
repeat | bool | false | If true, play the audio file on an infinite loop once it reaches the end, until a jump or cancel action stops the file.
persist | bool | false | If true, do not stop playing the audio file after a jump action. Audio actions are the only action types that can persist across scenes.
sound | string | | [ext] One of the game's own sounds instead of a file: `thunder`, `car`, `rain`, `river`, `bell`... See [the game's own sounds](/docs/developers/actions/audio/#the-games-own-sounds).

## The game's own sounds

An `audio` action can play a sound the game makes itself instead of a file: `{ "type": "audio", "sound": "thunder" }`. They are made with Web Audio as they play (`apps/client/src/audio/synth.ts`), through the game's master volume, so a scenario needs no sound files for its rain or a car going by. The list is `BUILT_IN_SOUNDS` in `packages/shared/src/sounds.ts`:

- **Ones that go on** (loop them with `repeat`; without it they play for a few seconds): `rain`, `heavy_rain`, `wind`, `river`, `stream`, `waves`, `fire` (crackling), `birds` (singing), `crickets`.
- **One-shots**: `thunder`, `car` (driving by, left to right, pitched up and then down as it passes), `horn`, `hooves` (going by), `bell`, `chime` (magic), `knock`, `door` (creaking shut), `footsteps`, `splash`, `whoosh`, `pop`, `tweet`.

`volume` works as for any sound; a cancel action stops it.
