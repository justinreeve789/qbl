<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The schools, districts and businesses that use QBL through the public API (/api/v1).
 * A root organization (a district, say) may have schools under it, one level deep.
 * `settings`: data_retention_days, and anything else the organization chooses.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('organizations')) {
            return;
        }

        Schema::create('organizations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_id')->nullable()->constrained('organizations')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('kind', 16)->default('school'); // district | school | business | other
            // The organization's own id for it (an NCES id, a school code), for its own lookups.
            $table->string('external_id', 64)->nullable();
            $table->json('settings')->nullable();
            $table->timestamps();
            $table->unique(['parent_id', 'external_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organizations');
    }
};
