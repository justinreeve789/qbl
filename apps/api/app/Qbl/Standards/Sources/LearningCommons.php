<?php

namespace App\Qbl\Standards\Sources;

use RuntimeException;

/**
 * Learning Commons knowledge graph (platform.learningcommons.org): US states' standards and CCSS,
 * with CASE identifiers. One framework (by its CASE document uuid) becomes one package; items keep
 * their CASE identifiers as uuids, so they line up with the same standards from a CASE server.
 */
final class LearningCommons
{
    public const BASE = 'https://api.learningcommons.org/knowledge-graph/v0';

    public const SOURCE = ['slug' => 'learning-commons', 'name' => 'Learning Commons', 'kind' => 'api', 'base_url' => self::BASE];

    /** @param  callable|null  $get  fn (string $url, array $headers): string, for tests */
    public function __construct(private string $apiKey, private string $baseUrl = self::BASE, private $get = null)
    {
        if ($apiKey === '') {
            throw new RuntimeException('A Learning Commons API key is needed (LEARNING_COMMONS_API_KEY).');
        }
    }

    /**
     * @param  string  $frameworkUuid  the CASE identifier of the framework's document
     * @param  string  $framework  the short name missions refer to it by (CA-MATH)
     * @param  string[]  $grades  only these grades ("5", "K")
     */
    public function package(string $frameworkUuid, string $framework, array $grades = [], ?string $jurisdiction = null): array
    {
        $list = [];
        $cursor = null;
        $first = null;
        do {
            $query = ['standardsFrameworkCaseIdentifierUUID' => $frameworkUuid, 'limit' => 1000, 'normalizedStatementType' => 'Standard'];
            if ($cursor) {
                $query['cursor'] = $cursor;
            }
            $qs = http_build_query($query);
            foreach ($grades as $g) {
                $qs .= '&gradeLevel=' . rawurlencode(ltrim((string) $g, '0') ?: 'K');
            }
            $url = rtrim($this->baseUrl, '/') . '/academic-standards?' . $qs;
            $headers = ['x-api-key: ' . $this->apiKey, 'Accept: application/json'];
            $body = $this->get ? ($this->get)($url, $headers) : Http::get($url, $headers);
            $data = json_decode($body, true);
            if (! is_array($data)) {
                throw new RuntimeException('Learning Commons sent something that is not JSON.');
            }
            foreach ($data['data'] ?? [] as $item) {
                $first ??= $item;
                $list[] = [
                    'code' => $item['statementCode'] ?? null, 'description' => $item['description'] ?? '',
                    'grades' => (array) ($item['gradeLevel'] ?? []), 'subject' => $item['academicSubject'] ?? null,
                    'uuid' => isset($item['caseIdentifierUUID']) ? strtolower($item['caseIdentifierUUID']) : null,
                ];
            }
            $cursor = ($data['pagination']['hasMore'] ?? false) ? ($data['pagination']['nextCursor'] ?? null) : null;
        } while ($cursor);

        $list = array_values(array_filter($list, fn ($s) => trim((string) $s['description']) !== ''));
        $package = StandardsList::package($list, $framework, $jurisdiction ?? ($first['jurisdiction'] ?? null), 'learning-commons');
        $package['source'] = self::SOURCE;
        $package['document']['source_key'] = "learning-commons:$frameworkUuid" . ($grades ? ':' . implode(',', $grades) : '');
        $package['document']['meta']['case_document'] = $frameworkUuid;
        // key items by their CASE identifier, and keep it as a URI so crosswalks to the same
        // standard from a CASE server resolve (not as our uuid: the same item can be in two grade slices)
        foreach ($package['items'] as $i => &$item) {
            $uuid = $list[$i]['uuid'] ?? null;
            if ($uuid && preg_match('/^[0-9a-f-]{36}$/', $uuid)) {
                $item['key'] = $uuid;
                $item['uri'] = "urn:uuid:$uuid";
            }
        }
        unset($item);

        return $package;
    }
}
