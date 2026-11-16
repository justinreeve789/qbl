<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The actions of an event, in order (docs/docs/action.md). The attributes specific to an action type are in `params`.
 *
 * A database made while one migration created every QBL table already has this table, so this
 * does nothing there.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('actions')) {
            return;
        }

        Schema::create('actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->string('type', 32);
            $table->unsignedInteger('sequence')->default(0);
            $table->boolean('blocking')->default(true);
            $table->foreignId('media_id')->nullable()->constrained('media')->nullOnDelete();
            $table->json('params')->nullable();     // the attributes specific to this action type
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('actions');
    }
};
