---
title: "Other API subsystems"
description: "The parts of the API around the scenario core, from a developer's side: the AI mission generator, characters' voices, the asset library, plans and credits, districts and single sign-on, and the public API for schools. What each is made of, how it is wired, and where its detailed page is."
host:
  who: asimov
  says: "Around the scenario core sit six larger machines. Each has its own detailed page; this one shows you where the levers are."
  side: right
---

Six subsystems of `apps/api/app/Qbl` are large enough to have their own reference pages. This page is the developer's map of each: the classes, how they are put together, how they meet the rest of the code, and where to read more. They all follow the same pattern as the core: plain PHP over PDO, an `*Api` class for HTTP, built in `AppServiceProvider`, and tested with plain-PHP scripts.

:::tip[In short]
- **Generator** (`Generation/`): a *method* is a list of *steps* (align → design → estimate → draw → build → voice → package → import). The result is an import ZIP that goes in through `ScenarioArchive`, like any teacher's ZIP. Runs from the editor go through a queue job.
- **Voices** (`Speech/`): one `SpeechEngine` interface per text-to-speech service; a catalog of voices by *our* keys; recordings with word timings, cached by text.
- **Library** (`Library/`): ready-made characters, vehicles, items, pictures and sounds. Adding one copies its files into the scenario's media.
- **Billing** (`Billing/`): plans, entitlements, credits, Stripe. Off by default: with billing off, everyone may do everything.
- **Districts** (`District/`): SAML, Clever and Google sign-in, roster syncs, a CSV roster.
- **Public API** (`Api/`): `/api/v1` for schools, with OAuth client credentials, pseudonymous rostering, launch links, reports.
:::

## The AI mission generator

Reference pages: [Generating missions with AI](/docs/developers/generation/) and [Generation methods and traces](/docs/developers/generation-methods/).

### The pieces

