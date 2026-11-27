---
title: Curriculum standards library
description: How QBL stores the standards of every US state, the Common Core, NGSS, Canada and the UK, and how they are kept up to date.
---

:::note[In short]
Standards live in the `standard_*` tables. (This is separate from `curriculum_standards`, the small set the
mission generator aligns to, filled by `qbl:standards`; linking the two is a follow-up.) Every source (an API, a CASE server, a government web page) is turned
into a **package** by an adapter in `App\Qbl\Standards\Sources`, and `App\Qbl\Standards\Importer` is the only code
that writes the tables. Importing is idempotent: an unchanged document is skipped, a changed one gets a new
**revision**, and standards are never deleted, only retired, so alignments to missions survive updates.
:::

## The model

```
standard_jurisdictions ─< standard_frameworks ─< standard_documents ─< standard_items (a tree)
   US-TX, CA-ON, GB-SCT     "Texas: Science"       one edition each      parent_id + lineage
                            current_document_id ─┘  status, revision      code, statement, levels
                                                    supersedes_id          uuid never changes
standard_items >─< standard_items       via standard_associations   (exactMatchOf, replacedBy, isRelatedTo, ...)
standard_items >─< standard_education_levels via standard_item_levels
standard_items ─< standard_alignments   (a scenario, scene, event, question or objective teaches it)
standard_documents ─< standard_document_revisions,  standard_items ─< standard_item_revisions
```

The shape follows 1EdTech **CASE** (CFDocument = document, CFItem = item, CFAssociation = association), so CASE
packages import without loss and could be exported again.

| Table | What a row is |
|---|---|
| `standard_jurisdictions` | Who sets the standards: a country, state, province, UK nation, a consortium (`US-CCSS`, `US-NGSS`) or a QBL organization (`organization_id`). Codes are ISO 3166-2 where one exists. |
| `standard_frameworks` | A line of standards that has editions over time: "Texas: Science", "National curriculum in England: Mathematics". `current_document_id` points at the edition in force. `organization_id` makes a framework private to one school organization. |
| `standard_documents` | One edition (CASE CFDocument): title, `version_label`, `published_year`, `status` (`current`, `superseded`, `archived`, `withdrawn`, `draft`, `proposed`), language, license, source. `revision` counts imports that changed it. `status_locked` lets an admin pin the status. |
| `standard_items` | One node of a document's tree: a section, strand, cluster, standard, benchmark, outcome... `code` is the publisher's code (`CCSS.Math.Content.3.OA.A.1`, `MNU 1-01a`), `item_type` a normalised kind, `type_label` the publisher's word, `is_statutory` when known. `lineage` (`/12/345/`) makes subtree queries an index range. |
| `standard_education_levels` | Every school system's levels with a US-grade equivalent (`grade_from`/`grade_to`): US/Canadian grades, England Years and key stages, Scottish CfE levels, Welsh progression steps, NI key stages. Searching "grade 3" finds England Year 4 and Scotland second level too. |
| `standard_associations` | Links between items: crosswalks (`exactMatchOf`), `replacedBy` between editions, `isRelatedTo`... A link to something not loaded keeps `destination_uri`/`destination_code` and is resolved when it arrives. |
| `standard_alignments` | QBL content aligned to an item, with `item_revision` (the document revision seen when it was aligned). |
| `standard_*_revisions`, `standard_import_runs`, `standard_sources`, `standard_licenses` | History, provenance and licensing. |

## Revisions: what happens on re-import

`Importer::import($package, $run)`:

1. Hashes the package. Same hash as last time → only `last_imported_at` is touched.
2. Otherwise `revision + 1`. Items are matched by their **source key**; an unmatched new item with the same code and
   statement as an unmatched old one is treated as **moved** (keeps its id).
3. Changed items are updated in place (same `id` and `uuid`). Their previous values and the list of changed fields go
   to `standard_item_revisions` (`change_type` `changed`, `moved`, `restored`, `retired`, `added`).
4. Items no longer in the source become `status = 'retired'` with `retired_at`. They come back as `restored` if the
   source brings them back.
5. Associations from that source are replaced and then resolved by URI, CSP/CASE id and (unique) code.
6. `refreshFrameworks()` works out editions: within a framework, documents whose titles match once years and words
   like "revised" are removed are editions of each other. The latest year is `current`, earlier ones `superseded`
   with `supersedes_id`. Archived, withdrawn and locked documents keep their status.

`StandardsStore::alignmentsForScenario()` flags aligned standards that changed (`changed_since`) or were retired,
with the replacement when the publisher named one, so the editor can ask an author to review them.

## Sources and coverage (first load, 2026-11-27)

