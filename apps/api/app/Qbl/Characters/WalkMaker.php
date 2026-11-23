<?php

namespace App\Qbl\Characters;

use App\Qbl\Avatars;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;
use PDO;

/**
 * A six-frame walk made from a character's standing picture, and made its "walk right": what the
 * editor's "Make walk" button does, for `php artisan qbl:walk`, and for the platform's avatars
 * too, which the editor has no page for.
 *
 * The walk itself is drawn by packages/shared/src/walkCycle.ts (the legs are cut out of the picture
 * and stepped, feet first), run by Node through packages/shared/bin/walk.ts. This class finds the
 * standing picture (the first frame of a sheet; mirrored when it faces left), hands it over as raw
 * pixels, and saves the sheet that comes back:
 *
 * - for an avatar, as a file of the platform's own under the media folder (`platform/`) and a
 *   `platform_media` row, made the avatar's `walk_right` (served with every document, so players
 *   see it at once);
 * - for a scenario's character, as one of the scenario's media, at the standing picture's size,
 *   made the character's `walk_right` (players see it once the scenario is published again).
 *
 * "Walk left" is not made: it falls back to "walk right" mirrored. A walk this class made before
 * is removed when a new one replaces it (unless something else uses its picture).
 */
final class WalkMaker
{
    /** Platform pictures made here live in this folder of the media directory. */
    public const PLATFORM_FOLDER = 'platform';

    /**
     * @param  string  $script  packages/shared/bin/walk.ts
     * @param  string  $node  the command that runs it ("node", or "node --import tsx" for Node before 22.18)
     * @param  ?string  $assetsDir  scenarios/assets, which /scenario-assets/ addresses are served from
     */
    public function __construct(
        private readonly string $script,
        private readonly string $node,
        private readonly ?string $mediaDir,
        private readonly string $mediaUrl = '/media',
        private readonly ?string $assetsDir = null,
    ) {}

    // ================================================================= avatars

    /** The platform's avatars (their rows), active ones first. @return list<array> */
    public static function avatarRows(PDO $pdo, bool $withdrawn = false): array
    {
        $rows = $pdo->query('SELECT id, name, image_url, portrait_url, settings, active, organization_id FROM avatars ORDER BY active DESC, sequence, id')->fetchAll(PDO::FETCH_ASSOC);

        return array_values(array_filter($rows, fn ($r) => $withdrawn || (int) $r['active'] === 1));
    }

