<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the marketplace sells. A row with no scenario is sold everywhere; a row with one is sold only there.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('shop_items')) {
            return;
        }

        Schema::create('shop_items', function (Blueprint $table) {
            $table->id();
            // Null: sold everywhere (the platform's catalogue). Set: sold only in that scenario.
            $table->unsignedBigInteger('scenario_id')->nullable()->index();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('kind', 16);                 // wearable, pet, animation, ability
            $table->string('slot', 16)->nullable();     // wearables: head, body, back, hand
            $table->integer('price')->default(0);
            $table->unsignedBigInteger('media_id')->nullable();
            $table->string('image_url')->nullable();
            $table->json('settings')->nullable();       // scale, offsets, animation, ability
            $table->boolean('active')->default(true);
            $table->integer('sequence')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_items');
    }
};
