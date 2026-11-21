<?php

namespace App\Qbl;

/**
 * Who may do what, by role. One place, so the editor API, the library, the classes, playing and
 * the commands agree (packages/shared/src/roles.ts says the same for the browser).
 *
 *   student         plays
 *   teacher         plays, builds their own scenarios, runs classes
 *   content_admin   a teacher who also edits every scenario (shared samples, curricular missions,
 *                   everyone's) and manages the asset library; no billing, district or account powers
 *   admin           everything
 *   guest           plays, for a while, without an account
 */
final class Roles
{
    public const STUDENT = 'student';

    public const TEACHER = 'teacher';

    public const CONTENT_ADMIN = 'content_admin';

    public const ADMIN = 'admin';

    public const GUEST = 'guest';

    /** The roles an account can be given (guests are made, not given). */
    public const ASSIGNABLE = [self::STUDENT, self::TEACHER, self::CONTENT_ADMIN, self::ADMIN];

    /** May use the editor and the classes: teachers, content admins and admins. */
    public static function isStaff(?string $role): bool
    {
        return in_array($role, [self::TEACHER, self::CONTENT_ADMIN, self::ADMIN], true);
    }

    /** May open and change every scenario, curricular ones included, and set a mission's tier or a shared sample's code. */
    public static function editsAllScenarios(?string $role): bool
    {
        return in_array($role, [self::CONTENT_ADMIN, self::ADMIN], true);
    }

    /** May add, change and remove assets of the library, and see every organization's. */
    public static function managesLibrary(?string $role): bool
    {
        return in_array($role, [self::CONTENT_ADMIN, self::ADMIN], true);
    }

    /** May run the platform: billing, districts, plans, accounts (who is a content admin). */
    public static function isAdmin(?string $role): bool
    {
        return $role === self::ADMIN;
    }

    /** As people read it. */
    public static function label(?string $role): string
    {
        return match ($role) {
            self::ADMIN => 'Administrator',
            self::CONTENT_ADMIN => 'Content admin',
            self::TEACHER => 'Teacher',
            self::GUEST => 'Guest',
            default => 'Student',
        };
    }
}
