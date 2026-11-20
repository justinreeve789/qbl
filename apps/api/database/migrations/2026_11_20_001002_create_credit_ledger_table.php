<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every change to an account's credits: the monthly grant, credits past the carry-over limit
 * expiring, a generation spending them, a failed generation's refund, an administrator's adjustment.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credit_ledger')) {
            return;
        }

        Schema::create('credit_ledger', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->integer('delta');
            $table->integer('balance_after');
            // grant | expire | spend | refund | adjust
            $table->string('reason', 16);
            // What it was for: a period key for grants, "generation:12" for spending and refunds.
            $table->string('ref', 64)->nullable();
            $table->string('note', 255)->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['user_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_ledger');
    }
};
