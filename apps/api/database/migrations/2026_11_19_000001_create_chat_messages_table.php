<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Every message a player sent: said in a scene (`chat`, `emote`) or to one other player (`private`).
 * Kept so that what was said can be audited later. The sender's name is stored as it was at the time.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('chat_messages')) {
            return;
        }

        Schema::create('chat_messages', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('scenario_id');
            $table->unsignedBigInteger('user_id')->index();
            $table->string('user_name', 120)->nullable();
            $table->string('group_key', 64)->default('public');
            $table->unsignedBigInteger('scene_id')->nullable();
            $table->string('kind', 12);
            $table->unsignedBigInteger('to_user_id')->nullable()->index();
            $table->string('to_name', 120)->nullable();
            $table->string('text', 500);
            $table->timestamp('created_at')->nullable();
            $table->index(['scenario_id', 'group_key', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chat_messages');
    }
};
