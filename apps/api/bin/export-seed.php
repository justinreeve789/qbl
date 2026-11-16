<?php

/**
 * Generate scenario JSON from seed data without Laravel or a database:
 *
 *   php apps/api/bin/export-seed.php starship > scenarios/starship.json
 *
 * It runs the same ScenarioCompiler the API uses, so the game server's file
 * backend and the seeded database serve the same document.
 */
require __DIR__.'/../app/Qbl/ProgressStore.php';
require __DIR__.'/../app/Qbl/ScenarioCompiler.php';

$name = $argv[1] ?? 'starship';
$file = __DIR__."/../database/seeders/data/{$name}.php";
if (! preg_match('/^[a-z0-9_-]+$/i', $name) || ! is_file($file)) {
    fwrite(STDERR, "No seed data named \"{$name}\".\n");
    exit(1);
}

$document = App\Qbl\ScenarioCompiler::compile(require $file);
echo json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), "\n";
