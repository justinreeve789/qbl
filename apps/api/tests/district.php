<?php

/**
 * Tests for the district admin panel (App\Qbl\District\*): organizations, the integrations switch,
 * admins, licenses, API clients, SAML/Clever/Google settings, roster syncs from Clever and Google
 * Classroom (answered from recordings), roster files, and who signing in through a district is.
 * SQLite, no network.
 *
 *   php apps/api/tests/district.php        (npm run test:district)
 */
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

use App\Qbl\Api\Clients;
use App\Qbl\District\CleverClient;
use App\Qbl\District\DistrictApi;
use App\Qbl\District\GoogleClassroomClient;
use App\Qbl\District\Integrations;
use App\Qbl\District\RosterFile;
use App\Qbl\District\RosterSync;
use App\Qbl\District\Sso;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;

$checks = 0;
$failures = 0;
function check(bool $ok, string $what): void
{
    global $checks, $failures;
    $checks++;
    if (! $ok) {
        $failures++;
        fwrite(STDERR, "FAIL: $what\n");
    }
}
function same(mixed $actual, mixed $expected, string $what): void
{
    check($actual === $expected, $what.' (got '.json_encode($actual).', expected '.json_encode($expected).')');
}
function refused(callable $work, int $status, string $what): ?string
{
    try {
        $work();
        check(false, "$what (was not refused)");
    } catch (StoreError $e) {
        same($e->status, $status, $what);

        return $e->getMessage();
    }

    return null;
}

final class Answers implements HttpClient
{
    public array $sent = [];

    public array $routes = [];

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $this->sent[] = compact('method', 'url', 'headers', 'body');
        foreach ($this->routes as [$m, $pattern, $answer]) {
            if ($m === $method && preg_match($pattern, $url)) {
                $answer = is_callable($answer) ? $answer($url, $body, $headers) : $answer;

                return new HttpResponse($answer[0], json_encode($answer[1]));
            }
        }

