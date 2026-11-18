<?php

namespace App\Qbl\Generation\Curriculum;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;

/**
 * Fills curriculum_standards from the places standards are published:
 *
 *  - Learning Commons Knowledge Graph (api.learningcommons.org): every US state's standards plus CCSS,
 *    with CASE identifiers. Needs an API key from platform.learningcommons.org.
 *  - Common Standards Project (api.commonstandardsproject.com): standard sets by id. Needs an API key.
 *  - A JSON file: a list of {code, description, grades, subject}, for a district's own standards or
 *    anything else. This needs no account.
 *
 * Importing again updates rows in place (matched by source and source id).
 */
class StandardsImporter
{
    public function __construct(private StandardsStore $store, private HttpClient $http) {}

    /** @return int how many standards were added or updated */
    public function fromLearningCommons(string $apiKey, string $frameworkUuid, string $framework, array $grades = [], string $baseUrl = 'https://api.learningcommons.org/knowledge-graph/v0'): int
    {
        if ($apiKey === '') {
            throw new GenerationError('A Learning Commons API key is needed (LEARNING_COMMONS_API_KEY).');
        }
        $count = 0;
        $cursor = null;
        do {
            $query = ['standardsFrameworkCaseIdentifierUUID' => $frameworkUuid, 'limit' => 1000, 'normalizedStatementType' => 'Standard'];
            if ($cursor) {
                $query['cursor'] = $cursor;
            }
            $qs = http_build_query($query);
            foreach ($grades as $g) {
                $qs .= '&gradeLevel='.rawurlencode(ltrim((string) $g, '0') ?: 'K');
            }
            $response = $this->http->send('GET', rtrim($baseUrl, '/').'/academic-standards?'.$qs, ['x-api-key' => $apiKey, 'Accept' => 'application/json']);
            $data = $response->json();
            if (! $response->ok()) {
                throw new GenerationError('Learning Commons refused: '.($data['message'] ?? $response->body));
            }
            foreach ($data['data'] ?? [] as $item) {
                if (trim((string) ($item['description'] ?? '')) === '') {
                    continue;
                }
                $this->store->upsert([
                    'framework' => $framework,
                    'jurisdiction' => $item['jurisdiction'] ?? null,
                    'subject' => $item['academicSubject'] ?? null,
                    'code' => $item['statementCode'] ?? null,
                    'grade_levels' => (array) ($item['gradeLevel'] ?? []),
                    'description' => $item['description'],
                    'source' => 'learningcommons',
                    'source_id' => 'lc:'.($item['caseIdentifierUUID'] ?? $item['identifier']),
                ]);
                $count++;
            }
            $cursor = ($data['pagination']['hasMore'] ?? false) ? ($data['pagination']['nextCursor'] ?? null) : null;
        } while ($cursor);

        return $count;
    }

    public function fromCommonStandardsProject(string $apiKey, string $standardSetId, string $framework, string $baseUrl = 'https://api.commonstandardsproject.com/api/v1'): int
    {
        if ($apiKey === '') {
            throw new GenerationError('A Common Standards Project API key is needed (CSP_API_KEY).');
        }
        $response = $this->http->send('GET', rtrim($baseUrl, '/').'/standard_sets/'.rawurlencode($standardSetId), ['Api-Key' => $apiKey, 'Accept' => 'application/json']);
        $data = $response->json();
        if (! $response->ok()) {
            throw new GenerationError('Common Standards Project refused: '.($data['message'] ?? $response->body));
        }
        $set = $data['data'] ?? $data;
        $levels = (array) ($set['educationLevels'] ?? []);
        $count = 0;
        // Parents first, so a child's parent is there when it is shown with its context.
        $standards = array_values((array) ($set['standards'] ?? []));
        usort($standards, fn ($a, $b) => ($a['depth'] ?? 0) <=> ($b['depth'] ?? 0));
        foreach ($standards as $s) {
            if (trim((string) ($s['description'] ?? '')) === '') {
                continue;
            }
            $this->store->upsert([
                'framework' => $framework,
                'jurisdiction' => $set['jurisdiction']['title'] ?? null,
                'subject' => $set['subject'] ?? null,
                'code' => $s['statementNotation'] ?? ($s['listId'] ?? null),
                'grade_levels' => (array) ($s['educationLevels'] ?? $levels),
                'description' => $s['description'],
                'source' => 'csp',
                'source_id' => 'csp:'.$s['id'],
                'parent_source_id' => isset($s['parentId']) ? 'csp:'.$s['parentId'] : null,
                'depth' => (int) ($s['depth'] ?? 0),
            ]);
            $count++;
        }

        return $count;
    }

    /** A JSON file: [{"code": "...", "description": "...", "grades": ["05"], "subject": "Science"}, ...] */
    public function fromFile(string $path, string $framework, ?string $jurisdiction = null): int
    {
        $list = json_decode((string) @file_get_contents($path), true);
        if (! is_array($list)) {
            throw new GenerationError("$path is not a JSON list of standards.");
        }
        $count = 0;
        foreach ($list as $s) {
            $this->store->upsert([
                'framework' => $framework,
                'jurisdiction' => $s['jurisdiction'] ?? $jurisdiction,
                'subject' => $s['subject'] ?? null,
                'code' => $s['code'] ?? null,
                'grade_levels' => (array) ($s['grades'] ?? $s['grade_levels'] ?? []),
                'description' => $s['description'] ?? '',
                'source' => 'file',
                'source_id' => strtoupper($framework).':'.($s['code'] ?? md5((string) ($s['description'] ?? ''))),
                'parent_source_id' => isset($s['parent_code']) ? strtoupper($framework).':'.$s['parent_code'] : null,
            ]);
            $count++;
        }

        return $count;
    }
}
