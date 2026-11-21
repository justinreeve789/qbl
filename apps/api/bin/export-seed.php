<?php

/**
 * Generate the JSON of a shipped scenario for the game server's file backend, without Laravel
 * or a database server:
 *
 *   php apps/api/bin/export-seed.php starship-explorer > scenarios/starship.json
 *
 * The argument names a ZIP in apps/api/database/seeders/scenarios (or is the path of one). It is
 * seeded into an in-memory SQLite database with the same classes `qbl:seed` uses, and published,
 * so the file backend and the seeded database serve the same document. The file backend has no
 * /media, so the files uploaded for the scenario are copied to an `uploads` folder beside its
 * other assets (scenarios/assets/starship/uploads for the demo) and the document points there.
 * Needs PHP with the pdo_sqlite and zip extensions.
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\ScenarioArchive;
use App\Qbl\ScenarioStore;

$name = $argv[1] ?? 'starship-explorer';
$zip = is_file($name) ? $name : ScenarioArchive::SHIPPED."/$name.zip";
if (! is_file($zip)) {
    fwrite(STDERR, "No shipped scenario named \"{$name}\".\n");
    exit(1);
}

$temp = sys_get_temp_dir().'/qbl-export-seed-'.bin2hex(random_bytes(4));
$pdo = new PDO('sqlite::memory:');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$store = new ScenarioStore($pdo, $temp, '/media');
$id = (new ScenarioArchive($store))->seed($zip);
[$document, $files] = ScenarioArchive::forFileBackend($store->publish($id));

if ($files) {
    $base = (string) ($document['asset_base_url'] ?? '');
    if (! preg_match('#^/scenario-assets/([A-Za-z0-9_-]+)$#', $base, $match)) {
        fwrite(STDERR, "The scenario has uploaded files but its asset_base_url (\"$base\") is not a folder of scenarios/assets.\n");
        exit(1);
    }
    $uploads = dirname(__DIR__, 3)."/scenarios/assets/{$match[1]}/uploads";
    @mkdir($uploads, 0775, true);
    foreach ($files as $file => $filepath) {
        copy("$temp/$filepath", "$uploads/$file");
    }
}
foreach (glob("$temp/*/*") ?: [] as $file) {
    @unlink($file);
}
foreach (glob("$temp/*") ?: [] as $dir) {
    @rmdir($dir);
}
@rmdir($temp);

echo json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
