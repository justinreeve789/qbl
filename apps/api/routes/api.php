<?php

use App\Http\Controllers\ApiV1Controller;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ClassController;
use App\Http\Controllers\EditorController;
use App\Http\Controllers\GoogleAuthController;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\PlayController;
use App\Http\Controllers\ProgressController;
use App\Http\Middleware\ServiceKey;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/auth/register', [AuthController::class, 'register'])->middleware('throttle:5,1');
Route::post('/auth/guest',[AuthController::class, 'guest'])->middleware('throttle:10,1');
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
Route::any('/{path}', ClassController::class)->where('path', 'missions|avatars|me/avatar|players/[0-9]+/profile|teach(/.*)?')->middleware('auth:sanctum');

// Auth is optional here: scenarios with require_login=false can be played without a token.
Route::get('/scenarios/{key}/play', [PlayController::class, 'show'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');

// The editor. One controller hands every request to App\Qbl\EditorApi, which lists the routes.
Route::any('/editor/{path?}', EditorController::class)->where('path', '.*')->middleware('auth:sanctum');

// The public API for schools, districts and businesses, versioned: /api/v1/… (and /api/v2/… beside it, when there is one).
// It has its own access tokens (OAuth 2 client credentials), not Sanctum's. Contract: docs/src/content/docs/developers/api-v1.md
Route::any('/v1/{path?}', ApiV1Controller::class)->where('path', '.*')->middleware('throttle:qbl-api-v1');

Route::prefix('internal')->middleware(ServiceKey::class)->group(function () {
    Route::post('/auth/verify', [InternalController::class, 'verify']);
    Route::get('/scenarios/{key}', [InternalController::class, 'scenario'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');
    Route::get('/scenarios/{scenario}/access/{user}', [InternalController::class, 'access'])->whereNumber(['scenario', 'user']);
    Route::get('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'loadSession'])->whereNumber(['scenario', 'user']);
    Route::put('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'saveSession'])->whereNumber(['scenario', 'user']);
    Route::post('/scenarios/{scenario}/awards', [InternalController::class, 'award'])->whereNumber('scenario');
    Route::get('/users/{user}/look', [InternalController::class, 'look'])->whereNumber('user');
    // What players did and said, written in batches by the game server.
    Route::post('/scenarios/{scenario}/activity', [InternalController::class, 'logActivity'])->whereNumber('scenario');
    Route::post('/scenarios/{scenario}/messages', [InternalController::class, 'logMessages'])->whereNumber('scenario');
    Route::get('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'loadInstance'])->whereNumber('scenario');
    Route::put('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'saveInstance'])->whereNumber('scenario');
});
