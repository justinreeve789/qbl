<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Every scenario gets a unique code of sixteen lowercase letters. Players open /{code} to play.
 *
 * Scenarios that already exist are given one here, so a database created before codes existed
 * keeps working. Each step can be repeated, in case the migration is interrupted part way.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('scenarios', 'code')) {
            Schema::table('scenarios', function (Blueprint $table) {
                $table->char('code', 16)->nullable()->after('id');
            });
        }

        foreach (DB::table('scenarios')->whereNull('code')->orderBy('id')->get(['id', 'shortname']) as $scenario) {
            // The demo mission has a fixed code; it is the one in its seed data.
            $code = $scenario->shortname === 'starship' ? 'starshipexplorer' : $this->randomCode();
            while (DB::table('scenarios')->where('code', $code)->exists()) {
                $code = $this->randomCode();
            }
            DB::table('scenarios')->where('id', $scenario->id)->update(['code' => $code]);
        }

        Schema::table('scenarios', function (Blueprint $table) {
            $table->unique('code');
        });
    }

    public function down(): void
    {
        Schema::table('scenarios', function (Blueprint $table) {
            $table->dropUnique(['code']);
            $table->dropColumn('code');
        });
    }

    private function randomCode(): string
    {
        $code = '';
        for ($i = 0; $i < 16; $i++) {
            $code .= chr(random_int(97, 122));
        }

        return $code;
    }
};
