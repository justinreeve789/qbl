<?php

namespace App\Models;

use App\Qbl\Library\AssetLibrary;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One asset of the library: a ready-made character, vehicle, item, picture or sound.
 *
 *   LibraryAsset::active()->ofKind('vehicle')->get();
 *   LibraryAsset::search('horse')->visibleTo($user)->get();
 *   LibraryAsset::resolve('red-squirrel')->addTo($scenario);          // copies its files, makes the character
 *   LibraryAsset::resolve('bay-horse')->file('sheet')?->url;
 *   LibraryAsset::keep($scenario, 'characters', $characterId, ['category' => 'Robots']);
 *
 * Writing goes through App\Qbl\Library\AssetLibrary (which checks definitions, stores files and is
 * shared with the dev server and tests); these models are for reading and for convenience.
 */
class LibraryAsset extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'tags' => 'array',
            'definition' => 'array',
            'credit' => 'array',
            'active' => 'boolean',
            'sequence' => 'integer',
        ];
    }

    public function files(): HasMany
    {
        return $this->hasMany(LibraryAssetFile::class);
    }

    /** The file in a role (sheet, portrait, image, sound, preview...), if it has one. */
    public function file(string $role): ?LibraryAssetFile
    {
        return $this->files->firstWhere('role', $role);
    }

    /** An asset by id or slug, or a 404. */
    public static function resolve(int|string $asset): self
    {
        return is_int($asset) || ctype_digit((string) $asset) ? static::findOrFail((int) $asset) : static::where('slug', $asset)->firstOrFail();
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('active', true);
    }

    /** One kind, or several: ofKind('vehicle'), ofKind(['character', 'vehicle']). */
    public function scopeOfKind(Builder $query, string|array $kind): Builder
    {
        return $query->whereIn('kind', (array) $kind);
    }

    public function scopeInCategory(Builder $query, string $category): Builder
    {
        return $query->where('category', $category);
    }

    /** Every word in the name, slug, category, description or tags. */
    public function scopeSearch(Builder $query, ?string $words): Builder
    {
        foreach (preg_split('/\s+/', trim((string) $words), -1, PREG_SPLIT_NO_EMPTY) as $word) {
            $like = '%'.str_replace(['%', '_'], ['\\%', '\\_'], $word).'%';
            $query->where(fn (Builder $q) => $q->where('name', 'like', $like)->orWhere('slug', 'like', $like)->orWhere('category', 'like', $like)
                ->orWhere('description', 'like', $like)->orWhere('tags', 'like', $like));
        }

        return $query;
    }

    /** What a user may see: the platform's assets and their organization's (everything, for an admin). */
    public function scopeVisibleTo(Builder $query, ?User $user): Builder
    {
        if ($user?->role === 'admin') {
            return $query;
        }

        return $query->where(fn (Builder $q) => $q->whereNull('organization_id')->when($user?->organization_id, fn ($q) => $q->orWhere('organization_id', $user->organization_id)));
    }

    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('sequence')->orderBy('id');
    }

    /**
     * Add it to a scenario: its files become the scenario's media (once), and the character or item it
     * describes is made. Returns ['asset', 'created' => ['table', 'row'], 'media' => [...], 'copied' => [ids]].
     */
    public function addTo(Scenario|int $scenario, array $options = []): array
    {
        return app(AssetLibrary::class)->addToScenario(app(\App\Qbl\ScenarioStore::class), $scenario instanceof Scenario ? $scenario->id : $scenario, $this->id, $options);
    }

    /** Keep a scenario's character, item or media row in the library as a new asset. */
    public static function keep(Scenario|int $scenario, string $table, int $rowId, array $attrs = []): self
    {
        $asset = app(AssetLibrary::class)->capture(app(\App\Qbl\ScenarioStore::class), $scenario instanceof Scenario ? $scenario->id : $scenario, $table, $rowId, $attrs);

        return static::findOrFail($asset['id']);
    }

    /** Give it a file in a role (copied into the media directory); params as AssetLibrary::putFile takes them. */
    public function attach(string $role, string $path, array $params = []): self
    {
        app(AssetLibrary::class)->putFile($this->id, $role, $path, $params);

        return $this->fresh('files');
    }

    /** The asset as the library API gives it (definition, credit, files with URLs). */
    public function toLibrary(): array
    {
        return app(AssetLibrary::class)->get($this->id);
    }
}