| Jurisdictions | Source | Adapter |
|---|---|---|
| 50 states + DC, Common Core, NGSS; Alberta, British Columbia, Manitoba, New Brunswick, Nova Scotia, Ontario, Quebec, Saskatchewan (English and French) | Common Standards Project API (data largely from the Achievement Standards Network) | `Sources\CommonStandardsProject` |
| England: national curriculum programmes of study, KS1–KS4, 12 subjects | gov.uk HTML | `Sources\UnitedKingdom::england` |
| Scotland: Curriculum for Excellence experiences and outcomes, early–fourth level | Education Scotland RTF | `Sources\UnitedKingdom::scotland` (+ `Sources\Rtf`) |
| Wales: Curriculum for Wales statements of what matters + descriptions of learning, PS1–PS5 | hwb.gov.wales HTML | `Sources\UnitedKingdom::wales` |
| Northern Ireland: minimum content, SR 2007/46 Schedule 2, FS–KS4 | legislation.gov.uk XML | `Sources\UnitedKingdom::northernIreland` |
| Anything published as CASE (e.g. Georgia's own server) | any CASE 1.0/1.1 server | `Sources\CasePackage` |

Not covered yet: Newfoundland and Labrador, Prince Edward Island and the territories (they are seeded as
jurisdictions; NWT/Nunavut follow Alberta's or BC's curricula, Yukon BC's); England's EYFS and GCSE subject content;
Scotland's benchmarks and senior phase; Wales's literacy/numeracy/digital frameworks.

## Commands

```bash
php artisan qbl:standards-library seed            # jurisdictions, subjects, education levels (also run by every import)
php artisan qbl:standards-library all --bulk      # everything below; ~7 min of loading after downloads, re-runs only touch what changed
php artisan qbl:standards-library csp [--jurisdiction=US-TX ...] [--refresh]
php artisan qbl:standards-library uk  [--nation=GB-ENG ...] [--refresh]
php artisan qbl:standards-library case https://case.georgiastandards.org/ims/case/v1p0/CFPackages/<id> --jurisdiction=US-GA
php artisan qbl:standards-library file my-standards.json    # a package (or a list of packages) written by hand
php artisan qbl:standards-library status
php artisan qbl:standards-library search "fractions on a number line" --grade=3 [--jurisdiction=GB-ENG] [--subject=mathematics]
php artisan qbl:standards-library history "CCSS.Math.Content.3.NF.A.2"
```

Downloads are cached in `storage/app/standards` (`--cache=` to change); `--refresh` downloads again. To pick up
publishers' updates, schedule `qbl:standards-library all --refresh` monthly.

## Adding a source

Write an adapter that yields packages (the format is documented at the top of `App\Qbl\Standards\Package`) and
call `Importer::import()` for each, between `startRun()` and `finishRun()`. Rules:

- **Item keys must be stable** across imports of the same source; they are how revisions are matched. Use the
  publisher's id or code; for HTML sources, a path of heading slugs plus an ordinal.
- Levels are `"SYSTEM:code"` strings from `Reference::levels()`. A new school system is new rows there.
- New jurisdictions go in `Reference::JURISDICTIONS`. Subjects are worked out by `Reference::subjectFor()` from
  the subject label; admins can change a framework's subject afterwards (imports don't overwrite it).

## Licensing

Each document records the license its source declares (`standard_licenses`, with the rights holder). Most CSP/ASN
data is CC BY 3.0 US or 4.0, UK material is Crown copyright under the Open Government Licence v3.0, and some CASE
publishers use non-commercial licenses (Georgia: CC BY-NC-SA). The license on the *metadata* is not always the
license on the *standards text*: some states and provinces hold copyright in their standards. Check before showing
standards text in paid features, and show `standard_licenses.attribution` / `standard_sources.attribution` where
standards are displayed.

## Gotchas

- `standard_items.code` is only unique within a document (`1.1` exists thousands of times). Look up by `uuid`, or
  by code plus jurisdiction (`StandardsStore::find($code, 'US-TX')`).
- The same CSP standard can appear in several jurisdictions (a state that lists the Common Core under its own
  name). Each copy is its own item; `exactMatchOf` links them to the Common Core item.
- `standard_items` has a FULLTEXT index on MariaDB only; on SQLite, search falls back to `LIKE`.
- `change_type` and `previous` (not `change`/`before`): those are reserved words in MariaDB.
- InnoDB full-text only sees committed rows, so `search()` finds nothing inside an uncommitted transaction
  (`RefreshDatabase` tests on MariaDB).
- Re-adding the FULLTEXT index after dropping it leaves most rows out unless the table is rebuilt first
  (`ALTER TABLE standard_items FORCE`). `--bulk` does this; do the same after a manual restore.
- Statement text is cleaned with `CommonStandardsProject::clean()`, not `strip_tags()`: maths uses `<` and `>` as
  symbols, and `strip_tags` silently truncates "…with the symbols >, =, or <, and justify…".
