<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One-time sign-in links an API client asks for, so a student or teacher it rostered can open
 * QBL from the school's own portal without a password. Kept as hashes; each works once, briefly.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('launch_tokens')) {
            return;
        }

        Schema::create('launch_tokens', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('api_client_id')->nullable()->constrained('api_clients')->nullOnDelete();
            $table->string('token_hash', 64)->unique();
            // A path on this site to open once signed in: /missions, /{code}?group=a12, /editor/#/.
            $table->string('return_path', 255);
            $table->timestamp('expires_at');
            $table->timestamp('used_at')->nullable();
            $table->timestamp('created_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('launch_tokens');
    }
};
