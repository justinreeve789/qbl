<?php

namespace App\Providers;

use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
use App\Qbl\ProgressStore;
use App\Qbl\ScenarioStore;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        // The scenario store is plain PHP over PDO; here it is given Laravel's own database connection.
        $this->app->singleton(ScenarioStore::class, fn () => new ScenarioStore(
            DB::connection()->getPdo(),
            config('qbl.media_dir'),
            config('qbl.media_url'),
        ));
        $this->app->singleton(ClassStore::class, fn () => new ClassStore(DB::connection()->getPdo()));
        $this->app->singleton(ClassApi::class, fn () => new ClassApi(DB::connection()->getPdo()));
        $this->app->singleton(ProgressStore::class, fn () => new ProgressStore(DB::connection()->getPdo(), config('qbl.ranks')));
    }

    public function boot(): void
    {
        //
    }
}
