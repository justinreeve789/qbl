---
title: "Characters' voices (text-to-speech)"
---

What characters say can be **recorded in a voice of their own**, and the game then plays the recording and lights each word on screen as it is spoken. The lines are recorded once, on the server, by a text-to-speech service, and kept with the scenario as audio files with the time of every word. Players never wait on the service, and a scenario with recordings plays the same on every device.

A line with no recording is read by the browser's own voice, as before (see [Reading text aloud](/docs/developers/extensions/#reading-text-aloud)).

## The service: Kokoro, in the `tts` container

By default the service is [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M), an open-weight text-to-speech model (Apache 2.0, voices included), served by [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) in the `tts` container of `docker-compose.yml`. It runs on the server's own CPU, costs nothing per line, adds no watermark, and reports when each word is said.

- The image (`ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0`) is about 5 GB on disk and the container uses about 1 GB of memory. A line takes one to three seconds to record on a CPU.
- It is only reachable inside the Compose network (as `http://tts:8880`); no port is published.
- With an NVIDIA GPU, set `QuestLab_TTS_IMAGE=ghcr.io/remsky/kokoro-fastapi-gpu:v0.10.0` in `.env` and give the container the GPU.
- Not wanted: set `QuestLab_TTS_DRIVER=none` (nothing is recorded; the browser reads every line) and `docker compose stop tts`.

Outside Docker, run it with `docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0` and set `QuestLab_TTS_URL=http://localhost:8880`.

## Giving characters voices and recording their lines

**In the editor:** open a character on the Characters page. Under **🔊 Voice**, choose a voice (grouped as women, men, children, and robots and creatures), press **▶ Listen** to hear it, and **🎙️ Record its lines**. The Characters page has **🎙️ Record voices** for every character at once, **🎭 Give everyone a voice** to give a different voice to each character that has none, and shows how many lines are recorded. Publish afterwards so players get the recordings.

**From the command line:**

```sh
docker compose exec app php artisan qbl:voice --list               # the voices, checked against the service
docker compose exec app php artisan qbl:voice --sample=captain     # save sample-captain.mp3 to listen to
docker compose exec app php artisan qbl:voice {code} --assign      # give voices to characters without one, record every line
docker compose exec app php artisan qbl:voice {code} --dry-run     # how many lines would be recorded
docker compose exec app php artisan qbl:voice {code} --force       # record every line again
```

**Any text, in a random voice:** `qbl:tts` says whatever you give it in a voice picked at random from the catalog and saves it as an MP3. It is for trying voices out and for one-off audio, such as a clip to upload as media; it does not touch any scenario.

```sh
docker compose exec app php artisan qbl:tts "Welcome aboard, {{QuestLabPlayerName}}!"   # a random English voice: tts-<voice>.mp3
docker compose exec app php artisan qbl:tts "¿Listos?" --lang=es --gender=female    # a random Spanish woman
docker compose exec app php artisan qbl:tts "Halt!" --trait=robot --trait=stern     # a voice that sounds like either
docker compose exec app php artisan qbl:tts "Ready?" --count=5 --out=takes/         # five different voices, to compare
docker compose exec app php artisan qbl:tts --file=intro.txt --voice=captain --timings  # one voice, with word timings in a .json
docker compose cp app:/app/tts-captain.mp3 .                                        # copy a file out of the container
```

The pick is from voices of `--lang` (default `en`, American and British; `any` for every language) that have a voice of their own on the service in use, so two picks never borrow the same one. `--gender` (female, male, neutral), `--age` (child, young, adult, elder) and `--trait` narrow it, and `--seed` makes it repeatable. With no text it says the catalog's sample line in the voice's language. `{{QuestLabPlayerName}}` is said as the stand-in word ("explorer"); other placeholders are refused. Recordings are cached like a scenario's, so saying the same text in the same voice again does not call the service.

