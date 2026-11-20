<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A teacher's paid plan, as Stripe keeps it: one row per account, kept after the plan ends so
 * the customer (and whether the free trial was used) is remembered. The webhook keeps it in step.
 * See App\Qbl\Billing\Subscriptions.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('subscriptions')) {
            return;
        }

        Schema::create('subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();
            $table->string('stripe_customer_id', 64)->nullable()->unique();
            $table->string('stripe_subscription_id', 64)->nullable()->index();
            // teacher | teacher_plus (config/qbl_billing.php), or null before the first checkout.
            $table->string('plan', 32)->nullable();
            // Stripe's: trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused.
            $table->string('status', 24)->nullable();
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_start')->nullable();
            $table->timestamp('current_period_end')->nullable();
            $table->boolean('cancel_at_period_end')->default(false);
            // Set when a trial first starts: one free trial per account.
            $table->timestamp('trial_used_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscriptions');
    }
};
