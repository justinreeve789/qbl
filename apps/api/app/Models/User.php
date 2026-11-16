<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password', 'role', 'avatar_media_id'];

    protected $hidden = ['password', 'remember_token', 'google_id'];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    /** The shape the client and game server expect. See docs/docs/api.md. */
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
