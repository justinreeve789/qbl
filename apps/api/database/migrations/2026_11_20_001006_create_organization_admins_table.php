<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Who runs an organization's account: usually the district's technical staff. They use the
 * district admin panel (/editor/#/district) for that organization only. Any account can be one;
 * being one does not change the account's role.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('organization_admins')) {
            return;
        }

        Schema::create('organization_admins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamps();
            $table->unique(['organization_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_admins');
    }
};
