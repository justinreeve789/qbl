<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stars (currency) and XP (experience) on the account, a ledger of every change to them,
 * the marketplace's items, and what each player owns and wears.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Signed on purpose: an award can subtract, and the store clamps the result at zero.
            if (! Schema::hasColumn('users', 'stars')) {
                $table->integer('stars')->default(0);
            }
            if (! Schema::hasColumn('users', 'xp')) {
                $table->integer('xp')->default(0);
            }
        });

        if (! Schema::hasTable('progress_ledger')) {
            Schema::create('progress_ledger', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->unsignedBigInteger('scenario_id')->nullable()->index();
                // "s{scenario}:a{action}" for an award that is granted once; null for repeatable awards and purchases.
                $table->string('grant_key', 64)->nullable();
                $table->integer('stars')->default(0);
                $table->integer('xp')->default(0);
                $table->string('note')->nullable();
                $table->timestamp('created_at')->nullable();
                $table->unique(['user_id', 'grant_key']);
            });
        }

        if (! Schema::hasTable('shop_items')) {
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

        if (! Schema::hasTable('user_items')) {
            Schema::create('user_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->unsignedBigInteger('shop_item_id')->index();
                $table->boolean('equipped')->default(false);
                $table->timestamp('created_at')->nullable();
                $table->unique(['user_id', 'shop_item_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_items');
        Schema::dropIfExists('shop_items');
        Schema::dropIfExists('progress_ledger');
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['stars', 'xp']);
        });
    }
};
