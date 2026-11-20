<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * - integrations_enabled_at: the district admin panel's integrations (SAML, Clever, Google, API
 *   clients, roster uploads) are an advanced feature, off until QBL turns them on for a customer
 *   who asks (`php artisan qbl:org enable`, or a QBL administrator in the panel).
 * - license: a school's or district's custom plan, agreed with QBL (a quote, not Stripe): what
 *   its teachers get. See App\Qbl\Billing\Entitlements.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            if (! Schema::hasColumn('organizations', 'integrations_enabled_at')) {
                $table->timestamp('integrations_enabled_at')->nullable();
            }
            if (! Schema::hasColumn('organizations', 'license')) {
                $table->json('license')->nullable();
            }
        });
    }

    public function down(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn(['integrations_enabled_at', 'license']);
        });
    }
};
