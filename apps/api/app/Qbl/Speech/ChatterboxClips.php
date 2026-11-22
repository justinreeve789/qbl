<?php

namespace App\Qbl\Speech;

/**
 * The reference clips Chatterbox speaks in: one per catalog voice, made by recording the catalog's
 * clip line for its language (VoiceCatalog::clipLine, about fifteen seconds) in that voice on
 * another service, Kokoro by default. So a character given "giant" sounds like the same giant on
 * either service, with Chatterbox's livelier delivery on top.
 *
 * A clip is named after the voice's key. Clips of your own (a teacher reading, a voice actor) can be
 * uploaded under any name with php artisan qbl:chatterbox-clips --file, and used by setting the
 * voice's engines.chatterbox.clip in the catalog.
 */
class ChatterboxClips
{
    public function __construct(
        private VoiceCatalog $catalog,
        /** The service that records clips; null when clips are never made, only uploaded. */
        private ?SpeechEngine $source,
    ) {}

    /** The audio of the clip for a catalog voice. */
    public function make(string $clip): string
    {
        $voice = $this->catalog->get($clip);
        if (! $voice) {
            throw new SpeechError("Chatterbox has no voice clip \"$clip\", and it is not a voice in the catalog to make one from. Upload one: php artisan qbl:chatterbox-clips $clip --file=reading.wav");
        }
        if (! $this->source) {
            throw new SpeechError("Chatterbox has no voice clip \"$clip\" yet, and making clips is switched off (QL_TTS_CHATTERBOX_CLIPS_FROM=none). Upload one: php artisan qbl:chatterbox-clips $clip --file=reading.wav");
        }
        $spec = $this->catalog->specFor($clip, $this->source->name());
        if (! $spec) {
            throw new SpeechError("No voice in the catalog works with {$this->source->name()}, so the clip \"$clip\" cannot be made.");
        }
        try {
            return $this->source->synthesize($this->catalog->clipLine($voice['lang']), $spec['spec'], $voice['lang'])->audio;
        } catch (SpeechError $e) {
            throw new SpeechError("Chatterbox's clip for \"$clip\" is made with {$this->source->name()}, which failed: ".$e->getMessage(), 0, $e);
        }
    }
}
