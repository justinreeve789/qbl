<?php

namespace App\Console\Commands;

use App\Models\Scenario;
use App\Qbl\Avatars;
use App\Qbl\Characters\NpcCharacter;
use App\Qbl\Characters\WalkMaker;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Make six-frame walks from standing pictures, as the editor's "Make walk" button does: for the
 * platform's avatars (which the editor has no page for), or for a scenario's characters. Each
 * becomes the avatar's or character's "walk right"; "walk left" is that mirrored. See WalkMaker,
 * and "Making a walk from the standing picture" in docs/src/content/docs/editor/library.md.
 */
class MakeWalk extends Command
{
    protected $signature = 'qbl:walk
        {who?* : Which avatars (or, with --scenario, characters): names or ids. Default: all of them}
        {--scenario= : Make walks for this scenario\'s characters (its code or shortname) instead of the avatars}
        {--force : Replace walks they already have (a walk made here before is removed)}
        {--stride= : How long a step is, as a share of the leg\'s length (default 0.72)}
        {--dry-run : Make the walks and report on the feet, but save nothing}
        {--preview= : Also write each sprite sheet to this folder, to look at}
        {--list : Only list them, and whether each walks}';

    protected $description = 'Make walking animations (six-frame sprite sheets) for avatars or a scenario\'s characters from their standing pictures';

    public function handle(WalkMaker $walks, ScenarioStore $store): int
    {
        $stride = $this->option('stride');
        if ($stride !== null && (! is_numeric($stride) || (float) $stride < 0.3 || (float) $stride > 1.2)) {
            $this->error('--stride is a share of the leg\'s length, from 0.3 to 1.2 (0.72 by default).');

            return self::FAILURE;
        }
        $options = array_filter([
            'force' => (bool) $this->option('force'), 'dry' => (bool) $this->option('dry-run'),
            'stride' => $stride !== null ? (float) $stride : null, 'preview' => $this->option('preview'),
        ], fn ($v) => $v !== null && $v !== false);
        $wanted = array_values((array) $this->argument('who'));

        try {
            if ($key = $this->option('scenario')) {
                return $this->characters($walks, $store, (string) $key, $wanted, $options);
            }

            return $this->avatars($walks, $wanted, $options);
        } catch (StoreError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }

    private function avatars(WalkMaker $walks, array $wanted, array $options): int
    {
        $pdo = DB::connection()->getPdo();
        $rows = WalkMaker::avatarRows($pdo, (bool) $wanted);
        $pick = $this->pick($rows, $wanted, fn ($r) => [(string) $r['id'], (string) (Avatars::BASE + (int) $r['id'])], 'avatar');
        if ($pick === null) {
            return self::FAILURE;
        }
        if ($this->option('list')) {
            $this->table(['Id', 'Avatar', 'Walks right', 'Active'], array_map(fn ($r) => [
                Avatars::BASE + (int) $r['id'], $r['name'], $this->walkOf(json_decode((string) $r['settings'], true) ?: []), (int) $r['active'] ? 'yes' : 'withdrawn',
            ], $pick));

            return self::SUCCESS;
        }

        return $this->makeEach($pick, fn ($r) => $walks->forAvatar($pdo, $r, $options), false);
    }

    private function characters(WalkMaker $walks, ScenarioStore $store, string $key, array $wanted, array $options): int
    {
        $scenario = Scenario::query()->where(fn ($q) => $q->where('code', strtolower($key))->orWhere('shortname', $key))->first();
        if (! $scenario) {
            $this->error("There is no scenario $key.");

            return self::FAILURE;
        }
        $rows = $store->bundle((int) $scenario->id)['characters'];
        $pick = $this->pick($rows, $wanted, fn ($r) => [(string) $r['id']], 'character in "'.$scenario->title.'"');
        if ($pick === null) {
            return self::FAILURE;
        }
        if ($this->option('list')) {
            $this->table(['Id', 'Character', 'Walks right'], array_map(fn ($r) => [
                $r['id'], $r['name'], $this->walkOf(['animations' => NpcCharacter::fromRow($r)->animations]),
            ], $pick));

            return self::SUCCESS;
        }
        $status = $this->makeEach($pick, fn ($r) => $walks->forCharacter($store, (int) $scenario->id, $r, $options), true);
        if ($status === self::SUCCESS && ! $this->option('dry-run')) {
            $this->line("Players get them once it is published: php artisan qbl:publish {$scenario->code}");
        }

        return $status;
    }

    /** The rows named (by name, case aside, or by an id), or all of them; null after saying which name matched nothing. */
    private function pick(array $rows, array $wanted, callable $ids, string $kind): ?array
    {
        if (! $wanted) {
            if (! $rows) {
                $this->warn("There is no $kind.");
            }

            return $rows;
        }
        $out = [];
        foreach ($wanted as $w) {
            $match = array_values(array_filter($rows, fn ($r) => strcasecmp((string) $r['name'], (string) $w) === 0 || in_array((string) $w, $ids($r), true)));
            if (! $match) {
                $this->error("There is no $kind \"$w\". Try --list.");

                return null;
            }
            $out[$match[0]['id']] = $match[0];
        }

        return array_values($out);
    }

    private function walkOf(array $settings): string
    {
        $walk = $settings['animations']['walk_right'] ?? null;

        return is_array($walk) && isset($walk['media_id']) ? 'yes (picture '.$walk['media_id'].')' : '-';
    }

    /** Make each one's walk and say how it came out. */
    private function makeEach(array $rows, callable $make, bool $scenario): int
    {
        [$walking, $bobbing, $skipped, $failed] = [0, 0, 0, 0];
        foreach ($rows as $row) {
            try {
                $r = $make($row);
            } catch (StoreError $e) {
                $failed++;
                $this->error("  {$row['name']}: ".$e->getMessage());

                continue;
            }
            if (isset($r['skipped'])) {
                $skipped++;
                $this->line("  {$r['name']}: skipped, {$r['skipped']}.");

                continue;
            }
            [$w, $h] = $r['frame'];
            if ($r['mode'] === 'legs') {
                $walking++;
                $feet = $r['feet'];
                $this->info(sprintf('  %s: walks. Six %d × %d frames, a step of %d%% of the height; feet together in frames %s, a step apart in %s.',
                    $r['name'], $w, $h, round($feet['step_share'] * 100), implode(', ', $feet['together']), implode(', ', $feet['apart'])));
                foreach ($feet['problems'] as $p) {
                    $this->warn("    Look at the frames: $p");
                }
            } else {
                $bobbing++;
                $this->warn("  {$r['name']}: no legs to step with ({$r['why']}), so it bobs instead.");
            }
        }
        $done = $this->option('dry-run') ? 'would get' : 'got';
        $this->newLine();
        $this->line(sprintf('%d %s a walk, %d a bob%s%s.', $walking, $done, $bobbing, $skipped ? ", $skipped skipped" : '', $failed ? ", $failed failed" : ''));
        if ($this->option('preview')) {
            $this->line('The sheets are in '.$this->option('preview').'.');
        }
        if (! $this->option('dry-run') && ($walking || $bobbing)) {
            $this->line($scenario ? 'Each is the character\'s "walk right"; "walk left" is it mirrored.' : 'Each is the avatar\'s "walk right" ("walk left" is it mirrored), in every game from now on.');
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