    /**
     * Make an avatar's walk. `$options`: stride (a share of the leg's length), force (replace a
     * walk it has), dry (make it, report, save nothing), preview (a folder to also write the
     * sheet to). Returns the report (see report()), with `saved` and the new `media_id` when saved.
     */
    public function forAvatar(PDO $pdo, array $row, array $options = []): array
    {
        $settings = is_array($row['settings'] ?? null) ? $row['settings'] : (json_decode((string) ($row['settings'] ?? ''), true) ?: []);
        $platform = Avatars::platformMedia($pdo);
        $character = AvatarCharacter::fromRow(['settings' => $settings] + $row, $platform);
        $name = (string) $row['name'];
        if (! is_array($settings['animations'] ?? null) || array_is_list($settings['animations'])) {
            throw new StoreError(422, "$name is an avatar of the older shape (one picture or sheet, no animations); give it animations in database/seeders/data/avatars.php first.");
        }
        $current = $settings['animations']['walk_right'] ?? null;
        if ($current && empty($options['force'])) {
            return ['name' => $name, 'skipped' => 'it already walks right (--force replaces that walk)'];
        }
        $chosen = $character->chosen('stand');
        if (! $chosen || $chosen['name'] === 'portrait') {
            return ['name' => $name, 'skipped' => 'it has no standing picture to make a walk from'];
        }
        $entry = null;
        foreach ($character->media as $m) {
            if ((int) $m['id'] === (int) $chosen['animation']['media_id']) {
                $entry = $m;
            }
        }
        $file = $entry ? $this->fileOf((string) $entry['url']) : null;
        if (! $file) {
            throw new StoreError(422, "$name's standing picture (".($entry['url'] ?? '?').') is not a file this server has.');
        }
        $made = $this->make($file, $entry['sheet'] ?? null, (int) ($chosen['animation']['frames'][0] ?? 0), $chosen['flip'], $options + ['name' => $name]);
        $report = $this->report($name, $made);
        if (! empty($options['dry'])) {
            @unlink($made['png']);

            return $report;
        }

        // The file, named by what is in it, so a browser holding an older walk does not show it.
        $dir = $this->platformDir();
        $hash = substr(sha1_file($made['png']), 0, 24);
        $target = "$dir/$hash.png";
        if (! rename($made['png'], $target) && ! (copy($made['png'], $target) && unlink($made['png']))) {
            throw new \RuntimeException("Could not write $target.");
        }
        @chmod($target, 0664);
        $now = gmdate('Y-m-d H:i:s');
        $params = ['sheet' => ['columns' => $made['frames'], 'rows' => 1], 'made_from' => ['media_id' => (int) $chosen['animation']['media_id'] - Avatars::MEDIA_BASE, 'as' => $made['mode'] === 'legs' ? 'walk' : 'bob']];
        $url = rtrim($this->mediaUrl, '/').'/'.self::PLATFORM_FOLDER."/$hash.png";
        $find = $pdo->prepare('SELECT id FROM platform_media WHERE url = ?');
        $find->execute([$url]);
        $mediaId = (int) $find->fetchColumn();
        if (! $mediaId) {
            $pdo->prepare('INSERT INTO platform_media (type, url, filename, width, height, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute(['image', $url, self::slug($name).'-walk.png', $made['width'] * $made['frames'], $made['height'], json_encode($params), $now, $now]);
            $mediaId = (int) $pdo->lastInsertId();
        }
        $settings['animations']['walk_right'] = ['media_id' => $mediaId, 'duration' => $made['duration']];
        $pdo->prepare('UPDATE avatars SET settings = ?, updated_at = ? WHERE id = ?')->execute([json_encode($settings, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), $now, $row['id']]);
        if ($current && (int) $current['media_id'] !== $mediaId) {
            $this->dropPlatformWalk($pdo, (int) $current['media_id']);
        }

        return $report + ['saved' => true, 'media_id' => $mediaId, 'url' => $url];
    }

    /** A platform picture an earlier walk was drawn on, once no avatar uses it: its row and its file. */
    private function dropPlatformWalk(PDO $pdo, int $mediaId): void
    {
        $st = $pdo->prepare('SELECT url, params FROM platform_media WHERE id = ?');
        $st->execute([$mediaId]);
        $m = $st->fetch(PDO::FETCH_ASSOC);
        $params = $m ? (json_decode((string) $m['params'], true) ?: []) : [];
        if (! $m || ! isset($params['made_from'])) {
            return; // a walk someone drew: kept
        }
        foreach ($pdo->query('SELECT settings FROM avatars')->fetchAll(PDO::FETCH_COLUMN) as $s) {
            foreach ((array) ((json_decode((string) $s, true) ?: [])['animations'] ?? []) as $a) {
                if ((int) ($a['media_id'] ?? 0) === $mediaId) {
                    return;
                }
            }
        }
        $pdo->prepare('DELETE FROM platform_media WHERE id = ?')->execute([$mediaId]);
        $file = $this->fileOf((string) $m['url']);
        if ($file && str_starts_with($file, $this->platformDir().'/')) {
            @unlink($file);
        }
    }

    private function platformDir(): string
    {
        if ($this->mediaDir === null) {
            throw new StoreError(503, 'There is no media folder to save the walk in (QBL_MEDIA_DIR).');
        }
        $dir = rtrim($this->mediaDir, '/').'/'.self::PLATFORM_FOLDER;
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException("Cannot create $dir");
        }

        return $dir;
    }

    // ============================================================== characters

