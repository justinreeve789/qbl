<?php

namespace App\Providers;

use App\Jobs\SyncRoster;
use App\Qbl\ActivityStore;
use App\Qbl\Api\V1\Api as ApiV1;
use App\Qbl\Billing\BillingApi;
use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\Billing\Plans;
use App\Qbl\Billing\Stripe;
use App\Qbl\Billing\Subscriptions;
use App\Qbl\Characters\WalkMaker;
use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
use App\Qbl\District\CleverClient;
use App\Qbl\District\DistrictApi;
use App\Qbl\District\GoogleClassroomClient;
use App\Qbl\District\Integrations;
use App\Qbl\District\RosterSync;
use App\Qbl\District\Sso;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Library\AssetLibrary;
use App\Qbl\Library\ContentAdmins;
use App\Qbl\Library\LibraryApi;
use App\Qbl\ProgressStore;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\SpeechFactory;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
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
        // Walks made from standing pictures (php artisan qbl:walk), drawn by Node with packages/shared's walkCycle.ts.
        $this->app->singleton(WalkMaker::class, fn () => new WalkMaker(
            (string) config('qbl.walk_script'), (string) config('qbl.node'), config('qbl.media_dir'), (string) config('qbl.media_url'), config('qbl.assets_dir'),
        ));
        // The asset library: ready-made characters, vehicles and more (App\Qbl\Library), and its API.
        $this->app->singleton(AssetLibrary::class, fn () => new AssetLibrary(
            DB::connection()->getPdo(), config('qbl.media_dir'), config('qbl.media_url'), config('qbl.library_dir'), config('qbl.library_url'),
        ));
        $this->app->singleton(LibraryApi::class, fn ($app) => new LibraryApi($app->make(AssetLibrary::class), $app->make(ScenarioStore::class), new ContentAdmins(DB::connection()->getPdo())));
        // Plans, Stripe and generator credits (config/qbl_billing.php). With billing off, everything is open.
        $this->app->singleton(HttpClient::class, fn () => new CurlHttpClient(2));
        $this->app->singleton(Plans::class, fn () => new Plans(config('qbl_billing')));
        $this->app->singleton(Entitlements::class, fn ($app) => new Entitlements(DB::connection()->getPdo(), $app->make(Plans::class)));
        $this->app->singleton(Credits::class, fn ($app) => new Credits(DB::connection()->getPdo(), $app->make(Entitlements::class)));
        $this->app->bind(Stripe::class, fn ($app) => new Stripe($app->make(HttpClient::class), (string) config('qbl_billing.stripe.secret'), (string) config('qbl_billing.stripe.base_url')));
        $this->app->singleton(Subscriptions::class, fn ($app) => new Subscriptions(
            DB::connection()->getPdo(), $app->make(Plans::class), config('qbl_billing.stripe.secret') ? $app->make(Stripe::class) : null, (string) config('app.url'),
        ));
        $this->app->singleton(BillingApi::class, fn ($app) => new BillingApi($app->make(Entitlements::class), $app->make(Credits::class), $app->make(Subscriptions::class)));

        $this->app->singleton(ClassStore::class, fn ($app) => new ClassStore(DB::connection()->getPdo(), $app->make(Entitlements::class)));
        $this->app->singleton(ClassApi::class, fn ($app) => new ClassApi(DB::connection()->getPdo(), config('qbl.ranks'), $app->make(Entitlements::class)));
        $this->app->singleton(ActivityStore::class, fn () => new ActivityStore(DB::connection()->getPdo()));
        $this->app->singleton(ProgressStore::class, fn () => new ProgressStore(DB::connection()->getPdo(), config('qbl.ranks')));
        // The public API for schools and districts (/api/v1). Plain PHP as well.
        $this->app->singleton(ApiV1::class, fn () => new ApiV1(
            DB::connection()->getPdo(), config('qbl.media_dir'), config('qbl.media_url'), (string) config('app.url'), config('qbl.ranks'),
        ));
        // The district admin panel: organizations' integrations (SAML, Clever, Google), roster syncs and sign-in.
        $this->app->singleton(Integrations::class, fn () => new Integrations(DB::connection()->getPdo(), fn (string $v) => Crypt::encryptString($v), fn (string $v) => Crypt::decryptString($v)));
        $this->app->singleton(RosterSync::class, fn () => new RosterSync(DB::connection()->getPdo()));
        $this->app->singleton(CleverClient::class, fn ($app) => new CleverClient(
            $app->make(HttpClient::class), (string) config('services.clever.client_id'), (string) config('services.clever.client_secret'),
            (string) config('services.clever.api_base', 'https://api.clever.com'), (string) config('services.clever.auth_base', 'https://clever.com'),
        ));
        $this->app->singleton(GoogleClassroomClient::class, fn ($app) => new GoogleClassroomClient($app->make(HttpClient::class), (string) config('services.google_classroom.api_base', 'https://classroom.googleapis.com')));
        $this->app->singleton(Sso::class, fn () => new Sso(DB::connection()->getPdo(), (string) config('app.key')));
        $this->app->singleton(DistrictApi::class, fn ($app) => new DistrictApi(
            DB::connection()->getPdo(), $app->make(Integrations::class), $app->make(RosterSync::class), $app->make(CleverClient::class), $app->make(GoogleClassroomClient::class),
            (string) config('app.url'), fn (int $runId) => SyncRoster::dispatch($runId),
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
