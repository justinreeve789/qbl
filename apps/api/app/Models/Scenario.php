<?php

namespace App\Models;

use App\Qbl\Avatars;
use App\Qbl\ScenarioStore;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Eloquent\Model;

class Scenario extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'document' => 'array',
            'settings' => 'array',
            'require_login' => 'boolean',
            'published_at' => 'datetime',
        ];
    }

    /** Generate the scenario JSON from the tables and make it the version players get. */
    public function publish(): array
    {
        $document = app(ScenarioStore::class)->publish($this->id);
        $this->refresh();

        return $document;
    }

    /** Find a published scenario by its 16-letter code, or by shortname. */
    public static function findPublished(string $key): ?self
    {
        return static::query()
            ->whereNotNull('published_at')
            ->where(fn ($q) => $q->where('code', strtolower($key))->orWhere('shortname', $key))
            // A code always wins over a shortname that happens to be spelled the same.
            ->orderByRaw('(`code` = ?) desc', [strtolower($key)])
            ->first();
    }

    /** The published document as served to the runtime. */
    public function toDocument(): array
    {
        // The code comes from the row, so documents published before codes existed carry it too.
        // The avatars are the platform's, the same in every scenario, so they are added here rather than published.
        return Avatars::inject(DB::connection()->getPdo(), array_merge($this->document, ['code' => $this->code]));
    }
}
