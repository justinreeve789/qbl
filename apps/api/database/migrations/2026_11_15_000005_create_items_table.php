<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Things players can pick up, wear or ride (docs/docs/item.md).
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('items')) {
            return;
        }

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
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
