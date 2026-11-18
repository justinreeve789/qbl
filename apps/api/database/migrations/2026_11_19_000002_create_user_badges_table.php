<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Badges players earned through award actions that carry one. A badge is earned once
 * (`badge_key` is "s{scenario}:a{action}") and is shown on the player's profile.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('user_badges')) {
            return;
        }

        Schema::create('user_badges', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('scenario_id')->nullable()->index();
            $table->string('badge_key', 64);
            $table->string('name', 80);
            $table->string('description')->nullable();
            $table->string('image_url', 500)->nullable();
            // The mission's title when the badge was earned, so the profile still reads well if the mission is renamed or removed.
            $table->string('scenario_title')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->unique(['user_id', 'badge_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_badges');
    }
};
