<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Curriculum standards that missions are aligned to (CCSS, NGSS, a state's own), as imported by
 * `php artisan qbl:standards`. Generated missions are only ever aligned to rows of this table, so
 * a standard's code is never made up.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('curriculum_standards')) {
            return;
        }

        Schema::create('curriculum_standards', function (Blueprint $table) {
            $table->id();
            // A short name for the set it belongs to, as used on the command line: "NGSS", "CCSS-MATH", "TX-TEKS-SCI".
            $table->string('framework', 64)->index();
            $table->string('jurisdiction', 128)->nullable();
            $table->string('subject', 128)->nullable();
            // The code teachers know it by ("5-PS1-1", "CCSS.MATH.CONTENT.4.NF.A.1"); may be empty for headings.
            $table->string('code', 128)->nullable()->index();
            // ["K"], ["05"], ["09","10","11","12"]
            $table->json('grade_levels')->nullable();
            $table->text('description');
            // Where it came from, so importing again updates instead of duplicating.
            $table->string('source', 32)->default('manual');
            $table->string('source_id', 191)->nullable()->unique();
            $table->string('parent_source_id', 191)->nullable();
            $table->unsignedSmallInteger('depth')->default(0);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('curriculum_standards');
    }
};