**The mission generator** gives every character a voice from what the blueprint says of them (gender, age, how they sound, their personality and role), a different one each, and records their lines before packaging. `--no-voices` skips it. If the service is down the mission is still made, with a warning; record the lines later with `qbl:voice` or the editor.

### What is recorded

- Every `dialogue` action said by a character (`speaker: character`) whose character has a voice (`tts_voice`), and every line such a character says in a `conversation`, unless the action has `narrate: false`. The player's own lines and choices are read by the browser. A voiced conversation gets `narrate: true` and each voiced line its own `narration_media_id`.
- The player's name, `{{QuestLabPlayerName}}`, is said as a stand-in word ("explorer"; "explorador" in Spanish, and so on). In play the game shows the player's name and lights it while the stand-in is said.
- A line with any other `{{placeholder}}` cannot be recorded ahead of play, since its words are only known then. The browser reads it.
- Recording again only records lines whose text or voice changed. The old recording is deleted. A line whose character loses its voice loses its recording.
- A recording someone uploaded and attached by hand (`narration_media_id` on media without `speech.engine`) is never replaced.
- Recordings are cached by service, voice and text (`QuestLab_TTS_CACHE_DIR`, `/data/speech` in Docker). A copy of a scenario, or a line changed back, costs nothing to record.

The voiced line gets `narrate: true` and `narration_media_id`. The recording is an audio media with its word timings in `params.speech`, which the document carries as the media's [`speech`](/docs/developers/extensions/#reading-text-aloud):

```json
{
  "id": 41, "type": "audio", "url": "/media/7/3f9c….mp3",
  "speech": {
    "text": "Welcome aboard, explorer!", "voice": "captain", "engine": "kokoro", "duration": 1612,
    "words": [{ "w": "Welcome", "s": 22, "e": 422 }, { "w": "aboard", "s": 422, "e": 870 }, { "w": "explorer", "s": 920, "e": 1612 }]
  }
}
```

## How the words are lit

