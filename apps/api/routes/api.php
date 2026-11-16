<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\EditorController;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\PlayController;
use App\Http\Middleware\ServiceKey;
use Illuminate\Support\Facades\Route;

// Contract: docs/docs/api.md

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/auth/guest', [AuthController::class, 'guest'])->middleware('throttle:10,1');
Route::get('/me', [AuthController::class, 'me'])->middleware('auth:sanctum');

// Auth is optional here: scenarios with require_login=false can be played without a token.
Route::get('/scenarios/{key}/play', [PlayController::class, 'show'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');

// The editor. One controller hands every request to App\Qbl\EditorApi, which lists the routes.
Route::any('/editor/{path?}', EditorController::class)->where('path', '.*')->middleware('auth:sanctum');

Route::prefix('internal')->middleware(ServiceKey::class)->group(function () {
    Route::post('/auth/verify', [InternalController::class, 'verify']);
    Route::get('/scenarios/{key}', [InternalController::class, 'scenario'])->where('key', '[A-Za-z][A-Za-z0-9_-]*');
    Route::get('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'loadSession'])->whereNumber(['scenario', 'user']);
    Route::put('/scenarios/{scenario}/sessions/{user}', [InternalController::class, 'saveSession'])->whereNumber(['scenario', 'user']);
    Route::get('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'loadInstance'])->whereNumber('scenario');
    Route::put('/scenarios/{scenario}/instances/{group}', [InternalController::class, 'saveInstance'])->whereNumber('scenario');
});
