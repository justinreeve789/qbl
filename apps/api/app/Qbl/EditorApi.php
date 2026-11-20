<?php

namespace App\Qbl;

use App\Qbl\Billing\Entitlements;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;

/**
 * The editor's HTTP API, as a function from a request to a response.
 *
 * It has no framework calls: Laravel's EditorController and the dev server
 * both hand it the method, path, JSON body and signed-in user, and send back
 * what it returns. All routes live under /api/editor.
 *
 *   GET    scenarios                              scenarios the user may edit
 *   POST   scenarios                              create one (with a first scene and a new code of 16 random letters)
 *   GET    scenarios/{id}                         every row of the scenario, typed, for the editor
 *   PATCH  scenarios/{id}                         change scenario attributes
 *   DELETE scenarios/{id}
 *   PUT    scenarios/{id}/code                    {code}: the address players open it at; the old one stops working
 *   POST   scenarios/{id}/rows/{table}            add a row: media, variables, items, characters, scenes, events, actions, conditions, labels
 *   PATCH  scenarios/{id}/rows/{table}/{rowId}
 *   DELETE scenarios/{id}/rows/{table}/{rowId}
 *   POST   scenarios/{id}/media/upload            multipart "file"
 *   POST   scenarios/import                       multipart `file`: a ZIP with scenario.json and assets/; creates a new scenario
 *   POST   scenarios/{id}/duplicate               {title?}: a copy of the scenario as a new draft of the caller's
 *   GET    scenarios/{id}/export                  the scenario as a ZIP file (scenario.json and the uploaded files)
 *   GET    scenarios/{id}/preview                 the scenario JSON generated from the tables as they are now
 *   POST   scenarios/{id}/publish                 generate the JSON and make it what players get
 *   GET    scenarios/{id}/voices                  the voices characters can be given, and how many lines are recorded
 *   GET    scenarios/{id}/voices/{key}/sample     a voice saying a sample line (MP3)
 *   POST   scenarios/{id}/voices/record           {limit?, force?, character_id?}: record characters' lines, a few per call
 *   POST   scenarios/{id}/voices/assign           {all?}: give a voice to each character that has none
 *
 * The AI generator's routes (editor/generations) are App\Qbl\Generation\GenerationApi's.
 * A scenario's tier (settings.tier: free or curricular) is changed by administrators only.
 */
class EditorApi
{
    public function __construct(
        private ScenarioStore $store,
        /** Plans, when billing is on (a copy of a curricular mission needs one). */
        private ?Entitlements $entitlements = null,
        /** Recorded voices (config/qbl_speech.php); the voice routes answer 503 without it. */
        private ?SpeechFactory $speech = null,
    ) {}

