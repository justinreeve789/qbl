<?php

return [
    // Shared secret for the game server's calls to /api/internal.
    'service_key' => env('QBL_SERVICE_KEY'),

    // Whether POST /api/auth/guest issues tokens for name-only guests.
    'allow_guests' => (bool) env('QBL_ALLOW_GUESTS', false),

    // "reset" makes the seeder put the shipped demo mission back, replacing any edits to it.
    'seed' => env('QBL_SEED'),

    // Where files uploaded in the editor are written, and the URL prefix the web server serves them under.
    'media_dir' => env('QBL_MEDIA_DIR', storage_path('app/media')),
    'media_url' => env('QBL_MEDIA_URL', '/media'),
];
