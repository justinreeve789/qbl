<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // Sign in with Google. The address Google sends people back to is this path on APP_URL (in
    // Docker: QBL_PUBLIC_URL), so set that to the https address people type, and register exactly
    // https://your-host/api/auth/google/callback with Google.
    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI', '/api/auth/google/callback'),
    ],

    // Clever: QBL's Clever application (Instant Login and Secure Sync), which districts add in their
    // Clever dashboard. Register https://your-host/api/sso/clever/callback as its redirect URI.
    'clever' => [
        'client_id' => env('CLEVER_CLIENT_ID'),
        'client_secret' => env('CLEVER_CLIENT_SECRET'),
        'api_base' => env('CLEVER_API_BASE', 'https://api.clever.com'),
        'auth_base' => env('CLEVER_AUTH_BASE', 'https://clever.com'),
    ],

    // Google Classroom rosters (each district gives its own service account in the admin panel).
    'google_classroom' => [
        'api_base' => env('GOOGLE_CLASSROOM_API_BASE', 'https://classroom.googleapis.com'),
    ],

];
