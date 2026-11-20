<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** An organization's own avatars, imported through the API. Null: one of the platform's. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('avatars', function (Blueprint $table) {
            if (! Schema::hasColumn('avatars', 'organization_id')) {
                $table->unsignedBigInteger('organization_id')->nullable()->index();
            }
            if (! Schema::hasColumn('avatars', 'external_id')) {
                $table->string('external_id', 64)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('avatars', function (Blueprint $table) {
            $table->dropIndex(['organization_id']);
            $table->dropColumn(['organization_id', 'external_id']);
        });
    }
};
