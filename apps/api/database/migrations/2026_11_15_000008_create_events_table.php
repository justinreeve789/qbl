<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * start_events, end_events, hotspots and indirect_events are all events (docs/docs/event.md); `kind` says which.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('events')) {
            return;
        }

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
    }

    public function down(): void
    {
        Schema::dropIfExists('events');
    }
};
