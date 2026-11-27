<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The narrator's recordings of what students' hotspots say (App\Qbl\Builds\BuildVoices): one per
 * hotspot, made when the build is kept. They belong with the build: deleting it, resetting the
 * student's game or deleting the student deletes them.
 *
 * build_voices.speech   JSON MediaSpeech: what it says, the hotspot's words it was recorded from, voice, service, word timings
 * build_voices.bytes    the recording itself, served by its unguessable file_key (as uploads are)
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('build_voices')) {
            return;
        }
        Schema::create('build_voices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('build_id')->constrained('scene_builds')->cascadeOnDelete();
            $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('group_key', 64)->default('public');
            $table->string('piece_id', 16);
            $table->char('file_key', 24)->unique();
            $table->string('mime', 32);
            $table->text('speech');
            $table->binary('bytes');
            $table->timestamps();

            $table->index('build_id');
            $table->index(['scenario_id', 'user_id', 'group_key']);
        });
        // A line is up to a few hundred KB: BLOB holds only 64 KB in MariaDB.
        if (DB::getDriverName() === 'mysql' || DB::getDriverName() === 'mariadb') {
            DB::statement('ALTER TABLE build_voices MODIFY bytes MEDIUMBLOB NOT NULL');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('build_voices');
    }
};
