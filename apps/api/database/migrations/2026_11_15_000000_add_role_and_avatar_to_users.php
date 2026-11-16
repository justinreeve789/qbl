<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What QBL adds to Laravel's users: a role, and the avatar the player last chose.
 *
 * The QBL tables used to be created by two large migrations. Each table now has its own, and
 * every one of them checks before creating, so a database made by the old files is left as it
 * is. The old files' entries in the `migrations` table are removed here: the files are gone.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('migrations')
            ->whereIn('migration', ['2026_11_15_000000_create_qbl_tables', '2026_11_16_000002_add_progress_and_shop'])
            ->delete();

        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'role')) {
                $table->string('role', 16)->default('student'); // student | teacher | admin | guest
            }
            if (! Schema::hasColumn('users', 'avatar_media_id')) {
                $table->unsignedBigInteger('avatar_media_id')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['role', 'avatar_media_id']);
        });
    }
};
