<?php

return [
    // Shared secret for the game server's calls to /api/internal.
    'service_key' => env('QBL_SERVICE_KEY'),

    // Whether POST /api/auth/guest issues tokens for name-only guests.
    'allow_guests' => (bool) env('QBL_ALLOW_GUESTS', false),

    // Whether people may create their own account (name, email, password) on the sign-in screen:
    // POST /api/auth/register. Such accounts are students, like new Google accounts, unless the
    // person says they are a teacher (below).
    'allow_registration' => (bool) env('QBL_ALLOW_REGISTRATION', true),

    // Whether someone creating an account (with a password, or with Google) may say they are a
    // teacher, and get a teacher's account: the editor, Classes and reports. Off, every new account
    // is a student's and teachers are made with qbl:update-role. A school that limits sign-in to its
    // own Google domain usually turns this off, so that only staff it chooses are teachers.
    'allow_teacher_registration' => (bool) env('QBL_ALLOW_TEACHER_SIGNUP', true),

    // What the site calls itself in the emails it sends (choosing a new password).
    'site_name' => env('QBL_SITE_NAME', 'QuestLab'),

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
