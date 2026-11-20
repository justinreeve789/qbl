<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    const ROLE_ADMIN = 'admin';
    const ROLE_STUDENT = 'student';
    const ROLE_TEACHER = 'teacher';

    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password', 'role', 'avatar_media_id'];

    protected $hidden = ['password', 'remember_token', 'google_id'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'self_registered_at' => 'datetime',
            'deactivated_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * Roles are compared exactly everywhere (the API, the editor, the game), so a role typed by
     * hand as "Teacher" or "teacher " is read, and stored, as "teacher".
     */
    protected function role(): Attribute
    {
        $tidy = fn ($value) => $value === null ? null : strtolower(trim((string) $value));

        return Attribute::make(get: $tidy, set: $tidy);
    }

    /**
     * Made on the sign-in screen with a typed address that nobody has checked yet. Google
     * signing in with that address is the check (GoogleAuthController).
     */
    public function hasUnprovenAddress(): bool
    {
        return $this->self_registered_at !== null && $this->email_verified_at === null && $this->google_id === null;
    }

    /** Made by a school or district through the public API (/api/v1): no password, a pseudonym, a placeholder address. */
    public function isRostered(): bool
    {
        return $this->organization_id !== null;
    }

    /**
     * A rostered student plays under the pseudonym their school's account was given ("Brave Otter
     * 417"), so that no real name is kept: only the school's system may change it
     * (regenerate_display_name). Everyone else chooses the name over their character.
     */
    public function nameIsLocked(): bool
    {
        return $this->isRostered() && $this->role === self::ROLE_STUDENT;
    }

    /** An address mail can be sent to: not a guest's or a rostered account's made-up one. */
    public function hasRealEmail(): bool
    {
        return $this->role !== 'guest' && $this->email && ! str_ends_with((string) $this->email, '.invalid');
    }

    /**
     * Whether this account signs in with a password that can be changed, or reset by email.
     * Accounts that have only ever used Google have none (Google looks after that), and
     * rostered accounts sign in with their school's launch links.
     */
    public function hasPassword(): bool
    {
        return $this->role !== 'guest' && $this->password !== null && $this->password !== '' && $this->deactivated_at === null;
    }

    /** The shape the client and game server expect. See docs/src/content/docs/developers/api.md. */
    public function toQbl(): array
    {
        return array_filter([
            'id' => $this->id,
            'name' => $this->name,
            'role' => $this->role,
            'avatar_media_id' => $this->avatar_media_id,
        ], fn ($v) => $v !== null);
    }
}
