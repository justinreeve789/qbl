<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Each roster sync (Clever, Google Classroom) and roster file upload: when, how it went, what changed. */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('integration_runs')) {
            return;
        }

        Schema::create('integration_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('kind', 16); // clever | google | upload
            $table->string('status', 16)->default('queued'); // queued | running | done | failed
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('summary')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();
            $table->index(['organization_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('integration_runs');
    }
};
