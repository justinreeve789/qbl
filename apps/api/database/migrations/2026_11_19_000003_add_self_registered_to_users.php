<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Accounts people make for themselves on the sign-in screen (POST /api/auth/register), with a
 * password instead of Google. Nobody checks that such an address belongs to whoever typed it,
 * so the account says when it was made that way: a later Google sign-in with the same address
 * proves who owns it, and the password typed at registration is then dropped.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('users', 'self_registered_at')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            $table->timestamp('self_registered_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('self_registered_at');
        });
    }
};
