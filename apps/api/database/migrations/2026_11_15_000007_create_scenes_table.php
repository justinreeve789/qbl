<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The scenes of a scenario (docs/docs/scene.md). `layout` holds where things are; `params` the rest.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenes')) {
            return;
        }

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
    }

    public function down(): void
    {
        Schema::dropIfExists('scenes');
    }
};
