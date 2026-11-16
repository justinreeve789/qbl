<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Hotspots that only appear when the player's avatar is near: beyond `reveal_radius` the hotspot
 * is invisible and cannot be clicked, within `reveal_full_radius` it is fully visible, and its
 * labels fade with distance in between. Both are optional.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('events', function (Blueprint $table) {
            if (! Schema::hasColumn('events', 'reveal_radius')) {
                $table->decimal('reveal_radius', 12, 3)->nullable();
            }
            if (! Schema::hasColumn('events', 'reveal_full_radius')) {
                $table->decimal('reveal_full_radius', 12, 3)->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('events', function (Blueprint $table) {
            $table->dropColumn(['reveal_radius', 'reveal_full_radius']);
        });
    }
};
