<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\GenerationError;

/**
 * An art style: the bible in resources/art-styles/{name}/style.php and its approved anchor pictures.
 *
 * It is the only place prompts are written. Every picture's prompt is the same text in the same order
 * (what kind of picture, then the style, the colours, the background, the references and what to avoid),
 * with only the subject and the layout notes changing, so two pictures asked for months apart are asked
 * for in the same words.
 */
final class ArtStyle
{
    private function __construct(public readonly string $key, public readonly string $dir, private array $bible) {}

    public static function load(string $stylesDir, string $key): self
    {
        $dir = rtrim($stylesDir, '/').'/'.$key;
        if (! preg_match('/^[a-z0-9][a-z0-9_-]*$/', $key) || ! is_file("$dir/style.php")) {
            throw new GenerationError("There is no art style \"$key\" (looked for $dir/style.php).");
        }
        $bible = require "$dir/style.php";
        foreach (['name', 'version', 'medium', 'line', 'shading', 'palette', 'kinds', 'avoid', 'chroma'] as $field) {
            if (empty($bible[$field])) {
                throw new GenerationError("The art style \"$key\" has no $field.");
            }
        }

        return new self($key, $dir, $bible);
    }

    public function name(): string
    {
        return $this->bible['name'];
    }

    public function version(): int
    {
        return (int) $this->bible['version'];
    }

    public function bible(): array
    {
        return $this->bible;
    }

    /** @return array<string, array{int, int, int}> name => [r, g, b] */
    public function palette(): array
    {
        $out = [];
        foreach ($this->bible['palette'] as $name => $hex) {
            $out[$name] = self::rgb($hex);
        }

        return $out;
    }

    public function chroma(): array
    {
        return self::rgb($this->bible['chroma']);
    }

    public function post(string $key, mixed $default = null): mixed
    {
        return $this->bible['post'][$key] ?? $default;
    }

    public function bootstrap(): array
    {
        return $this->bible['bootstrap'] ?? [];
    }

    /** Path of an anchor picture, whether or not it exists yet. */
    public function anchorPath(string $role): string
    {
        return $this->dir.'/'.($this->bible['anchors'][$role] ?? "anchors/$role.png");
    }

    /** The anchors that exist, by role. */
    public function anchors(): array
    {
        $out = [];
        foreach (array_keys($this->bible['anchors'] ?? []) as $role) {
            if (is_file($path = $this->anchorPath($role))) {
                $out[$role] = $path;
            }
        }

        return $out;
    }

    /** Which anchors are sent with each kind of picture, most relevant first. */
    public function anchorsFor(string $kind): array
    {
        // What else is in an anchor gets copied, not just its style: a character anchor beside a character
        // sheet is a second person the model may draw instead, and an environment anchor becomes a backdrop
        // painted behind a cut-out. So cut-outs never get the environment, and frames and portraits (whose
        // own approved sheet carries the style) get only the props, which has no one and nowhere in it.
        $roles = match ($kind) {
            'background' => ['environment', 'character'],
            'character' => ['character', 'props'],
            'strip', 'portrait' => ['props'],
            'item', 'vehicle', 'badge' => ['props'],
            default => ['props'],
        };
        $out = [];
        foreach ($roles as $role) {
            if (is_file($path = $this->anchorPath($role))) {
                $out[] = new Reference((string) file_get_contents($path), match ($role) {
                    'character', 'portrait' => "style anchor ($role): a DIFFERENT character, shown only for how characters are drawn. Do not copy their face, hair, body, clothes, colours or belongings",
                    default => "style anchor ($role): match how it is painted, not what it shows",
                });
            }
        }

        return $out;
    }

    /** Whether a kind is cut out of its background. */
    public static function cutout(string $kind): bool
    {
        return in_array($kind, ['character', 'strip', 'portrait', 'item', 'vehicle', 'badge'], true);
    }

    /**
     * The prompt for a picture.
     *
     * @param  string  $kind  background | character | portrait | strip | item | vehicle | badge
     * @param  string  $subject  What to draw, in plain words, without any style words.
     * @param  Reference[]  $references  Sent with the request, in this order.
     * @param  array  $vars  Values for placeholders in the kind's sentence ({frames}).
     * @param  string[]  $notes  Layout requirements and corrections from the style judge.
     * @param  bool  $nativeTransparency  The provider can draw transparent backgrounds itself.
     */
    public function prompt(string $kind, string $subject, array $references = [], array $vars = [], array $notes = [], bool $nativeTransparency = false, array $accents = []): string
    {
        $b = $this->bible;
        $sentence = $b['kinds'][$kind] ?? throw new GenerationError("The art style has no picture kind \"$kind\".");
        $replace = ['{subject}' => rtrim(trim($subject), '.')];
        foreach ($vars as $k => $v) {
            $replace['{'.$k.'}'] = (string) $v;
        }
        $parts = [strtr($sentence, $replace)];

        $style = "ART STYLE ({$b['name']}, v{$b['version']}): {$b['medium']}. Outlines: {$b['line']}. Shading: {$b['shading']}.";
        if (! empty($b['shapes'])) {
            $style .= " Shapes: {$b['shapes']}.";
        }
        if (in_array($kind, ['character', 'portrait', 'strip'], true) && ! empty($b['characters'])) {
            $style .= " Characters: {$b['characters']}.";
        }
        foreach (['lighting' => 'Lighting', 'mood' => 'Mood'] as $field => $label) {
            if (! empty($b[$field])) {
                $style .= " $label: {$b[$field]}.";
            }
        }
        $parts[] = $style;

        $colours = [];
        foreach ($b['palette'] as $name => $hex) {
            $colours[] = "$name $hex";
        }
        $parts[] = 'COLOURS: use only these colours and lighter or darker tints of them: '.implode(', ', $colours).'.'
            .($accents ? ' This set of pictures also uses these accents: '.implode(', ', $accents).'.' : '');

        if (self::cutout($kind)) {
            $parts[] = $nativeTransparency
                ? 'BACKGROUND: fully transparent. No ground, floor, shadow or scenery behind the subject.'
                : "BACKGROUND: a perfectly flat, solid {$b['chroma']} fill from edge to edge, with no ground, floor shadow, gradient, vignette or scenery. Do not use this colour, or anything close to it, anywhere in the subject. No glow, halo, shadow or light spilling from the subject onto the background.";
        }

        if ($references) {
            $lines = [];
            foreach (array_values($references) as $i => $ref) {
                $lines[] = 'Image '.($i + 1).': '.$ref->role.'.';
            }
            $parts[] = 'REFERENCE IMAGES: '.implode(' ', $lines).' Every picture in this game must look as if drawn by the same artist as the style anchors: same line weight, same shading, same colour treatment, same level of detail.';
        }
        if ($notes) {
            $parts[] = 'REQUIREMENTS: '.implode(' ', array_map(fn ($n) => rtrim(trim($n), '.').'.', $notes));
        }
        $parts[] = "AVOID: {$b['avoid']}.";

        return implode("\n\n", $parts);
    }

    public static function rgb(string $hex): array
    {
        $hex = ltrim(trim($hex), '#');
        if (! preg_match('/^[0-9a-fA-F]{6}$/', $hex)) {
            throw new GenerationError("\"$hex\" is not a #rrggbb colour.");
        }

        return [hexdec(substr($hex, 0, 2)), hexdec(substr($hex, 2, 2)), hexdec(substr($hex, 4, 2))];
    }
}
