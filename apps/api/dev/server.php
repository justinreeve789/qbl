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
foreach (['StoreError', 'Roles', 'ProgressStore', 'ActivityStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive', 'EditorApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}
// The rest (the voices, the HTTP client they use) as they are needed.
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

// Everything else (plans and credits, the generator's API, the district panel) is loaded when used.
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

use App\Qbl\EditorApi;
use App\Qbl\ScenarioStore;

$dataDir = getenv('QBL_DEV_DATA') ?: dirname(__DIR__, 3).'/.data/dev-api';
@mkdir("$dataDir/media", 0775, true);
$path = rawurldecode((string) parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$method = $_SERVER['REQUEST_METHOD'];

// Uploaded media (and the files given to library assets, under library/).
if (preg_match('#^/media/((?:library/)?\d+/[a-f0-9]{24}\.[a-z0-9]{2,4})$#', $path, $m) && is_file("$dataDir/media/$m[1]")) {
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
foreach (array_merge(ScenarioStore::sqliteSchema(), App\Qbl\ActivityStore::sqliteSchema(), App\Qbl\Api\Clients::sqliteSchema(), App\Qbl\Billing\Credits::sqliteSchema(),
    App\Qbl\District\Integrations::sqliteSchema(), App\Qbl\Generation\GenerationRuns::sqliteSchema(), App\Qbl\Generation\GenerationEvents::sqliteSchema(), App\Qbl\Library\AssetLibrary::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
foreach (['organizations' => ['integrations_enabled_at', 'license'], 'users' => ['self_registered_at', 'email_verified_at']] as $table => $columns) {
    foreach ($columns as $column) {
        try {
            $pdo->exec("ALTER TABLE `$table` ADD COLUMN `$column`");
        } catch (PDOException) {
            // There already.
        }
    }
}
// First run (no scenarios yet): add the shipped scenarios (the demo mission) from their ZIPs, as
// the Laravel seeder does, and publish them. After that they are left alone.
if (! $pdo->query('SELECT COUNT(*) FROM `scenarios`')->fetchColumn()) {
    $archive = new App\Qbl\ScenarioArchive($store);
    foreach (App\Qbl\ScenarioArchive::shipped() as $zip) {
        $seeded = $archive->seed($zip);
        if ($seeded !== null) {
            $store->publish($seeded);
        }
    }
}

// The platform's marketplace catalogue, added once, as ShopSeeder does.
foreach (require __DIR__.'/../database/seeders/data/shop.php' as $sequence => $item) {
    $pdo->prepare('INSERT OR IGNORE INTO `shop_items` (`id`, `scenario_id`, `name`, `description`, `kind`, `slot`, `price`, `image_url`, `settings`, `active`, `sequence`) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        ->execute([$item['id'], $item['name'], $item['description'] ?? null, $item['kind'], $item['slot'] ?? null, $item['price'], $item['image_url'] ?? null, json_encode($item['settings'] ?? []), $sequence + 1]);
}

// The asset library's shipped pack (scenarios/assets/library), each asset added once, as LibrarySeeder does.
$library = new App\Qbl\Library\AssetLibrary($pdo, "$dataDir/media", '/media', dirname(__DIR__, 3).'/scenarios/assets/library');
$library->importPack();

// The platform's avatars, added once, as AvatarSeeder does; a dev database with the first cast gets
// the new one in its place, as the migration 2026_11_21_000200_replace_platform_avatars does.
App\Qbl\Avatars::replaceFirstCast($pdo, require __DIR__.'/../database/seeders/data/avatars.php');
App\Qbl\Avatars::seed($pdo, require __DIR__.'/../database/seeders/data/avatars.php');

// The role a dev sign-in gets: one starting "admin" is an admin, "content" a content admin, "student" a
// student, the rest teachers; unless the account was since made a content admin or a teacher again
// (on the library's Content admins list), which is kept.
$devRole = function (string $email) use ($pdo): string {
    $kept = $pdo->prepare('SELECT `role` FROM `users` WHERE `email` = ?');
    $kept->execute([$email]);
    $role = $kept->fetchColumn();
    if (in_array($role, ['content_admin', 'teacher'], true) && ! str_starts_with($email, 'admin') && ! str_starts_with($email, 'student')) {
        return $role;
    }

    return str_starts_with($email, 'admin') ? 'admin' : (str_starts_with($email, 'content') ? 'content_admin' : (str_starts_with($email, 'student') ? 'student' : 'teacher'));
};

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
    respond(200, ['google' => false, 'guest' => true, 'register' => true, 'teacher' => true]);
}
// Creating an account: checked like the real API, then signed in like any other address here.
if ($path === '/api/auth/register' && $method === 'POST') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $name = trim(strip_tags((string) ($body['name'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $problem = match (true) {
        $name === '' => 'Enter your name.',
        ! filter_var($email, FILTER_VALIDATE_EMAIL) => 'That does not look like an email address.',
        strlen($password) < 8 => 'Use a password of at least 8 characters.',
        $password !== (string) ($body['password_confirmation'] ?? '') => 'The two passwords are not the same.',
        default => null,
    };
    if ($problem) {
        respond(422, ['message' => $problem]);
    }
    $role = ($body['role'] ?? null) === 'teacher' ? 'teacher' : 'student';
    $account = ['id' => crc32($email) % 100000 + 10, 'name' => mb_substr($name, 0, 60), 'email' => $email, 'role' => $role];
    $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `role`, `stars`, `xp`) VALUES (?, ?, ?, ?, 100, 0)')->execute([$account['id'], $account['name'], $email, $role]);
    respond(201, $issue($account));
}
if ($path === '/api/auth/login' && $method === 'POST') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    if ($email === '') {
        respond(422, ['message' => 'Enter an email address.']);
    }
    // Anyone can sign in with any address; $devRole says with which role.
    $account = ['id' => crc32($email) % 100000 + 10, 'name' => ucfirst(strtok($email, '@')), 'email' => $email, 'role' => $devRole($email)];
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
// "Forgot your password?": the same answer as Laravel's; the link (which works for any address here) goes to this server's output.
if ($path === '/api/auth/forgot-password' && $method === 'POST') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, ['message' => 'That does not look like an email address.']);
    }
    error_log('Password reset link for '.$email.': http://'.($_SERVER['HTTP_HOST'] ?? 'localhost').'/missions#'.http_build_query(['reset-password' => 'dev', 'email' => $email], '', '&', PHP_QUERY_RFC3986));
    respond(202, ['ok' => true, 'message' => 'If an account with a password uses that address, a link to choose a new password is on its way. It works for 60 minutes. Check your spam folder too.']);
}
// Choosing a new password with the link: any token but "expired" works, and signs in as that address does here.
if ($path === '/api/auth/reset-password' && $method === 'POST') {
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $password = (string) ($body['password'] ?? '');
    $problem = match (true) {
        ($body['token'] ?? '') === '' || $email === '' => 'This link is not complete. Open the link from the email again.',
        strlen($password) < 8 => 'Use a password of at least 8 characters.',
        $password !== (string) ($body['password_confirmation'] ?? '') => 'The two passwords are not the same.',
        $body['token'] === 'expired' => 'This link has expired or was already used. Ask for a new one.',
        default => null,
    };
    if ($problem) {
        respond(422, ['message' => $problem]);
    }
    $account = ['id' => crc32($email) % 100000 + 10, 'name' => ucfirst(strtok($email, '@')), 'email' => $email, 'role' => $devRole($email)];
    $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `role`, `stars`, `xp`) VALUES (?, ?, ?, ?, 100, 0)')->execute([$account['id'], $account['name'], $email, $account['role']]);
    respond(200, $issue($account));
}
// The profile page. Every account here "has a password"; a current password of "wrong-password" is refused, to try the message.
if ($path === '/api/me/password' && $method === 'PUT') {
    if (! $user || $user['role'] === 'guest') {
        respond($user ? 409 : 401, ['message' => $user ? 'This account has no password to change.' : 'Unauthenticated.']);
    }
    $password = (string) ($body['password'] ?? '');
    $problem = match (true) {
        ($body['current_password'] ?? '') === '' => 'Enter your current password.',
        $body['current_password'] === 'wrong-password' => 'That is not your current password.',
        strlen($password) < 8 => 'Use a password of at least 8 characters.',
        $password !== (string) ($body['password_confirmation'] ?? '') => 'The two new passwords are not the same.',
        default => null,
    };
    if ($problem) {
        respond(422, ['message' => $problem]);
    }
    respond(200, ['ok' => true, 'signed_out_elsewhere' => 0]);
}
if ($path === '/api/me') {
    if (! $user) {
        respond(401, ['message' => 'Unauthenticated.']);
    }
    if ($method === 'PATCH') {
        // Checked like the Laravel app (AuthController::update). The name is kept on the row; the token still carries the old one.
        $name = trim((string) preg_replace('/\s+/u', ' ', strip_tags((string) ($body['name'] ?? ''))));
        $problem = match (true) {
            $user['role'] === 'guest' => 'Guests choose a name each time they play. Create an account to keep one.',
            $name === '' => 'Enter a name.',
            mb_strlen($name) > 60 => 'Use a name of at most 60 characters.',
            (bool) preg_match('/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/', $name) || (bool) preg_match('/(?:\+?\d[\s().\-]*){7,}/', $name) => 'Other players see this name, so leave out email addresses and phone numbers.',
            default => null,
        };
        if ($problem) {
            respond($user['role'] === 'guest' ? 403 : 422, ['message' => $problem]);
        }
        $pdo->prepare('INSERT OR IGNORE INTO `users` (`id`, `name`, `email`, `role`, `stars`, `xp`) VALUES (?, ?, ?, ?, 100, 0)')->execute([$user['id'], $name, $user['email'] ?? null, $user['role']]);
        $pdo->prepare('UPDATE `users` SET `name` = ? WHERE `id` = ?')->execute([$name, $user['id']]);
    }
    $row = $pdo->prepare('SELECT `name`, `avatar_media_id` FROM `users` WHERE `id` = ?');
    $row->execute([$user['id']]);
    $row = $row->fetch(PDO::FETCH_ASSOC) ?: [];
    $own = $user['role'] === 'guest' ? [] : ['has_password' => true, 'uses_google' => false, 'name_locked' => false];
    respond(200, ['user' => array_filter(['name' => $row['name'] ?? $user['name']] + $user + ['avatar_media_id' => (int) ($row['avatar_media_id'] ?? 0) ?: null] + $own, fn ($v) => $v !== null)]);
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
// Laravel's env(), for reading config files here.
if (! function_exists('env')) {
    function env(string $key, mixed $default = null): mixed
    {
        $value = getenv($key);

        return $value === false ? $default : match (strtolower($value)) {
            'true' => true, 'false' => false, 'null', '' => null, default => $value,
        };
    }
}
// Plans and billing: off here (everything open), as on a site without QBL_BILLING_ENABLED.
// QBL_DEV_BILLING=1: on, to look at the plans pages (nothing can be bought: there is no Stripe here).
$plans = new App\Qbl\Billing\Plans(['enabled' => (bool) getenv('QBL_DEV_BILLING')] + require __DIR__.'/../config/qbl_billing.php');
$entitlements = new App\Qbl\Billing\Entitlements($pdo, $plans);
$credits = new App\Qbl\Billing\Credits($pdo, $entitlements);
if (preg_match('#^/api/billing(?:/(checkout|change|portal|promotion|credits))?$#', $path, $m)) {
    respond(...(new App\Qbl\Billing\BillingApi($entitlements, $credits, new App\Qbl\Billing\Subscriptions($pdo, $plans, null, 'http://localhost')))->handle($method, $m[1] ?? '', $body, $user));
}
// The generator needs the real backend (keys, the queue worker): here it says so. With
// QBL_DEV_GENERATOR=1 it pretends instead: a run goes through every stage in about 70 seconds (worked
// out from the time on each request, so no worker is needed) and ends as an empty draft. For trying
// the editor's generator page and its progress bar, nothing more. A number of seconds above 1
// (QBL_DEV_GENERATOR=15) makes the pretend run take that long instead.
if (preg_match('#^/api/editor/generations(?:/([0-9a-z/]+))?$#', $path, $m)) {
    App\Qbl\Generation\GenerationRuns::sqliteUpgrade($pdo);
    $pretend = (bool) getenv('QBL_DEV_GENERATOR');
    if ($pretend) {
        devPretendGenerations($pdo, $store, $credits);
    }
    respond(...(new App\Qbl\Generation\GenerationApi($pdo, $entitlements, $credits, fn () => null,
        $pretend ? null : fn () => throw new RuntimeException('the development server does not make missions; use Docker (or QBL_DEV_GENERATOR=1 to pretend).')))
        ->handle($method, isset($m[1]) ? explode('/', $m[1]) : [], $body, $user));
}
// The district admin panel, with its integrations' secrets merely encoded (NOT FOR DEPLOYMENT).
if (str_starts_with($path, '/api/district/')) {
    $http = new App\Qbl\Generation\Http\CurlHttpClient(0);
    $district = null;
    $district = new App\Qbl\District\DistrictApi($pdo, new App\Qbl\District\Integrations($pdo, 'base64_encode', 'base64_decode'), new App\Qbl\District\RosterSync($pdo),
        new App\Qbl\District\CleverClient($http, '', ''), new App\Qbl\District\GoogleClassroomClient($http), 'http://localhost:5173',
        function (int $run) use (&$district) {
            $district->performSync($run);
        });
    $files = isset($_FILES['file']) ? ['file' => ['tmp_name' => $_FILES['file']['tmp_name'], 'name' => $_FILES['file']['name']]] : [];
    respond(...$district->handle($method, substr($path, strlen('/api/district')), $body, $user, $files));
}
if (str_starts_with($path, '/api/editor/library') && preg_match('#^/api/editor/library(/.*)?$#', $path, $m)) {
    $files = isset($_FILES['file']) ? ['file' => ['tmp_name' => $_FILES['file']['tmp_name'], 'name' => $_FILES['file']['name']]] : [];
    respond(...(new App\Qbl\Library\LibraryApi($library, $store, new App\Qbl\Library\ContentAdmins($pdo)))->handle($method, $m[1] ?? '', $body, $user, $files, $_GET));
}
if (str_starts_with($path, '/api/editor/') || $path === '/api/editor') {
    $files = isset($_FILES['file']) ? ['file' => ['tmp_name' => $_FILES['file']['tmp_name'], 'name' => $_FILES['file']['name']]] : [];
    // Voices: Kokoro on this machine (docker run -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:v0.10.0), or QBL_TTS_DRIVER=none.
    $speech = new App\Qbl\Speech\SpeechFactory([
        'driver' => getenv('QBL_TTS_DRIVER') ?: 'kokoro',
        'engines' => ['kokoro' => ['class' => App\Qbl\Speech\Engines\KokoroEngine::class, 'url' => getenv('QBL_TTS_URL') ?: 'http://localhost:8880']],
        'voices' => __DIR__.'/../resources/speech/voices.json',
        'cache_dir' => "$dataDir/speech",
    ]);
    [$status, $answer] = (new EditorApi($store, speech: $speech))->handle($method, substr($path, strlen('/api/editor')), $body, $user, $files);
    if (isset($answer['download'])) {
        header('Content-Type: '.$answer['download']['type']);
        header('Content-Disposition: '.(empty($answer['download']['inline']) ? 'attachment' : 'inline').'; filename="'.$answer['download']['name'].'"');
        readfile($answer['download']['path']);
        unlink($answer['download']['path']);
        exit;
    }
    respond($status, $answer);
}
respond(404, ['message' => 'Not found.']);

/** QBL_DEV_GENERATOR=1: move pretend runs along by the clock (see the generations route above). */
function devPretendGenerations(PDO $pdo, ScenarioStore $store, App\Qbl\Billing\Credits $credits): void
{
    $plan = ['queued' => 3, 'aligning' => 5, 'designing' => 14, 'drawing' => 40, 'building' => 3, 'importing' => 2];
    $wanted = (float) getenv('QBL_DEV_GENERATOR');
    if ($wanted > 1) {
        $plan = array_map(fn ($s) => $s * $wanted / array_sum($plan), $plan);
    }
    $pictures = 17;
    $runs = new App\Qbl\Generation\GenerationRuns($pdo);
    $busy = $pdo->query("SELECT id FROM scenario_generations WHERE status IN ('".implode("', '", App\Qbl\Generation\GenerationApi::BUSY)."')")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($busy as $id) {
        $run = $runs->get((int) $id);
        if ($run['cancelled_at']) {
            App\Qbl\Generation\GenerationApi::cancelled($pdo, $credits, (int) $id);

            continue;
        }
        $start = strtotime($run['created_at'].' UTC');
        $t = microtime(true) - $start;
        $at = $start;
        $finished = true;
        foreach ($plan as $stage => $seconds) {
            if ($t < $seconds) {
                $finished = false;
                break;
            }
            $t -= $seconds;
            $at += $seconds;
        }
        $iso = fn (int $u) => gmdate('Y-m-d\TH:i:s\Z', $u);
        if ($finished) {
            $title = 'Pretend mission: '.mb_strimwidth($run['prompt'], 0, 40, '…');
            $scenario = $store->createScenario(['title' => $title], $run['user_id'] !== null ? (int) $run['user_id'] : null);
            $runs->update((int) $id, ['status' => 'done', 'scenario_id' => $scenario['id'], 'blueprint' => ['title' => $title],
                'progress' => ['stage' => 'importing', 'percent' => 100, 'detail' => 'Ready', 'started_at' => $iso((int) ($start + $plan['queued'])), 'stage_started_at' => $iso((int) $at)] + (array) $run['progress']]);

            continue;
        }
        $fraction = $t / $plan[$stage];
        $done = $stage === 'drawing' ? (int) floor($fraction * $pictures) : null;
        $detail = match ($stage) {
            'drawing' => $done < 4 ? sprintf('Drawing Professor Fern (character 1 of 2)') : ($done < 7 ? 'Drawing the props: a watering can, a seed tray and the marker' : sprintf('Painting the Greenhouse (scene %d of 5)', min(5, $done - 6))),
            'designing' => $fraction < 0.7 ? 'Writing the story, scenes and questions' : 'Fixing 2 problems in the design (round 1)',
            default => App\Qbl\Generation\GenerationProgress::STAGES[$stage][2],
        };
        $runs->update((int) $id, ['status' => $stage, 'blueprint' => $stage === 'drawing' || $stage === 'building' || $stage === 'importing' ? ['title' => 'The Greenhouse Mystery'] : null, 'progress' => [
            'stage' => $stage, 'stages' => App\Qbl\Generation\GenerationProgress::stagesFor(false),
            'percent' => App\Qbl\Generation\GenerationProgress::percent($stage, $stage === 'drawing' ? $done / $pictures : $fraction),
            'detail' => $detail, 'done' => $done, 'total' => $stage === 'drawing' ? $pictures : null,
            'started_at' => $stage === 'queued' ? null : $iso((int) ($start + $plan['queued'])), 'stage_started_at' => $iso((int) $at), 'updated_at' => $iso(time()),
        ]]);
    }
}
