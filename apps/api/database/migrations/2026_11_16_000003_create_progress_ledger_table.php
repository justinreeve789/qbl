<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every change to a player's stars and XP: an award, a purchase. The unique key is what makes an award once-only.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('progress_ledger')) {
            return;
        }

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

    public function down(): void
    {
        Schema::dropIfExists('progress_ledger');
    }
};
