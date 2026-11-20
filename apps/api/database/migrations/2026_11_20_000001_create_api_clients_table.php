<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The programs an organization connects to /api/v1 with (its SIS, LMS or data warehouse).
 * Only a hash of the secret is kept; the secret is shown once, when the client is made.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('api_clients')) {
            return;
        }

        Schema::create('api_clients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('client_id', 64)->unique();
            $table->string('secret_hash', 255);
            $table->json('scopes');
            $table->timestamp('last_used_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_clients');
    }
};