    /** Make a scenario character's walk (a decoded `characters` row). Options and report as for forAvatar. */
    public function forCharacter(ScenarioStore $store, int $scenarioId, array $row, array $options = []): array
    {
        $media = [];
        $bundle = $store->bundle($scenarioId);
        // A relative address is the scenario's asset_base_url's, as the game reads it (resolveMediaUrl).
        $base = rtrim((string) ($bundle['scenario']['settings']['asset_base_url'] ?? ''), '/');
        foreach ($bundle['media'] as $m) {
            $media[(int) $m['id']] = $m;
        }
        $mediaEntry = fn (int $id) => isset($media[$id]) ? ['id' => $id, 'sheet' => $media[$id]['params']['sheet'] ?? null, 'animations' => $media[$id]['params']['animations'] ?? null] : null;
        $character = NpcCharacter::fromRow($row, $mediaEntry);
        $name = (string) $row['name'];
        $current = $character->animations['walk_right'] ?? null;
        if ($current && empty($options['force'])) {
            return ['name' => $name, 'skipped' => 'it already walks right (--force replaces that walk)'];
        }
        $chosen = $character->chosen('stand');
        if (! $chosen || $chosen['name'] === 'portrait') {
            return ['name' => $name, 'skipped' => 'it has no standing picture to make a walk from'];
        }
        $picture = $media[(int) $chosen['animation']['media_id']] ?? null;
        $url = (string) ($picture['url'] ?? '');
        if ($url !== '' && ! preg_match('#^(https?:)?//|^/|^data:#', $url)) {
            $url = "$base/$url";
        }
        $file = $picture ? ($store->mediaFile($picture) ?? $this->fileOf($url)) : null;
        if (! $file) {
            throw new StoreError(422, "$name's standing picture (".($picture['url'] ?? '?').') is not a file this server has.');
        }
        $made = $this->make($file, $picture['params']['sheet'] ?? null, (int) ($chosen['animation']['frames'][0] ?? 0), $chosen['flip'], $options + ['name' => $name]);
        $report = $this->report($name, $made);
        if (! empty($options['dry'])) {
            @unlink($made['png']);

            return $report;
        }

        $added = $store->addMediaFile($scenarioId, $made['png'], self::slug($name).'-walk.png');
        @unlink($made['png']);
        $store->updateRow($scenarioId, 'media', $added['id'], [
            'scale_x' => $picture['scale_x'] ?? 1, 'scale_y' => $picture['scale_y'] ?? 1,
            'params' => array_merge((array) ($added['params'] ?? []), [
                'category' => 'character',
                'sheet' => ['columns' => $made['frames'], 'rows' => 1],
                'made_from' => ['media_id' => (int) $picture['id'], 'as' => $made['mode'] === 'legs' ? 'walk' : 'bob'],
            ]),
        ]);
        // A row from before characters had animations gets them written out, as the editor does.
        $settings = (array) ($row['settings'] ?? []);
        $settings['animations'] = $character->animations;
        $settings['animations']['walk_right'] = ['media_id' => (int) $added['id'], 'duration' => $made['duration']];
        unset($settings['portrait_media_id']);
        $store->updateRow($scenarioId, 'characters', (int) $row['id'], ['settings' => $settings] + (! empty($row['media_id']) ? ['media_id' => null] : []));
        if ($current && isset($media[(int) $current['media_id']]['params']['made_from'])) {
            $this->dropScenarioWalk($store, $scenarioId, (int) $current['media_id'], (int) $row['id']);
        }

        return $report + ['saved' => true, 'media_id' => (int) $added['id']];
    }

    /** A walk made earlier for this character, once nothing else in the scenario uses its picture. */
    private function dropScenarioWalk(ScenarioStore $store, int $scenarioId, int $mediaId, int $characterId): void
    {
        $bundle = $store->bundle($scenarioId);
        foreach ($bundle as $table => $rows) {
            if ($table === 'scenario' || $table === 'media' || ! is_array($rows)) {
                continue;
            }
            foreach ($rows as $r) {
                if (preg_match('/"(?:media_id|music_media_id|portrait_media_id|badge_media_id|narration_media_id)":'.$mediaId.'\b/', json_encode($r))) {
                    return;
                }
            }
        }
        $store->deleteRow($scenarioId, 'media', $mediaId);
    }

    // ================================================================ the walk

