<?php

namespace App\Providers;

use App\Qbl\ActivityStore;
use App\Qbl\Api\V1\Api as ApiV1;
use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\ProgressStore;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\SpeechFactory;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
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
        $this->app->singleton(ClassApi::class, fn () => new ClassApi(DB::connection()->getPdo(), config('qbl.ranks')));
        $this->app->singleton(ActivityStore::class, fn () => new ActivityStore(DB::connection()->getPdo()));
        $this->app->singleton(ProgressStore::class, fn () => new ProgressStore(DB::connection()->getPdo(), config('qbl.ranks')));
        // The public API for schools and districts (/api/v1). Plain PHP as well.
        $this->app->singleton(ApiV1::class, fn () => new ApiV1(
            DB::connection()->getPdo(), config('qbl.media_dir'), config('qbl.media_url'), (string) config('app.url'), config('qbl.ranks'),
        ));
        // The AI scenario generator (qbl:generate). Plain PHP too; built from config/qbl_generation.php.
        // Recorded voices for what characters say (qbl:voice, the editor, the generator): config/qbl_speech.php.
        $this->app->singleton(SpeechFactory::class, fn () => new SpeechFactory(config('qbl_speech')));
        $this->app->singleton(GenerationFactory::class, fn ($app) => new GenerationFactory(config('qbl_generation'), $app->make(ScenarioStore::class), speech: $app->make(SpeechFactory::class)));
    }

    public function boot(): void
    {
        // /api/v1: per access token, with tighter limits on the two doors that take secrets.
        RateLimiter::for('qbl-api-v1', function (Request $request) {
            $path = $request->path();
            if (str_ends_with($path, 'v1/oauth/token')) {
                return Limit::perMinute(20)->by('token:'.$request->ip());
            }
            if (str_contains($path, 'v1/launch/')) {
                return Limit::perMinute(60)->by('launch:'.$request->ip());
            }

            return Limit::perMinute((int) config('qbl.api_rate_limit', 600))->by('client:'.sha1((string) ($request->bearerToken() ?? $request->ip())));
        });
    }
}
