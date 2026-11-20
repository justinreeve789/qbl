<?php

namespace App\Qbl\Api;

use App\Qbl\Avatars;
use PDO;
use RuntimeException;

/**
 * An organization's own avatars, imported through the API: a school mascot, characters its
 * students drew. Its players choose from these as well as the platform's set; other
 * organizations' players never see them in their list, though they can meet them in a game.
 *
 * Pictures are uploaded (multipart, or base64 in JSON) and kept on this server. A link to a
 * picture elsewhere is refused on purpose: every player's browser would fetch it from that
 * other server, telling it who was playing and when, which a children's service may not allow.
 */
class OrgAvatars
{
    use Sql;

    public const MAX_BYTES = 5 * 1024 * 1024;

    public const MAX_SIDE = 4096;

    public const MAX_PER_ORGANIZATION = 200;

    private const TYPES = ['image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif', 'image/jpeg' => 'jpg'];

    public function __construct(PDO $pdo, private ?string $mediaDir = null, private string $mediaUrl = '/media')
    {
        $this->pdo = $pdo;
    }

    /** The platform's avatars and the organization's own, as players choose from them. */
    public function list(int $rootId, bool $includeInactive = false): array
    {
        $rows = $this->all('SELECT * FROM avatars WHERE (organization_id IS NULL OR organization_id = ?)'.($includeInactive ? '' : ' AND active = 1').' ORDER BY CASE WHEN organization_id IS NULL THEN 0 ELSE 1 END, sequence, id', [$rootId]);

        return array_map(fn ($r) => $this->present($r), $rows);
    }

    public function get(int $rootId, int $id): array
    {
        return $this->present($this->own($rootId, $id, true));
    }

    /**
     * Import an avatar. `$files` may hold `image` and `portrait` ([tmp_name]); otherwise
     * `image_base64` / `portrait_base64` in `$attrs`. Settings: scale, sheet, animations, sequence.
     */
    public function create(int $rootId, array $attrs, array $files = []): array
    {
        if ((int) $this->one('SELECT COUNT(*) AS n FROM avatars WHERE organization_id = ? AND active = 1', [$rootId])['n'] >= self::MAX_PER_ORGANIZATION) {
            throw new ApiError(409, 'limit_reached', 'An organization may have at most '.self::MAX_PER_ORGANIZATION.' active avatars.');
        }
        $name = Privacy::text($attrs['name'] ?? null, 'name', 64) ?? throw ApiError::invalid('name', 'An avatar needs a name.');
        $externalId = isset($attrs['external_id']) ? Privacy::externalId($attrs['external_id']) : null;
        if ($externalId !== null && $this->one('SELECT id FROM avatars WHERE organization_id = ? AND external_id = ?', [$rootId, $externalId])) {
            throw new ApiError(409, 'conflict', "There is already an avatar with external_id $externalId.");
        }
        [$imageUrl, $size] = $this->picture($rootId, 'image', $attrs, $files, true);
        [$portraitUrl] = $this->picture($rootId, 'portrait', $attrs, $files, false);
        $settings = self::settings($attrs, $size);
        $id = $this->insert('INSERT INTO avatars (name, image_url, portrait_url, settings, active, sequence, organization_id, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)',
            [$name, $imageUrl, $portraitUrl, json_encode($settings), (int) ($attrs['sequence'] ?? 0), $rootId, $externalId, self::now(), self::now()]);

        return $this->get($rootId, $id);
    }

