<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Looks at a new picture beside the style's anchors (and, for a character's frames or portrait, the
 * character's own sheet) and scores how well it matches, the way an art director would. A picture
 * below the bar is drawn again with the judge's corrections added to its prompt.
 */
class StyleJudge
{
    public const CRITERIA = ['line', 'shading', 'colour', 'shapes', 'rendering', 'subject', 'composition'];

    public function __construct(private LanguageModel $llm, private float $minScore = 7.0) {}

    /**
     * @param  Reference[]  $anchors  Style anchors.
     * @param  Reference[]  $subject  The character sheet, when the picture must show that character.
     * @param  string[]  $requirements  What the picture must do (layout, frames, empty floor).
     * @return array{score: float, pass: bool, scores: array, problems: string[], fix: string}
     */
    public function judge(string $kind, string $png, array $anchors, array $subject, string $description, array $requirements = []): array
    {
        $content = [];
        foreach ($anchors as $i => $a) {
            $content[] = 'Style anchor '.($i + 1).' (the approved house style):';
            $content[] = ['image' => self::small($a->bytes), 'mime' => 'image/png'];
        }
        // The anchors are the same for every picture of a kind: read from the prompt cache after the first.
        if ($anchors) {
            $content[] = ['cache' => true];
        }
        foreach ($subject as $s) {
            $content[] = 'The approved design of this character (the new picture must show exactly this character):';
            $content[] = ['image' => self::small($s->bytes), 'mime' => 'image/png'];
        }
        $content[] = "The new picture to judge ($kind): $description";
        $content[] = ['image' => self::small($png), 'mime' => 'image/png'];
        if ($requirements) {
            $content[] = "It must also:\n- ".implode("\n- ", $requirements);
        }

        $system = <<<'TXT'
        You are the art director of a children's educational game. Every picture in the game must look as if one
        artist drew it, in the house style shown by the style anchors. Judge the new picture strictly against the
        anchors, not against your own taste. Score each criterion from 0 to 10:
        line (outline colour, weight, smoothness), shading (cel shading with one hard shadow tone, light from the
        upper left, no gradients or texture), colour (palette, saturation, value range), shapes (rounded, simple,
        proportions like the anchors), rendering (flat 2D vector, not 3D, photo, painterly or pixel art),
        subject (shows what was asked; for a character's frames or portrait, the same character design exactly),
        composition (framing and the stated requirements; no text, no extra objects; for a background, the scale
        requirement above all: scenery far too big or too small for the people who will stand in it is a
        composition problem).
        A 7 means a viewer would accept it beside the anchors without noticing; a 9 is indistinguishable.
        List concrete problems, then write "fix": one short paragraph of instructions that would correct them
        in a redraw, phrased as requirements for the picture.
        TXT;

        $schema = [
            'type' => 'object',
            'required' => ['scores', 'problems', 'fix'],
            'properties' => [
                'scores' => ['type' => 'object', 'required' => self::CRITERIA, 'properties' => array_fill_keys(self::CRITERIA, ['type' => 'number', 'minimum' => 0, 'maximum' => 10])],
                'problems' => ['type' => 'array', 'items' => ['type' => 'string'], 'maxItems' => 6],
                'fix' => ['type' => 'string'],
            ],
        ];
        $answer = $this->llm->structured($system, $content, 'style_review', $schema, 1500);
        $scores = array_map('floatval', array_intersect_key((array) ($answer['scores'] ?? []), array_flip(self::CRITERIA)));
        $score = $scores ? round(array_sum($scores) / count($scores), 1) : 0.0;
        // One bad criterion fails a picture however good the rest are: a wrong line weight shows.
        $pass = $score >= $this->minScore && (! $scores || min($scores) >= $this->minScore - 2);

        return ['score' => $score, 'pass' => $pass, 'scores' => $scores, 'problems' => array_values($answer['problems'] ?? []), 'fix' => (string) ($answer['fix'] ?? '')];
    }

    /** Pictures go to the judge at most 768 pixels across: enough to see style, and far cheaper. */
    private static function small(string $bytes): string
    {
        $im = ImageTools::load($bytes);
        if (max(imagesx($im), imagesy($im)) > 768) {
            $im = ImageTools::fit($im, 768, 768);
        }
        if (ImageTools::hasTransparentBackground($im)) {
            // On a light grey, so outlines and edges can be seen.
            $flat = imagecreatetruecolor(imagesx($im), imagesy($im));
            imagefill($flat, 0, 0, imagecolorallocate($flat, 236, 236, 236));
            imagealphablending($flat, true);
            imagecopy($flat, $im, 0, 0, 0, 0, imagesx($im), imagesy($im));
            $im = $flat;
        }

        return ImageTools::png($im);
    }
}
