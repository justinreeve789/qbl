<?php

namespace App\Models;

use App\Qbl\Library\AssetLibrary;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One file of a library asset, in a role (sheet, portrait, image, sound, preview...). */
class LibraryAssetFile extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['params' => 'array', 'width' => 'integer', 'height' => 'integer', 'bytes' => 'integer'];
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(LibraryAsset::class, 'library_asset_id');
    }

    /** Where the file is on this server, or null if it is missing. */
    public function localPath(): ?string
    {
        return app(AssetLibrary::class)->filePath(['path' => $this->path]);
    }
}
