<?php

namespace App\Qbl\Speech;

/**
 * A text-to-speech service: the one thing that changes when QBL moves to another one.
 *
 * Everything else (the voice catalog, choosing voices, recording a scenario's lines, the cache,
 * the editor and the generator) only talks to this. To use another service, write a class that
 * implements it, give it a static fromConfig(), add it to config/qbl_speech.php under `engines`,
 * and say in resources/speech/voices.json what each voice is on it (under engines.<its name>).
 * See docs/src/content/docs/developers/voices.md.
 */
interface SpeechEngine
{
    /** Its name: the key of its settings in config/qbl_speech.php and of its voices in the catalog ("kokoro"). */
    public function name(): string;

    /**
     * Say $text in a voice.
     *
     * @param  array<string, mixed>  $voice  What the catalog says this voice is on this service (its
     *                                       engines.<name> entry): the service decides what it holds,
     *                                       e.g. ['voice' => 'af_bella(2)+af_sky(1)', 'speed' => 1.1].
     * @param  ?string  $lang  The language of the text (BCP 47, "en-US"), when known.
     *
     * @throws SpeechError when the service cannot be reached or refuses
     */
    public function synthesize(string $text, array $voice, ?string $lang = null): Speech;

    /**
     * The service's own voices, by its own ids, to check the catalog against; an empty list when it
     * cannot say.
     *
     * @return list<string>
     */
    public function voices(): array;
}
