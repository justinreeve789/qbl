<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The asset library: ready-made characters, vehicles, items, pictures and sounds that any scenario
 * can add (App\Qbl\Library\AssetLibrary, App\Models\LibraryAsset). Adding one copies its files into
 * the scenario's media, so nothing here is referenced by a scenario afterwards.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('library_assets')) {
            Schema::create('library_assets', function (Blueprint $table) {
                $table->id();
                // How it is found and referred to: red-squirrel, red-sports-car.
                $table->string('slug', 80)->unique();
                // character, vehicle, item, picture or sound (AssetLibrary::KINDS).
                $table->string('kind', 24)->index();
                $table->string('name', 120);
                // How the library groups it: Squirrels, Cars, Horses...
                $table->string('category', 80)->nullable()->index();
                $table->text('description')->nullable();
                $table->json('tags')->nullable();
                // pixel, cartoon...
                $table->string('style', 24)->nullable();
                // What adding it makes, with files named by role (see AssetLibrary).
                $table->json('definition')->nullable();
                // {title, author, license, url, note}: kept on every media row it adds.
                $table->json('credit')->nullable();
                // Null: everyone's. Otherwise only that organization's teachers see it.
                $table->foreignId('organization_id')->nullable()->index();
                $table->foreignId('created_by')->nullable();
                // pack (shipped with QuestLab), upload, scenario (kept from a scenario).
                $table->string('source', 24)->default('upload');
                $table->boolean('active')->default(true);
                $table->integer('sequence')->default(0);
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('library_asset_files')) {
            Schema::create('library_asset_files', function (Blueprint $table) {
                $table->id();
                $table->foreignId('library_asset_id')->constrained('library_assets')->cascadeOnDelete();
                // sheet, portrait, image, sound, preview...: what the definition calls it.
                $table->string('role', 32);
                $table->string('type', 16)->default('image');
                // pack:<path in scenarios/assets/library> or media:library/<asset id>/<name>.
                $table->string('path', 1024);
                $table->string('url', 2048);
                $table->string('filename', 200)->nullable();
                $table->unsignedInteger('width')->nullable();
                $table->unsignedInteger('height')->nullable();
                $table->unsignedBigInteger('bytes')->nullable();
                // What the file carries into a scenario's media: sheet {columns, rows, count}, animations, scale_x/scale_y.
                $table->json('params')->nullable();
                $table->timestamps();
                $table->unique(['library_asset_id', 'role']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('library_asset_files');
        Schema::dropIfExists('library_assets');
    }
};
