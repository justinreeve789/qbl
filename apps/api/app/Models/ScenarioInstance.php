<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ScenarioInstance extends Model
{
    protected $fillable = ['scenario_id', 'group_key', 'data'];

    protected function casts(): array
    {
        return ['data' => 'array'];
    }
}
