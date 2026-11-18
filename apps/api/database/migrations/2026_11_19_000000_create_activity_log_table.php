<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What players did, one line at a time: joined, entered a scene, used a hotspot, chose an answer,
 * completed an objective, learned a word, earned an award. Written by the game server; teachers'
 * reports are read from it. `group_key` names the instance (a team's, an assignment's, the public one).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('activity_log')) {
            return;
        }

        Schema::create('activity_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('scenario_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 64)->default('public');
            $table->unsignedBigInteger('scene_id')->nullable();
            $table->string('type', 16);
            // The event, action, objective or glossary entry concerned, and a few words about it.
            $table->string('ref', 64)->nullable();
            $table->string('label', 200)->nullable();
            $table->double('value')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['scenario_id', 'group_key', 'user_id']);
            $table->index(['scenario_id', 'type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_log');
    }
};