    /**
     * Draw the walk: the picture (one frame of it, for a sheet), facing right, through walk.ts.
     * Returns what walk.ts says, with `png`: a temporary file holding the sheet.
     */
    public function make(string $file, ?array $sheet, int $frame, bool $mirror, array $options = []): array
    {
        $image = @imagecreatefromstring((string) file_get_contents($file));
        if (! $image) {
            throw new StoreError(422, basename($file).' is not a picture this server can read.');
        }
        if (! imageistruecolor($image)) {
            imagepalettetotruecolor($image);
        }
        $columns = max(1, (int) ($sheet['columns'] ?? 1));
        $rows = max(1, (int) ($sheet['rows'] ?? 1));
        $w = intdiv(imagesx($image), $columns);
        $h = intdiv(imagesy($image), $rows);
        $frame = max(0, min($frame, $columns * $rows - 1));
        $x0 = ($frame % $columns) * $w;
        $y0 = intdiv($frame, $columns) * $h;

        $raw = '';
        for ($y = 0; $y < $h; $y++) {
            $line = [];
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($image, $mirror ? $x0 + $w - 1 - $x : $x0 + $x, $y0 + $y);
                $alpha = ($c >> 24) & 0x7F; // GD: 0 opaque … 127 clear
                $line[] = ($c >> 16) & 0xFF;
                $line[] = ($c >> 8) & 0xFF;
                $line[] = $c & 0xFF;
                $line[] = $alpha === 0 ? 255 : ($alpha === 127 ? 0 : (int) round((127 - $alpha) * 255 / 127));
            }
            $raw .= pack('C*', ...$line);
        }
        imagedestroy($image);

        $in = tempnam(sys_get_temp_dir(), 'qbl-stand-');
        $out = tempnam(sys_get_temp_dir(), 'qbl-walk-').'.png';
        file_put_contents($in, $raw);
        $command = $this->node.' '.escapeshellarg($this->script).' --in '.escapeshellarg($in).' --out '.escapeshellarg($out)." --width $w --height $h"
            .(isset($options['stride']) ? ' --stride '.escapeshellarg((string) (float) $options['stride']) : '');
        $pipes = [];
        $process = proc_open($command, [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (! is_resource($process)) {
            @unlink($in);
            throw new StoreError(500, 'Could not start Node to draw the walk.');
        }
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $status = proc_close($process);
        @unlink($in);
        $result = json_decode((string) $stdout, true);
        if ($status !== 0 || ! is_array($result) || ! is_file($out)) {
            @unlink($out);
            throw new StoreError(500, 'Drawing the walk failed: '.trim($stderr ?: $stdout ?: "exit code $status")." ($command)");
        }

        if (! empty($options['preview'])) {
            $dir = rtrim((string) $options['preview'], '/');
            if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
                throw new \RuntimeException("Cannot create $dir");
            }
            copy($out, $dir.'/'.self::slug((string) ($options['name'] ?? pathinfo($file, PATHINFO_FILENAME))).'-walk.png');
        }

        return $result + ['png' => $out];
    }

    /** What a run made, for the command to show: whether it walks or bobs, and how the feet came out. */
    private function report(string $name, array $made): array
    {
        return [
            'name' => $name, 'mode' => $made['mode'], 'why' => $made['why'] ?? null,
            'frame' => [$made['width'], $made['height']], 'feet' => $made['feet'] ?? null, 'arms' => (int) ($made['arms'] ?? 0),
        ];
    }

    /** Where a picture's address is on disk: uploaded media, or the shipped /scenario-assets/. */
    public function fileOf(string $url): ?string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $roots = [];
        if ($this->mediaDir !== null) {
            $roots[rtrim($this->mediaUrl, '/').'/'] = $this->mediaDir;
        }
        if ($this->assetsDir !== null) {
            $roots['/scenario-assets/'] = $this->assetsDir;
        }
        foreach ($roots as $prefix => $dir) {
            if (! str_starts_with($path, $prefix)) {
                continue;
            }
            $root = realpath($dir);
            $file = $root ? realpath($root.'/'.rawurldecode(substr($path, strlen($prefix)))) : false;
            if ($file && str_starts_with($file, $root.DIRECTORY_SEPARATOR) && is_file($file)) {
                return $file;
            }
        }

        return null;
    }

    public static function slug(string $name): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($name)), '-') ?: 'character';
    }
}
