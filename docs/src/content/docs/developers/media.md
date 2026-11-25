---
title: "Media"
host:
  who: gil
  says: "Pictures, sounds and video, and how a scenario points at them."
---

A media object describes an audio, image, or video file that has been uploaded and associated with the scenario.

:::note[Spec v2]
Sprite sheets, named animations and animated PNGs are spec v2: see [Animations](/docs/developers/extensions/animations/). A file is not always needed: [the game's own sounds](/docs/developers/extensions/actions-world/#the-games-own-sounds) are made as they play.
:::

Media objects are currently defined at the action level, but with the draft revisions, they are being transferred to a single list at the scenario level for better reusability, and so they can be referenced from different scenes for pre-loading.

## Primary Attributes
Parameter | Type      | Default | Description
--------- |-----------|---------| -----------
id | int       |  | The id for the media object.
scenario_id | int       |  | The scenario id the media object is associated with.
file_id | int/array | | The file id(s) of the media object.
user_id | int       |  | User id of the media uploader.
folder_id | int       |  | The id of the user-created folder this media object is stored in.
type | string    |  | Any one of the following representing the type of media: audio, image, video.
filename | string    |  | The name of the file as presented to the user. Note that this is not the actual file name on the server, but the file name presented within the use rinterface.
filepath | string    | / | The full path to the file within the scenario assets. This has no relation to where the file is stored on the server, but indicates where the file can be found within the user-created directories of the scenario.
url | string    | null | A URL to an external media asset. This will be retrieved before the scenario runs.
scale_x | decimal   | 1.0 | Multiplicator to horizontally stretch the image or video. This value is ignored if the type is audio, backgroundimage, or backgroundvideo.
scale_y | decimal   | 1.0 | Multiplicator to vertically stretch the image or video. This value is ignored if the type is audio, backgroundimage, or backgroundvideo.
params | array     |  | A list of arbitrary parameters that may further define the media object.

## Media Types
Value | Description
----- | -----------
audio | An audio file (MP3/WAV) that can be played via actions.
image | An image that can be displayed via an action or in a label. Sprite sheets are categorized as images within the media object.
video | A video file (MP4/WEBM) that can be displayed via an action.
