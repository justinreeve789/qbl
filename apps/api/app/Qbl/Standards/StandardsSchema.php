<?php

namespace App\Qbl\Standards;

use PDO;

/**
 * The standard_* tables for SQLite (the plain-PHP dev server and tests that don't boot Laravel).
 * Generated from migrations 2026_11_27_200000_create_standards_library_tables and
 * 2026_11_28_000000_merge_curriculum_standards_into_library; regenerate when they change.
 */
final class StandardsSchema
{
    public static function sqliteSchema(): string
    {
        return <<<'SQL'
CREATE TABLE IF NOT EXISTS "standard_sources" ("id" integer primary key autoincrement not null, "slug" varchar not null, "name" varchar not null, "kind" varchar not null, "base_url" varchar, "attribution" text, "created_at" datetime, "updated_at" datetime);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_sources_slug_unique" on "standard_sources" ("slug");
CREATE TABLE IF NOT EXISTS "standard_licenses" ("id" integer primary key autoincrement not null, "hash" varchar not null, "title" varchar not null, "url" varchar, "rights_holder" varchar, "attribution" text, "created_at" datetime, "updated_at" datetime);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_licenses_hash_unique" on "standard_licenses" ("hash");
CREATE TABLE IF NOT EXISTS "standard_jurisdictions" ("id" integer primary key autoincrement not null, "code" varchar not null, "name" varchar not null, "kind" varchar not null, "parent_id" integer, "country" varchar, "level_system" varchar, "organization_id" integer, "external_ids" text, "created_at" datetime, "updated_at" datetime, foreign key("parent_id") references "standard_jurisdictions"("id") on delete set null);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_jurisdictions_code_unique" on "standard_jurisdictions" ("code");
CREATE INDEX IF NOT EXISTS "standard_jurisdictions_organization_id_index" on "standard_jurisdictions" ("organization_id");
CREATE TABLE IF NOT EXISTS "standard_subjects" ("id" integer primary key autoincrement not null, "slug" varchar not null, "name" varchar not null, "parent_id" integer, "sort" integer not null default '0', foreign key("parent_id") references "standard_subjects"("id") on delete set null);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_subjects_slug_unique" on "standard_subjects" ("slug");
CREATE TABLE IF NOT EXISTS "standard_education_levels" ("id" integer primary key autoincrement not null, "system" varchar not null, "code" varchar not null, "label" varchar not null, "is_band" tinyint(1) not null default '0', "age_from" integer, "age_to" integer, "grade_from" integer, "grade_to" integer, "sort" integer not null default '0');
CREATE UNIQUE INDEX IF NOT EXISTS "standard_education_levels_system_code_unique" on "standard_education_levels" ("system", "code");
CREATE INDEX IF NOT EXISTS "standard_education_levels_grade_from_grade_to_index" on "standard_education_levels" ("grade_from", "grade_to");
CREATE TABLE IF NOT EXISTS "standard_frameworks" ("id" integer primary key autoincrement not null, "slug" varchar not null, "jurisdiction_id" integer not null, "title" varchar not null, "subject_id" integer, "subject_label" varchar, "language" varchar not null default 'en', "publisher" varchar, "description" text, "organization_id" integer, "current_document_id" integer, "created_at" datetime, "updated_at" datetime, foreign key("jurisdiction_id") references "standard_jurisdictions"("id") on delete cascade, foreign key("subject_id") references "standard_subjects"("id") on delete set null);
CREATE INDEX IF NOT EXISTS "standard_frameworks_jurisdiction_id_subject_id_index" on "standard_frameworks" ("jurisdiction_id", "subject_id");
CREATE UNIQUE INDEX IF NOT EXISTS "standard_frameworks_slug_unique" on "standard_frameworks" ("slug");
CREATE INDEX IF NOT EXISTS "standard_frameworks_organization_id_index" on "standard_frameworks" ("organization_id");
CREATE INDEX IF NOT EXISTS "standard_frameworks_current_document_id_index" on "standard_frameworks" ("current_document_id");
CREATE TABLE IF NOT EXISTS "standard_import_runs" ("id" integer primary key autoincrement not null, "source_id" integer not null, "scope" varchar, "status" varchar not null default 'running', "options" text, "stats" text, "error" text, "user_id" integer, "started_at" datetime, "finished_at" datetime, foreign key("source_id") references "standard_sources"("id"));
CREATE TABLE IF NOT EXISTS "standard_documents" ("id" integer primary key autoincrement not null, "uuid" varchar not null, "framework_id" integer not null, "source_id" integer not null, "source_key" varchar not null, "title" varchar not null, "version_label" varchar, "published_year" integer, "adopted_on" date, "effective_from" date, "effective_until" date, "status" varchar not null default 'current', "status_locked" tinyint(1) not null default '0', "language" varchar not null default 'en', "publisher" varchar, "source_url" varchar, "license_id" integer, "supersedes_id" integer, "translation_of_id" integer, "revision" integer not null default '0', "content_hash" varchar, "item_count" integer not null default '0', "last_import_run_id" integer, "last_imported_at" datetime, "meta" text, "created_at" datetime, "updated_at" datetime, foreign key("framework_id") references "standard_frameworks"("id") on delete cascade, foreign key("source_id") references "standard_sources"("id"), foreign key("license_id") references "standard_licenses"("id") on delete set null, foreign key("supersedes_id") references "standard_documents"("id") on delete set null, foreign key("translation_of_id") references "standard_documents"("id") on delete set null, foreign key("last_import_run_id") references "standard_import_runs"("id") on delete set null);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_documents_source_id_source_key_unique" on "standard_documents" ("source_id", "source_key");
CREATE INDEX IF NOT EXISTS "standard_documents_framework_id_status_index" on "standard_documents" ("framework_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "standard_documents_uuid_unique" on "standard_documents" ("uuid");
CREATE TABLE IF NOT EXISTS "standard_document_revisions" ("id" integer primary key autoincrement not null, "document_id" integer not null, "revision" integer not null, "import_run_id" integer, "content_hash" varchar not null, "item_count" integer not null default '0', "added" integer not null default '0', "changed" integer not null default '0', "retired" integer not null default '0', "restored" integer not null default '0', "note" varchar, "created_at" datetime, foreign key("document_id") references "standard_documents"("id") on delete cascade, foreign key("import_run_id") references "standard_import_runs"("id") on delete set null);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_document_revisions_document_id_revision_unique" on "standard_document_revisions" ("document_id", "revision");
CREATE TABLE IF NOT EXISTS "standard_items" ("id" integer primary key autoincrement not null, "uuid" varchar not null, "document_id" integer not null, "parent_id" integer, "source_key" varchar not null, "lineage" varchar not null default '/', "depth" integer not null default '0', "position" integer not null default '0', "code" varchar, "alt_code" varchar, "list_label" varchar, "type_label" varchar, "item_type" varchar not null default 'standard', "statement" text not null, "abbreviated" varchar, "notes" text, "is_statutory" tinyint(1), "language" varchar, "uri" varchar, "asn_id" varchar, "status" varchar not null default 'active', "first_revision" integer not null default '1', "last_revision" integer not null default '1', "retired_at" datetime, "content_hash" varchar not null, "extra" text, "created_at" datetime, "updated_at" datetime, foreign key("document_id") references "standard_documents"("id") on delete cascade, foreign key("parent_id") references "standard_items"("id") on delete set null);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_items_document_id_source_key_unique" on "standard_items" ("document_id", "source_key");
CREATE INDEX IF NOT EXISTS "standard_items_document_id_status_position_index" on "standard_items" ("document_id", "status", "position");
CREATE INDEX IF NOT EXISTS "standard_items_source_key_index" on "standard_items" ("source_key");
CREATE INDEX IF NOT EXISTS "standard_items_code_index" on "standard_items" ("code");
CREATE INDEX IF NOT EXISTS "standard_items_alt_code_index" on "standard_items" ("alt_code");
CREATE INDEX IF NOT EXISTS "standard_items_asn_id_index" on "standard_items" ("asn_id");
CREATE INDEX IF NOT EXISTS "standard_items_lineage_index" on "standard_items" ("lineage");
CREATE UNIQUE INDEX IF NOT EXISTS "standard_items_uuid_unique" on "standard_items" ("uuid");
CREATE INDEX IF NOT EXISTS "standard_items_uri_index" on "standard_items" ("uri");
CREATE TABLE IF NOT EXISTS "standard_item_revisions" ("id" integer primary key autoincrement not null, "item_id" integer not null, "revision" integer not null, "import_run_id" integer, "change_type" varchar not null, "previous" text, "fields" text, "created_at" datetime, foreign key("item_id") references "standard_items"("id") on delete cascade, foreign key("import_run_id") references "standard_import_runs"("id") on delete set null);
CREATE INDEX IF NOT EXISTS "standard_item_revisions_item_id_revision_index" on "standard_item_revisions" ("item_id", "revision");
CREATE TABLE IF NOT EXISTS "standard_item_levels" ("item_id" integer not null, "level_id" integer not null, foreign key("item_id") references "standard_items"("id") on delete cascade, foreign key("level_id") references "standard_education_levels"("id") on delete cascade, primary key ("item_id", "level_id"));
CREATE INDEX IF NOT EXISTS "standard_item_levels_level_id_index" on "standard_item_levels" ("level_id");
CREATE TABLE IF NOT EXISTS "standard_document_levels" ("document_id" integer not null, "level_id" integer not null, foreign key("document_id") references "standard_documents"("id") on delete cascade, foreign key("level_id") references "standard_education_levels"("id") on delete cascade, primary key ("document_id", "level_id"));
CREATE TABLE IF NOT EXISTS "standard_associations" ("id" integer primary key autoincrement not null, "type" varchar not null, "origin_item_id" integer not null, "destination_item_id" integer, "destination_uri" varchar, "destination_code" varchar, "source_id" integer, "confidence" numeric, "note" varchar, "user_id" integer, "created_at" datetime, "updated_at" datetime, foreign key("origin_item_id") references "standard_items"("id") on delete cascade, foreign key("destination_item_id") references "standard_items"("id") on delete cascade, foreign key("source_id") references "standard_sources"("id") on delete set null);
CREATE INDEX IF NOT EXISTS "standard_associations_origin_item_id_type_index" on "standard_associations" ("origin_item_id", "type");
CREATE INDEX IF NOT EXISTS "standard_associations_destination_item_id_type_index" on "standard_associations" ("destination_item_id", "type");
CREATE TABLE IF NOT EXISTS "standard_alignments" ("id" integer primary key autoincrement not null, "item_id" integer not null, "alignable_type" varchar not null, "alignable_id" integer not null, "scenario_id" integer, "strength" varchar not null default 'primary', "item_revision" integer, "user_id" integer, "created_at" datetime, "updated_at" datetime, "rationale" text, "evidence" text, foreign key("item_id") references "standard_items"("id") on delete cascade);
CREATE UNIQUE INDEX IF NOT EXISTS "standard_alignments_unique" on "standard_alignments" ("item_id", "alignable_type", "alignable_id");
CREATE INDEX IF NOT EXISTS "standard_alignments_alignable_type_alignable_id_index" on "standard_alignments" ("alignable_type", "alignable_id");
CREATE INDEX IF NOT EXISTS "standard_alignments_scenario_id_index" on "standard_alignments" ("scenario_id");
SQL;
    }

    public static function createSqlite(PDO $db): void
    {
        $db->exec(self::sqliteSchema());
    }
}
