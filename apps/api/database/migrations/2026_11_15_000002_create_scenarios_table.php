<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A scenario: a whole mission. Columns follow docs/docs/scenario.md; what the walk-around runtime added is in `settings`.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenarios')) {
            return;
        }

        Schema::create('scenarios', function (Blueprint $table) {
            $table->id();
            $table->string('shortname', 64)->unique();
            $table->string('title');
            $table->string('subtitle')->nullable();
            $table->text('description')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('start_scene_id')->nullable();
            $table->boolean('enable_save_session')->default(true);
            $table->boolean('require_login')->default(true);
            $table->boolean('allow_groups')->default(false);
            $table->unsignedInteger('max_players')->nullable();
            $table->string('default_language', 16)->default('en-us');
            $table->unsignedBigInteger('intro_media_portrait_id')->nullable();
            $table->unsignedBigInteger('intro_media_landscape_id')->nullable();
            $table->json('settings')->nullable();   // spec_version, chat_mode, move_speed, asset_base_url, avatar_media_ids
            // The compiled JSON the game plays, generated from the tables below on publish.
            $table->json('document')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scenarios');
    }
};
