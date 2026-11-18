<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;

/**
 * Scenario (scenario.com), with a model trained on the house style. A trained style model is the
 * strongest guarantee of consistency there is: once 15-30 approved QBL pictures exist (the anchors and
 * the best results of earlier runs), train a "style" model on them in Scenario and set SCENARIO_MODEL_ID.
 *
 * Generation is a job: start it, poll it, fetch the picture. The first reference (a character sheet,
 * for frames and portraits) is uploaded and used as the starting image.
 *
 * Not yet run against the live API: check the request fields against docs.scenario.com before relying on it.
 */
class ScenarioImageGenerator implements ImageGenerator
{
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $apiSecret,
        private string $modelId,
        private string $baseUrl = 'https://api.cloud.scenario.com/v1',
        private ?\Closure $sleep = null,
    ) {
        if ($this->apiKey === '' || $this->apiSecret === '' || $this->modelId === '') {
            throw new GenerationError('SCENARIO_API_KEY, SCENARIO_API_SECRET and SCENARIO_MODEL_ID must all be set.');
        }
    }

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        [$w, $h] = array_map('intval', explode(':', $aspect.':1'));
        $width = $w >= $h ? 1536 : (int) round(1536 * $w / $h / 64) * 64;
        $height = $w >= $h ? (int) round(1536 * $h / $w / 64) * 64 : 1536;
        $body = ['prompt' => $prompt, 'numSamples' => 1, 'width' => $width, 'height' => $height];
        // The subject reference (a character sheet), not the style anchors: the style is in the model.
        $subject = array_values(array_filter($references, fn ($r) => ! str_starts_with($r->role, 'style anchor')))[0] ?? null;
        if ($subject) {
            $body['image'] = $this->upload($subject->bytes);
            $body['strength'] = 0.55;
        }
        $job = $this->call('POST', '/generate/custom/'.rawurlencode($this->modelId), $body);
        $jobId = $job['job']['jobId'] ?? $job['jobId'] ?? throw new GenerationError('Scenario did not start a job.');
        for ($i = 0; $i < 120; $i++) {
            $status = $this->call('GET', '/jobs/'.rawurlencode($jobId))['job'] ?? [];
            if (($status['status'] ?? '') === 'success') {
                $assetId = $status['metadata']['assetIds'][0] ?? throw new GenerationError('Scenario finished without a picture.');
                $url = $this->call('GET', '/assets/'.rawurlencode($assetId))['asset']['url'] ?? throw new GenerationError('Scenario gave no address for the picture.');

                return $this->http->send('GET', $url, [], timeout: 120)->body;
            }
            if (in_array($status['status'] ?? '', ['failure', 'canceled'], true)) {
                throw new GenerationError('Scenario could not draw it: '.json_encode($status['metadata']['error'] ?? $status['status']));
            }
            $this->sleep ? ($this->sleep)(3) : sleep(3);
        }
        throw new GenerationError('Scenario took too long.');
    }

    private function upload(string $bytes): string
    {
        $answer = $this->call('POST', '/assets', ['image' => 'data:image/png;base64,'.base64_encode($bytes), 'name' => 'qbl-reference.png']);

        return $answer['asset']['id'] ?? throw new GenerationError('Scenario did not accept the reference picture.');
    }

    private function call(string $method, string $path, ?array $body = null): array
    {
        $response = $this->http->send($method, rtrim($this->baseUrl, '/').$path, [
            'Authorization' => 'Basic '.base64_encode("{$this->apiKey}:{$this->apiSecret}"),
            'Accept' => 'application/json',
        ], $body, timeout: 120);
        $data = $response->json();
        if (! $response->ok()) {
            throw new GenerationError('Scenario refused: '.($data['message'] ?? $data['error'] ?? $response->body));
        }

        return $data;
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return "scenario:{$this->modelId}";
    }
}
