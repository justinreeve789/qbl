<?php

namespace App\Console\Commands;

use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use App\Qbl\District\DistrictApi;
use App\Qbl\StoreError;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Organizations (schools and districts) and their district admin panel:
 *
 *   php artisan qbl:org list
 *   php artisan qbl:org create "Riverside Unified" --kind=district
 *   php artisan qbl:org enable "Riverside Unified"         turn on integrations (SAML, Clever, Google, API clients, roster files)
 *   php artisan qbl:org disable "Riverside Unified"        turn them off again (every integration stops)
 *   php artisan qbl:org admin "Riverside Unified" it@riverside.org          make someone an admin of it (they need an account)
 *   php artisan qbl:org admin "Riverside Unified" it@riverside.org --remove
 *   php artisan qbl:org license "Riverside Unified" --students=5000 --generator --credits=500 --expires=2027-06-30
 *   php artisan qbl:org license "Riverside Unified" --remove
 *
 * Integrations are an advanced feature: they stay off until a customer asks for them.
 */
class OrgCommand extends Command
{
    protected $signature = 'qbl:org
        {action : list, create, enable, disable, admin or license}
        {organization? : its name or id}
        {email? : admin: the person\'s email address}
        {--kind=district : create: district, school, business or other}
        {--remove : admin, license: take it away}
        {--name= : license: what the plan is called (default: "<organization> license")}
        {--students= : license: students per teacher (default: no limit)}
        {--no-curricular : license: without the curricular missions}
        {--generator : license: with the AI mission generator}
        {--credits=0 : license: generator credits per teacher per month}
        {--carryover= : license: unused credits carried to the next month (default: one month\'s)}
        {--expires= : license: the last day, YYYY-MM-DD}';

    protected $description = 'Organizations: create them, turn on their integrations, name their admins, set their license';

    public function handle(DistrictApi $district): int
    {
        $clients = new Clients(DB::connection()->getPdo());
        try {
            if ($this->argument('action') === 'list') {
                $rows = DB::table('organizations')->whereNull('parent_id')->orderBy('name')->get();
                $this->table(['id', 'name', 'kind', 'integrations', 'license', 'admins'], $rows->map(fn ($o) => [
                    $o->id, $o->name, $o->kind, $o->integrations_enabled_at ? 'on' : 'off', $o->license ? 'yes' : '',
                    DB::table('organization_admins')->join('users', 'users.id', '=', 'organization_admins.user_id')->where('organization_id', $o->id)->pluck('email')->implode(', '),
                ]));

                return self::SUCCESS;
            }
            if ($this->argument('action') === 'create') {
                $org = $clients->createOrganization((string) $this->argument('organization'), (string) $this->option('kind'));
                $this->info("Created organization {$org['id']}: {$org['name']}. Turn on its integrations with: php artisan qbl:org enable {$org['id']}");

                return self::SUCCESS;
            }
            $org = $this->organization();
            switch ($this->argument('action')) {
                case 'enable':
                case 'disable':
                    $district->setEnabled($org->id, $this->argument('action') === 'enable');
                    $this->info("Integrations are now {$this->argument('action')}d for {$org->name}.");
                    if ($this->argument('action') === 'enable' && ! DB::table('organization_admins')->where('organization_id', $org->id)->exists()) {
                        $this->line("Next, give it an admin: php artisan qbl:org admin {$org->id} someone@district.org");
                    }

                    return self::SUCCESS;
                case 'admin':
                    $email = (string) $this->argument('email');
                    if ($this->option('remove')) {
                        $user = DB::table('users')->whereRaw('LOWER(email) = ?', [strtolower($email)])->first();
                        DB::table('organization_admins')->where('organization_id', $org->id)->where('user_id', $user?->id)->delete();
                        $this->info("$email is no longer an admin of {$org->name}.");

                        return self::SUCCESS;
                    }
                    $added = $district->addAdmin($org->id, $email);
                    $this->info("$email is an admin of {$org->name}. They will find it in the editor, under District.");
                    if (isset($added['warning'])) {
                        $this->warn($added['warning']);
                    }

                    return self::SUCCESS;
                case 'license':
                    if ($this->option('remove')) {
                        $district->setLicense($org->id, null);
                        $this->info("{$org->name} has no license now.");

                        return self::SUCCESS;
                    }
                    $district->setLicense($org->id, [
                        'plan_name' => $this->option('name') ?: null,
                        'curricular' => ! $this->option('no-curricular'),
                        'generator' => (bool) $this->option('generator'),
                        'students' => $this->option('students'),
                        'monthly_credits' => (int) $this->option('credits'),
                        'credit_carryover' => $this->option('carryover') ?? (int) $this->option('credits'),
                        'expires_at' => $this->option('expires'),
                    ]);
                    $this->info("{$org->name}'s license is set. Its teachers and students get it from their next request.");

                    return self::SUCCESS;
            }
            $this->error('The action is one of: list, create, enable, disable, admin, license.');
        } catch (StoreError|ApiError $e) {
            $this->error($e->getMessage());
        }

        return self::FAILURE;
    }

    private function organization(): object
    {
        $key = trim((string) $this->argument('organization'));
        $org = ctype_digit($key) ? DB::table('organizations')->where('id', (int) $key)->first() : DB::table('organizations')->whereNull('parent_id')->where('name', $key)->first();
        if (! $org || $org->parent_id !== null) {
            throw new StoreError(404, "There is no organization \"$key\". See: php artisan qbl:org list");
        }

        return $org;
    }
}
