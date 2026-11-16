<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per player per scenario: the save game (docs/docs/session.md).
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenario_sessions')) {
            return;
        }

        Schema::create('scenario_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->json('data');
            $table->timestamps();
            $table->unique(['scenario_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scenario_sessions');
    }
};
