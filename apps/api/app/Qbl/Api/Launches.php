<?php

namespace App\Qbl\Api;

use PDO;

/**
 * One-time sign-in links. A school's portal or LMS asks for a link for one of its rostered
 * people and sends them to it; opening it signs them in to QBL in that browser (as a Google
 * sign-in does) and takes them to their missions, a mission, or for a teacher, the editor.
 *
 * A link works once and for five minutes, and only a hash of it is kept. Opening it shows a
 * page that redeems it with a POST, so a chat app or mail scanner that fetches the link to make
 * a preview does not use it up.
 */
class Launches
{
    use Sql;

    public const SECONDS = 300;

    public function __construct(PDO $pdo, private string $publicUrl = '')
    {
        $this->pdo = $pdo;
    }

    /**
     * A link for someone. `$to`: missions (default), editor or classes (teachers), or an
     * assignment_id to open that assignment's mission in the student's own team.
     *
     * @return array{url: string, expires_at: string, return_path: string}
     */
    public function create(array $user, ?int $clientId, array $to = []): array
    {
        if ($user['deactivated_at'] !== null) {
            throw new ApiError(409, 'inactive', 'That account is inactive. Set its status to active first.');
        }
        $path = $this->target($user, $to);
        $code = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
        $expires = time() + self::SECONDS;
        $this->insert('INSERT INTO launch_tokens (user_id, api_client_id, token_hash, return_path, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [$user['id'], $clientId, hash('sha256', $code), $path, gmdate('Y-m-d H:i:s', $expires), self::now()]);
        $this->run('DELETE FROM launch_tokens WHERE expires_at < ? OR used_at IS NOT NULL', [gmdate('Y-m-d H:i:s', time() - 86400)]);

        return ['url' => rtrim($this->publicUrl, '/').'/api/v1/launch/'.$code, 'expires_at' => gmdate('Y-m-d\TH:i:s\Z', $expires), 'return_path' => $path];
    }

    /**
     * Use a link: a sign-in token for the browser, who it is for, and where to go.
     *
     * @return array{token: string, user: array, return_path: string}
     */
    public function redeem(string $code): array
    {
        $row = $this->one('SELECT l.*, u.name, u.role, u.avatar_media_id, u.deactivated_at FROM launch_tokens l JOIN users u ON u.id = l.user_id WHERE l.token_hash = ?', [hash('sha256', $code)]);
        if (! $row || $row['used_at'] !== null || strtotime($row['expires_at'].' UTC') < time() || $row['deactivated_at'] !== null) {
            throw new ApiError(410, 'launch_expired', 'This sign-in link has been used or has expired. Go back and open QBL again.');
        }
        // Used once: a second redeem of the same link, even a moment later, finds it used.
        if ($this->run('UPDATE launch_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL', [self::now(), $row['id']]) !== 1) {
            throw new ApiError(410, 'launch_expired', 'This sign-in link has been used or has expired.');
        }
        // A Sanctum personal access token, made as Sanctum makes them: "id|plain", with the plain part's SHA-256 kept.
        $plain = bin2hex(random_bytes(20));
        $id = $this->insert('INSERT INTO personal_access_tokens (tokenable_type, tokenable_id, name, token, abilities, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ['App\\Models\\User', $row['user_id'], 'launch', hash('sha256', $plain), '["*"]', self::now(), self::now()]);

        return [
            'token' => "$id|$plain",
            'user' => array_filter(['id' => (int) $row['user_id'], 'name' => $row['name'], 'role' => $row['role'], 'avatar_media_id' => $row['avatar_media_id'] === null ? null : (int) $row['avatar_media_id']], fn ($v) => $v !== null),
            'return_path' => $row['return_path'],
        ];
    }

    /** The page a link opens: it redeems the link with a POST, keeps the token as the game does, and moves on. */
    public static function page(): string
    {
        return <<<'HTML'
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Signing in to QBL…</title>
<style>body{font:18px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#223}p{max-width:28em;text-align:center}</style>
<p id="m">Signing you in…</p>
<script>
fetch(location.pathname, {method: 'POST', headers: {Accept: 'application/json'}, credentials: 'omit'})
  .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error((d.error && d.error.message) || 'This link did not work.'); return d.data; }); })
  .then(function (d) { try { localStorage.setItem('qbl.token', d.token); } catch (e) {} location.replace(d.return_path); })
  .catch(function (e) { document.getElementById('m').textContent = e.message; });
</script>
HTML;
    }

    private function target(array $user, array $to): string
    {
        $staff = $user['role'] === 'teacher';
        $where = (string) ($to['to'] ?? 'missions');
        if (isset($to['assignment_id'])) {
            $a = $this->one('SELECT a.id, a.teacher_id, s.code FROM assignments a JOIN scenarios s ON s.id = a.scenario_id WHERE a.id = ?', [(int) $to['assignment_id']]);
            if (! $a || ! $a['code']) {
                throw ApiError::invalid('assignment_id', 'No such assignment.');
            }
            if ($staff) {
                if ((int) $a['teacher_id'] !== (int) $user['id']) {
                    throw ApiError::invalid('assignment_id', 'That is not this teacher\'s assignment.');
                }

                return '/'.$a['code'].'?group=a'.$a['id'];
            }
            $place = $this->one('SELECT team_id FROM assignment_student WHERE assignment_id = ? AND student_id = ?', [$a['id'], $user['id']]);
            if (! $place) {
                throw ApiError::invalid('assignment_id', 'That student is not in that assignment.');
            }

            return '/'.$a['code'].'?group='.($place['team_id'] ? 't'.$place['team_id'] : 'a'.$a['id']);
        }

        return match (true) {
            $where === 'missions' => '/missions',
            $where === 'editor' && $staff => '/editor/#/',
            $where === 'classes' && $staff => '/editor/#/classes',
            default => throw ApiError::invalid('to', $staff ? 'to must be missions, editor or classes.' : 'Students can be sent to missions, or to an assignment_id.'),
        };
    }
}
