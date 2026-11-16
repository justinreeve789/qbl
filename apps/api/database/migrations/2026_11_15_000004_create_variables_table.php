<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a scenario remembers (docs/docs/variable.md). `scope` says whether each player has their own value or everyone playing together shares one.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('variables')) {
            return;
        }

        Schema::create('variables', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->string('variable_name', 64);
            $table->json('default_value');
            $table->string('scope', 16)->default('player');   // player | room
            $table->boolean('persist')->default(true);
            $table->timestamps();
            $table->unique(['scenario_id', 'variable_name']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('variables');
    }
};
