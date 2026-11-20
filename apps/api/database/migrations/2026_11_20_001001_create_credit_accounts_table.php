<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Each account's AI generator credits. `period_key` names the billing period the last monthly
 * refill was for, so a refill happens once per period however often the balance is read.
 * Every change is also written to credit_ledger. See App\Qbl\Billing\Credits.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('credit_accounts')) {
            return;
        }

        Schema::create('credit_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->integer('balance')->default(0);
            $table->string('period_key', 64)->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_accounts');
    }
};
