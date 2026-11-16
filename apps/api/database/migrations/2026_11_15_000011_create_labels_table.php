<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The text and pictures that mark a hotspot (docs/docs/label.md).
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('labels')) {
            return;
        }

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
    }

    public function down(): void
    {
        Schema::dropIfExists('labels');
    }
};
