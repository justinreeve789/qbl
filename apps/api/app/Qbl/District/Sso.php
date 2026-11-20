<?php

namespace App\Qbl\District;

use App\Qbl\Api\ApiError;
use App\Qbl\Api\Clients;
use App\Qbl\Api\Privacy;
use App\Qbl\Api\Roster;
use App\Qbl\Api\Sql;
use App\Qbl\StoreError;
use PDO;

/**
 * Who someone signing in through their district is, in QBL: the organization's account with that
 * external_id, made on the spot when the integration allows it. Like rostered accounts, these
 * keep no name or address: a pseudonym to play under, and the district's id for the person.
 */
class Sso
{
    use Sql;

    public function __construct(PDO $pdo, private string $secret)
    {
        $this->pdo = $pdo;
    }

    /**
     * @param  string|null  $role  student or teacher, when the identity provider says which
     * @return int the account's id
     */
    public function resolve(int $orgId, string $externalId, ?string $role, bool $create): int
    {
        $user = $this->one('SELECT id, role, deactivated_at FROM users WHERE organization_id = ? AND external_id = ?', [$orgId, $externalId]);
        if ($user) {
            if ($user['deactivated_at'] !== null) {
                throw new StoreError(403, 'Your school has turned this account off. Ask your teacher about it.');
            }
            // The district's own system says what someone is; never an administrator's account, though.
            if ($role !== null && $user['role'] !== $role && in_array($user['role'], Roster::ROLES, true)) {
                $this->run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', [$role, self::now(), $user['id']]);
            }

            return (int) $user['id'];
        }
        if (! $create) {
            throw new StoreError(403, 'There is no account for you here yet. Ask your school to add you.');
        }
        try {
            return (int) (new Roster($this->pdo, new Clients($this->pdo)))->create($orgId, $role ?? 'student', ['external_id' => $externalId])['id'];
        } catch (ApiError $e) {
            throw new StoreError(422, $e->getMessage());
        }
    }

    /**
     * The external_id for a SAML sign-in. With `$idAttribute` set (an attribute carrying the
     * district's own id for the person, such as employeeNumber or a student number), that id, so
     * accounts match those uploaded by the API or a roster file. Otherwise the NameID, which is
     * often an email address: it is kept only as a keyed hash ("saml:…"), never as it is.
     */
    public function samlSubject(string $nameId, array $attributes, string $idAttribute): string
    {
        if ($idAttribute !== '') {
            $value = trim((string) (($attributes[$idAttribute] ?? [])[0] ?? ''));
            if ($value === '') {
                throw new StoreError(422, "The identity provider did not send the attribute \"$idAttribute\".");
            }
            if (! Privacy::looksLikeEmail($value) && preg_match('/^[A-Za-z0-9._:\-]{1,64}$/', $value)) {
                return $value;
            }
            $nameId = $value;
        }
        if (trim($nameId) === '') {
            throw new StoreError(422, 'The identity provider did not say who signed in (no NameID).');
        }

        return 'saml:'.substr(hash_hmac('sha256', strtolower(trim($nameId)), $this->secret), 0, 40);
    }

    /** student or teacher from a role attribute (eduPersonAffiliation, say), or null when it is not sent. */
    public static function samlRole(array $attributes, string $roleAttribute, array $teacherValues): ?string
    {
        if ($roleAttribute === '' || ! isset($attributes[$roleAttribute])) {
            return null;
        }
        $values = array_map(fn ($v) => strtolower(trim((string) $v)), (array) $attributes[$roleAttribute]);

        return array_intersect($values, $teacherValues) ? 'teacher' : 'student';
    }

    /** Clever's kinds of user as QBL roles: students are students; teachers and school or district staff are teachers. */
    public static function cleverRole(string $type): string
    {
        return $type === 'student' ? 'student' : 'teacher';
    }
}
