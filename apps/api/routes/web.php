<?php

use Illuminate\Support\Facades\Route;

// QBL's backend is an API. The game and the editor are separate front ends, served by Apache;
// only /api reaches Laravel. This route exists so the application answers at its root.
Route::get('/', fn () => response()->json(['name' => 'QuestLab']));
