<?php

namespace App\Console\Commands;

use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use Illuminate\Console\Command;

/**
 * Set up an art style's anchors: the approved pictures every generated picture is drawn beside and
 * judged against.
 *
 *   php artisan qbl:art-style qbl-cartoon                 what the style has
 *   php artisan qbl:art-style qbl-cartoon --bootstrap     draw candidates for each anchor
 *   php artisan qbl:art-style qbl-cartoon --approve=character:2 --approve=environment:1
 *   php artisan qbl:art-style qbl-cartoon --bootstrap --role=portrait   (after the character is approved)
 */
class ArtStyleCommand extends Command
{
    protected $signature = 'qbl:art-style
        {style? : The style folder in resources/art-styles}
        {--bootstrap : Draw candidate anchors from the style\'s bootstrap descriptions}
        {--role=* : Only these anchors (environment, character, props, portrait)}
        {--variants=3 : Candidates per anchor}
        {--images= : Image driver}
        {--approve=* : role:number, to make that candidate the anchor}';

    protected $description = 'Make and approve the anchor pictures that define an art style';

    public function handle(GenerationFactory $factory): int
    {
        try {
            $style = $factory->style($this->argument('style'));
            $candidates = rtrim((string) $factory->config('work_dir'), '/').'/anchors/'.$style->key;

            foreach ($this->option('approve') as $choice) {
                if (! preg_match('/^([a-z]+):(\d+)$/', $choice, $m) || ! is_file($file = "$candidates/{$m[1]}-{$m[2]}.png")) {
                    $this->error("No candidate \"$choice\" (looked in $candidates).");

                    return self::FAILURE;
                }
                $target = $style->anchorPath($m[1]);
                @mkdir(dirname($target), 0775, true);
                // Anchors go with every request: 1600 pixels across is plenty to show the style, and far smaller.
                file_put_contents($target, ImageTools::png(ImageTools::fit(ImageTools::load((string) file_get_contents($file)), 1600, 1600)));
                $this->info("Approved {$m[1]}: $target");
            }

            if ($this->option('bootstrap')) {
                @mkdir($candidates, 0775, true);
                if (in_array('portrait', $this->option('role') ?: ['portrait'], true) && ! is_file($style->anchorPath('character'))) {
                    $this->warn('The portrait anchor is drawn from the approved character anchor; approve a character first, then run --bootstrap --role=portrait.');
                }
                $director = $factory->director($candidates, $style->key, $this->option('images'), fn ($m) => $this->line($m));
                $roles = $this->option('role') ?: null;
                if (! is_file($style->anchorPath('character')) && ! $roles) {
                    $roles = array_values(array_diff(array_keys($style->bootstrap()), ['portrait']));
                }
                foreach ($director->anchorCandidates(max(1, (int) $this->option('variants')), $roles) as $role => $files) {
                    $this->info("$role:");
                    foreach ($files as $i => $file) {
                        $this->line('  '.($i + 1).": $file");
                    }
                }
                $this->line('Look at them, then approve one of each: php artisan qbl:art-style '.$style->key.' --approve=character:1 ...');
                $this->line('Commit the approved anchors with the style: they define it.');
            }

            $this->newLine();
            $this->info("{$style->name()} (v{$style->version()}) in {$style->dir}");
            foreach (['environment', 'character', 'props', 'portrait'] as $role) {
                $this->line(sprintf('  %-12s %s', $role, is_file($style->anchorPath($role)) ? 'approved' : 'missing'));
            }
        } catch (GenerationError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
