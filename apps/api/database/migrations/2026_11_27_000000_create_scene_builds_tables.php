<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Student building (App\Qbl\Builds\BuildStore): what students add on top of scenes that allow it,
 * one build per student per scene per instance, and the pictures they upload for it. Both belong
 * with the student's save: resetting their game, or deleting the student, deletes them.
 *
 * scene_builds.status   pending (waits for the teacher) | approved | hidden
 * scene_builds.pieces   JSON list of what was added (packages/shared/src/builds.ts BuildPiece)
 * build_uploads.bytes   the re-encoded picture itself, served by its unguessable file_key
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('scene_builds')) {
            Schema::create('scene_builds', function (Blueprint $table) {
                $table->id();
                $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
                $table->unsignedBigInteger('scene_id');
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('group_key', 64)->default('public');
                $table->string('status', 12)->default('pending');
                $table->mediumText('pieces');
                $table->unsignedBigInteger('reviewed_by')->nullable();
                $table->timestamp('reviewed_at')->nullable();
                $table->timestamps();

                $table->unique(['scenario_id', 'scene_id', 'user_id', 'group_key']);
                $table->index(['scenario_id', 'group_key', 'status']);
                $table->index(['status', 'updated_at']);
            });
        }
        if (! Schema::hasTable('build_uploads')) {
            Schema::create('build_uploads', function (Blueprint $table) {
                $table->id();
                $table->foreignId('scenario_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('group_key', 64)->default('public');
                $table->char('file_key', 24)->unique();
                $table->string('mime', 32);
                $table->unsignedInteger('width');
                $table->unsignedInteger('height');
                $table->binary('bytes');
                $table->timestamps();

                $table->index(['scenario_id', 'user_id', 'group_key']);
            });
            // A picture is up to a few MB: BLOB holds only 64 KB in MariaDB.
            if (DB::getDriverName() === 'mysql' || DB::getDriverName() === 'mariadb') {
                DB::statement('ALTER TABLE build_uploads MODIFY bytes MEDIUMBLOB NOT NULL');
            }
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('build_uploads');
        Schema::dropIfExists('scene_builds');
    }
};
