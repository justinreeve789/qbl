<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Players' notebooks (App\Qbl\Notebooks\NotebookStore): their own notes on a scenario, one per
 * player per instance, kept whole as JSON (packages/shared/src/notebook.ts NotebookPage[]). They
 * belong with the player's save: resetting their game, or deleting the student, deletes them.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('notebooks')) {
            Schema::create('notebooks', function (Blueprint $table) {
                $table->id();
                $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('group_key', 64)->default('public');
                $table->mediumText('pages');
                $table->timestamps();

                $table->unique(['scenario_id', 'user_id', 'group_key']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('notebooks');
    }
};
