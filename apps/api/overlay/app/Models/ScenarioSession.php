<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ScenarioSession extends Model
{
    protected $fillable = ['scenario_id', 'user_id', 'data'];

    protected function casts(): array
    {
        return ['data' => 'array'];
    }
}
