<?php

namespace App\Console\Commands;

use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Organizations and the API clients they use /api/v1 with. Only an administrator of this
 * server makes them; the organization is then sent the client id and secret.
 *
 *   php artisan qbl:api-client create "Riverside District" --kind=district --name="SIS sync" --scopes=roster:read,roster:write,reports:read
 *   php artisan qbl:api-client create 3                  (an organization that exists, by id; every scope)
 *   php artisan qbl:api-client list
 *   php artisan qbl:api-client rotate qbl_0123…           (a new secret; the old one stops working)
 *   php artisan qbl:api-client revoke qbl_0123…
 *   php artisan qbl:api-client scopes                     (what each scope allows)
 */
class ApiClientCommand extends Command
{
    protected $signature = 'qbl:api-client {action : create, list, rotate, revoke or scopes} {target? : the organization (id or name) for create; the client id for rotate and revoke}
        {--name=API client : what to call the client} {--kind=district : for a new organization: district, school, business or other} {--scopes=all : comma-separated, or all}';

    protected $description = 'Make, list, rotate or revoke the API clients organizations use /api/v1 with';

    public function handle(): int
    {
        $clients = new Clients(DB::connection()->getPdo());
        $target = (string) $this->argument('target');
        try {
            switch ($this->argument('action')) {
                case 'create':
                    if ($target === '') {
                        $this->error('Name the organization: its id, or a name to make a new one.');

                        return self::FAILURE;
                    }
                    $org = ctype_digit($target) ? $clients->organization((int) $target) : null;
                    if (! $org && ctype_digit($target)) {
                        $this->error("There is no organization $target.");

                        return self::FAILURE;
                    }
                    if (! $org) {
                        $existing = DB::table('organizations')->whereNull('parent_id')->where('name', $target)->value('id');
                        $org = $existing ? $clients->organization((int) $existing) : $clients->createOrganization($target, (string) $this->option('kind'));
                        $this->info(($existing ? 'Using' : 'Made')." organization {$org['id']}: {$org['name']} ({$org['kind']}).");
                    }
                    $made = $clients->createClient($org['id'], (string) $this->option('name'), in_array($this->option('scopes'), ['all', '*'], true) ? ['*'] : array_map('trim', explode(',', (string) $this->option('scopes'))));
                    $this->line('client_id:     '.$made['client_id']);
                    $this->line('client_secret: '.$made['client_secret']);
                    $this->line('scopes:        '.implode(' ', $made['scopes']));
                    $this->warn('The secret is shown this once. Send it to the organization securely.');

                    return self::SUCCESS;
                case 'list':
                    $orgs = DB::table('organizations')->pluck('name', 'id');
                    $this->table(['client_id', 'name', 'organization', 'scopes', 'last used', 'revoked'], array_map(fn ($c) => [
                        $c['client_id'], $c['name'], $c['organization_id'].' '.($orgs[$c['organization_id']] ?? ''), implode(' ', $c['scopes']), $c['last_used_at'] ?? '-', $c['revoked_at'] ?? '-',
                    ], $clients->clients()));

                    return self::SUCCESS;
                case 'rotate':
                    $this->line('client_secret: '.$clients->rotateSecret($target));
                    $this->warn('The old secret, and every token issued with it, no longer works.');

                    return self::SUCCESS;
                case 'revoke':
                    $clients->revokeClient($target);
                    $this->info("Revoked $target. Its tokens no longer work.");

                    return self::SUCCESS;
                case 'scopes':
                    $this->table(['scope', 'allows'], array_map(fn ($k, $v) => [$k, $v], array_keys(Clients::SCOPES), Clients::SCOPES));

                    return self::SUCCESS;
            }
        } catch (ApiError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $this->error('The action is create, list, rotate, revoke or scopes.');

        return self::FAILURE;
    }
}
