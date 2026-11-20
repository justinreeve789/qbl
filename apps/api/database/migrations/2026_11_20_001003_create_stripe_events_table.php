<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Stripe events already handled, so one delivered twice is handled once. */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('stripe_events')) {
            return;
        }

        Schema::create('stripe_events', function (Blueprint $table) {
            $table->id();
            $table->string('event_id', 80)->unique();
            $table->string('type', 80);
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stripe_events');
    }
};
