<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * When the teacher launched an assignment (or showed it to their students). A mission whose
 * settings say it waits for its teacher (`settings.wait_for_launch`) is not on the students'
 * missions page, and cannot be joined by them, until then. Null: not launched yet.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('assignments', function (Blueprint $table) {
            if (! Schema::hasColumn('assignments', 'launched_at')) {
                $table->timestamp('launched_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('assignments', function (Blueprint $table) {
            $table->dropColumn('launched_at');
        });
    }
};
