<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Contact us for a quote", from schools and districts. These are a staff member's work contact
 * details, given to be contacted; no student information is asked for.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('quote_requests')) {
            return;
        }

        Schema::create('quote_requests', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->string('email', 255);
            $table->string('organization', 160);
            $table->string('role', 80)->nullable();
            $table->string('phone', 40)->nullable();
            $table->unsignedInteger('students')->nullable();
            $table->text('message')->nullable();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('handled_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('quote_requests');
    }
};
