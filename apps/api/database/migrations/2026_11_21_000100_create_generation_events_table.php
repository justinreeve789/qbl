<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An audit log of the AI scenario generator: one row for every language-model call, picture drawn,
 * judge call, recorded voice line and stage a run goes through, with when it began, how long it took,
 * which model, tokens, what it cost (list prices, an estimate not a bill) and how it came out.
 * scenario_generations says what a run made; this says where its time and money went.
 *
 * type    llm | picture | voice | stage | estimate
 * kind    llm: what it was for (curriculum_alignment, mission_blueprint, style_review...);
 *         picture: what was drawn (background, item, strip, sheet...); stage/estimate: null
 * step    what it was working on: the picture's key (strip:keeper-ama:walk), or the call's purpose
 * outcome ok | error | truncated | refused | kept | discarded | rejected | cancelled | failed
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('generation_events')) {
            return;
        }

        Schema::create('generation_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('generation_id')->constrained('scenario_generations')->cascadeOnDelete();
            // The order things happened in, within the run (a resumed run carries on counting).
            $table->unsignedInteger('seq');
            $table->string('stage', 16)->nullable();
            $table->string('type', 12);
            $table->string('kind', 40)->nullable();
            $table->string('step', 190)->nullable();
            $table->string('label', 190)->nullable();
            $table->unsignedSmallInteger('attempt')->nullable();
            $table->string('model', 80)->nullable();
            $table->string('size', 16)->nullable();
            $table->dateTime('started_at', 3);
            $table->unsignedInteger('duration_ms')->nullable();
            // Output tokens include the model's thinking.
            $table->unsignedInteger('input_tokens')->nullable();
            $table->unsignedInteger('output_tokens')->nullable();
            $table->unsignedInteger('cache_read_tokens')->nullable();
            $table->unsignedInteger('cache_write_tokens')->nullable();
            $table->unsignedSmallInteger('references')->nullable();
            $table->decimal('usd', 10, 5)->default(0);
            $table->decimal('score', 4, 1)->nullable();
            $table->string('outcome', 16)->nullable();
            $table->text('note')->nullable();
            $table->text('detail')->nullable();
            $table->timestamp('created_at')->nullable();

            $table->index(['generation_id', 'seq']);
            $table->index(['generation_id', 'step', 'attempt']);
            $table->index(['type', 'kind']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('generation_events');
    }
};
