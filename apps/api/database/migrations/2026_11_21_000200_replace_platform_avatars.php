<?php

use App\Qbl\Avatars;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * The platform's avatars are a new cast (Asimov, Buck, Gil, Lucy, Mallory, Pinta, Riona, Sam,
 * Val: ids 11 to 19 in database/seeders/data/avatars.php). On a database that has the first cast
 * (ids 1 to 10, Nova … Halley and Sprocket), this withdraws it and adds the new one, so updating
 * needs no `qbl:seed`. A fresh database has neither and is left for seeding, as before.
 *
 * The old rows are kept, inactive. Organizations' own avatars are not touched. Players who had
 * chosen an old avatar are given the first of the new cast and can choose on the missions page.
 * See Avatars::replaceFirstCast.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::transaction(fn () => Avatars::replaceFirstCast(DB::connection()->getPdo(), require database_path('seeders/data/avatars.php')));
    }

    /** The first cast back, and the new one withdrawn. Players' choices of the new cast are left as they are. */
    public function down(): void
    {
        $old = array_keys(Avatars::FIRST_CAST);
        if (! DB::table('avatars')->whereIn('id', $old)->exists()) {
            return;
        }
        $new = array_column(require database_path('seeders/data/avatars.php'), 'id');
        DB::table('avatars')->whereIn('id', $new)->whereNull('organization_id')->update(['active' => 0]);
        DB::table('avatars')->whereIn('id', $old)->whereNull('organization_id')->update(['active' => 1]);
    }
};
