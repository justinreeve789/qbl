<?php

namespace App\Qbl\Generation\Art;

/**
 * Something that turns one character's accepted character sheet into their animations (idle, walk,
 * the gestures), in place of drawing each animation as a strip with the image model.
 *
 * The art director still draws the character sheet itself, in the house style and judged against the
 * anchors: that is what keeps the cast looking like one game. The animator only makes it move.
 *
 * AutoSprite (Providers/AutoSpriteAnimator) is the one there is, and the primary source when it is
 * set up: see config/qbl_generation.php, `animations`. Without one, the director draws strips.
 */
interface CharacterAnimator
{
    /**
     * Every animation of one character.
     *
     * Each animation comes back as frames that all share one pivot: the point, in the frame's own
     * pixels, where the character's feet stand. Frames are NOT trimmed one by one, so a jump stays in
     * the air and raised arms stay raised when the director puts them on its sheet.
     *
     * @param  string  $key  the character's key in the blueprint (stable for the run: results are kept under it)
     * @param  string  $sheetPath  their accepted character sheet: a PNG with a transparent background
     * @param  string[]  $needed  the QBL animations the mission plays (walk, and its gestures): always asked for
     * @param  string  $dir  where to keep what it makes (the run's assets folder), so a resumed run reuses it
     * @return array{
     *     animations: array<string, array{frames: string[], pivot: ?array{0: float, 1: float}, duration: int, loops: bool}>,
     *     missing: array<string, string>,
     *     refused: ?string,
     * } animations: name => PNG paths of its frames, the pivot in frame pixels (null: work it out from
     *   the first frame), milliseconds per pass, and whether it loops. missing: name => why an animation
     *   asked for did not come. refused: set when the service never took the request at all, so nothing
     *   was spent and the director may draw the strips the old way instead.
     */
    public function animate(string $key, string $name, string $description, string $sheetPath, array $needed, string $dir): array;

    /**
     * The QBL animation names it will ask for, for a character who needs $needed: what the mission
     * plays first, then everything else it is set to make, up to what one request may hold.
     *
     * @param  string[]  $needed
     * @return string[]
     */
    public function animationsFor(array $needed): array;

    /** What animating one such character should cost, in USD (for the estimate before drawing). */
    public function estimateUsd(array $needed): float;

    /** A short name for records and the trace: "autosprite:turbo". */
    public function describe(): string;
}