The game matches the words shown against the recorded words, in order. Capitals and punctuation are ignored, and a few words of difference are allowed. Words that do not match (the player's name where "explorer" was said, "42" where the service said "forty-two", "Dr." where it said "Doctor") take the time of what was said in their place. The highlight then follows the recording's own clock (`audio.currentTime`), so it stays with the voice even if the audio is slow to start or stutters. If fewer than half the words match (the line was changed and not recorded again), or the recording has no timings, the words are paced evenly over its length instead.

## The voices

The voices are in `apps/api/resources/speech/voices.json`: about 50 of them, 35 in English (American and British women, men, children, older people, robots and creatures) and a few each in Spanish, French, Italian, Brazilian Portuguese, Hindi, Japanese and Mandarin. A scenario is offered the voices of its language (`default_language`). Japanese and Mandarin recordings have no word timings, so their words are paced evenly.

A character's `tts_voice` is a **key of this catalog** ("heart", "captain", "robot"), never a service's own voice name. Each voice says who it sounds like and what it is on every service:

```json
{
  "key": "captain", "name": "Captain", "gender": "male", "age": "adult", "lang": "en-US", "accent": "American",
  "traits": ["commanding", "deep", "warm", "confident", "leader", "captain"],
  "description": "A deep, commanding voice with warmth: a captain, a leader.",
  "engines": {
    "kokoro": { "voice": "am_michael(1)+am_fenrir(1)", "speed": 0.95 },
    "openai": { "voice": "onyx", "instructions": "Commanding but warm, like a ship's captain." }
  }
}
```

On Kokoro, a voice is one of its 54 voices or a weighted blend of them (`af_bella(2)+af_sky(1)`), at a speed from 0.25 to 4. Blends are how the catalog has voices Kokoro does not ship with, such as children, a robot or a mentor. To add a voice, add an entry: give it a new key, say who it is, and say what it is on Kokoro. `qbl:voice --list` checks that every Kokoro voice it uses exists, and `qbl:voice --sample=<key>` lets you hear it. `QuestLab_TTS_VOICES` points at another catalog file.

## Using another text-to-speech service

Everything above talks to the service through one interface, `App\Qbl\Speech\SpeechEngine`:

```php
interface SpeechEngine
{
    public function name(): string;                                            // "kokoro": its key in config and in the catalog
    public function synthesize(string $text, array $voice, ?string $lang = null): Speech;  // audio, format, word timings in ms
    public function voices(): array;                                           // its own voice ids, to check the catalog
}
```

Two come with QuestLab:

Driver | Class | Word timings
------ | ----- | ------------
`kokoro` | `Engines\KokoroEngine`: Kokoro-FastAPI's `POST /dev/captioned_speech` | yes
`openai` | `Engines\OpenAiSpeechEngine`: any service with OpenAI's `POST /v1/audio/speech` (OpenAI itself, and the many servers that copy it) | no: words are paced evenly

To add a service:

1. Write a class that implements `SpeechEngine`, with a static `fromConfig(array $config, ?HttpClient $http)`. Turn the service's word timings into `Speech::words()` (milliseconds, punctuation dropped); return none if it has none.
2. Add it to `config/qbl_speech.php` under `engines`, with `class` and whatever settings it needs from `.env`.
3. Say what each voice is on it in `voices.json`, under `engines.<name>`. The spec is the engine's own: `$voice` in `synthesize()` is exactly that entry. A voice with nothing for the new service borrows the nearest voice that has something (same language, then gender, then age), so mapping a handful is enough to start.
4. Set `QuestLab_TTS_DRIVER` to its name, and record again with `qbl:voice {code} --force` if you want every line in the new voices. Characters keep their `tts_voice`, so nothing in the scenarios changes.

## Settings

Variable | Default | What
-------- | ------- | ----
`QuestLab_TTS_DRIVER` | `kokoro` | `kokoro`, `openai`, or `none`.
`QuestLab_TTS_URL` | `http://tts:8880` | Kokoro-FastAPI.
`QuestLab_TTS_API_KEY` | | Only for a Kokoro-FastAPI started with `API_KEYS`.
`QuestLab_TTS_IMAGE` | `ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0` | The `tts` container's image.
`QuestLab_TTS_OPENAI_URL`, `QuestLab_TTS_OPENAI_KEY`, `QuestLab_TTS_OPENAI_MODEL` | `https://api.openai.com`, `OPENAI_API_KEY`, `gpt-4o-mini-tts` | With `QuestLab_TTS_DRIVER=openai`.
`QuestLab_TTS_TIMEOUT` | 120 | Seconds to wait for one line.
`QuestLab_TTS_CACHE_DIR` | `/data/speech` (Docker), `storage/app/speech` | Recordings already made.
`QuestLab_TTS_VOICES` | `resources/speech/voices.json` | The voice catalog.

## Editor API

Route | What
----- | ----
`GET scenarios/{id}/voices` | `{engine, voices, lines: {total, recorded, to_record}}`: the voices for the scenario's language, and how far recording has got.
`GET scenarios/{id}/voices/{key}/sample` | A voice saying a sample line, as `audio/mpeg`.
`POST scenarios/{id}/voices/record` | `{limit?, force?, character_id?}`: records up to `limit` lines (default 6, at most 20) and says how many `remaining`; the editor calls again until none remain, so no request runs long.
`POST scenarios/{id}/voices/assign` | `{all?}`: gives a voice to each character that has none (with `all`, to every character).

## Testing

`npm run test:speech` tests the engines (with recorded responses), the catalog, choosing voices, recording a scenario and keeping it up to date, the editor's routes and the compiled document, with no network. With a Kokoro running, `KOKORO_URL=http://localhost:8880 npm run test:speech` also records lines with it and checks that every voice in the catalog exists there. `apps/editor/test/voices.test.ts` drives the editor against a stand-in Kokoro, and `apps/client/test/narrator.test.ts` checks that the highlight follows a recording's clock.
