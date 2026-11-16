<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per group per scenario: shared variables and where unique items are.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenario_instances')) {
            return;
        }

        Schema::create('scenario_instances', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 64);
            $table->json('data');
            $table->timestamps();
            $table->unique(['scenario_id', 'group_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scenario_instances');
    }
};
