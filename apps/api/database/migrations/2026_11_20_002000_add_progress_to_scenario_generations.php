<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How far a generation has got, for the editor's progress bar (stage, percent, what it is drawing,
 * when each stage began), and when its teacher asked to stop it. A cancelled run gives its credits back.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scenario_generations', function (Blueprint $table) {
            if (! Schema::hasColumn('scenario_generations', 'progress')) {
                $table->text('progress')->nullable();
            }
            if (! Schema::hasColumn('scenario_generations', 'cancelled_at')) {
                $table->timestamp('cancelled_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('scenario_generations', function (Blueprint $table) {
            $table->dropColumn(['progress', 'cancelled_at']);
        });
    }
};
