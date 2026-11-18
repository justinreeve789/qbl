<?php

/**
 * A small stand-in for the Laravel API, for working on the editor without Docker
 * and for the editor's browser tests:
 *
 *   php -S 127.0.0.1:8000 apps/api/dev/server.php        (or: npm run dev:api)
 *
 * It serves the editor API and scenario JSON from the same framework-free classes
 * Laravel uses (ScenarioStore, EditorApi, ScenarioCompiler), over a SQLite file.
 *
 * NOT FOR DEPLOYMENT. Sign-in accepts any email and password and makes you a teacher.
 */
if (PHP_SAPI !== 'cli-server') {
    http_response_code(500);
    exit("This is a development server. Run it with php -S.\n");
}
foreach (['StoreError', 'ProgressStore', 'ActivityStore', 'ScenarioCompiler', 'ClassStore', 'Avatars', 'ClassApi', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive', 'EditorApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\EditorApi;
use App\Qbl\ScenarioStore;

$dataDir = getenv('QBL_DEV_DATA') ?: dirname(__DIR__, 3).'/.data/dev-api';
@mkdir("$dataDir/media", 0775, true);
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$method = $_SERVER['REQUEST_METHOD'];

// Uploaded media.
if (preg_match('#^/media/(\d+/[a-f0-9]{24}\.[a-z0-9]{2,4})$#', $path, $m) && is_file("$dataDir/media/$m[1]")) {
    header('Content-Type: '.(mime_content_type("$dataDir/media/$m[1]") ?: 'application/octet-stream'));
    header('X-Content-Type-Options: nosniff');
    readfile("$dataDir/media/$m[1]");
    exit;
}

// The demo mission's media, which the app container serves from its public directory.
if (str_starts_with($path, '/scenario-assets/')) {
    $root = realpath(dirname(__DIR__, 3).'/scenarios/assets');
    $file = realpath($root.substr($path, strlen('/scenario-assets')));
    if ($root && $file && str_starts_with($file, $root.DIRECTORY_SEPARATOR) && is_file($file)) {
        header('Content-Type: '.(mime_content_type($file) ?: 'application/octet-stream'));
        readfile($file);
        exit;
    }
    http_response_code(404);
    exit;
}

$pdo = new PDO("sqlite:$dataDir/qbl.sqlite");
$store = new ScenarioStore($pdo, "$dataDir/media", '/media');
foreach (array_merge(ScenarioStore::sqliteSchema(), App\Qbl\ActivityStore::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
// First run: seed the demo mission exactly as the Laravel seeder does. After that it is left alone.
$seeded = $store->seedScenario(require __DIR__.'/../database/seeders/data/starship.php');
if ($seeded !== null) {
    $store->publish($seeded);
}

// The platform's marketplace catalogue, added once, as ShopSeeder does.
foreach (require __DIR__.'/../database/seeders/data/shop.php' as $sequence => $item) {
    $pdo->prepare('INSERT OR IGNORE INTO `shop_items` (`id`, `scenario_id`, `name`, `description`, `kind`, `slot`, `price`, `image_url`, `settings`, `active`, `sequence`) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        ->execute([$item['id'], $item['name'], $item['description'] ?? null, $item['kind'], $item['slot'] ?? null, $item['price'], $item['image_url'] ?? null, json_encode($item['settings'] ?? []), $sequence + 1]);
}

// The platform's avatars, added once, as AvatarSeeder does.
foreach (require __DIR__.'/../database/seeders/data/avatars.php' as $sequence => $avatar) {
    $pdo->prepare('INSERT OR IGNORE INTO `avatars` (`id`, `name`, `image_url`, `portrait_url`, `settings`, `active`, `sequence`) VALUES (?, ?, ?, ?, ?, 1, ?)')
        ->execute([$avatar['id'], $avatar['name'], $avatar['image_url'], $avatar['portrait_url'] ?? null, json_encode($avatar['settings'] ?? []), $sequence + 1]);
}

function respond(int $status, ?array $body): never
{
    http_response_code($status);
    if ($body !== null) {
        header('Content-Type: application/json');
        echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    exit;
}

$json = json_decode((string) file_get_contents('php://input'), true);
$body = is_array($json) ? $json : $_POST;

// Dev tokens carry the user in the open. They prove nothing.
$user = null;
if (preg_match('/^Bearer dev\.(.+)$/', $_SERVER['HTTP_AUTHORIZATION'] ?? '', $m)) {
    $decoded = json_decode((string) base64_decode(strtr($m[1], '-_', '+/')), true);
    $user = is_array($decoded) && isset($decoded['id'], $decoded['role']) ? $decoded : null;
}
$issue = function (array $u): array {
    return ['token' => 'dev.'.rtrim(strtr(base64_encode(json_encode($u)), '+/', '-_'), '='), 'user' => $u];
};

// Google sign-in needs the real backend and Google's servers; the stand-in does not offer it.
if ($path === '/api/auth/providers') {
    respond(200, ['google' => false, 'guest' => true]);
}
if ($path === '/api/auth/login' && $method === 'POST') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    if ($email === '') {
        respond(422, ['message' => 'Enter an email address.']);
    }
    // Anyone can sign in with any address. One starting "admin" is an admin, "student" a student, and the rest teachers.
    $account = ['id' => crc32($email) % 100000 + 10, 'name' => ucfirst(strtok($email, '@')), 'role' => str_starts_with($email, 'admin') ? 'admin' : (str_starts_with($email, 'student') ? 'student' : 'teacher')];
    // Kept as a row, so a teacher can add the student to a class by this address.
    $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `role`, `stars`, `xp`) VALUES (?, ?, ?, ?, 100, 0)')->execute([$account['id'], $account['name'], $email, $account['role']]);
    respond(200, $issue($account));
}
if ($path === '/api/auth/guest' && $method === 'POST') {
    $name = trim((string) ($body['name'] ?? 'Guest')) ?: 'Guest';
    respond(200, $issue(['id' => random_int(100000, 999999), 'name' => mb_substr($name, 0, 24), 'role' => 'guest']));
}
if ($path === '/api/auth/logout' && $method === 'POST') {
    respond(200, ['ok' => true]);
}
if ($path === '/api/me') {
    if (! $user) {
        respond(401, ['message' => 'Unauthenticated.']);
    }
    $chosen = $pdo->prepare('SELECT `avatar_media_id` FROM `users` WHERE `id` = ?');
    $chosen->execute([$user['id']]);
    respond(200, ['user' => array_filter($user + ['avatar_media_id' => (int) $chosen->fetchColumn() ?: null], fn ($v) => $v !== null)]);
}
// Missions, avatars and the teacher's classes, with the same rules as the Laravel app (App\Qbl\ClassApi).
if (preg_match('#^/api/(missions|avatars|me/avatar|players/\d+/profile|teach(/.*)?)$#', $path, $m)) {
    if ($user && $user['role'] === 'guest') {
        // Guests are not rows here until they need to be.
        $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `role`) VALUES (?, ?, ?)')->execute([$user['id'], $user['name'], 'guest']);
    }
    respond(...(new App\Qbl\ClassApi($pdo))->handle($method, $m[1], $body, $user));
}
if (preg_match('#^/api/scenarios/([A-Za-z][A-Za-z0-9_-]*)/play$#', $path, $m)) {
    $document = $store->findPublished($m[1]);
    if (! $document) {
        respond(404, ['message' => 'Scenario not found.']);
    }
    // Teams and assignments are for their members, as in the Laravel app. Saves need the game server and the real backend.
    $group = substr((string) ($_GET['group'] ?? 'public'), 0, 64) ?: 'public';
    if ($user ? ! (new App\Qbl\ClassStore($pdo))->mayJoin((int) $user['id'], (string) $user['role'], (int) $document['id'], $group) : $group !== 'public') {
        respond(403, ['message' => 'You are not in that team.']);
    }
    $access = $user ? (new App\Qbl\ClassStore($pdo))->access((int) $user['id'], (string) $user['role'], (int) $document['id'], $group) : ['party' => $group];
    $instance = array_filter(['group' => $group, 'party' => $access['party'], 'team_name' => $access['team_name'] ?? null], fn ($v) => $v !== null);
    respond(200, ['scenario' => App\Qbl\Avatars::inject($pdo, $document) + ['session' => null, 'instance' => $instance]]);
}
// Stars, XP and the marketplace, with the same rules as the Laravel app (App\Qbl\ProgressStore).
// Awards themselves come through the game server, which needs the real backend; here stars start at 100.
if ($path === '/api/me/progress' || $path === '/api/shop' || preg_match('#^/api/shop/(\d+)/(buy|equip)$#', $path, $m)) {
    $progress = new App\Qbl\ProgressStore($pdo);
    $member = $user && $user['role'] !== 'guest';
    if ($member) {
        // Normally there since sign-in; this covers tokens issued before accounts were kept as rows.
        $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `role`, `stars`, `xp`) VALUES (?, ?, ?, ?, 100, 0)')->execute([$user['id'], $user['name'], "dev{$user['id']}@example.test", $user['role']]);
    }
    $scenario = ($key = $_GET['scenario'] ?? $body['scenario'] ?? null) ? $store->findPublished((string) $key) : null;
    try {
        if ($path === '/api/shop') {
            respond(200, ['items' => $progress->catalogue($scenario['id'] ?? null), 'progress' => $member ? $progress->progress($user['id']) : null]);
        }
        if (! $user) {
            respond(401, ['message' => 'Unauthenticated.']);
        }
        if ($path === '/api/me/progress') {
            respond(200, ['progress' => $progress->progress($user['id'])]);
        }
        respond(200, ['progress' => $m[2] === 'buy' && $method === 'POST'
            ? $progress->buy($user['id'], (int) $m[1], $scenario['id'] ?? null)
            : $progress->equip($user['id'], (int) $m[1], (bool) ($body['equipped'] ?? true))]);
    } catch (App\Qbl\StoreError $e) {
        respond($e->status, ['message' => $e->getMessage()]);
    }
}
if (str_starts_with($path, '/api/editor/') || $path === '/api/editor') {
    $files = isset($_FILES['file']) ? ['file' => ['tmp_name' => $_FILES['file']['tmp_name'], 'name' => $_FILES['file']['name']]] : [];
    [$status, $answer] = (new EditorApi($store))->handle($method, substr($path, strlen('/api/editor')), $body, $user, $files);
    if (isset($answer['download'])) {
        header('Content-Type: '.$answer['download']['type']);
        header('Content-Disposition: attachment; filename="'.$answer['download']['name'].'"');
        readfile($answer['download']['path']);
        unlink($answer['download']['path']);
        exit;
    }
    respond($status, $answer);
}
respond(404, ['message' => 'Not found.']);
