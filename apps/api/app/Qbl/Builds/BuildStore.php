<?php

namespace App\Qbl\Builds;

use App\Qbl\ClassStore;
use App\Qbl\Roles;
use App\Qbl\StoreError;
use PDO;

/**
 * What students build in scenes that allow it: an extra layer over a scene, never part of the
 * scenario. Plain PHP over PDO, like the other stores, so the dev server and Laravel share it.
 *
 * Each student has one build per scene in each instance they play in (`group_key`: `public`, an
 * assignment's `a12`, a team's `t7`), and the pictures they uploaded for their builds there. Both
 * belong with the student's save: starting their game again (ClassStore::resetProgress) deletes
 * them, as does deleting the student (Api\Roster). The tables' SQLite form is in ClassStore::sqliteSchema,
 * which owns resetting, so that every store's tests have them.
 *
 * A build waits for the teacher (`pending`) unless the scene's author said it need not; until it is
 * `approved` only its maker and their teacher see it. `hidden`: the teacher took it down.
 *
 * Who reviews: the teacher of the assignment the instance belongs to; for a scenario's public
 * game, the scenario's owner; admins, any.
 *
 * Uploaded pictures are re-encoded here (which drops what a camera writes into a photo, such as
 * where it was taken), made no larger than MAX_SIDE, and kept in the database, so that deleting the
 * row deletes the picture. They are served by an unguessable key (fileUrl), so the game can load
 * them as it loads any picture.
 */
class BuildStore
{
    public const MAX_SIDE = 1600;

    private ClassStore $classes;

    /** `$filesUrl`: where uploads are served, the key appended (the API's /api/builds/files). */
    public function __construct(private PDO $pdo, private string $filesUrl = '/api/builds/files', ?ClassStore $classes = null)
    {
        $this->classes = $classes ?? new ClassStore($pdo);
    }

    // ------------------------------------------------------------------ players

    /**
     * What a player sees and may do in one instance of a scenario: the builds shown to them (their own,
     * whatever its state, and others' approved ones where the scene shares them), and their uploads.
     */
    public function forPlayer(array $user, string $key, string $group): array
    {
        [$scenario, $document] = $this->joined($user, $key, $group);
        $me = (int) $user['id'];
        $shared = [];
        foreach ($document['scenes'] ?? [] as $scene) {
            $rules = BuildRules::of($scene);
            if ($rules && $rules['share'] === 'instance') {
                $shared[] = (int) $scene['id'];
            }
        }
        $rows = $this->all(
            'SELECT b.*, u.name AS author FROM scene_builds b JOIN users u ON u.id = b.user_id WHERE b.scenario_id = ? AND b.group_key = ? ORDER BY b.updated_at, b.id',
            [$scenario['id'], $group],
        );
        $builds = [];
        foreach ($rows as $row) {
            $mine = (int) $row['user_id'] === $me;
            if ($mine || ($row['status'] === 'approved' && in_array((int) $row['scene_id'], $shared, true))) {
                $builds[] = $this->present($row, $mine);
            }
        }
        // The pictures others' approved builds show, so the game can load them.
        $shownUploads = [];
        foreach ($builds as $b) {
            if (! $b['mine']) {
                foreach ($b['pieces'] as $p) {
                    if (($p['kind'] ?? '') === 'picture') {
                        $shownUploads[] = (int) $p['upload_id'];
                    }
                }
            }
        }

        return [
            'may_build' => $this->mayBuild($user),
            'builds' => $builds,
            'uploads' => $this->uploadsOf($scenario['id'], $me, $group),
            'pictures' => $this->picturesById($scenario['id'], $group, $shownUploads),
        ];
    }

