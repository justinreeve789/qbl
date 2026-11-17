<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A save belongs to the instance it was made in, not to the scenario as a whole: a student in a
 * team has that team's game, and their own casual game in the public instance is another.
 * Saves made before this are the public instance's.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('scenario_sessions', 'group_key')) {
            return;
        }
        Schema::table('scenario_sessions', function (Blueprint $table) {
            $table->string('group_key', 64)->default('public');
            // The new index first: the old one is what the foreign key on scenario_id has been using.
            $table->unique(['scenario_id', 'user_id', 'group_key']);
            $table->dropUnique(['scenario_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::table('scenario_sessions', function (Blueprint $table) {
            $table->unique(['scenario_id', 'user_id']);
            $table->dropUnique(['scenario_id', 'user_id', 'group_key']);
            $table->dropColumn('group_key');
        });
    }
};