    /** Change an avatar's name, pictures, settings or whether players can choose it (`active`). */
    public function update(int $rootId, int $id, array $attrs, array $files = []): array
    {
        $row = $this->own($rootId, $id);
        $set = ['updated_at' => self::now()];
        if (array_key_exists('name', $attrs)) {
            $set['name'] = Privacy::text($attrs['name'], 'name', 64) ?? throw ApiError::invalid('name', 'An avatar needs a name.');
        }
        $size = null;
        if (isset($files['image']) || isset($attrs['image_base64'])) {
            [$set['image_url'], $size] = $this->picture($rootId, 'image', $attrs, $files, true);
        }
        if (isset($files['portrait']) || isset($attrs['portrait_base64'])) {
            [$set['portrait_url']] = $this->picture($rootId, 'portrait', $attrs, $files, false);
        }
        if (array_key_exists('portrait_base64', $attrs) && $attrs['portrait_base64'] === null) {
            $set['portrait_url'] = null;
        }
        if (array_intersect_key($attrs, ['scale' => 1, 'sheet' => 1, 'animations' => 1]) || $size) {
            $old = self::json($row['settings']);
            $set['settings'] = json_encode(self::settings($attrs + $old, $size ?? (isset($old['width']) ? [$old['width'], $old['height']] : null)));
        }
        if (array_key_exists('active', $attrs)) {
            $set['active'] = $attrs['active'] ? 1 : 0;
        }
        if (array_key_exists('sequence', $attrs)) {
            $set['sequence'] = (int) $attrs['sequence'];
        }
        $this->run('UPDATE avatars SET '.implode(', ', array_map(fn ($k) => "$k = ?", array_keys($set))).' WHERE id = ?', [...array_values($set), $id]);

        return $this->get($rootId, $id);
    }

    /**
     * Retire an avatar. It is kept (inactive) so games in progress can still draw the players
     * wearing it; those players choose again next time.
     */
    public function retire(int $rootId, int $id): void
    {
        $this->own($rootId, $id);
        $this->run('UPDATE avatars SET active = 0, updated_at = ? WHERE id = ?', [self::now(), $id]);
        $this->run('UPDATE users SET avatar_media_id = NULL WHERE avatar_media_id = ?', [Avatars::BASE + $id]);
    }

    private function own(int $rootId, int $id, bool $platformToo = false): array
    {
        $row = $this->one('SELECT * FROM avatars WHERE id = ?', [$id]);
        if (! $row || ((int) $row['organization_id'] !== $rootId && ! ($platformToo && $row['organization_id'] === null))) {
            throw ApiError::notFound('The avatar');
        }
        if ($row['organization_id'] === null && ! $platformToo) {
            throw new ApiError(403, 'forbidden', 'Platform avatars cannot be changed through the API.');
        }

        return $row;
    }

    private function present(array $r): array
    {
        $s = self::json($r['settings']);

        return [
            'id' => (int) $r['id'], 'media_id' => Avatars::BASE + (int) $r['id'], 'name' => $r['name'], 'external_id' => $r['external_id'] ?? null,
            'owner' => $r['organization_id'] === null ? 'platform' : 'organization',
            'image_url' => $r['image_url'], 'portrait_url' => $r['portrait_url'],
            'scale' => $s['scale'] ?? 1, 'width' => $s['width'] ?? null, 'height' => $s['height'] ?? null, 'sheet' => $s['sheet'] ?? null, 'animations' => $s['animations'] ?? [],
            'active' => (bool) $r['active'], 'sequence' => (int) $r['sequence'],
        ];
    }