Folder | What is in it
------ | -------------
`Generation/` | `ScenarioGenerator` (runs a method's steps with all the bookkeeping), `GenerationFactory` (builds every service from `config/qbl_generation.php`), `GenerationApi` (the editor's routes), `GenerationRuns` and `GenerationEvents` (the tables), `GenerationProgress` (the progress bar, and cancelling), `Spend` (what a run spent, against a soft budget), `ScenarioPackage` (the import ZIP), `ScenePreview` (a picture of each scene with its floor and hotspots drawn on)
`Generation/Methods/` | `GenerationMethod` (the class to subclass) and the built-in methods: `classic`, `draft`, `gemini-judge`, `sprite-app`, `critic`, `best-of`, `outline-first`, and `scene` (one scene for an existing scenario). `GenerationMethods` is the list by key
`Generation/Pipeline/` | `Step` (one step) and `Steps/*` (`AlignStep`, `DesignStep`, `EstimateStep`, `DrawStep`, `BuildStep`, `VoiceStep`, `PackageStep`, `ImportStep`, and `CritiqueStep`, `BestOfDesignStep`, `OutlineStep`, `ClearStep`, `SurveyStep` and the scene steps), `GenerationRun` (everything a run knows, handed from step to step), `Tracer` and the `Tracing*` wrappers (a flight recorder of every step and AI call), `RoutingImageGenerator`
`Generation/Design/` | Writing the **blueprint**: `MissionDesigner` (write and correct until valid), `BlueprintSchema`, `BlueprintValidator`, `BlueprintCritic`, `DesignRules`, `SceneDesigner`, `Connections`, `Cutscenes`, story formats (`StorySchema`, `StoryValidator`, `StoryPlan`), `Sizes`, `TwistIdeas`
`Generation/Art/` | Drawing: `AssetDirector` (every picture in one style, judged against anchors, redrawn below the bar), `ArtStyle`, `StyleJudge`, `ImageTools`, `ObjectCutter` and `BackgroundCleaner` (cutting things out), `FloorTracer` and `SceneSurveyor` (finding the floor), `SortLine`, `CharacterAnimator`, `LibraryCritters`, and `Providers/*` (Gemini, OpenAI, Scenario, AutoSprite, a placeholder and an offline source)
`Generation/Build/` | Rows from the blueprint: `MissionBuilder` (every interaction becomes events and actions by a known pattern, so the model is never trusted to write runtime JSON), `SceneBuilder`, `StoryBuilder`, `StoryStaging`
`Generation/Curriculum/` | Standards: `MissionStandards` (the library's standards a mission can be aligned to, and the ones it is: framework selectors, candidates, codes, `standard_alignments`), `StandardsAligner`. The library itself is `App\\Qbl\\Standards` ([Curriculum standards library](/docs/codebase/standards-library/))
`Generation/Llm/`, `Generation/Http/` | `LanguageModel` and `AnthropicModel`; `HttpClient` and `CurlHttpClient` (recorded responses in tests)

### How a run flows

```text
editor #/generate ─▶ POST /api/editor/generations ─▶ GenerationApi (credits charged, row made, 202)
                                                         └─▶ RunGeneration job (queue worker in "app")
                                                               └─▶ ScenarioGenerator::run(method)
   align ─▶ design ─▶ estimate ─▶ draw ─▶ build ─▶ voice ─▶ package ─▶ import
     │        │                     │       │                 │          └─ ScenarioArchive::import → a private draft
     │        └─ blueprint          │       └─ rows (bundle shape) ──▶ ScenarioCompiler → scenario.json
     └─ standards, objectives       └─ pictures (AssetDirector)
editor polls GET /api/editor/generations every few seconds (GenerationProgress) ─▶ the header chip
```

Key points:

- **The model never writes runtime JSON.** It writes a blueprint (story, scenes, characters, items, interactions, checklist) that `BlueprintValidator` checks; `MissionBuilder` turns each interaction into events and actions by a fixed pattern (talk, collect, inspect, use, question...).
- **Generated missions enter the database the way any other does**: a ZIP through `ScenarioArchive::import`. A generated scene for an existing scenario goes through `ScenarioStore::mergeRows`, and the editor takes it in as one undo step (`Store.takeIn`).
- **Runs can be resumed** (`qbl:generate --resume=ID`), traced (`qbl:generation-trace`) and audited (`qbl:generation-log`). Work folders are under `storage/app/generations/<run>/`.
- **Cancelling** happens between two pictures: `GenerationProgress` throws `GenerationCancelled`; credits are given back on failure or cancel.
- **Tests** (`npm run test:generation`, `test:story-generation`, `test:scenes`, `test:scene-generation`) use a stand-in model (`tests/fixtures/generation/FakeModel.php`) and placeholder pictures, then validate and play the result.

## Voices

Reference page: [Characters' voices (text-to-speech)](/docs/developers/voices/).

- **`SpeechEngine`** is the one interface that changes when the service does. Engines: `KokoroEngine` (the default, the `tts` container), `ChatterboxEngine` (the `chatterbox` container, with reference clips from `ChatterboxClips`), `ElevenLabsEngine`, `OpenAiSpeechEngine`. `QL_TTS_DRIVER` chooses; `SpeechFactory` builds from `config/qbl_speech.php`.
- **`VoiceCatalog`** (`resources/speech/voices.json`): voices by QuestLab's own keys (`heart`, `captain`, `robot`), each saying what it is on every engine, with a `flair` from everyday to theatrical. A character's `tts_voice` is always a catalog key, never a service's voice id, so scenarios keep their voices when the service changes.
- **`VoicePicker`** gives each character a fitting voice, different for each while there are enough.
- **`Voicer`** records a line in a voice and returns a `Speech` (audio and word timings), with `{{QL_PlayerName}}` spoken as a stand-in word; lines with other placeholders are left to the browser. Recordings are cached by engine, voice and text.
- **`ScenarioVoicer`** records a scenario's lines into its media (`qbl:voice`, the editor's "Record voices", the generator's voice step): new or changed lines are recorded, stale recordings removed, uploaded recordings never touched. The word timings go into the media's `params.speech`, which the compiler lifts to `speech` and the game uses to light each word.

## The asset library

Reference pages: [The asset library](/docs/developers/asset-library/) (developers) and [The asset library and content admins](/docs/editor/asset-library/) (users).

- **`AssetLibrary`**: `library_assets` (kind, name, category, tags, credit, organization, the `definition` of what adding it makes) and `library_asset_files` (one per role: sheet, portrait, image, sound, preview, with media params).
- **Adding an asset** to a scenario copies the files its definition uses into the scenario's media (once: a second Red Squirrel shares the first one's sheet) and makes the character or item. The editor calls it through `Store.addFromLibrary`; the generator and the game server through `/api/internal/library`.
- **`LibraryApi`**: `/api/editor/library`: teachers list and add; content admins and admins change assets and keep a scenario's character or item in the library. **`ContentAdmins`** manages who the content admins are.
- `qbl:library` lists, imports, adds and keeps assets; `qbl:seed` installs the shipped ones.

## Plans, billing and credits

Reference page: [Billing, credits and district sign-in](/docs/developers/billing/).

- **`Plans`** (from `config/qbl_billing.php`): free, Teacher, Teacher Plus.
- **`Entitlements`**: what an account may do (curricular missions, the generator, how many students), from its Stripe subscription and its organization's license, the better of each. Admins may do everything; **with `QBL_BILLING_ENABLED=false` (the default) everyone may**.
- **`Credits`**: generator credits, refilled lazily when read (`min(balance, carry-over) + monthly`), with a ledger.
- **`Subscriptions`** and **`Stripe`**: checkout with the free trial and coupons, plan changes, the customer portal, and the webhook that keeps `subscriptions` in step. No Stripe SDK: form-encoded requests over the shared `HttpClient`.
- **`BillingApi`**: `/api/billing`. The webhook and the quote form are in `BillingController`.
- Where it is enforced: `ClassStore::needsPlan` and `mayJoin` (curricular missions), `EditorApi` (opening, duplicating a curricular mission), `GenerationApi` (credits), the Classes page (student limits).

## Districts and single sign-on

Reference pages: [Billing, credits and district sign-in](/docs/developers/billing/) and [The district admin panel](/docs/editor/district-admin/).

- **`Integrations`**: an organization's SAML, Clever and Google settings, with secrets encrypted by Laravel's `Crypt` (passed in as functions, so the class stays framework-free).
- **`Sso`**: who someone signing in through their district is: the organization's account with that `external_id`, made on the spot when allowed, with a pseudonym and no name or email. `SsoController` handles SAML and Clever; Google Workspace domains go through `GoogleAuthController`.
- **`RosterSync`**: brings an organization's schools, teachers, students and enrollments in line with a source (`CleverClient`, `GoogleClassroomClient`, or a CSV parsed by `RosterFile`), through the public API's `Roster`. It runs on the queue (`SyncRoster` job). A CSV with a column that would identify someone is refused outright.
- **`DistrictApi`**: `/api/district`, for an organization's admins and QBL's.

## The public API (`/api/v1`)

Reference: [The public API (v1)](/docs/api-v1/), and its OpenAPI description at `/docs/api/v1/openapi.yaml`.

Class | What it owns
----- | ------------
`Api\V1\Api` | The router for everything under `/api/v1`. **Version 1 is a promise**: fields are only added, never renamed or removed; anything else is `/api/v2`
`Api\Clients` | Organizations, API clients (OAuth 2 client credentials, scopes), hour-long access tokens, the audit log
`Api\Roster` | Schools, teachers, students and enrollments, by the organization's opaque `external_id`
`Api\Privacy` | Keeping personal information out: pseudonyms ("Brave Otter 417"), placeholder addresses, and refusing fields that would identify a child
`Api\Launches` | One-time, five-minute sign-in links (only a hash is kept; a page redeems them by POST, so link previews do not use them up)
`Api\OrgAvatars` | An organization's own avatars, uploaded, never linked from elsewhere
`Api\Reports` | Grades, engagement and learning, read through `ActivityStore::report` so the numbers agree with the editor's reports
`Api\Sql`, `Api\ApiError` | PDO helpers; errors with a stable code

The rate limits are in `AppServiceProvider::boot` (`qbl-api-v1`: per token, tighter for `oauth/token` and `launch/`). `qbl:api-client` makes and rotates clients; `qbl:privacy-purge` deletes what is older than each organization's retention period (run it daily).
