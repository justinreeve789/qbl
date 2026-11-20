<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A scenario's code can now be changed in the editor to one of 4 to 32 characters (lowercase
 * letters, digits and hyphens), so the column is no longer a fixed 16. Existing codes are kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scenarios', function (Blueprint $table) {
            $table->string('code', 32)->nullable()->change();
        });
    }

    public function down(): void
    {
        // Codes longer than 16 would not fit: they are left as they are rather than cut short.
    }
};