    /**
     * Keep a player's build in one scene: the whole list of what they added. An empty list removes it.
     * It waits for the teacher again after any change, unless the scene's author said builds need no approval.
     */
    public function save(array $user, string $key, string $group, int $sceneId, mixed $pieces): ?array
    {
        if (! $this->mayBuild($user)) {
            throw new StoreError(403, 'Sign in to build. Guests can look, but cannot build.');
        }
        [$scenario, $document] = $this->joined($user, $key, $group);
        $scene = null;
        foreach ($document['scenes'] ?? [] as $s) {
            if ((int) ($s['id'] ?? 0) === $sceneId) {
                $scene = $s;
            }
        }
        $rules = $scene ? BuildRules::of($scene) : null;
        if (! $rules) {
            throw new StoreError(422, 'You cannot build in this scene.');
        }
        $size = BuildRules::size($document, $scene);
        if (! $size) {
            throw new StoreError(422, 'This scene has no size, so nothing can be placed in it.');
        }
        if (! is_array($pieces)) {
            throw new StoreError(422, 'A build is a list of things.');
        }
        $me = (int) $user['id'];
        $uploads = array_map(fn ($u) => (int) $u['id'], $this->uploadsOf($scenario['id'], $me, $group));
        $problems = BuildRules::problems($rules, $size, $pieces, $uploads);
        if ($problems) {
            throw new StoreError(422, implode(' ', $problems));
        }
        $pieces = array_map(fn ($p) => BuildRules::tidy($p), $pieces);
        $existing = $this->one('SELECT * FROM scene_builds WHERE scenario_id = ? AND scene_id = ? AND user_id = ? AND group_key = ?', [$scenario['id'], $sceneId, $me, $group]);
        $now = self::now();
        if (! $pieces) {
            if ($existing) {
                $this->run('DELETE FROM scene_builds WHERE id = ?', [$existing['id']]);
            }

            return null;
        }
        $status = $rules['approve'] ? 'pending' : 'approved';
        $json = json_encode($pieces, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($existing) {
            // Nothing changed: it keeps its state (an approved build stays approved).
            if ($existing['pieces'] === $json) {
                return $this->present($existing + ['author' => $user['name'] ?? ''], true);
            }
            $this->run('UPDATE scene_builds SET pieces = ?, status = ?, reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?', [$json, $status, $now, $existing['id']]);
            $id = (int) $existing['id'];
        } else {
            $this->run(
                'INSERT INTO scene_builds (scenario_id, scene_id, user_id, group_key, status, pieces, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$scenario['id'], $sceneId, $me, $group, $status, $json, $now, $now],
            );
            $id = (int) $this->pdo->lastInsertId();
        }

        return $this->present($this->one('SELECT b.*, u.name AS author FROM scene_builds b JOIN users u ON u.id = b.user_id WHERE b.id = ?', [$id]), true);
    }

    /**
     * Keep a picture a player uploaded for their builds in one instance. The file at `$path` is read
     * and re-encoded; the original is not kept.
     */
    public function upload(array $user, string $key, string $group, string $path): array
    {
        if (! $this->mayBuild($user)) {
            throw new StoreError(403, 'Sign in to upload pictures.');
        }
        [$scenario, $document] = $this->joined($user, $key, $group);
        $allowed = false;
        foreach ($document['scenes'] ?? [] as $scene) {
            $allowed = $allowed || in_array('picture', BuildRules::of($scene)['tools'] ?? [], true);
        }
        if (! $allowed) {
            throw new StoreError(422, 'This mission does not take pictures.');
        }
        $me = (int) $user['id'];
        if (count($this->uploadsOf($scenario['id'], $me, $group)) >= BuildRules::UPLOADS) {
            throw new StoreError(422, 'You have uploaded '.BuildRules::UPLOADS.' pictures here already. Remove one to add another.');
        }
        [$bytes, $mime, $width, $height] = self::reencode($path);
        $now = self::now();
        $fileKey = bin2hex(random_bytes(12));
        $st = $this->pdo->prepare('INSERT INTO build_uploads (scenario_id, user_id, group_key, file_key, mime, width, height, bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $st->bindValue(1, $scenario['id'], PDO::PARAM_INT);
        $st->bindValue(2, $me, PDO::PARAM_INT);
        $st->bindValue(3, $group);
        $st->bindValue(4, $fileKey);
        $st->bindValue(5, $mime);
        $st->bindValue(6, $width, PDO::PARAM_INT);
        $st->bindValue(7, $height, PDO::PARAM_INT);
        $st->bindValue(8, $bytes, PDO::PARAM_LOB);
        $st->bindValue(9, $now);
        $st->bindValue(10, $now);
        $st->execute();

        return ['id' => (int) $this->pdo->lastInsertId(), 'url' => $this->fileUrl($fileKey), 'width' => $width, 'height' => $height];
    }

    /** Remove one of a player's uploads, and the pictures in their builds that showed it. */
    public function removeUpload(array $user, int $uploadId): void
    {
        $row = $this->one('SELECT id, scenario_id, group_key FROM build_uploads WHERE id = ? AND user_id = ?', [$uploadId, (int) $user['id']]);
        if (! $row) {
            throw new StoreError(404, 'No such picture.');
        }
        foreach ($this->all('SELECT * FROM scene_builds WHERE scenario_id = ? AND user_id = ? AND group_key = ?', [$row['scenario_id'], (int) $user['id'], $row['group_key']]) as $build) {
            $pieces = json_decode((string) $build['pieces'], true) ?: [];
            $kept = array_values(array_filter($pieces, fn ($p) => ! (($p['kind'] ?? '') === 'picture' && (int) ($p['upload_id'] ?? 0) === $uploadId)));
            if (count($kept) !== count($pieces)) {
                $kept
                    ? $this->run('UPDATE scene_builds SET pieces = ?, updated_at = ? WHERE id = ?', [json_encode($kept, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), self::now(), $build['id']])
                    : $this->run('DELETE FROM scene_builds WHERE id = ?', [$build['id']]);
            }
        }
        $this->run('DELETE FROM build_uploads WHERE id = ?', [$uploadId]);
    }

    /** An upload's picture by its key: [bytes, mime], or null. */
    public function file(string $fileKey): ?array
    {
        if (! preg_match('/^[a-f0-9]{24}$/', $fileKey)) {
            return null;
        }
        $row = $this->one('SELECT bytes, mime FROM build_uploads WHERE file_key = ?', [$fileKey]);

        return $row ? [is_resource($row['bytes']) ? stream_get_contents($row['bytes']) : (string) $row['bytes'], (string) $row['mime']] : null;
    }

    // ------------------------------------------------------------------ teachers

    /**
     * The builds a teacher reviews: in the instances of their assignments, and in the public game of
     * the scenarios they own. `$status`: pending (the default), approved, hidden or all.
     */
    public function queue(array $user, string $status = 'pending'): array
    {
        if (! Roles::isStaff((string) ($user['role'] ?? ''))) {
            throw new StoreError(403, 'This is for teachers.');
        }
        $where = [];
        $args = [];
        if (in_array($status, ['pending', 'approved', 'hidden'], true)) {
            $where[] = 'b.status = ?';
            $args[] = $status;
        }
        // Only the instances this teacher looks after: their assignments' and their teams', and the
        // public games of scenarios they own (reviewable() checks each row again). Admins: all.
        if (($user['role'] ?? '') !== 'admin') {
            $me = (int) $user['id'];
            $groups = [];
            foreach ($this->all('SELECT id FROM assignments WHERE teacher_id = ?', [$me]) as $a) {
                $groups[] = 'a'.$a['id'];
            }
            foreach ($this->all('SELECT t.id FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE a.teacher_id = ?', [$me]) as $t) {
                $groups[] = 't'.$t['id'];
            }
            $mine = $groups ? 'b.group_key IN ('.implode(',', array_fill(0, count($groups), '?')).')' : '0 = 1';
            $where[] = "($mine OR s.user_id = ?)";
            array_push($args, ...$groups);
            $args[] = $me;
        }
        $rows = $this->all(
            'SELECT b.*, u.name AS author, s.title AS scenario_title, s.code AS scenario_code, s.user_id AS scenario_owner, s.document AS document
             FROM scene_builds b JOIN users u ON u.id = b.user_id JOIN scenarios s ON s.id = b.scenario_id'
            .($where ? ' WHERE '.implode(' AND ', $where) : '').' ORDER BY b.updated_at DESC, b.id DESC LIMIT 200',
            $args,
        );
        $out = [];
        $documents = [];
        foreach ($rows as $row) {
            $where = $this->reviewable($user, $row);
            if (! $where) {
                continue;
            }
            $doc = $documents[$row['scenario_id']] ??= (json_decode((string) $row['document'], true) ?: []);
            $out[] = $this->present($row, false) + [
                'student' => ['id' => (int) $row['user_id'], 'name' => (string) $row['author']],
                'scenario' => ['id' => (int) $row['scenario_id'], 'title' => (string) $row['scenario_title'], 'code' => (string) $row['scenario_code']],
                'where' => $where,
                'preview' => $this->preview($doc, (int) $row['scene_id'], json_decode((string) $row['pieces'], true) ?: [], (int) $row['scenario_id'], (string) $row['group_key']),
            ];
        }

        return $out;
    }

    /** A teacher approves a build, or hides it: `approved` or `hidden`. */
    public function review(array $user, int $buildId, string $status): array
    {
        if (! in_array($status, ['approved', 'hidden', 'pending'], true)) {
            throw new StoreError(422, 'A build can be approved, hidden, or put back to wait.');
        }
        $row = $this->one('SELECT b.*, u.name AS author, s.user_id AS scenario_owner FROM scene_builds b JOIN users u ON u.id = b.user_id JOIN scenarios s ON s.id = b.scenario_id WHERE b.id = ?', [$buildId]);
        if (! $row || ! Roles::isStaff((string) ($user['role'] ?? '')) || ! $this->reviewable($user, $row)) {
            throw new StoreError(404, 'No such build.');
        }
        $this->run('UPDATE scene_builds SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [$status, (int) $user['id'], self::now(), $buildId]);

        return $this->present(['status' => $status] + $row, false);
    }

    /** A teacher deletes a build. */
    public function remove(array $user, int $buildId): void
    {
        $row = $this->one('SELECT b.*, s.user_id AS scenario_owner FROM scene_builds b JOIN scenarios s ON s.id = b.scenario_id WHERE b.id = ?', [$buildId]);
        if (! $row || ! Roles::isStaff((string) ($user['role'] ?? '')) || ! $this->reviewable($user, $row)) {
            throw new StoreError(404, 'No such build.');
        }
        $this->run('DELETE FROM scene_builds WHERE id = ?', [$buildId]);
    }

    // ------------------------------------------------------------------ helpers

    /** Signed in with an account: guests can see builds but not make them. */
    private function mayBuild(array $user): bool
    {
        return ($user['role'] ?? 'guest') !== 'guest';
    }

    /**
     * The published scenario a player is in, if they may be in that instance of it.
     *
     * @return array{0: array, 1: array} the scenario row and its document
     */
    private function joined(array $user, string $key, string $group): array
    {
        $scenario = $this->one(
            'SELECT id, user_id, document FROM scenarios WHERE published_at IS NOT NULL AND (code = ? OR shortname = ?) ORDER BY (code = ?) DESC LIMIT 1',
            [strtolower($key), $key, strtolower($key)],
        );
        if (! $scenario || ! $this->classes->mayJoin((int) $user['id'], (string) ($user['role'] ?? ''), (int) $scenario['id'], $group)) {
            throw new StoreError(404, 'Scenario not found.');
        }

        return [$scenario, json_decode((string) $scenario['document'], true) ?: []];
    }

    /** Whether this teacher reviews this build, and if so a few words saying where it is ("Period 2 · Team Otters"). */
    private function reviewable(array $user, array $row): ?string
    {
        $me = (int) $user['id'];
        $admin = ($user['role'] ?? '') === 'admin';
        if (preg_match('/^([at])(\d+)$/', (string) $row['group_key'], $m)) {
            $a = $m[1] === 't'
                ? $this->one('SELECT a.id, a.teacher_id, a.scenario_id, t.name AS team FROM teams t JOIN assignments a ON a.id = t.assignment_id WHERE t.id = ?', [(int) $m[2]])
                : $this->one('SELECT a.id, a.teacher_id, a.scenario_id, NULL AS team FROM assignments a WHERE a.id = ?', [(int) $m[2]]);
            if (! $a || (int) $a['scenario_id'] !== (int) $row['scenario_id'] || (! $admin && (int) $a['teacher_id'] !== $me)) {
                return null;
            }

            return $a['team'] !== null ? 'Team '.$a['team'] : 'Your class';
        }
        if ($admin || (int) $row['scenario_owner'] === $me) {
            return 'The public game';
        }

        return null;
    }

    private function present(array $row, bool $mine): array
    {
        return [
            'id' => (int) $row['id'],
            'scene_id' => (int) $row['scene_id'],
            'mine' => $mine,
            'author' => (string) ($row['author'] ?? ''),
            'status' => (string) $row['status'],
            'pieces' => json_decode((string) $row['pieces'], true) ?: [],
            'updated_at' => isset($row['updated_at']) ? gmdate('Y-m-d\TH:i:sP', strtotime($row['updated_at'].' UTC')) : null,
        ];
    }

    private function uploadsOf(int $scenarioId, int $userId, string $group): array
    {
        return array_map(fn ($u) => ['id' => (int) $u['id'], 'url' => $this->fileUrl($u['file_key']), 'width' => (int) $u['width'], 'height' => (int) $u['height']], $this->all(
            'SELECT id, file_key, width, height FROM build_uploads WHERE scenario_id = ? AND user_id = ? AND group_key = ? ORDER BY id',
            [$scenarioId, $userId, $group],
        ));
    }

    /** Uploads by id, as {id: {url, width, height}}: the pictures in builds shown to someone other than their maker. */
    private function picturesById(int $scenarioId, string $group, array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));
        if (! $ids) {
            return [];
        }
        $out = [];
        foreach ($this->all('SELECT id, file_key, width, height FROM build_uploads WHERE scenario_id = ? AND group_key = ? AND id IN ('.implode(',', array_fill(0, count($ids), '?')).')', [$scenarioId, $group, ...$ids]) as $u) {
            $out[(string) $u['id']] = ['url' => $this->fileUrl($u['file_key']), 'width' => (int) $u['width'], 'height' => (int) $u['height']];
        }

        return $out;
    }

    /** What a teacher needs to see a build where it is: the scene's size and main picture, and the pictures its pieces show. */
    private function preview(array $document, int $sceneId, array $pieces, int $scenarioId, string $group): array
    {
        $scene = null;
        foreach ($document['scenes'] ?? [] as $s) {
            if ((int) ($s['id'] ?? 0) === $sceneId) {
                $scene = $s;
            }
        }
        $assets = [];
        foreach ((array) ($document['assets'] ?? []) as $m) {
            $assets[(int) ($m['id'] ?? 0)] = $m;
        }
        $url = function (?int $id) use ($assets, $document): ?string {
            $u = $id !== null ? ($assets[$id]['url'] ?? null) : null;
            if (! is_string($u) || $u === '') {
                return null;
            }

            $base = (string) ($document['asset_base_url'] ?? '');

            return preg_match('#^(https?:)?//|^/|^data:#', $u) || $base === '' ? $u : rtrim($base, '/').'/'.ltrim($u, '/');
        };
        $first = $scene['background_media'][0] ?? null;
        $media = [];
        foreach ($pieces as $p) {
            if (($p['kind'] ?? '') === 'sticker') {
                $media[(string) $p['media_id']] = ['url' => $url((int) $p['media_id']), 'width' => (int) ($assets[(int) $p['media_id']]['width'] ?? 0), 'height' => (int) ($assets[(int) $p['media_id']]['height'] ?? 0)];
            }
        }
        $uploads = array_map(fn ($p) => (int) $p['upload_id'], array_filter($pieces, fn ($p) => ($p['kind'] ?? '') === 'picture'));
        $size = $scene ? BuildRules::size($document, $scene) : null;

        return [
            'scene' => $scene ? (string) ($scene['shortname'] ?? $scene['subtitle'] ?? ('Scene '.$sceneId)) : 'A scene that is gone',
            'width' => $size['width'] ?? 0,
            'height' => $size['height'] ?? 0,
            'zoom' => (float) ($scene['zoom'] ?? 1) ?: 1.0,
            'background_url' => is_array($first) ? $url((int) ($first['media_id'] ?? $first['id'] ?? 0)) : null,
            'media' => $media,
            'pictures' => $this->picturesById($scenarioId, $group, $uploads),
        ];
    }

    private function fileUrl(string $fileKey): string
    {
        return rtrim($this->filesUrl, '/').'/'.$fileKey;
    }

    /**
     * Read an uploaded picture and write it again, no larger than MAX_SIDE: [bytes, mime, width, height].
     * WebP where this PHP can write it, otherwise PNG; see-through parts are kept.
     */
    public static function reencode(string $path): array
    {
        $size = is_file($path) ? filesize($path) : false;
        if ($size === false || $size < 1) {
            throw new StoreError(422, 'Choose a picture to upload.');
        }
        if ($size > BuildRules::UPLOAD_BYTES) {
            throw new StoreError(422, 'That picture is too big. Pictures can be up to '.(BuildRules::UPLOAD_BYTES >> 20).' MB.');
        }
        $info = @getimagesize($path);
        if (! $info || ! in_array($info[2] ?? null, [IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
            throw new StoreError(422, 'Upload a PNG, JPEG, WebP or GIF picture.');
        }
        [$w, $h] = $info;
        if ($w < 1 || $h < 1 || $w > 8000 || $h > 8000 || $w * $h > 40_000_000) {
            throw new StoreError(422, 'That picture is too big.');
        }
        if (! function_exists('imagecreatefromstring')) {
            throw new StoreError(500, 'This server cannot read pictures.');
        }
        $src = @imagecreatefromstring((string) file_get_contents($path));
        if (! $src) {
            throw new StoreError(422, 'That picture could not be read.');
        }
        // A phone photo taken sideways says so in its EXIF; turn it the right way before that is dropped.
        if (($info[2] ?? null) === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
            $turn = [3 => 180, 6 => -90, 8 => 90][(int) (@exif_read_data($path)['Orientation'] ?? 1)] ?? 0;
            if ($turn) {
                $turned = imagerotate($src, $turn, 0);
                if ($turned) {
                    imagedestroy($src);
                    $src = $turned;
                    [$w, $h] = [imagesx($src), imagesy($src)];
                }
            }
        }
        $scale = min(1, self::MAX_SIDE / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        $out = imagecreatetruecolor($nw, $nh);
        imagealphablending($out, false);
        imagesavealpha($out, true);
        imagefill($out, 0, 0, imagecolorallocatealpha($out, 0, 0, 0, 127));
        imagecopyresampled($out, $src, 0, 0, 0, 0, $nw, $nh, $w, $h);
        imagedestroy($src);
        ob_start();
        $webp = function_exists('imagewebp') && ! empty(gd_info()['WebP Support']);
        $webp ? imagewebp($out, null, 86) : imagepng($out, null, 7);
        $bytes = (string) ob_get_clean();
        imagedestroy($out);

        return [$bytes, $webp ? 'image/webp' : 'image/png', $nw, $nh];
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    private function one(string $sql, array $args): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        $row = $st->fetch(PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    private function all(string $sql, array $args): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function run(string $sql, array $args): void
    {
        $this->pdo->prepare($sql)->execute($args);
    }
}
