<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The QBL tables. Columns follow the attribute tables in docs/docs; attributes
 * added for the walk-around runtime (docs/docs/extensions.md) and the
 * type-specific attributes of actions live in JSON columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 16)->default('student'); // student | teacher | admin | guest
            $table->unsignedBigInteger('avatar_media_id')->nullable();
        });

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

        Schema::create('media', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedBigInteger('folder_id')->nullable();
            $table->string('type', 16);             // audio | image | video
            $table->string('filename')->nullable();
            $table->string('filepath')->nullable();
            $table->string('url', 2048)->nullable();
            $table->decimal('scale_x', 10, 5)->default(1);
            $table->decimal('scale_y', 10, 5)->default(1);
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->unsignedInteger('priority')->default(100);
            $table->json('params')->nullable();
            $table->timestamps();
        });

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

        Schema::create('items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->boolean('unique')->default(false);
            $table->boolean('physical')->default(false);
            $table->boolean('blocking')->default(false);
            $table->boolean('wearable')->default(false);
            $table->boolean('vehicle')->default(false);
            $table->foreignId('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->json('settings')->nullable();   // scale, attach offsets, art_faces, speed_multiplier...
            $table->timestamps();
        });

        Schema::create('characters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->foreignId('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->json('settings')->nullable();
            $table->timestamps();
        });

        Schema::create('scenes', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->string('shortname', 64)->nullable();
            $table->unsignedInteger('sequence')->default(0);
            $table->unsignedBigInteger('group_id')->nullable();
            $table->string('subtitle')->nullable();
            $table->text('description')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('locked_by')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('is_intro_scene')->default(false);
            $table->decimal('zoom', 6, 3)->default(1);
            $table->boolean('show_avatars')->default(true);
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            $table->json('background_media')->nullable();
            $table->json('foreground_media')->nullable();
            $table->json('layout')->nullable();     // walkable_areas, blocked_areas, spawn_points, scale_areas, items, characters
            $table->json('params')->nullable();
            $table->timestamps();
        });

        // start_events, end_events, hotspots and indirect_events are all events; `kind` says which.
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scene_id')->constrained()->cascadeOnDelete();
            $table->string('kind', 16);             // start | end | hotspot | indirect
            $table->string('shortname', 64)->nullable();
            $table->unsignedInteger('sequence')->default(0);
            $table->boolean('overridable')->default(false);
            $table->boolean('block_hotspots')->default(false);
            // Hotspots only. A null coordinate means "the entire axis".
            $table->decimal('position_x', 12, 3)->nullable();
            $table->decimal('position_y', 12, 3)->nullable();
            $table->decimal('radius', 12, 3)->nullable();
            $table->boolean('activate_by_trigger')->default(false);
            $table->boolean('once')->default(false);
            $table->timestamps();
        });

        Schema::create('actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->string('type', 32);
            $table->unsignedInteger('sequence')->default(0);
            $table->boolean('blocking')->default(true);
            $table->foreignId('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->json('params')->nullable();     // the attributes specific to this action type
            $table->timestamps();
        });

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

        Schema::create('labels', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->string('type', 16);             // text | image | spritemap
            $table->decimal('position_x', 12, 3);
            $table->decimal('position_y', 12, 3);
            $table->decimal('scale_x', 10, 5)->default(1);
            $table->decimal('scale_y', 10, 5)->default(1);
            $table->string('text')->nullable();
            $table->foreignId('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->json('params')->nullable();     // spritemap attributes
            $table->timestamps();
        });

        // One row per player per scenario: the save game.
        Schema::create('scenario_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->json('data');
            $table->timestamps();
            $table->unique(['scenario_id', 'user_id']);
        });

        // One row per group per scenario: shared variables and unique item positions.
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
        foreach (['scenario_instances', 'scenario_sessions', 'labels', 'conditions', 'actions', 'events', 'scenes', 'characters', 'items', 'variables', 'media', 'scenarios'] as $table) {
            Schema::dropIfExists($table);
        }
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'avatar_media_id']);
        });
    }
};
