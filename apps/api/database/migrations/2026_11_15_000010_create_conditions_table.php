<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Conditions on an event, an action, an item or a character (docs/docs/condition.md). Exactly one owner is set.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('conditions')) {
            return;
        }

        Schema::create('conditions', function (Blueprint $table) {
            $table->id();
            // Exactly one owner is set.
            $table->foreignId('event_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('action_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('item_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('character_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('type', 16)->default('variable');
            $table->string('variable', 64);
            $table->string('operator', 4);
            $table->json('operand');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conditions');
    }
};
