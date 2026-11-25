<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Qbl\Generation\Design\DesignRules;
use App\Qbl\Generation\Design\SceneDesigner;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\StoreError;
use Illuminate\Console\Command;

/**
 * Generate a whole mission from a prompt: standards, story, scenes, characters, dialogue, events,
 * every picture in the house art style, packaged as an import ZIP and imported as a private draft.
 * See docs/src/content/docs/developers/generation.mdx.
 */
class GenerateScenario extends Command
{
    protected $signature = 'qbl:generate
        {prompt? : What the mission is about, in a teacher\'s words}
        {--method= : How to make it: classic, draft, gemini-judge, sprite-app, critic, best-of, outline-first (see --list-methods; default QBL_GEN_METHOD)}
        {--list-methods : List the generation methods and what each tries, and stop}
        {--redo= : With --resume: do this step again, and every step after it (align, design, draw...)}
        {--grade= : Grade level: K, 1-12, "6-8"}
        {--subject= : Science, Mathematics, English Language Arts, Social Studies...}
        {--framework=* : Standards framework(s) to align to, as imported with qbl:standards (NGSS, CCSS-MATH...)}
        {--standard=* : Exact standard codes to build the mission around (instead of choosing)}
        {--scenes= : Number of scenes (default: the designer decides, usually 3-6)}
        {--players=2-6 : How many students play together, "min-max"}
        {--minutes= : Rough playing time}
        {--notes= : Anything else the designer should know}
        {--format= : mission (students play it) or story (it plays by itself, for students to watch); default: as the prompt reads}
        {--opening= : How it starts: action, balanced (action first, story through discoveries) or story; default: chosen to suit the prompt}
        {--focus= : Rigor or play: play, balanced (quick hook, rigorous middle) or rigor; default: chosen to suit the prompt}
        {--freedom= : Student freedom: guided, balanced (some choice of order) or open; default: chosen to suit the prompt}
        {--owner= : Email of the teacher who will own the draft}
        {--style= : Art style (a folder in resources/art-styles); default from config}
        {--images= : Image driver: gemini, openai, scenario or placeholder}
        {--animations= : Who animates the characters: autosprite (one request per character, the default when AUTOSPRITE_API_KEY is set) or draw (strips drawn by the image model)}
        {--attempts= : Attempts per picture before the best is kept}
        {--budget= : Most to spend on AI services for this run, in US dollars (default QBL_GEN_BUDGET_USD; 0 for none)}
        {--no-judge : Do not have each picture checked against the style anchors}
        {--no-voices : Do not record what characters say (the browser reads it aloud instead)}
        {--offline : Draw nothing new: finish with the pictures the run already has (with --resume)}
        {--without-anchors : Go ahead even though the art style has no approved anchors}
        {--design-only : Stop after the blueprint (no pictures; cheap, to review the plan)}
        {--no-import : Make the ZIP but do not import it}
        {--publish : Publish the imported draft straight away}
        {--resume= : Carry on a generation that stopped, by its id}
        {--import= : Import a scenario ZIP made earlier, and do nothing else}
        {--scenario= : Make ONE scene and add it to this scenario (by id) instead of a mission (method scene)}
        {--place= : With --scenario: outdoor, indoor, underground, up_high or underwater; default: chosen to suit the prompt}
        {--time= : With --scenario: the time of day (dawn, morning, midday, afternoon, golden, sunset, dusk, night)}
        {--width= : With --scenario: normal or wide}
        {--repeat= : With --scenario: what a thing with several descriptions does when clicked again: last or cycle; default: chosen thing by thing}
        {--no-hotspots : With --scenario: nothing to click}
        {--no-animations : With --scenario: no lights, living sky, things in the air or flowing water}
        {--critters : With --scenario: birds, squirrels, deer... that come and go}';

    protected $description = 'Generate a whole mission (scenes, characters, art, dialogue, events, curriculum alignment) from a prompt';

    public function handle(GenerationFactory $factory): int
    {
        $owner = null;
        if ($email = $this->option('owner')) {
            $owner = User::where('email', $email)->first();
            if (! $owner) {
                $this->error("There is no user $email.");

                return self::FAILURE;
            }
        }
        if ($this->option('list-methods')) {
            $default = (string) config('qbl_generation.method', 'classic');
            $this->table(['Method', 'What it tries'], array_map(fn ($k, $v) => [$k.($k === $default ? ' (default)' : ''), $v], array_keys($factory->methods()), $factory->methods()));
            $this->line('Choose one with --method=<name>. Each is a class in app/Qbl/Generation/Methods; every run writes a trace (qbl:generation-trace <run>).');

            return self::SUCCESS;
        }
        $log = fn (string $m) => $this->line($m);
        // Pictures are worked on in memory; a 2250 x 1200 background with its copies needs room.
        ini_set('memory_limit', '2048M');

        try {
            if ($zip = $this->option('import')) {
                $generator = $factory->generator(['images' => 'placeholder', 'anchors_required' => false], $log);
                $id = $generator->import($zip, $owner?->id, [], [], (bool) $this->option('publish'));
                $this->info("Imported scenario $id.");

                return self::SUCCESS;
            }
            $prompt = (string) $this->argument('prompt');
            if (! $this->option('resume') && trim($prompt) === '') {
                $this->error('Say what the mission is about: php artisan qbl:generate "..."');

                return self::FAILURE;
            }
            foreach (DesignRules::SETTINGS as $key => $setting) {
                $value = $this->option($key);
                if ($value !== null && ! isset($setting['choices'][$value])) {
                    $this->error("--$key is one of: ".implode(', ', array_keys($setting['choices'])).'.');

                    return self::FAILURE;
                }
            }
            // One scene for a scenario: its own options, made by the scene method.
            if ($this->option('scenario')) {
                foreach (['place', 'time', 'width', 'repeat'] as $key) {
                    $value = $this->option($key);
                    $allowed = SceneDesigner::OPTIONS[$key];
                    if ($value !== null && ! in_array($value, $allowed, true)) {
                        $this->error("--$key is one of: ".implode(', ', $allowed).'.');

                        return self::FAILURE;
                    }
                }
                $sceneOptions = array_filter([
                    'kind' => 'scene', 'scenario_id' => (int) $this->option('scenario'),
                    'place' => $this->option('place'), 'time' => $this->option('time'), 'width' => $this->option('width'), 'repeat' => $this->option('repeat'),
                    'hotspots' => ! $this->option('no-hotspots'), 'animations' => ! $this->option('no-animations'), 'critters' => (bool) $this->option('critters'),
                    'grade' => $this->option('grade'), 'notes' => $this->option('notes'),
                ], fn ($v) => $v !== null && $v !== '');
            }
            [$min, $max] = array_map('intval', explode('-', (string) $this->option('players').'-'.(string) $this->option('players')));
            $options = array_filter([
                'grade' => $this->option('grade'),
                'subject' => $this->option('subject'),
                'frameworks' => $this->option('framework'),
                'standards' => $this->option('standard'),
                'scenes' => $this->option('scenes') ? (int) $this->option('scenes') : null,
                'min_players' => $this->option('resume') && $this->option('players') === '2-6' ? null : max(1, $min),
                'max_players' => $this->option('resume') && $this->option('players') === '2-6' ? null : max($min, $max),
                'minutes' => $this->option('minutes') ? (int) $this->option('minutes') : null,
                'notes' => $this->option('notes'),
                'format' => in_array($this->option('format'), ['mission', 'story'], true) ? $this->option('format') : null,
                ...DesignRules::chosen(['opening' => $this->option('opening'), 'focus' => $this->option('focus'), 'freedom' => $this->option('freedom')]),
                'style' => $this->option('style'),
                'stop_after' => $this->option('design-only') ? 'design' : null,
                'import' => $this->option('no-import') ? false : null,
                'publish' => $this->option('publish') ?: null,
            ], fn ($v) => $v !== null && $v !== [] && $v !== '');

            if (isset($sceneOptions)) {
                $options = $sceneOptions;
            }
            // A resumed run carries on with the method it was started with, unless told otherwise.
            $method = $this->option('method') ?: ($this->option('resume') ? $factory->savedMethod((int) $this->option('resume')) : (isset($sceneOptions) ? 'scene' : null));
            if ($this->option('redo')) {
                if (! $this->option('resume')) {
                    $this->error('--redo needs --resume=ID: it does a step of an earlier run again.');

                    return self::FAILURE;
                }
                $options['redo'] = (string) $this->option('redo');
            }
            $generator = $factory->generator([
                'method' => $method,
                'style' => $this->option('style'),
                'images' => $this->option('offline') ? 'offline' : $this->option('images'),
                'animations' => $this->option('animations'),
                'judge' => $this->option('no-judge') ? false : null,
                'attempts' => $this->option('attempts') ? (int) $this->option('attempts') : null,
                'budget' => $this->option('budget') !== null ? (float) $this->option('budget') : null,
                'anchors_required' => ! $this->option('without-anchors') && ! $this->option('design-only'),
                'voices' => $this->option('no-voices') ? false : null,
            ], $log);
            $result = $generator->generate($prompt, $options, $owner?->id, $this->option('resume') ? (int) $this->option('resume') : null);
        } catch (GenerationError|StoreError $e) {
            $this->error($e->getMessage());
            if ($run = ($generator ?? null)?->lastRun) {
                $this->line("Carry on with: php artisan qbl:generate --resume=$run");
            }

            return self::FAILURE;
        }

        $this->newLine();
        if (! empty($result['trace'])) {
            $this->line("What every step did: php artisan qbl:generation-trace {$result['run']} (or open {$result['trace']}/README.md)");
        }
        foreach ($result['warnings'] as $w) {
            $this->warn($w);
        }
        if ($result['method'] === 'scene' && $result['status'] === 'done') {
            $this->info("Done: a new scene in scenario {$result['scenario_id']} (generation {$result['run']}). Open the scenario in the editor to look it over.");

            return self::SUCCESS;
        }
        match ($result['status']) {
            'designed' => $this->info("Blueprint ready (generation {$result['run']}). Look at it, then draw and build it with: php artisan qbl:generate --resume={$result['run']}".(isset($result['estimate']) ? sprintf(' (about %d pictures, about $%.2f)', $result['estimate']['pictures'], $result['estimate']['usd']) : '')),
            'packaged' => $this->info("Packaged: {$result['zip']}"),
            default => $this->info("Done: scenario {$result['scenario_id']} (generation {$result['run']}), a private draft. Review it in the editor, then publish and assign it. ZIP: {$result['zip']}"),
        };

        return self::SUCCESS;
    }
}