        return new HttpResponse(404, json_encode(['message' => "nothing at $method $url"]));
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach ([...ScenarioStore::sqliteSchema(), ...Clients::sqliteSchema(), ...Integrations::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
foreach (['organizations' => ['integrations_enabled_at', 'license'], 'users' => ['self_registered_at', 'email_verified_at']] as $table => $columns) {
    foreach ($columns as $column) {
        $pdo->exec("ALTER TABLE $table ADD COLUMN $column");
    }
}
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES (1, 'Root', 'root@qbl.test', 'admin'), (2, 'Ivy IT', 'ivy@riverside.org', 'teacher'), (3, 'Sam', 'sam@other.org', 'student'), (4, 'Ola', 'ola@riverside.org', 'student')");
$pdo->exec("UPDATE users SET self_registered_at = '2026-11-01' WHERE id = 4");

// Secrets are "encrypted" reversibly here; Laravel's Crypt in the app.
$integrations = new Integrations($pdo, fn ($v) => 'enc:'.base64_encode($v), fn ($v) => base64_decode(substr($v, 4)));
$http = new Answers;
$clever = new CleverClient($http, 'qbl-app', 'app-secret', 'https://api.clever.test', 'https://clever.test');
$google = new GoogleClassroomClient($http, 'https://classroom.test', fn () => 1_800_000_000);
$sync = new RosterSync($pdo);
$queued = [];
$district = new DistrictApi($pdo, $integrations, $sync, $clever, $google, 'https://qbl.test', function (int $id) use (&$queued) {
    $queued[] = $id;
});
$root = ['id' => 1, 'role' => 'admin', 'name' => 'Root'];
$ivy = ['id' => 2, 'role' => 'teacher', 'name' => 'Ivy IT'];
$sam = ['id' => 3, 'role' => 'student', 'name' => 'Sam'];
$call = fn (array $user, string $method, string $path, array $body = [], array $files = []) => $district->handle($method, $path, $body, $user, $files);

// ------------------------------------------------------- organizations, admins, the switch
same($call($sam, 'GET', 'orgs')[0], 403, 'the panel is for organizations\' admins');
same($call($ivy, 'POST', 'orgs', ['name' => 'Mine'])[0], 403, 'only QBL administrators create organizations');
[$status, $body] = $call($root, 'POST', 'orgs', ['name' => 'Riverside Unified', 'kind' => 'district']);
$org = $body['organization']['id'] ?? 0;
same([$status, $body['organization']['integrations_enabled'] ?? null], [201, false], 'a new organization has integrations off');
$other = $call($root, 'POST', 'orgs', ['name' => 'Hill Valley'])[1]['organization']['id'];
same($call($ivy, 'GET', "orgs/$org")[0], 404, 'someone who is not its admin cannot see it');
[$status, $body] = $call($root, 'POST', "orgs/$org/admins", ['email' => 'IVY@riverside.org']);
same([$status, $body['admin']['id'] ?? null, isset($body['warning'])], [201, 2, false], 'an admin is added by the address of their account');
same($call($root, 'POST', "orgs/$org/admins", ['email' => 'nobody@riverside.org'])[0], 404, 'an address with no account is refused');
same(isset($call($root, 'POST', "orgs/$other/admins", ['email' => 'ola@riverside.org'])[1]['warning']), true, 'an account whose address nobody checked is added with a warning');
same(array_column($district->adminOf(2, 'teacher'), 'name'), ['Riverside Unified'], 'Ivy runs Riverside');
same(count($district->adminOf(1, 'admin')), 2, 'QBL administrators see every organization');
same($call($ivy, 'GET', 'orgs')[1]['organizations'][0]['name'] ?? null, 'Riverside Unified', 'the panel lists her organization');
same($call($ivy, 'GET', "orgs/$other")[0], 404, 'but not another');

[$status, $body] = $call($ivy, 'GET', "orgs/$org");
same([$status, $body['organization']['integrations_enabled'], isset($body['integrations'])], [200, false, false], 'with integrations off, the overview has none');
$message = $call($ivy, 'PUT', "orgs/$org/integrations/saml", ['config' => []]);
same($message[0], 403, 'integrations are off until QBL turns them on');
check(str_contains($message[1]['message'], 'contact QBL'), 'and it says how to ask');
same($call($ivy, 'PATCH', "orgs/$org", ['integrations_enabled' => true])[0], 403, 'an organization admin cannot turn them on');
same($call($ivy, 'PATCH', "orgs/$org", ['license' => ['students' => 99]])[0], 403, 'nor set its license');
same($call($ivy, 'PATCH', "orgs/$org", ['data_retention_days' => 365])[1]['organization']['data_retention_days'] ?? null, 365, 'an organization admin can set data retention');
[$status, $body] = $call($root, 'PATCH', "orgs/$org", ['integrations_enabled' => true, 'license' => ['generator' => true, 'monthly_credits' => 40, 'expires_at' => '2027-06-30']]);
same([$status, $body['organization']['integrations_enabled'], $body['organization']['license']['credit_carryover'] ?? null, count($body['integrations'] ?? [])], [200, true, 40, 3], 'QBL turns integrations on and sets a license');
same($body['addresses']['saml_acs_url'] ?? null, "https://qbl.test/api/sso/$org/saml/acs", 'the overview gives the addresses to configure');
same($call($root, 'PATCH', "orgs/$org", ['license' => ['expires_at' => 'soon']])[0], 422, 'a license\'s end is a date');

// --------------------------------------------------------------------------- SAML settings
$key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
$cert = openssl_csr_sign(openssl_csr_new(['commonName' => 'idp.riverside.test'], $key), null, $key, 365);
openssl_x509_export($cert, $certPem);
$certBody = preg_replace('/-----[^-]+-----|\s/', '', $certPem);
$metadata = '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="https://idp.riverside.test/saml">'
    .'<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"><md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>'.$certBody.'</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>'
    .'<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://idp.riverside.test/post"/>'
    .'<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://idp.riverside.test/sso"/></md:IDPSSODescriptor></md:EntityDescriptor>';
same($call($ivy, 'PUT', "orgs/$org/integrations/saml", ['enabled' => true])[0], 422, 'SAML cannot be turned on without the IdP\'s settings');
[$status, $body] = $call($ivy, 'PUT', "orgs/$org/integrations/saml", ['idp_metadata_xml' => $metadata, 'config' => ['role_attribute' => 'eduPersonAffiliation'], 'enabled' => true]);
same([$status, $body['integration']['config']['idp_entity_id'] ?? null, $body['integration']['config']['idp_sso_url'] ?? null, $body['integration']['config']['idp_x509_cert'] === $certBody],
    [200, 'https://idp.riverside.test/saml', 'https://idp.riverside.test/sso', true], 'pasted IdP metadata fills in the entity ID, the redirect sign-in URL and the certificate');
same($call($ivy, 'PUT', "orgs/$org/integrations/saml", ['config' => ['idp_x509_cert' => 'not a certificate']])[0], 422, 'a certificate is checked');
same($call($ivy, 'PUT', "orgs/$org/integrations/saml", ['config' => ['idp_sso_url' => 'http://idp.riverside.test/sso']])[0], 422, 'the sign-in URL is https');
same($call($ivy, 'PUT', "orgs/$org/integrations/saml", ['config' => ['password' => 'x']])[0], 422, 'unknown settings are refused');
same($call($ivy, 'PUT', "orgs/$org/integrations/saml", ['idp_metadata_xml' => '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'])[0], 422, 'metadata with a DOCTYPE (entities) is refused');
same($call($ivy, 'POST', "orgs/$org/integrations/saml/test")[1]['check']['ok'] ?? null, true, 'the SAML settings check out');
same($call($ivy, 'POST', "orgs/$org/integrations/saml/sync")[0], 422, 'SAML has no roster to sync');

// --------------------------------------------------------------------------- Clever
$cleverDistrict = '5a1b2c3d4e5f60718293a4b5';
same($call($ivy, 'PUT', "orgs/$org/integrations/clever", ['config' => ['district_id' => 'nope!']])[0], 422, 'a Clever district ID is checked');
[$status, $body] = $call($ivy, 'PUT', "orgs/$org/integrations/clever", ['config' => ['district_id' => $cleverDistrict], 'secrets' => ['district_token' => 'tok_district'], 'enabled' => true]);
same([$status, $body['integration']['secrets'] ?? null], [200, ['district_token' => true]], 'the panel learns that the token is set…');
check(! str_contains(json_encode($body), 'tok_district'), '…never the token');
check(! str_contains((string) $pdo->query("SELECT secrets FROM org_integrations WHERE kind = 'clever'")->fetchColumn(), 'tok_district'), 'and it is kept encrypted');
same($integrations->secrets($org, 'clever'), ['district_token' => 'tok_district'], 'the server can read it back');
$pdo->exec('UPDATE organizations SET integrations_enabled_at = CURRENT_TIMESTAMP WHERE id = '.(int) $other);
$pdo->exec("INSERT INTO organization_admins (organization_id, user_id) VALUES ($other, 3)");
same($call($sam, 'PUT', "orgs/$other/integrations/clever", ['config' => ['district_id' => $cleverDistrict]])[0], 409, 'one Clever district, one organization');
same($integrations->cleverDistrict($cleverDistrict)['organization_id'] ?? null, $org, 'Clever sign-ins find their organization by district');

$page = fn (array $items, ?string $next = null) => [200, ['data' => array_map(fn ($d) => ['data' => $d], $items), 'links' => $next ? [['rel' => 'next', 'uri' => $next]] : []]];
$http->routes = [
    ['GET', '#clever\.test/v3\.0/schools#', $page([['id' => 'sch1', 'name' => 'Lincoln Elementary'], ['id' => 'sch2', 'name' => 'Grant Middle']])],
    ['GET', '#role=teacher#', $page([['id' => 't1', 'roles' => ['teacher' => ['school' => 'sch1']], 'name' => ['first' => 'Real', 'last' => 'Name'], 'email' => 'real@riverside.org']])],
    ['GET', '#role=student&limit=1000$#', $page([['id' => 's1', 'roles' => ['student' => ['school' => 'sch1', 'grade' => '4']]], ['id' => 's2', 'roles' => ['student' => ['school' => 'sch1', 'grade' => 'Kindergarten']]]], '/v3.0/users?role=student&limit=1000&starting_after=s2')],
    ['GET', '#starting_after=s2#', $page([['id' => 's3', 'roles' => ['student' => ['school' => 'sch2', 'grade' => 'Ungraded']]]])],
    ['GET', '#v3\.0/sections#', $page([['id' => 'sec1', 'teacher' => 't1', 'teachers' => ['t1'], 'students' => ['s1', 's2']]])],
];
[$status, $body] = $call($ivy, 'POST', "orgs/$org/integrations/clever/sync");
same([$status, $body['run']['status'] ?? null, count($queued)], [202, 'queued', 1], 'a Clever sync is queued');
same($call($ivy, 'POST', "orgs/$org/integrations/clever/sync")[0], 409, 'one at a time');
$run = $district->performSync($queued[0]);
same([$run['status'], $run['summary']['teachers']['created'] ?? null, $run['summary']['students']['created'] ?? null, $run['summary']['schools']['created'] ?? null, $run['summary']['enrollments'] ?? null],
    ['done', 1, 3, 2, 2], 'the sync makes schools, teachers and students (following Clever\'s pages) and enrolls by section');
same($http->sent[0]['headers']['Authorization'] ?? null, 'Bearer tok_district', 'with the district\'s token');
$people = $pdo->query("SELECT external_id, role, grade_level, name, email FROM users WHERE organization_id = $org ORDER BY external_id")->fetchAll(PDO::FETCH_ASSOC);
same(array_column($people, 'grade_level', 'external_id'), ['clever:s1' => '4', 'clever:s2' => 'K', 'clever:s3' => 'UG', 'clever:t1' => null], 'Clever\'s grades become grade levels');
check(! str_contains(json_encode($people), 'Real') && ! str_contains(json_encode($people), 'real@'), 'no names or addresses from Clever are kept');
same((int) $pdo->query("SELECT COUNT(*) FROM teacher_student ts JOIN users t ON t.id = ts.teacher_id WHERE t.external_id = 'clever:t1'")->fetchColumn(), 2, 't1 teaches s1 and s2');
same($pdo->query("SELECT o.name FROM users u JOIN organizations o ON o.id = u.school_id WHERE u.external_id = 'clever:s3'")->fetchColumn(), 'Grant Middle', 'people are put in their schools');

// s3 leaves the district; the next sync deactivates them. A sync that sees nobody deactivates nobody.
$http->routes[3] = ['GET', '#starting_after=s2#', $page([])];
$queued = [];
$call($ivy, 'POST', "orgs/$org/integrations/clever/sync");
$run = $district->performSync($queued[0]);
same([$run['summary']['deactivated'], $run['summary']['students']['updated']], [1, 2], 'someone no longer in Clever is deactivated');
check($pdo->query("SELECT deactivated_at FROM users WHERE external_id = 'clever:s3'")->fetchColumn() !== null, 's3 is inactive, their work kept');
$saved = $http->routes;
$http->routes = [['GET', '#v3\.0/#', $page([])]];
$queued = [];
$call($ivy, 'POST', "orgs/$org/integrations/clever/sync");
$run = $district->performSync($queued[0]);
same([$run['summary']['deactivated'], count($run['summary']['warnings'])], [0, 1], 'an empty answer deactivates nobody, and warns');
$http->routes = [['GET', '#v3\.0/schools#', [401, ['message' => 'invalid token']]]];
$queued = [];
$call($ivy, 'POST', "orgs/$org/integrations/clever/sync");
$run = $district->performSync($queued[0]);
same([$run['status'], str_contains((string) $run['error'], '401')], ['failed', true], 'a sync Clever refuses is recorded as failed, with why');
same($district->performSync($queued[0])['status'], 'failed', 'a run is done once');
same($call($ivy, 'POST', "orgs/$org/integrations/clever/test")[1]['check']['ok'] ?? null, false, 'the connection check says it does not work');
$http->routes = $saved;
same(count($call($ivy, 'GET', "orgs/$org/runs")[1]['runs']), 4, 'the sync history');

// The district token, fetched with QBL's app credentials when none is given.
$http->routes[] = ['GET', '#clever\.test/oauth/tokens\?owner_type=district#', [200, ['data' => [['access_token' => 'tok_from_app', 'owner' => ['id' => $cleverDistrict, 'type' => 'district']]]]]];
same($clever->districtToken($cleverDistrict), 'tok_from_app', 'without a token in the panel, Clever\'s own for the district is used');
same(end($http->sent)['headers']['Authorization'], 'Basic '.base64_encode('qbl-app:app-secret'), 'asked for with the app\'s credentials');

// --------------------------------------------------------------------------- Google
same($call($ivy, 'PUT', "orgs/$org/integrations/google", ['config' => ['domains' => 'gmail.com']])[0], 422, 'gmail.com cannot be claimed');
same($call($ivy, 'PUT', "orgs/$org/integrations/google", ['secrets' => ['service_account_json' => '{"type":"user"}']])[0], 422, 'a service account key is checked');
openssl_pkey_export($key, $keyPem);
$sa = json_encode(['type' => 'service_account', 'client_email' => 'qbl@riverside.iam.gserviceaccount.com', 'private_key' => $keyPem, 'token_uri' => 'https://oauth2.google.test/token', 'project_id' => 'x']);
[$status, $body] = $call($ivy, 'PUT', "orgs/$org/integrations/google", ['config' => ['domains' => 'Riverside.org, students.riverside.org', 'admin_email' => 'Admin@riverside.org'], 'secrets' => ['service_account_json' => $sa], 'enabled' => true]);
same([$status, $body['integration']['config']['domains'] ?? null, $body['integration']['config']['admin_email'] ?? null], [200, ['riverside.org', 'students.riverside.org'], 'admin@riverside.org'], 'domains and the administrator to act as');
same($call($sam, 'PUT', "orgs/$other/integrations/google", ['config' => ['domains' => 'riverside.org']])[0], 409, 'a domain belongs to one organization');
same($integrations->googleDomain('students.riverside.org')['organization_id'] ?? null, $org, 'Google sign-ins find their organization by domain');
$http->routes = [
    ['POST', '#oauth2\.google\.test/token#', function ($url, $body) use ($key) {
        parse_str($body, $form);
        [$h, $c, $sig] = explode('.', $form['assertion']);
        $ok = openssl_verify("$h.$c", base64_decode(strtr($sig, '-_', '+/')), openssl_pkey_get_details($key)['key'], OPENSSL_ALGO_SHA256) === 1;
        $claims = json_decode(base64_decode(strtr($c, '-_', '+/')), true);

        return $ok && $claims['sub'] === 'admin@riverside.org' && str_contains($claims['scope'], 'classroom.rosters.readonly') ? [200, ['access_token' => 'ya29.test']] : [400, ['error' => 'invalid_grant']];
    }],
    ['GET', '#/v1/courses\?courseStates=ACTIVE&pageSize=100$#', [200, ['courses' => [['id' => 'c1', 'ownerId' => '900']], 'nextPageToken' => 'p2']]],
    ['GET', '#/v1/courses\?courseStates=ACTIVE&pageSize=100&pageToken=p2#', [200, ['courses' => [['id' => 'c2', 'ownerId' => '901']]]]],
    ['GET', '#/v1/courses\?courseStates=ACTIVE&pageSize=1$#', [200, ['courses' => [['id' => 'c1']]]]],
    ['GET', '#/v1/courses/c1/teachers#', [200, ['teachers' => [['userId' => '900', 'profile' => ['name' => ['fullName' => 'Real Teacher']]]]]]],
    ['GET', '#/v1/courses/c1/students#', [200, ['students' => [['userId' => '100'], ['userId' => '101']]]]],
    ['GET', '#/v1/courses/c2/teachers#', [200, ['teachers' => [['userId' => '901']]]]],
    ['GET', '#/v1/courses/c2/students#', [200, ['students' => [['userId' => '101'], ['userId' => '900']]]]],
];
same($call($ivy, 'POST', "orgs/$org/integrations/google/test")[1]['check']['ok'] ?? null, true, 'the service account signs in (a signed JWT, acting as the administrator)');
$queued = [];
$call($ivy, 'POST', "orgs/$org/integrations/google/sync");
$run = $district->performSync($queued[0]);
same([$run['status'], $run['summary']['teachers']['created'], $run['summary']['students']['created']], ['done', 2, 2], 'Classroom: course owners and teachers, and students (a teacher who also takes a course stays a teacher)');
same((int) $pdo->query("SELECT COUNT(*) FROM teacher_student ts JOIN users s ON s.id = ts.student_id WHERE s.external_id = 'google:101'")->fetchColumn(), 2, 'a student in two courses has both teachers');

// --------------------------------------------------------------------------- roster files
$csv = function (string $text) {
    $file = tempnam(sys_get_temp_dir(), 'roster');
    file_put_contents($file, $text);

    return ['file' => ['tmp_name' => $file, 'name' => 'roster.csv']];
};
$refusedPii = $call($ivy, 'POST', "orgs/$org/roster", [], $csv("role,external_id,first_name,email\nstudent,S-1,Ann,ann@x.org\n"));
same($refusedPii[0], 422, 'a file with names or addresses is refused…');
check(str_contains($refusedPii[1]['message'], 'first_name, email'), '…naming the columns to remove');
same((int) $pdo->query("SELECT COUNT(*) FROM users WHERE external_id = 'S-1'")->fetchColumn(), 0, '…before anything is read');
same($call($ivy, 'POST', "orgs/$org/roster", [], $csv("role,external_id,nickname\n"))[0], 422, 'unknown columns are refused');
same($call($ivy, 'POST', "orgs/$org/roster", [], $csv("role,external_id\nparent,P-1\n"))[0], 422, 'a role is student or teacher');
same($call($ivy, 'POST', "orgs/$org/roster", [], $csv("role,external_id\nstudent,someone@riverside.org\n"))[0], 422, 'an external_id may not be an email address');
[$status, $body] = $call($ivy, 'POST', "orgs/$org/roster", [], $csv("\xEF\xBB\xBFrole,external_id,school_id,school_name,grade_level,teacher_ids,status\nteacher,T-1,LIN,Lincoln,,,\nstudent,S-1,LIN,Lincoln,3,T-1;T-404,\nstudent,S-2,,,,T-1,inactive\n\n"));
same([$status, $body['run']['kind'], $body['run']['status'], $body['run']['summary']['students']['created'] ?? null], [201, 'upload', 'done', 2], 'a roster file is applied at once');
same($pdo->query("SELECT grade_level FROM users WHERE external_id = 'S-1'")->fetchColumn(), '3', 'with grade levels');
check($pdo->query("SELECT deactivated_at FROM users WHERE external_id = 'S-2'")->fetchColumn() !== null, 'and status');
same((int) $pdo->query("SELECT COUNT(*) FROM teacher_student ts JOIN users s ON s.id = ts.student_id WHERE s.external_id = 'S-1'")->fetchColumn(), 1, 'a teacher not in the roster is left out of the enrollments');
same(array_column(RosterFile::read($csv("role,external_id\nteacher,T-9\n")['file']['tmp_name'])['teachers'], 'external_id'), ['T-9'], 'only role and external_id are needed');

// --------------------------------------------------------------------------- API clients
[$status, $body] = $call($ivy, 'POST', "orgs/$org/clients", ['name' => 'SIS nightly', 'scopes' => ['roster:read', 'roster:write']]);
$clientId = $body['client']['client_id'] ?? '';
same([$status, str_starts_with($body['client']['client_secret'] ?? '', 'qbls_')], [201, true], 'an API client is made; its secret shown once');
same(count($call($ivy, 'GET', "orgs/$org")[1]['clients']), 1, 'and listed, without the secret');
check(! str_contains(json_encode($call($ivy, 'GET', "orgs/$org")[1]), $body['client']['client_secret']), 'the secret is not in the overview');
same($call($ivy, 'POST', "orgs/$org/clients", ['name' => 'x', 'scopes' => ['everything']])[0], 422, 'unknown scopes are refused');
check(str_starts_with($call($ivy, 'POST', "orgs/$org/clients/$clientId/rotate")[1]['client']['client_secret'] ?? '', 'qbls_'), 'a new secret');
same($call($sam, 'DELETE', "orgs/$other/clients/$clientId")[0], 404, 'another organization cannot revoke it');
same($call($ivy, 'DELETE', "orgs/$org/clients/$clientId")[0], 204, 'revoked');
check($call($ivy, 'GET', "orgs/$org")[1]['clients'][0]['revoked_at'] !== null, 'and shown as revoked');

// ------------------------------------------------------------ signing in through the district
$sso = new Sso($pdo, 'app-key');
$id = $sso->resolve($org, 'saml:abc', 'teacher', true);
same($pdo->query("SELECT role || ' ' || organization_id || ' ' || (email LIKE '%.invalid') FROM users WHERE id = $id")->fetchColumn(), "teacher $org 1", 'a first SAML sign-in makes a pseudonymous account in the organization');
same($sso->resolve($org, 'saml:abc', null, false), $id, 'the next finds it');
same($sso->resolve($org, 'saml:abc', 'student', false), $id, 'the identity provider\'s role is followed…');
same($pdo->query("SELECT role FROM users WHERE id = $id")->fetchColumn(), 'student', '…when it changes');
refused(fn () => $sso->resolve($org, 'saml:new', null, false), 403, 'with account creation off, a stranger is turned away');
refused(fn () => $sso->resolve($org, 'clever:s3', null, true), 403, 'a deactivated account cannot sign in');
$subject = $sso->samlSubject('Ann@Riverside.org', [], '');
check(str_starts_with($subject, 'saml:') && ! str_contains($subject, 'riverside') && $subject === $sso->samlSubject('ann@riverside.org ', [], ''), 'an email NameID is kept only as a keyed hash, the same each time');
same($sso->samlSubject('ann@riverside.org', ['employeeNumber' => ['S-1']], 'employeeNumber'), 'S-1', 'an id attribute matches people uploaded by file or API');
refused(fn () => $sso->samlSubject('x', [], 'employeeNumber'), 422, 'a missing id attribute is an error');
same([Sso::samlRole(['eduPersonAffiliation' => ['member', 'Faculty']], 'eduPersonAffiliation', ['faculty']), Sso::samlRole(['eduPersonAffiliation' => ['student']], 'eduPersonAffiliation', ['faculty']), Sso::samlRole([], 'eduPersonAffiliation', ['faculty'])],
    ['teacher', 'student', null], 'roles from an affiliation attribute');
same([Sso::cleverRole('student'), Sso::cleverRole('district_admin')], ['student', 'teacher'], 'Clever students are students; staff are teachers');
same([CleverClient::grade('11'), CleverClient::grade('PreKindergarten'), CleverClient::grade('Other')], ['11', 'PK', null], 'Clever grade names');

// Someone made a student at their first Google sign-in, before the sync said they teach.
$early = $sso->resolve($org, 'google:902', null, true);
$sync->apply($org, ['teachers' => [['external_id' => 'google:902']], 'students' => []]);
same($pdo->query("SELECT role FROM users WHERE id = $early")->fetchColumn(), 'teacher', 'a sync gives an early sign-in its real role');

// Turning integrations off turns every integration off.
$call($root, 'PATCH', "orgs/$org", ['integrations_enabled' => false]);
same([(int) $pdo->query("SELECT COUNT(*) FROM org_integrations WHERE organization_id = $org AND enabled = 1")->fetchColumn(), $integrations->googleDomain('riverside.org')], [0, null], 'switching the feature off stops every integration');
same($call($ivy, 'DELETE', "orgs/$org/admins/2")[0], 409, 'the last admin cannot remove themselves');
same($call($root, 'DELETE', "orgs/$org")[0], 409, 'an organization with people in it is not deleted');

echo $failures ? "district: $failures of $checks checks FAILED\n" : "district: all $checks checks passed\n";
exit($failures ? 1 : 0);
