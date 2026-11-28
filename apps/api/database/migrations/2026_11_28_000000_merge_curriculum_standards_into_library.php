<?php

use App\Qbl\Standards\LegacyStandards;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One standards library. curriculum_standards and scenario_standards (the generator's own list,
 * from 2026-11-18) are moved into the standard_* tables and dropped:
 *
 *  - standard_alignments gains rationale and evidence, which scenario_standards had;
 *  - every old standard is matched to a library item (CSP id, CASE id, or a code only one current
 *    item has, preferring the Common Core's/NGSS's own) or else imported as a framework of its own
 *    under the QBL jurisdiction, so no alignment is lost (LegacyStandards::migrate);
 *  - every scenario_standards row becomes a standard_alignments row (alignable_type "scenario").
 *
 * After loading the library on a server that migrated before it was loaded, run
 * `php artisan qbl:standards relink` to move alignments from the imported copies to library items.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('standard_alignments', function (Blueprint $t) {
            $t->text('rationale')->nullable()->after('strength');   // what in the mission addresses it
            $t->json('evidence')->nullable()->after('rationale');   // the objectives, questions and interactions that do
        });

        $result = LegacyStandards::migrate(DB::connection()->getPdo());
        if ($result['standards']) {
            fwrite(STDERR, sprintf("  standards: %d old standards (%d matched to the library, %d kept as imported sets), %d mission alignments moved\n",
                $result['standards'], $result['matched'], $result['imported'], $result['alignments']));
        }

        Schema::dropIfExists('scenario_standards');
        Schema::dropIfExists('curriculum_standards');
    }

    /** Puts the old tables back, empty: their rows now live in the library. */
    public function down(): void
    {
        if (! Schema::hasTable('curriculum_standards')) {
            Schema::create('curriculum_standards', function (Blueprint $table) {
                $table->id();
                $table->string('framework', 64)->index();
                $table->string('jurisdiction', 128)->nullable();
                $table->string('subject', 128)->nullable();
                $table->string('code', 128)->nullable()->index();
                $table->json('grade_levels')->nullable();
                $table->text('description');
                $table->string('source', 32)->default('manual');
                $table->string('source_id', 191)->nullable()->unique();
                $table->string('parent_source_id', 191)->nullable();
                $table->unsignedSmallInteger('depth')->default(0);
                $table->timestamps();
            });
        }
        if (! Schema::hasTable('scenario_standards')) {
            Schema::create('scenario_standards', function (Blueprint $table) {
                $table->id();
                $table->foreignId('scenario_id')->constrained('scenarios')->cascadeOnDelete();
                $table->foreignId('curriculum_standard_id')->constrained('curriculum_standards')->cascadeOnDelete();
                $table->string('alignment', 16)->default('primary');
                $table->text('rationale')->nullable();
                $table->json('evidence')->nullable();
                $table->timestamps();
                $table->unique(['scenario_id', 'curriculum_standard_id']);
            });
        }
        Schema::table('standard_alignments', function (Blueprint $t) {
            $t->dropColumn(['rationale', 'evidence']);
        });
    }
};
