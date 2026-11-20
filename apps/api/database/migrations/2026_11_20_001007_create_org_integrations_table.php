<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * How an organization's accounts and enrollments come to QBL: SAML sign-in, Clever, or Google
 * (Workspace sign-in and Classroom rosters). One row per kind. `config` is what the panel shows;
 * `secrets` (tokens, a service account key) are encrypted with the app key and never sent back.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('org_integrations')) {
            return;
        }

        Schema::create('org_integrations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('kind', 16); // saml | clever | google
            $table->boolean('enabled')->default(false);
            $table->json('config')->nullable();
            $table->text('secrets')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamps();
            $table->unique(['organization_id', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('org_integrations');
    }
};
