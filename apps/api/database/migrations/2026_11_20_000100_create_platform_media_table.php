<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The platform's own pictures: what the avatars are drawn from. Like a scenario's media, but
 * belonging to no scenario, so the same sprite sheet can serve any number of avatars. In a
 * scenario document a row is media App\Qbl\Avatars::MEDIA_BASE + its id.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('platform_media')) {
            return;
        }

        Schema::create('platform_media', function (Blueprint $table) {
            $table->id();
            $table->string('type', 16)->default('image');
            $table->string('url', 2048);
            $table->string('filename')->nullable();
            $table->unsignedInteger('width')->nullable();
            $table->unsignedInteger('height')->nullable();
            // sheet {columns, rows, count}, apng {frames, duration, plays}
            $table->json('params')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_media');
    }
};
