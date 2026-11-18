<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Which standards a scenario teaches or assesses, and how: what in the mission does it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenario_standards')) {
            return;
        }

        Schema::create('scenario_standards', function (Blueprint $table) {
            $table->id();
            $table->foreignId('scenario_id')->constrained('scenarios')->cascadeOnDelete();
            $table->foreignId('curriculum_standard_id')->constrained('curriculum_standards')->cascadeOnDelete();
            // primary: the mission is built around it. supporting: practised along the way.
            $table->string('alignment', 16)->default('primary');
            $table->text('rationale')->nullable();
            // The learning objectives, questions and interactions that address it.
            $table->json('evidence')->nullable();
            $table->timestamps();
            $table->unique(['scenario_id', 'curriculum_standard_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scenario_standards');
    }
};
