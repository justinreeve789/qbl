<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The avatars players choose from. One set for the whole platform, so a player keeps theirs in every scenario.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('avatars')) {
            return;
        }

        Schema::create('avatars', function (Blueprint $table) {
            $table->id();
            $table->string('name', 64);
            $table->string('image_url');
            $table->string('portrait_url')->nullable();
            // scale, and for a sprite sheet: sheet {columns, rows} and animations [{name, frames, duration, repeat}]
            $table->json('settings')->nullable();
            $table->boolean('active')->default(true);
            $table->unsignedInteger('sequence')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('avatars');
    }
};
