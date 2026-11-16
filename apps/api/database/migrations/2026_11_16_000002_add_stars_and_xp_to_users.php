<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stars (currency) and XP (experience) on the account, so they are the same in every scenario.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Signed on purpose: an award can subtract, and the store stops the result at zero.
            if (! Schema::hasColumn('users', 'stars')) {
                $table->integer('stars')->default(0);
            }
            if (! Schema::hasColumn('users', 'xp')) {
                $table->integer('xp')->default(0);
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['stars', 'xp']);
        });
    }
};
