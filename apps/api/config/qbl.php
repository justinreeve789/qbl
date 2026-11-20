<?php

return [
    // Shared secret for the game server's calls to /api/internal.
    'service_key' => env('QBL_SERVICE_KEY'),

    // Whether POST /api/auth/guest issues tokens for name-only guests.
    'allow_guests' => (bool) env('QBL_ALLOW_GUESTS', false),

    // Signing in with Google is on once GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (config/services.php).
    'google' => [
        // Only addresses at these domains may sign in with Google. Empty: any Google account.
        'domains' => array_values(array_filter(array_map('trim', explode(',', strtolower((string) env('QBL_GOOGLE_DOMAINS', '')))))),
        // New accounts are always students; roles are changed with qbl:update-role.
    ],

    // Ranks, by the XP at which each starts. Platform-wide.
    'ranks' => App\Qbl\ProgressStore::DEFAULT_RANKS,

    // Seeding is done by hand: `php artisan qbl:seed`. "reset" (set by its --reset option) makes the
    // seeder put the shipped demo mission back, replacing any edits to it.
    'seed' => env('QBL_SEED'),
    // When set (the command's --password option), the seeder also creates the demo accounts with it.
    'seed_password' => env('QBL_SEED_PASSWORD'),

    // Where files uploaded in the editor are written, and the URL prefix the web server serves them under.
    'media_dir' => env('QBL_MEDIA_DIR', storage_path('app/media')),
    'media_url' => env('QBL_MEDIA_URL', '/media'),

    // Requests per minute each access token may make to /api/v1 (the public API for schools).
    'api_rate_limit' => (int) env('QBL_API_RATE_LIMIT', 600),
];
