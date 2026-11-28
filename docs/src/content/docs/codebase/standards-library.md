---
title: Curriculum standards library
description: How QBL stores the standards of every US state, the Common Core, NGSS, Canada and the UK, and how they are kept up to date.
---

:::note[In short]
Standards live in the `standard_*` tables, and missions (generated or not) are aligned to them. Every source (an API, a CASE server, a government web page) is turned
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
| A framework from Learning Commons (CASE identifiers) | Learning Commons API (`LEARNING_COMMONS_API_KEY`) | `Sources\LearningCommons` |
| Your own list of standards | a JSON file | `Sources\StandardsList` |

Not covered yet: Newfoundland and Labrador, Prince Edward Island and the territories (they are seeded as
jurisdictions; NWT/Nunavut follow Alberta's or BC's curricula, Yukon BC's); England's EYFS and GCSE subject content;
Scotland's benchmarks and senior phase; Wales's literacy/numeracy/digital frameworks.

## Commands

```bash
php artisan qbl:standards seed            # jurisdictions, subjects, education levels (also run by every import)
php artisan qbl:standards all --bulk      # everything below; ~7 min of loading after downloads, re-runs only touch what changed
php artisan qbl:standards csp [--jurisdiction=US-TX ...] [--refresh]
php artisan qbl:standards uk  [--nation=GB-ENG ...] [--refresh]
php artisan qbl:standards case https://case.georgiastandards.org/ims/case/v1p0/CFPackages/<id> --jurisdiction=US-GA
php artisan qbl:standards file my-standards.json    # a package (or a list of packages) written by hand
php artisan qbl:standards file list.json --framework=MY-DISTRICT-SCI [--jurisdiction=US-TX]   # a plain list, see below
php artisan qbl:standards learning-commons <framework CASE uuid> --framework=CA-MATH [--grade=5]
php artisan qbl:standards relink                     # move alignments from imported copies to the library's own items
php artisan qbl:standards status
php artisan qbl:standards search "fractions on a number line" --grade=3 [--jurisdiction=GB-ENG] [--subject=mathematics]
php artisan qbl:standards history "CCSS.Math.Content.3.NF.A.2" --jurisdiction=US-CCSS
```

Downloads are cached in `storage/app/standards` (`--cache=` to change); `--refresh` downloads again. To pick up
publishers' updates, schedule `qbl:standards all --refresh` monthly.

`qbl:standards` with no action shows the status. `qbl:standards-library` is the same command (its name for a
day, while the generator's old `curriculum_standards` table still existed).

## Missions and the generator

A mission's standards are `standard_alignments` rows with `alignable_type` `scenario` (`strength` `primary` or
`supporting`, the generator's `rationale` and `evidence`). `App\Qbl\Generation\Curriculum\MissionStandards` is
what the generator uses:

- **Framework selectors** (`--framework` on `qbl:generate`): a jurisdiction (`US-TX`), a jurisdiction and subject
  (`US-TX:science`), a framework slug, a shorthand (`NGSS`, `CCSS`, `CCSS-MATH`, `CCSS-ELA`), or the name of a set
  imported by hand. None: `qbl_generation.standards.default_frameworks` (`QBL_GEN_STANDARDS`, default
  `US-CCSS,US-NGSS,QBL`).
- **`candidates()`** offers active standards of current documents at the grade, ranked by words in common with the
  request. Scopes up to 20,000 standards are scored whole; bigger ones (all of Texas) take their pool from the
  full-text index. Uncoded statements (England, Wales) are offered under a reference, `GB-ENG-1a2b3c4d`
  (jurisdiction + start of the uuid), which is also what reports show for them.
- **`byCodes()`** finds standards a teacher names: code, short code (`3.NF.2`) or reference, case-insensitive;
  without frameworks, anywhere, preferring the defaults, and the Common Core's own item over a state's copy.
- Reports and the public API read `StandardsStore::SCENARIO_SQL`: the same fields `scenario_standards` gave
  (`code`, `framework`, `description`, `alignment`), where `framework` is the jurisdiction code (`US-CCSS`), or an
  imported set's name.

### Sets of your own: the QBL jurisdiction

`qbl:standards file list.json --framework=NAME` takes the plain list the generator always took,
`[{"code", "description", "grades", "subject", "parent_code"}]`, as a framework with the slug `qbl-<name>` under the
`QBL` jurisdiction (or under a real one, when `--jurisdiction` is a code such as `US-TX`). Learning Commons
frameworks are imported the same way, keyed by their CASE identifiers.

### Where the old tables went

Until 2026-11-28 the generator had its own `curriculum_standards` / `scenario_standards`. Migration
`2026_11_28_000000_merge_curriculum_standards_into_library` (`LegacyStandards::migrate`) moved them in and dropped
them: each old standard was matched to a library item (its CSP id, its CASE id, or a code only one current item
has, the Common Core's/NGSS's own winning over states' copies, then the jurisdiction the old row named), and the
rest were imported as sets of their own, so every mission kept its alignments, rationale and evidence. On a server
that migrated before loading the library, `qbl:standards all` ends with `relink`, which moves alignments from those
copies to the library's items once a unique match exists.

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
- Filter by grade with a correlated `(SELECT COUNT(*) ...) > 0`, not `EXISTS`: MariaDB turns `EXISTS` into a
  semi-join that walks every standard at that grade in the library (hundreds of thousands). Likewise, look levels
  up by `item_id` alone and name them in PHP; joining `standard_education_levels` there scans every
  `standard_item_levels` row.
- MariaDB's `uuid` column type does not sort as text, so a uuid prefix is not an index range; `byCodes()` looks
  references up within their jurisdiction's documents instead.
- InnoDB full-text only sees committed rows, so `search()` finds nothing inside an uncommitted transaction
  (`RefreshDatabase` tests on MariaDB).
- Re-adding the FULLTEXT index after dropping it leaves most rows out unless the table is rebuilt first
  (`ALTER TABLE standard_items FORCE`). `--bulk` does this; do the same after a manual restore.
- Statement text is cleaned with `CommonStandardsProject::clean()`, not `strip_tags()`: maths uses `<` and `>` as
  symbols, and `strip_tags` silently truncates "…with the symbols >, =, or <, and justify…".
