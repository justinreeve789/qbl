<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who sees what an event shows: `player` (only the player who set it off, the default) or
 * `scene` (every player in the scene).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('events', 'audience')) {
            Schema::table('events', function (Blueprint $table) {
                $table->string('audience', 16)->default('player');
            });
        }
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn('audience');
        });
    }
};
