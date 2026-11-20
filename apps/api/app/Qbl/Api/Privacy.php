<?php

namespace App\Qbl\Api;

/**
 * Keeping personally identifiable information out of QBL.
 *
 * Accounts made through the API are known only by the organization's own opaque id
 * (`external_id`) and a pseudonym that QBL makes up ("Brave Otter 417"). QBL is never told a
 * student's name, email, birth date, address or phone number, so it cannot leak them, and the
 * organization keeps the only key from pseudonym to child. This is what lets a school use QBL
 * under FERPA's "school official" exception and COPPA's school-authorization route without QBL
 * holding records that identify a child (see docs: api-v1/privacy).
 *
 * Fields that would carry such information are refused outright, so a client that sends them by
 * mistake finds out at once rather than having them silently kept.
 */
final class Privacy
{
    /** Keys refused anywhere in a request about people, whatever their value. */
    public const PII_FIELDS = [
        'name', 'first_name', 'last_name', 'middle_name', 'full_name', 'given_name', 'family_name', 'preferred_name',
        'email', 'email_address', 'username', 'login', 'password',
        'birthdate', 'birth_date', 'date_of_birth', 'dob', 'age',
        'address', 'street', 'city', 'postal_code', 'zip', 'zip_code',
        'phone', 'phone_number', 'mobile', 'ssn', 'social_security_number', 'state_id', 'parent_name', 'guardian', 'guardian_email',
        'gender', 'sex', 'race', 'ethnicity', 'photo', 'photo_url',
    ];

    private const ADJECTIVES = [
        'Brave', 'Bright', 'Calm', 'Clever', 'Cosmic', 'Curious', 'Daring', 'Eager', 'Gentle', 'Happy', 'Jolly', 'Keen', 'Kind', 'Lively',
        'Lucky', 'Merry', 'Mighty', 'Nimble', 'Noble', 'Plucky', 'Quick', 'Quiet', 'Rapid', 'Sunny', 'Swift', 'Steady', 'Witty', 'Zesty',
    ];

    private const NOUNS = [
        'Otter', 'Falcon', 'Comet', 'Panda', 'Lynx', 'Heron', 'Koala', 'Badger', 'Gecko', 'Puffin', 'Orca', 'Ibis', 'Marten', 'Quokka',
        'Nebula', 'Meteor', 'Pulsar', 'Rover', 'Beacon', 'Pebble', 'Maple', 'Cedar', 'Willow', 'Fern', 'Tiger', 'Wombat', 'Yak', 'Zebra',
    ];

    /** A made-up name to play under: two words and a number, never a real person's. */
    public static function pseudonym(): string
    {
        return self::ADJECTIVES[random_int(0, count(self::ADJECTIVES) - 1)].' '.self::NOUNS[random_int(0, count(self::NOUNS) - 1)].' '.random_int(100, 999);
    }

    /** The address an account made through the API has: unique, and unable to receive mail (RFC 2606 `.invalid`). */
    public static function placeholderEmail(): string
    {
        return 'u-'.bin2hex(random_bytes(12)).'@roster.qbl.invalid';
    }

    public static function isPlaceholderEmail(?string $email): bool
    {
        return $email !== null && (str_ends_with($email, '.invalid'));
    }

    /** Refuse a request that carries any field that would identify a person. */
    public static function refusePii(array $body): void
    {
        $found = array_values(array_intersect(array_map('strtolower', array_keys($body)), self::PII_FIELDS));
        if ($found) {
            throw new ApiError(422, 'pii_not_accepted',
                'QBL does not store personally identifiable information. Remove: '.implode(', ', $found).'. Identify people by your own opaque external_id instead.',
                array_fill_keys($found, 'Not accepted: personally identifiable.'));
        }
    }

    /**
     * The organization's id for someone, checked: letters, digits and `._:-`, at most 64, and not an
     * email address. We recommend a keyed hash of the SIS id, so that even this is not the SIS id.
     */
    public static function externalId(mixed $value, string $field = 'external_id'): string
    {
        $value = is_scalar($value) ? trim((string) $value) : '';
        if (self::looksLikeEmail($value)) {
            throw new ApiError(422, 'pii_not_accepted', "$field looks like an email address. Use an opaque id.", [$field => 'Looks like an email address.']);
        }
        if ($value === '' || strlen($value) > 64 || ! preg_match('/^[A-Za-z0-9._:\-]+$/', $value)) {
            throw ApiError::invalid($field, "$field must be 1 to 64 letters, digits, dots, colons, underscores or hyphens.");
        }

        return $value;
    }

    /**
     * Free text an organization gives us (a display name for a teacher, a team's name, an
     * assignment's note), checked for the most common identifying shapes.
     */
    public static function text(mixed $value, string $field, int $max): ?string
    {
        if ($value === null) {
            return null;
        }
        $value = trim(strip_tags(is_scalar($value) ? (string) $value : ''));
        if ($value === '') {
            return null;
        }
        if (mb_strlen($value) > $max) {
            throw ApiError::invalid($field, "$field may be at most $max characters.");
        }
        if (self::looksLikeEmail($value) || self::looksLikePhone($value)) {
            throw new ApiError(422, 'pii_not_accepted', "$field looks like it contains an email address or phone number.", [$field => 'Looks like contact details.']);
        }

        return $value;
    }

    public static function looksLikeEmail(string $value): bool
    {
        return (bool) preg_match('/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/', $value);
    }

    /** Seven or more digits in a row, allowing the usual separators, or a US social security number. */
    public static function looksLikePhone(string $value): bool
    {
        return (bool) preg_match('/(?:\+?\d[\s().\-]*){7,}/', $value) || (bool) preg_match('/\b\d{3}-\d{2}-\d{4}\b/', $value);
    }

    /** "K", "1" … "12", "PK", "TK", "UG" (ungraded), "PS" (post-secondary) or "AD" (adult); null for none. */
    public static function gradeLevel(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        $grade = strtoupper(ltrim(trim((string) $value), '0')) ?: 'K';
        if (! in_array($grade, ['PK', 'TK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG', 'PS', 'AD'], true)) {
            throw ApiError::invalid('grade_level', 'grade_level must be one of PK, TK, K, 1 to 12, UG, PS or AD.');
        }

        return $grade;
    }
}