    /** Keep an uploaded picture. @return array{0: ?string, 1: ?array{0:int,1:int}} its URL and size */
    private function picture(int $rootId, string $field, array $attrs, array $files, bool $required): array
    {
        if (isset($attrs[$field.'_url'])) {
            throw ApiError::invalid($field.'_url', 'Upload the picture (multipart "'.$field.'", or '.$field.'_base64). Links to pictures on other servers are not accepted, so players\' browsers never contact third parties.');
        }
        $path = null;
        $temp = null;
        if (isset($files[$field]['tmp_name'])) {
            $path = $files[$field]['tmp_name'];
        } elseif (isset($attrs[$field.'_base64']) && is_string($attrs[$field.'_base64'])) {
            $data = base64_decode(preg_replace('#^data:[^;,]+;base64,#', '', $attrs[$field.'_base64']), true);
            if ($data === false || $data === '') {
                throw ApiError::invalid($field.'_base64', "{$field}_base64 is not valid base64.");
            }
            $temp = $path = tempnam(sys_get_temp_dir(), 'qbl-avatar');
            file_put_contents($path, $data);
        }
        if ($path === null) {
            if ($required) {
                throw ApiError::invalid($field, 'Send the picture as a multipart file "'.$field.'", or as '.$field.'_base64.');
            }

            return [null, null];
        }
        try {
            if (filesize($path) > self::MAX_BYTES) {
                throw ApiError::invalid($field, 'Pictures may be at most 5 MB.');
            }
            $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
            $size = @getimagesize($path);
            if (! isset(self::TYPES[$mime]) || ! $size) {
                throw ApiError::invalid($field, 'Pictures must be PNG, WebP, GIF or JPEG.');
            }
            if ($size[0] > self::MAX_SIDE || $size[1] > self::MAX_SIDE) {
                throw ApiError::invalid($field, 'Pictures may be at most '.self::MAX_SIDE.' pixels on a side.');
            }
            if ($this->mediaDir === null) {
                throw new ApiError(503, 'unavailable', 'File uploads are not set up on this server.');
            }
            $dir = $this->mediaDir.'/avatars/o'.$rootId;
            if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
                throw new RuntimeException("Cannot create $dir");
            }
            $name = bin2hex(random_bytes(12)).'.'.self::TYPES[$mime];
            if (! copy($path, "$dir/$name")) {
                throw new RuntimeException('Could not store the picture.');
            }

            return [rtrim($this->mediaUrl, '/').'/avatars/o'.$rootId.'/'.$name, [$size[0], $size[1]]];
        } finally {
            if ($temp) {
                @unlink($temp);
            }
        }
    }

    /** How the game draws the avatar: scale, and for a sprite sheet its grid and animations. */
    private static function settings(array $attrs, ?array $size): array
    {
        $scale = $attrs['scale'] ?? 1;
        if (! is_numeric($scale) || $scale < 0.1 || $scale > 4) {
            throw ApiError::invalid('scale', 'scale must be a number from 0.1 to 4.');
        }
        $out = ['scale' => (float) $scale];
        if ($size) {
            [$out['width'], $out['height']] = $size;
        }
        $sheet = $attrs['sheet'] ?? null;
        if ($sheet !== null) {
            $columns = $sheet['columns'] ?? null;
            $rows = $sheet['rows'] ?? null;
            if (! is_int($columns) || ! is_int($rows) || $columns < 1 || $rows < 1 || $columns > 32 || $rows > 32) {
                throw ApiError::invalid('sheet', 'sheet is {"columns": 1-32, "rows": 1-32}.');
            }
            $out['sheet'] = ['columns' => $columns, 'rows' => $rows];
            $frames = $columns * $rows;
            $animations = [];
            foreach ((array) ($attrs['animations'] ?? []) as $i => $a) {
                $name = is_array($a) ? ($a['name'] ?? null) : null;
                $list = is_array($a) ? ($a['frames'] ?? null) : null;
                if (! is_string($name) || ! preg_match('/^[a-z][a-z0-9_-]{0,31}$/', $name) || ! is_array($list) || ! $list
                    || array_filter($list, fn ($f) => ! is_int($f) || $f < 0 || $f >= $frames)) {
                    throw ApiError::invalid("animations.$i", 'Each animation is {"name": lowercase, "frames": [0..'.($frames - 1).'], "duration"?: ms, "repeat"?: bool}.');
                }
                $animations[] = array_filter(['name' => $name, 'frames' => array_values($list), 'duration' => isset($a['duration']) ? max(16, min(60000, (int) $a['duration'])) : null, 'repeat' => isset($a['repeat']) ? (bool) $a['repeat'] : null], fn ($v) => $v !== null);
            }
            if ($animations) {
                $out['animations'] = $animations;
            }
        } elseif (! empty($attrs['animations'])) {
            throw ApiError::invalid('animations', 'Animations need a sheet: {"columns", "rows"}.');
        }

        return $out;
    }
}
