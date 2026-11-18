<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One row per run of the AI scenario generator: what was asked, what was planned, every picture it
 * drew and how it scored, and the scenario it made. A failed or interrupted run can be resumed.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('scenario_generations')) {
            return;
        }

        Schema::create('scenario_generations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('scenario_id')->nullable()->constrained('scenarios')->nullOnDelete();
            $table->text('prompt');
            // grade, subject, framework, scene count, players, art style, image driver...
            $table->json('options')->nullable();
            // queued, aligning, designing, drawing, building, done, failed
            $table->string('status', 16)->default('queued');
            $table->json('alignment')->nullable();
            $table->longText('blueprint')->nullable();
            // Every picture: its key, prompt, provider, attempts, judge scores, file.
            $table->longText('manifest')->nullable();
            $table->text('error')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('scenario_generations');
    }
};
