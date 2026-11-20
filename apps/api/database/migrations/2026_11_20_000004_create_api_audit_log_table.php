<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every request made to /api/v1: which client, what it asked for, and what it got. FERPA asks a
 * school to keep a record of who was given access to education records; this is that record.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('api_audit_log')) {
            return;
        }

        Schema::create('api_audit_log', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('organization_id')->nullable()->index();
            $table->unsignedBigInteger('api_client_id')->nullable();
            $table->string('method', 8);
            $table->string('path', 255);
            $table->unsignedSmallInteger('status');
            // The students whose records the request read or changed, when it was about particular ones.
            $table->json('student_ids')->nullable();
            $table->timestamp('created_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('api_audit_log');
    }
};
