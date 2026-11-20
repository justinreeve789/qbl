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
