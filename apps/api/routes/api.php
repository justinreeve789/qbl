<?php

use App\Http\Controllers\ApiV1Controller;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BillingController;
use App\Http\Controllers\ClassController;
use App\Http\Controllers\DistrictController;
use App\Http\Controllers\EditorController;
use App\Http\Controllers\GenerationController;
use App\Http\Controllers\GoogleAuthController;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\LibraryController;
use App\Http\Controllers\PlayController;
use App\Http\Controllers\ProgressController;
use App\Http\Controllers\SsoController;
use App\Http\Middleware\ServiceKey;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:5,1');
Route::post('/auth/guest', [AuthController::class, 'guest'])->middleware('throttle:10,1');
Route::get('/me', [AuthController::class, 'me'])->middleware('auth:sanctum');
// The profile page: the name over the player's character, and the password.
Route::patch('/me', [AuthController::class, 'update'])->middleware(['auth:sanctum', 'throttle:20,1']);
Route::put('/me/password', [AuthController::class, 'changePassword'])->middleware(['auth:sanctum', 'throttle:6,1']);
// "Forgot your password?": a link by email, then a new password with it.
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:5,1');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:10,1');
Route::post('/auth/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');

// Signing in with Google. The browser is sent to the first and comes back to the second.
Route::get('/auth/providers', [GoogleAuthController::class, 'providers']);
Route::get('/auth/google/redirect', [GoogleAuthController::class, 'redirect'])->middleware('throttle:20,1');
Route::get('/auth/google/callback', [GoogleAuthController::class, 'callback'])->middleware('throttle:20,1');

// Stars, XP and the marketplace. Awards are not here: only the game server may grant them.
Route::middleware('auth:sanctum')->group(function () {
    Route::get('/me/progress', [ProgressController::class, 'show']);
    Route::get('/shop', [ProgressController::class, 'shop']);
    Route::post('/shop/{item}/buy', [ProgressController::class, 'buy'])->whereNumber('item');
    Route::post('/shop/{item}/equip', [ProgressController::class, 'equip'])->whereNumber('item');
});

// Missions, avatars and the teacher's classes. One controller hands these to App\Qbl\ClassApi, which lists the routes.
Route::any('/{path}', ClassController::class)->where('path', 'missions|avatars|me/avatar|me/progress/reset|players/[0-9]+/profile|teach(/.*)?')->middleware('auth:sanctum');

// Auth is optional here: scenarios with require_login=false can be played without a token.
Route::get('/scenarios/{key}/play', [PlayController::class, 'show'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');

// Plans, Stripe billing and AI generator credits (App\Qbl\Billing\BillingApi lists the routes). The plans
// on sale can be read signed out; the rest needs a token. Stripe's webhook is checked by its signature.
Route::post('/billing/webhook', [BillingController::class, 'webhook']);
Route::post('/billing/quote', [BillingController::class, 'quote'])->middleware('throttle:5,1');
Route::any('/billing/{path?}', BillingController::class)->where('path', 'checkout|change|portal|promotion|credits')->middleware('throttle:30,1');

// The AI mission generator from the editor, paid in credits; the work runs on the queue worker.
// The editor asks how a generation is going every few seconds, from any page: a looser limit than most.
Route::any('/editor/generations/{path?}', GenerationController::class)->where('path', '[0-9a-z/]*')->middleware(['auth:sanctum', 'throttle:90,1']);

// The district admin panel (App\Qbl\District\DistrictApi lists the routes), and signing in through a
// district's own system: SAML, Clever (Google Workspace domains go through GoogleAuthController).
Route::any('/district/{path?}', DistrictController::class)->where('path', '.*')->middleware(['auth:sanctum', 'throttle:120,1']);
Route::get('/sso/{org}/saml/metadata', [SsoController::class, 'samlMetadata'])->whereNumber('org');
Route::get('/sso/{org}/saml/login', [SsoController::class, 'samlLogin'])->whereNumber('org')->middleware('throttle:30,1');
Route::post('/sso/{org}/saml/acs', [SsoController::class, 'samlAcs'])->whereNumber('org')->middleware('throttle:30,1');
Route::get('/sso/clever/login', [SsoController::class, 'cleverLogin'])->middleware('throttle:30,1');
Route::get('/sso/clever/callback', [SsoController::class, 'cleverCallback'])->middleware('throttle:30,1');

// The asset library: ready-made characters, vehicles, items, pictures and sounds to add to scenarios
// (App\Qbl\Library\LibraryApi lists the routes). Teachers read and add; administrators change it.
Route::any('/editor/library/{path?}', LibraryController::class)->where('path', '.*')->middleware(['auth:sanctum', 'throttle:120,1']);

// An exported scenario ZIP, by a signed link from POST /editor/scenarios/{id}/export-link: the browser
// downloads it itself (streamed to disk), so it carries no token. Before the /editor catch-all.
Route::get('/editor-export/{ticket}', [EditorController::class, 'exportByLink'])->where('ticket', '[A-Za-z0-9_.-]+')->middleware('throttle:30,1');
// The editor. One controller hands every request to App\Qbl\EditorApi, which lists the routes.
Route::any('/editor/{path?}', EditorController::class)->where('path', '.*')->middleware('auth:sanctum');

// The public API for schools, districts and businesses, versioned: /api/v1/… (and /api/v2/… beside it, when there is one).
// It has its own access tokens (OAuth 2 client credentials), not Sanctum's. Contract: docs/src/content/docs/api-v1/ (index.mdx and its sibling pages)
Route::any('/v1/{path?}', ApiV1Controller::class)->where('path', '.*')->middleware('throttle:qbl-api-v1');

Route::prefix('internal')->middleware(ServiceKey::class)->group(function () {
    Route::post('/auth/verify', [InternalController::class, 'verify']);
    Route::get('/scenarios/{key}', [InternalController::class, 'scenario'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');
    Route::get('/scenarios/{scenario}/access/{user}', [InternalController::class, 'access'])->whereNumber(['scenario', 'user']);
    Route::get('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'loadSession'])->whereNumber(['scenario', 'user']);
    Route::put('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'saveSession'])->whereNumber(['scenario', 'user']);
    Route::post('/scenarios/{scenario}/awards', [InternalController::class, 'award'])->whereNumber('scenario');
    Route::get('/users/{user}/look', [InternalController::class, 'look'])->whereNumber('user');
    // A teacher launched an assignment from the game: the students there are sent into it.
    Route::post('/assignments/{assignment}/launch', [InternalController::class, 'launch'])->whereNumber('assignment');
    // What players did and said, written in batches by the game server.
    Route::post('/scenarios/{scenario}/activity', [InternalController::class, 'logActivity'])->whereNumber('scenario');
    Route::post('/scenarios/{scenario}/messages', [InternalController::class, 'logMessages'])->whereNumber('scenario');
    Route::get('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'loadInstance'])->whereNumber('scenario');
    Route::put('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'saveInstance'])->whereNumber('scenario');
    // The asset library, for the platform's own services (the generator, the game server, scripts).
    Route::get('/library', [InternalController::class, 'library']);
    Route::get('/library/{asset}', [InternalController::class, 'libraryAsset'])->where('asset', '[a-z0-9-]+');
    Route::post('/scenarios/{scenario}/library/{asset}', [InternalController::class, 'addLibraryAsset'])->whereNumber('scenario')->where('asset', '[a-z0-9-]+');
});