    /**
     * @param  array|null  $user  ['id' => int, 'name' => string, 'role' => string], or null if not signed in
     * @param  array  $files  uploaded files: ['file' => ['tmp_name' => ..., 'name' => ...]]
     * @return array{0: int, 1: array|null} HTTP status and JSON body
     */
    public function handle(string $method, string $path, array $body, ?array $user, array $files = []): array
    {
        try {
            return $this->route(strtoupper($method), array_values(array_filter(explode('/', trim($path, '/')), 'strlen')), $body, $user, $files);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user, array $files): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        if (! in_array($user['role'] ?? '', ['teacher', 'admin'], true)) {
            throw new StoreError(403, 'The editor is for teachers and content creators.');
        }
        if (($parts[0] ?? '') !== 'scenarios') {
            throw new StoreError(404, 'Not found.');
        }

        // A scenario from a ZIP made by "Export", or put together by hand in the same shape.
        if ($parts === ['scenarios', 'import'] && $method === 'POST') {
            $file = $files['file'] ?? null;
            if (! $file || empty($file['tmp_name'])) {
                throw new StoreError(422, 'No file was uploaded.');
            }
            $id = (new ScenarioArchive($this->store))->import($file['tmp_name'], (int) $user['id'], $body['title'] ?? null);

            return [201, ['scenario' => $this->store->scenario($id)]];
        }

        if (count($parts) === 1) {
            return match ($method) {
                'GET' => [200, ['scenarios' => $this->store->listFor($user)]],
                'POST' => [201, ['scenario' => $this->store->createScenario($body, (int) $user['id'])]],
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }

        $id = $this->id($parts[1]);
        $scenario = $this->store->scenario($id);
        // A copy to make one's own: of a scenario one can edit as it is now, or of anyone's public mission as it was published.
        if ($scenario && array_slice($parts, 2) === ['duplicate'] && $method === 'POST') {
            if (ClassStore::isCurricular($scenario) && ($user['role'] ?? '') !== 'admin' && $this->entitlements && ! $this->entitlements->curricular((int) $user['id'])) {
                throw new StoreError(402, 'That is one of the curricular missions, which come with a Teacher plan.');
            }
            if ($this->store->canEdit($scenario, $user)) {
                $rows = $this->store->bundle($id);
            } elseif ($scenario['published_at'] !== null && ($scenario['settings']['visibility'] ?? 'public') !== 'private') {
                $rows = ScenarioDecompiler::rows($this->store->findPublished($scenario['code']));
            } else {
                throw new StoreError(404, 'Scenario not found.');
            }

            return [201, ['scenario' => $this->store->duplicate($rows, (int) $user['id'], $body['title'] ?? null)]];
        }
        if (! $scenario || ! $this->store->canEdit($scenario, $user)) {
            // The same answer whether it does not exist or belongs to someone else.
            throw new StoreError(404, 'Scenario not found.');
        }
        // A curricular mission a teacher can edit (a shared sample, or their own copy) is still only
        // theirs to open, preview or export while their plan includes curricular missions.
        if (ClassStore::isCurricular($scenario) && ($user['role'] ?? '') !== 'admin' && $this->entitlements && ! $this->entitlements->curricular((int) $user['id'])) {
            throw new StoreError(402, 'That is one of the curricular missions, which come with a Teacher plan.');
        }
        $rest = array_slice($parts, 2);

        if ($rest === []) {
            return match ($method) {
                'GET' => [200, $this->store->bundle($id)],
                'PATCH', 'PUT' => [200, ['scenario' => $this->store->updateScenario($id, $this->keepTier($scenario, $body, $user))]],
                'DELETE' => $this->deleted(fn () => $this->store->deleteScenario($id)),
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }

        if ($rest === ['code'] && $method === 'PUT') {
            // The shared samples (the demo among them) are linked from outside the editor; only an admin may move them.
            if ($scenario['user_id'] === null && ($user['role'] ?? '') !== 'admin') {
                throw new StoreError(403, 'Only an admin can change the code of a shared sample.');
            }

            return [200, ['scenario' => $this->store->changeCode($id, (string) ($body['code'] ?? ''))]];
        }

        if ($rest === ['preview'] && $method === 'GET') {
            // As players will get it: with the platform's avatars.
            return [200, ['scenario' => Avatars::inject($this->store->pdo(), $this->store->compile($id))]];
        }
        // The whole scenario as one ZIP file. The caller sends the file named in `download` and then deletes it.
        if ($rest === ['export'] && $method === 'GET') {
            [$path, $name] = (new ScenarioArchive($this->store))->export($id);

            return [200, ['download' => ['path' => $path, 'name' => $name, 'type' => 'application/zip']]];
        }
        if ($rest === ['publish'] && $method === 'POST') {
            $this->store->publish($id);

            return [200, ['scenario' => $this->store->scenario($id)]];
        }
        if (($rest[0] ?? '') === 'voices') {
            return $this->voices($id, $method, array_slice($rest, 1), $body);
        }
        if ($rest === ['media', 'upload'] && $method === 'POST') {
            $file = $files['file'] ?? null;
            if (! $file || empty($file['tmp_name'])) {
                throw new StoreError(422, 'No file was uploaded.');
            }

            return [201, ['row' => $this->store->addMediaFile($id, $file['tmp_name'], (string) ($file['name'] ?? 'upload'))]];
        }

        if (($rest[0] ?? '') === 'rows' && isset($rest[1])) {
            $table = $rest[1];
            if (count($rest) === 2 && $method === 'POST') {
                return [201, ['row' => $this->store->createRow($id, $table, $body)]];
            }
            if (count($rest) === 3) {
                $rowId = $this->id($rest[2]);

                return match ($method) {
                    'PATCH', 'PUT' => [200, ['row' => $this->store->updateRow($id, $table, $rowId, $body)]],
                    'DELETE' => $this->deleted(fn () => $this->store->deleteRow($id, $table, $rowId)),
                    default => throw new StoreError(405, 'Method not allowed.'),
                };
            }
        }

        throw new StoreError(404, 'Not found.');
    }

    /**
     * A mission's tier (settings.tier: "free" or "curricular") is set by administrators only: the
     * curricular missions are what the teacher plans sell. Settings sent without a tier keep the one it has.
     */
    private function keepTier(array $scenario, array $body, array $user): array
    {
        if (! is_array($body['settings'] ?? null)) {
            return $body;
        }
        $now = ClassStore::isCurricular($scenario) ? 'curricular' : 'free';
        $asked = $body['settings']['tier'] ?? $now;
        if (! in_array($asked, ['free', 'curricular'], true)) {
            throw new StoreError(422, 'A mission\'s tier is "free" or "curricular".');
        }
        if ($asked !== $now && ($user['role'] ?? '') !== 'admin') {
            throw new StoreError(403, 'Only an administrator can change whether a mission is free or curricular.');
        }
        if ($asked === 'curricular') {
            $body['settings']['tier'] = 'curricular';
        } else {
            unset($body['settings']['tier']);
        }

        return $body;
    }

    /** Characters' voices: the list to choose from, hearing one, and recording the lines. */
    private function voices(int $id, string $method, array $rest, array $body): array
    {
        if (! $this->speech) {
            throw new StoreError(503, 'Voices are not set up on this server.');
        }
        try {
            $catalog = $this->speech->catalog();
            $engine = $this->speech->engine();
            if ($rest === [] && $method === 'GET') {
                $lang = $this->store->scenario($id)['default_language'] ?? 'en';
                $status = $engine ? $this->speech->scenarioVoicer($this->store)->record($id, ['dry' => true]) : null;

                return [200, [
                    'engine' => $engine?->name(),
                    'voices' => array_values(array_map(fn ($v) => $catalog->describe($v), $catalog->forLanguage($lang))),
                    'lines' => $status ? ['total' => $status['lines'], 'recorded' => $status['kept'], 'to_record' => $status['remaining']] : null,
                ]];
            }
            if (! $engine) {
                throw new StoreError(503, 'Recording voices is switched off on this server (QBL_TTS_DRIVER=none). Lines are read by the browser\'s voice.');
            }
            if (count($rest) === 2 && $rest[1] === 'sample' && $method === 'GET') {
                $voice = $catalog->get($rest[0]) ?? throw new StoreError(404, 'There is no such voice.');
                $said = $this->speech->voicer()->sample($voice['key'], $voice['lang']);
                $path = tempnam(sys_get_temp_dir(), 'qbl-sample');
                file_put_contents($path, $said->audio);

                return [200, ['download' => ['path' => $path, 'name' => "{$voice['key']}.{$said->format}", 'type' => 'audio/mpeg', 'inline' => true]]];
            }
            if ($rest === ['record'] && $method === 'POST') {
                // A few at a time, so no request runs long: the editor calls again while some remain.
                $limit = max(1, min(20, (int) ($body['limit'] ?? 6)));
                $result = $this->speech->scenarioVoicer($this->store)->record($id, [
                    'limit' => $limit, 'seconds' => 12, 'force' => (bool) ($body['force'] ?? false), 'character_id' => isset($body['character_id']) ? (int) $body['character_id'] : null,
                ]);

                return [200, $result];
            }
            if ($rest === ['assign'] && $method === 'POST') {
                return [200, ['voices' => $this->speech->scenarioVoicer($this->store)->assign($id, (bool) ($body['all'] ?? false))]];
            }
        } catch (SpeechError $e) {
            throw new StoreError(503, $e->getMessage());
        }

        throw new StoreError(404, 'Not found.');
    }

    private function id(string $part): int
    {
        if (! ctype_digit($part)) {
            throw new StoreError(404, 'Not found.');
        }

        return (int) $part;
    }

    private function deleted(callable $fn): array
    {
        $fn();

        return [204, null];
    }
}
