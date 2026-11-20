<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Accounts made through the public API belong to an organization (and maybe one of its schools)
 * and are known to it by its own opaque id. They carry no name, email or birth date: their
 * `name` is a pseudonym, and their `email` a placeholder that cannot receive mail.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'organization_id')) {
                $table->unsignedBigInteger('organization_id')->nullable()->index();
            }
            if (! Schema::hasColumn('users', 'school_id')) {
                $table->unsignedBigInteger('school_id')->nullable()->index();
            }
            if (! Schema::hasColumn('users', 'external_id')) {
                $table->string('external_id', 64)->nullable();
            }
            if (! Schema::hasColumn('users', 'grade_level')) {
                $table->string('grade_level', 8)->nullable();
            }
            if (! Schema::hasColumn('users', 'deactivated_at')) {
                $table->timestamp('deactivated_at')->nullable();
            }
        });
        if (! collect(Schema::getIndexes('users'))->contains(fn ($i) => $i['name'] === 'users_organization_id_external_id_unique')) {
            Schema::table('users', fn (Blueprint $table) => $table->unique(['organization_id', 'external_id']));
        }
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['organization_id', 'external_id']);
            $table->dropIndex(['organization_id']);
            $table->dropIndex(['school_id']);
            $table->dropColumn(['organization_id', 'school_id', 'external_id', 'grade_level', 'deactivated_at']);
        });
    }
};
