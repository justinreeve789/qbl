<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Curriculum standards library (any country, any publisher), shaped after
 * 1EdTech CASE so CASE packages import and export without loss.
 *
 *   jurisdiction ─< framework ─< document (an edition) ─< item (a tree)
 *                                   │                      └─< item_revisions
 *                                   └─< document_revisions (one per import that changed it)
 *   item >─< item   through standard_associations (crosswalks, replacedBy, ...)
 *   item >─< education level, and  item ─< standard_alignments (QBL content)
 *
 * Items keep their uuid for ever: an import that changes a statement updates the
 * row and keeps the old values in standard_item_revisions; a statement that
 * disappears is retired, not deleted, so alignments never dangle.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('standard_sources', function (Blueprint $t) {
            $t->id();
            $t->string('slug', 64)->unique();          // csp, gov-uk-dfe, case:opensalt.net, manual
            $t->string('name');
            $t->string('kind', 16);                    // api | case | html | pdf | rtf | xml | manual
            $t->string('base_url', 500)->nullable();
            $t->text('attribution')->nullable();
            $t->timestamps();
        });

        Schema::create('standard_licenses', function (Blueprint $t) {
            $t->id();
            $t->char('hash', 40)->unique();            // sha1(title|url|rights_holder)
            $t->string('title');
            $t->string('url', 500)->nullable();
            $t->string('rights_holder')->nullable();
            $t->text('attribution')->nullable();       // text to show wherever the standards are shown
            $t->timestamps();
        });

        Schema::create('standard_jurisdictions', function (Blueprint $t) {
            $t->id();
            $t->string('code', 32)->unique();          // US-TX, CA-ON, GB-SCT, US-CCSS, ORG-<id>
            $t->string('name');
            $t->string('kind', 24);                    // country | state | province | territory | nation | consortium | organization | district | school
            $t->foreignId('parent_id')->nullable()->constrained('standard_jurisdictions')->nullOnDelete();
            $t->char('country', 2)->nullable();        // ISO 3166-1 alpha-2
            $t->string('level_system', 16)->nullable();// default system for education levels
            $t->unsignedBigInteger('organization_id')->nullable()->index(); // a QBL organization's own standards
            $t->json('external_ids')->nullable();      // {"csp": ["B6AA…", "6C1C…"]}
            $t->timestamps();
        });

        Schema::create('standard_subjects', function (Blueprint $t) {
            $t->id();
            $t->string('slug', 64)->unique();          // mathematics, science, ela, social-studies, ...
            $t->string('name');
            $t->foreignId('parent_id')->nullable()->constrained('standard_subjects')->nullOnDelete();
            $t->unsignedSmallInteger('sort')->default(0);
        });

        Schema::create('standard_education_levels', function (Blueprint $t) {
            $t->id();
            $t->string('system', 16);                  // GRADE (US+Canada), GB-ENG, GB-SCT, GB-WLS, GB-NIR, ISCED
            $t->string('code', 32);                    // 03, K, Y4, first, PS2, KS3
            $t->string('label');
            $t->boolean('is_band')->default(false);    // spans several years (Scottish levels, key stages)
            $t->unsignedTinyInteger('age_from')->nullable();   // typical age at the start of the year
            $t->unsignedTinyInteger('age_to')->nullable();
            $t->tinyInteger('grade_from')->nullable(); // US-grade equivalent for cross-system search (PK=-1, K=0, HE=13)
            $t->tinyInteger('grade_to')->nullable();
            $t->unsignedSmallInteger('sort')->default(0);
            $t->unique(['system', 'code']);
            $t->index(['grade_from', 'grade_to']);
        });

        Schema::create('standard_frameworks', function (Blueprint $t) {
            $t->id();
            $t->string('slug', 191)->unique();         // us-tx-mathematics, gb-eng-national-curriculum-science
            $t->foreignId('jurisdiction_id')->constrained('standard_jurisdictions')->cascadeOnDelete();
            $t->string('title');
            $t->foreignId('subject_id')->nullable()->constrained('standard_subjects')->nullOnDelete();
            $t->string('subject_label')->nullable();   // the publisher's own word for the subject
            $t->string('language', 16)->default('en');
            $t->string('publisher')->nullable();
            $t->text('description')->nullable();
            $t->unsignedBigInteger('organization_id')->nullable()->index(); // null = everyone
            $t->unsignedBigInteger('current_document_id')->nullable()->index(); // the edition in force
            $t->timestamps();
            $t->index(['jurisdiction_id', 'subject_id']);
        });

        Schema::create('standard_import_runs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('source_id')->constrained('standard_sources');
            $t->string('scope')->nullable();           // "US-TX", "all", a file name
            $t->string('status', 16)->default('running'); // running | ok | partial | failed
            $t->json('options')->nullable();
            $t->json('stats')->nullable();             // documents added/changed/unchanged, items added/changed/retired
            $t->text('error')->nullable();
            $t->unsignedBigInteger('user_id')->nullable();
            $t->timestamp('started_at')->nullable();
            $t->timestamp('finished_at')->nullable();
        });

        Schema::create('standard_documents', function (Blueprint $t) {
            $t->id();
            $t->uuid('uuid')->unique();                // CASE CFDocument identifier
            $t->foreignId('framework_id')->constrained('standard_frameworks')->cascadeOnDelete();
            $t->foreignId('source_id')->constrained('standard_sources');
            $t->string('source_key', 191);             // the source's id for this document
            $t->string('title', 500);
            $t->string('version_label', 64)->nullable(); // "2012", "Sept 2013", "2020 revision"
            $t->unsignedSmallInteger('published_year')->nullable();
            $t->date('adopted_on')->nullable();
            $t->date('effective_from')->nullable();
            $t->date('effective_until')->nullable();
            $t->string('status', 16)->default('current'); // draft | proposed | current | superseded | archived | withdrawn
            $t->boolean('status_locked')->default(false); // set by an admin: imports leave status alone
            $t->string('language', 16)->default('en');
            $t->string('publisher')->nullable();
            $t->string('source_url', 1000)->nullable();
            $t->foreignId('license_id')->nullable()->constrained('standard_licenses')->nullOnDelete();
            $t->foreignId('supersedes_id')->nullable()->constrained('standard_documents')->nullOnDelete();
            $t->foreignId('translation_of_id')->nullable()->constrained('standard_documents')->nullOnDelete();
            $t->unsignedInteger('revision')->default(0); // latest revision number
            $t->char('content_hash', 40)->nullable();
            $t->unsignedInteger('item_count')->default(0); // active items
            $t->foreignId('last_import_run_id')->nullable()->constrained('standard_import_runs')->nullOnDelete();
            $t->timestamp('last_imported_at')->nullable();
            $t->json('meta')->nullable();
            $t->timestamps();
            $t->unique(['source_id', 'source_key']);
            $t->index(['framework_id', 'status']);
        });

        Schema::create('standard_document_revisions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('document_id')->constrained('standard_documents')->cascadeOnDelete();
            $t->unsignedInteger('revision');
            $t->foreignId('import_run_id')->nullable()->constrained('standard_import_runs')->nullOnDelete();
            $t->char('content_hash', 40);
            $t->unsignedInteger('item_count')->default(0);
            $t->unsignedInteger('added')->default(0);
            $t->unsignedInteger('changed')->default(0);
            $t->unsignedInteger('retired')->default(0);
            $t->unsignedInteger('restored')->default(0);
            $t->string('note', 500)->nullable();
            $t->timestamp('created_at')->nullable();
            $t->unique(['document_id', 'revision']);
        });

        Schema::create('standard_items', function (Blueprint $t) {
            $t->id();
            $t->uuid('uuid')->unique();                // CASE CFItem identifier; never changes
            $t->foreignId('document_id')->constrained('standard_documents')->cascadeOnDelete();
            $t->foreignId('parent_id')->nullable()->constrained('standard_items')->nullOnDelete();
            $t->string('source_key', 191);             // the source's id, or a path for HTML sources
            $t->string('lineage', 255)->default('/');  // "/12/345/" ancestor ids, for subtree queries
            $t->unsignedTinyInteger('depth')->default(0);
            $t->unsignedInteger('position')->default(0); // reading order within the document
            $t->string('code', 191)->nullable();       // human code: CCSS.MATH.CONTENT.3.OA.A.1, MNU 1-01a
            $t->string('alt_code', 191)->nullable();   // short form: 3.OA.1
            $t->string('list_label', 16)->nullable();  // a, b, i, 1
            $t->string('type_label', 100)->nullable(); // the publisher's word: "Specific Expectation"
            $t->string('item_type', 24)->default('standard'); // normalised, see StandardTypes
            $t->text('statement');
            $t->string('abbreviated', 500)->nullable();
            $t->text('notes')->nullable();             // examples, clarifications (JSON list)
            $t->boolean('is_statutory')->nullable();   // null = not stated
            $t->string('language', 16)->nullable();    // null = the document's
            $t->string('uri', 500)->nullable();        // canonical URI (corestandards.org, ASN, CASE)
            $t->string('asn_id', 32)->nullable();
            $t->string('status', 16)->default('active'); // active | retired
            $t->unsignedInteger('first_revision')->default(1);
            $t->unsignedInteger('last_revision')->default(1); // last document revision that changed it
            $t->timestamp('retired_at')->nullable();
            $t->char('content_hash', 40);
            $t->json('extra')->nullable();
            $t->timestamps();
            $t->unique(['document_id', 'source_key']);
            $t->index(['document_id', 'status', 'position']);
            $t->index('source_key');
            $t->index('code');
            $t->index('alt_code');
            $t->index('asn_id');
            $t->index('lineage');
        });
        // prefix indexes and fulltext are MariaDB/MySQL only
        if (in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement('CREATE INDEX standard_items_uri_index ON standard_items (uri(191))');
            DB::statement('ALTER TABLE standard_items ADD FULLTEXT standard_items_fulltext (statement)');
        } else {
            Schema::table('standard_items', fn (Blueprint $t) => $t->index('uri'));
        }

        Schema::create('standard_item_revisions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('item_id')->constrained('standard_items')->cascadeOnDelete();
            $t->unsignedInteger('revision');           // the document revision that made the change
            $t->foreignId('import_run_id')->nullable()->constrained('standard_import_runs')->nullOnDelete();
            $t->string('change_type', 16);             // added | changed | retired | restored | moved
            $t->json('previous')->nullable();          // the values it had before the change
            $t->json('fields')->nullable();            // which fields changed
            $t->timestamp('created_at')->nullable();
            $t->index(['item_id', 'revision']);
        });

        Schema::create('standard_item_levels', function (Blueprint $t) {
            $t->foreignId('item_id')->constrained('standard_items')->cascadeOnDelete();
            $t->foreignId('level_id')->constrained('standard_education_levels')->cascadeOnDelete();
            $t->primary(['item_id', 'level_id']);
            $t->index('level_id');
        });

        Schema::create('standard_document_levels', function (Blueprint $t) {
            $t->foreignId('document_id')->constrained('standard_documents')->cascadeOnDelete();
            $t->foreignId('level_id')->constrained('standard_education_levels')->cascadeOnDelete();
            $t->primary(['document_id', 'level_id']);
        });

        Schema::create('standard_associations', function (Blueprint $t) {
            $t->id();
            $t->string('type', 32);                    // CASE: exactMatchOf, isRelatedTo, isPeerOf, isPartOf, precedes, replacedBy, exemplar, hasSkillLevel; plus isTranslationOf
            $t->foreignId('origin_item_id')->constrained('standard_items')->cascadeOnDelete();
            $t->foreignId('destination_item_id')->nullable()->constrained('standard_items')->cascadeOnDelete();
            $t->string('destination_uri', 500)->nullable(); // kept when the destination isn't loaded (yet)
            $t->string('destination_code', 191)->nullable();
            $t->foreignId('source_id')->nullable()->constrained('standard_sources')->nullOnDelete(); // who said so; null = an editor
            $t->decimal('confidence', 4, 3)->nullable();
            $t->string('note', 500)->nullable();
            $t->unsignedBigInteger('user_id')->nullable();
            $t->timestamps();
            $t->index(['origin_item_id', 'type']);
            $t->index(['destination_item_id', 'type']);
        });

        // A QBL thing (scenario, scene, event, question, objective) teaches or assesses a standard.
        Schema::create('standard_alignments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('item_id')->constrained('standard_items')->cascadeOnDelete();
            $t->string('alignable_type', 32);          // scenario | scene | event | question | objective
            $t->unsignedBigInteger('alignable_id');
            $t->unsignedBigInteger('scenario_id')->nullable()->index();
            $t->string('strength', 16)->default('primary'); // primary | secondary | introduces | practices | assesses
            $t->unsignedInteger('item_revision')->nullable(); // document revision seen when aligned
            $t->unsignedBigInteger('user_id')->nullable();
            $t->timestamps();
            $t->unique(['item_id', 'alignable_type', 'alignable_id'], 'standard_alignments_unique');
            $t->index(['alignable_type', 'alignable_id']);
        });
    }

    public function down(): void
    {
        foreach ([
            'standard_alignments', 'standard_associations', 'standard_document_levels', 'standard_item_levels',
            'standard_item_revisions', 'standard_items', 'standard_document_revisions', 'standard_documents',
            'standard_import_runs', 'standard_frameworks', 'standard_education_levels', 'standard_subjects',
            'standard_jurisdictions', 'standard_licenses', 'standard_sources',
        ] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
