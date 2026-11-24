<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\CharacterAnimator;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Spend;
use Closure;
use CURLFile;
use Throwable;

/**
 * AutoSprite (autosprite.io): the characters' animations, made from their character sheet.
 *
 * Image models draw a good character once and a poor walk cycle: every frame is a new drawing, so
 * the design drifts and the feet slide. AutoSprite animates one picture of the character instead (a
 * video model, cut into a sprite sheet), so every frame is the same character.
 *
 * ONE REQUEST PER CHARACTER, AND NEVER ANOTHER
 *
 * Each character costs exactly one generation request, holding every animation the game can use:
 *
 *   1. Upload the character sheet the art director drew and accepted   POST /characters (multipart; free)
 *   2. Ask for all their animations at once                            POST /characters/{id}/spritesheets
 *   3. Wait for the jobs                                                GET  /jobs/{jobId}            (reads)
 *   4. Fetch each finished sheet and its atlas                         GET  /spritesheets/{id}, then the files
 *
 * Step 2 happens once per character and is never repeated: not when an animation fails, not when a
 * job is slow, not when the run is resumed, and not by the HTTP client's own retries (it is sent with
 * a client that does not retry, since a retry after a timeout could start, and pay for, a second
 * generation). An animation that fails is simply missing: the director makes a walk from the standing
 * picture, and the game's built-in moves stand in for a missing gesture. The only way to ask again is
 * to draw the character again (`qbl:generate --resume=ID --redo=draw`), which starts a new folder.
 *
 * Steps 3 and 4 are reads (AutoSprite counts them apart from generation, and they cost nothing).
 *
 * What is asked for, in this order (ANIMATIONS; QBL_GEN_AUTOSPRITE_ANIMATIONS to trim it), ten being
 * the most one request may hold:
 *
 *   idle, walk     every character stands and walks (AutoSprite loops these seamlessly)
 *   wave           when a conversation starts
 *   cheer          the guide at the end (AutoSprite's "victory")
 *   point, think   cutscene gestures (think is a custom animation: AutoSprite has no preset for it)
 *   talk           for teachers to play while someone speaks (an `animate` action)
 *   jump, dance    cutscene gestures that otherwise only bounce the whole picture
 *   crouch         a built-in move, drawn properly
 *
 * The mission's own needs (walk and the gestures it plays) always come first, so a trimmed list
 * still has them. Everything else is there so a teacher editing the mission later has it to hand.
 *
 * Everything is kept in the run's assets folder (autosprite-<key>.json: the character, the request,
 * each job and sheet; then the frames as PNGs), so a resumed run picks up where it stopped, polling
 * jobs that were still running rather than asking again.
 *
 * Cost: AutoSprite charges credits per animation, by video tier (turbo: 5). Uploading the picture is
 * free. Spend prices them as "autosprite@<tier>" (Spend::PRICES, from the Pro plan's ~$0.019 a credit).
 * Credits for animations that fail are refunded by AutoSprite.
 *
 * API reference: https://www.autosprite.io/docs/api (spritesheets, jobs, characters).
 */
final class AutoSpriteAnimator implements CharacterAnimator
{
    /**
     * QBL animation name => AutoSprite animation entry. In priority order: a shorter list keeps the
     * first. Presets must not carry a prompt; a custom one needs a name and a prompt.
     */
    public const ANIMATIONS = [
        'idle' => ['kind' => 'idle'],
        'walk' => ['kind' => 'walk'],
        'wave' => ['kind' => 'wave'],
        'cheer' => ['kind' => 'victory'],
        'point' => ['kind' => 'point'],
        'think' => ['kind' => 'custom', 'name' => 'Think', 'prompt' => 'Thinking: the character raises one hand to their chin, looks up and tilts their head as if puzzling something out, then lowers the hand and ends in their normal standing pose. Side view, facing right, feet planted.'],
        'talk' => ['kind' => 'talk'],
        'jump' => ['kind' => 'jump'],
        'dance' => ['kind' => 'dance'],
        'crouch' => ['kind' => 'crouch'],
    ];

    /** Played over and over by themselves; the rest are played once when asked for. */
    public const LOOPS = ['idle', 'walk'];

    /** Asked to loop seamlessly by AutoSprite (idle and walk always are), so they can be repeated in the editor. */
    public const SEAMLESS = ['talk', 'dance'];

    /** The most animations one request may hold (more is an error: TOO_MANY_ANIMATIONS). */
    public const PER_REQUEST = 10;

    /** Credits per animation by video tier (ultra is 10 a second; at turbo's two seconds, 20). */
    public const CREDITS = ['turbo' => 5, 'pro' => 15, 'max' => 35, 'ultra' => 20];

    /** How long a pass takes when the atlas does not say, in milliseconds. */
    private const FALLBACK_MS = 2000;

    /** @var Closure|null fn(string $what, array $detail): the run's trace */
    private ?Closure $trace = null;

    /** @var Closure|null fn(string $message) */
    private ?Closure $log = null;

    /** Finishing a run offline: what was made before is used, and nothing new is asked for. */
    private bool $offline = false;

    /**
     * @param  HttpClient  $http  for reads: polling jobs and downloading sheets (may retry)
     * @param  HttpClient  $once  for the upload and the animations request: must NOT retry (see above)
     * @param  string[]  $animations  QBL names to ask for; empty: all of ANIMATIONS
     * @param  int  $frames  frames per animation (2-16: sixteen 256 px cells are a 4096 px row, the most a phone's GPU takes)
     * @param  int  $timeout  seconds to wait for the jobs before going on without the slow ones (a resume collects them)
     */
    public function __construct(
        private HttpClient $http,
        private HttpClient $once,
        private string $apiKey,
        private array $animations = [],
        private string $tier = 'turbo',
        private int $frames = 16,
        private int $frameSize = 256,
        private string $removeBg = 'default',
        private string $baseUrl = 'https://www.autosprite.io/api/v1',
        private int $timeout = 900,
        private ?Spend $spend = null,
        private ?Closure $sleep = null,
    ) {
        if ($this->apiKey === '') {
            throw new GenerationError('AUTOSPRITE_API_KEY is not set.');
        }
        if (! isset(self::CREDITS[$this->tier])) {
            throw new GenerationError("Unknown AutoSprite video tier \"{$this->tier}\": use turbo, pro, max or ultra.");
        }
        $unknown = array_diff($this->animations, array_keys(self::ANIMATIONS));
        if ($unknown) {
            throw new GenerationError('AutoSprite cannot make these animations: '.implode(', ', $unknown).'. Choose from '.implode(', ', array_keys(self::ANIMATIONS)).'.');
        }
        $this->frames = max(2, min(16, $this->frames));
        $this->frameSize = max(32, min(512, $this->frameSize));
    }

    /** Where each step goes in the run's trace, and the log. */
    public function observe(?callable $trace, ?callable $log): void
    {
        $this->trace = $trace ? Closure::fromCallable($trace) : null;
        $this->log = $log ? Closure::fromCallable($log) : null;
    }

    /** Use only what earlier sessions of the run made (and fetch jobs they started): `qbl:generate --offline`. */
    public function offline(): void
    {
        $this->offline = true;
    }

    public function describe(): string
    {
        return "autosprite:{$this->tier}";
    }

    public function animationsFor(array $needed): array
    {
        $configured = $this->animations ?: array_keys(self::ANIMATIONS);
        // What the mission plays first (idle and walk always), then the rest, in ANIMATIONS' order.
        $first = array_values(array_intersect(array_keys(self::ANIMATIONS), ['idle', 'walk', ...$needed]));
        $rest = array_values(array_intersect(array_keys(self::ANIMATIONS), $configured));

        return array_slice(array_values(array_unique([...$first, ...$rest])), 0, self::PER_REQUEST);
    }

    public function estimateUsd(array $needed): float
    {
        return count($this->animationsFor($needed)) * ($this->spend ?? new Spend)->pictureCost('autosprite', $this->tier);
    }

    public function animate(string $key, string $name, string $description, string $sheetPath, array $needed, string $dir): array
    {
        $sheetBytes = (string) @file_get_contents($sheetPath);
        if ($sheetBytes === '') {
            throw new GenerationError("The character sheet for $key is missing ($sheetPath).");
        }
        $stateFile = "$dir/autosprite-".self::slug($key).'.json';
        $state = is_file($stateFile) ? (json_decode((string) file_get_contents($stateFile), true) ?: []) : [];
        if (($state['sheet_sha1'] ?? null) !== sha1($sheetBytes)) {
            // A different drawing of them (or the first time): what was made before is of another picture.
            $state = ['sheet_sha1' => sha1($sheetBytes)];
        }
        $save = function () use (&$state, $stateFile) {
            file_put_contents($stateFile, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        };

        if ($this->offline && empty($state['requested'])) {
            return $this->result([], [], 'the run is being finished offline, and nothing was asked of AutoSprite for this character before');
        }

        // ------------------------------------------------------------ 1. the character (free)
        if (empty($state['character_id']) && empty($state['requested'])) {
            try {
                $state['character_id'] = $this->upload($key, $name, $description, $sheetPath, $dir);
            } catch (GenerationError $e) {
                // Nothing was asked for: nothing spent, and a resumed run may try again.
                return $this->result([], [], 'AutoSprite did not take the character: '.$e->getMessage());
            }
            $save();
        }

        // ------------------------------------------------------------ 2. THE request: every animation, once
        if (empty($state['requested'])) {
            $wanted = $this->animationsFor($needed);
            $this->spend?->checkLimit("asking AutoSprite to animate $name");
            $body = $this->requestBody($wanted);
            // Written down before it is sent: whatever happens next, this character is never asked for again.
            $state['requested'] = gmdate('c');
            $state['wanted'] = $wanted;
            $state['request'] = $body;
            $save();
            $this->say(sprintf('Asking AutoSprite for %s\'s %d animations in one request: %s', $name, count($wanted), implode(', ', $wanted)));
            $this->spend?->at("autosprite:$key", 1, "$name: animations");
            $started = microtime(true);
            try {
                $response = $this->once->send('POST', $this->url('/characters/'.rawurlencode((string) $state['character_id']).'/spritesheets'), $this->headers(), $body, timeout: 120);
            } catch (Throwable $e) {
                // No answer: it may or may not have been taken. Not asked again; step 3 looks for its jobs.
                $state['lost'] = $e->getMessage();
                $save();
                $this->note('autosprite-request', ['character' => $key, 'character_id' => $state['character_id'], 'request' => $body, 'error' => 'no answer: '.$e->getMessage()]);
                $response = null;
            }
            if ($response !== null) {
                $data = self::json($response);
                $this->note('autosprite-request', ['character' => $key, 'character_id' => $state['character_id'], 'request' => $body, 'status' => $response->status, 'answer' => $data, 'seconds' => round(microtime(true) - $started, 2)]);
                if (! $response->ok()) {
                    // Refused outright (no credits, no plan, a bad field): nothing was made or charged.
                    $state['refused'] = self::problem($response, $data);
                    $save();
                } else {
                    $state['jobs'] = $this->jobsFrom($wanted, $data);
                    $state['credits_used'] = $data['creditsUsed'] ?? null;
                    foreach ($data['failed'] ?? [] as $f) {
                        $state['missing'][$this->nameFor($wanted, (string) ($f['kind'] ?? ''), array_column($state['jobs'], 'name'), $state['missing'] ?? []) ?? (string) ($f['kind'] ?? '?')] = 'AutoSprite could not start it: '.($f['error'] ?? 'no reason given');
                    }
                    $seconds = (microtime(true) - $started) / max(1, count($state['jobs']));
                    foreach ($state['jobs'] as $job) {
                        $this->spend?->picture('autosprite', $this->tier, 'animation', 0, $seconds);
                    }
                    $save();
                }
            }
        }
        if (! empty($state['refused'])) {
            return $this->result([], [], (string) $state['refused']);
        }

        // ------------------------------------------------------------ 3 and 4. wait, then fetch (reads only)
        if (! empty($state['lost']) && ! isset($state['jobs'])) {
            $state['jobs'] = $this->findJobs((string) $state['character_id']);
            $save();
            if (! $state['jobs']) {
                $state['refused'] = 'AutoSprite did not answer the request and has no jobs for the character: it was not taken ('.$state['lost'].')';
                $save();

                return $this->result([], [], (string) $state['refused']);
            }
        }
        $this->collect($key, $name, $state, $save, $dir);

        $animations = [];
        foreach ($state['jobs'] ?? [] as $job) {
            if (isset($job['name'], $job['frames']) && $job['frames'] && ! array_filter($job['frames'], fn ($f) => ! is_file($f))) {
                $animations[$job['name']] = ['frames' => $job['frames'], 'pivot' => $job['pivot'] ?? null, 'duration' => (int) $job['duration'], 'loops' => in_array($job['name'], self::LOOPS, true)];
            }
        }
        $missing = (array) ($state['missing'] ?? []);
        foreach ($state['wanted'] ?? [] as $w) {
            if (! isset($animations[$w]) && ! isset($missing[$w])) {
                $missing[$w] = 'AutoSprite is still making it: resume the run to collect it (it will not be asked for again)';
            }
        }

        return $this->result($animations, array_diff_key($missing, $animations), null);
    }

    /** The body of the one request: every animation, with the same frames, size and background removal. */
    private function requestBody(array $wanted): array
    {
        $animations = [];
        foreach ($wanted as $w) {
            $entry = self::ANIMATIONS[$w];
            if (in_array($w, self::SEAMLESS, true) && $this->tier !== 'ultra') {
                $entry['loop'] = true;
            }
            $animations[] = $entry;
        }

        return ['animations' => $animations, 'videoTier' => $this->tier, 'frameCount' => $this->frames, 'frameSize' => $this->frameSize, 'removeBg' => $this->removeBg];
    }

    /**
     * Each workflow in the answer, matched to the animation it is for: by kind, in the order asked
     * (only one custom animation is asked for, so "custom" is never ambiguous).
     */
    private function jobsFrom(array $wanted, array $data): array
    {
        $jobs = [];
        foreach ($data['workflows'] ?? [] as $w) {
            $jobs[] = [
                'name' => $this->nameFor($wanted, (string) ($w['kind'] ?? ''), array_column($jobs, 'name'), []),
                'kind' => $w['kind'] ?? null, 'job_id' => (string) ($w['jobId'] ?? ''), 'video_id' => $w['videoId'] ?? null,
            ];
        }

        return array_values(array_filter($jobs, fn ($j) => $j['job_id'] !== ''));
    }

    /** The first animation asked for with this AutoSprite kind that is not yet matched. */
    private function nameFor(array $wanted, string $kind, array $taken, array $missing): ?string
    {
        foreach ($wanted as $w) {
            if ((self::ANIMATIONS[$w]['kind'] ?? null) === $kind && ! in_array($w, $taken, true) && ! isset($missing[$w])) {
                return $w;
            }
        }

        return null;
    }

    /** After an answer that never came: the character's jobs, if the request was taken after all. */
    private function findJobs(string $characterId): array
    {
        $this->pause(10);
        $data = $this->get('/jobs?characterId='.rawurlencode($characterId).'&limit=50');
        $jobs = array_map(fn ($j) => ['name' => null, 'kind' => null, 'job_id' => (string) ($j['jobId'] ?? '')], (array) ($data['jobs'] ?? []));
        $this->note('autosprite-recover', ['character_id' => $characterId, 'jobs' => array_column($jobs, 'job_id')]);

        return array_values(array_filter($jobs, fn ($j) => $j['job_id'] !== ''));
    }

    /**
     * Poll every unfinished job (all of them each round, as AutoSprite advises: about ten seconds, then
     * every five) until each has succeeded or failed or the time is up; fetch each sheet as it finishes.
     */
    private function collect(string $key, string $name, array &$state, callable $save, string $dir): void
    {
        $open = fn () => array_keys(array_filter($state['jobs'] ?? [], fn ($j) => empty($j['frames']) && empty($j['failed'])));
        if (! $open()) {
            return;
        }
        $this->say(sprintf('Waiting for AutoSprite to animate %s (%d animations)', $name, count($open())));
        $rounds = (int) ceil(max(10, $this->timeout - 10) / 5) + 1;
        $this->pause(10);
        for ($round = 0; $round < $rounds && $open(); $round++) {
            if ($round > 0) {
                $this->pause(5);
            }
            foreach ($open() as $i) {
                $job = &$state['jobs'][$i];
                try {
                    $status = $this->get('/jobs/'.rawurlencode($job['job_id']));
                } catch (GenerationError $e) {
                    unset($job);
                    $this->say("Could not ask AutoSprite about a job ({$e->getMessage()}); asking again shortly");

                    continue;
                }
                $job['status'] = $status['status'] ?? null;
                if (($status['status'] ?? '') === 'failed') {
                    $job['failed'] = true;
                    $state['missing'][$job['name'] ?? ($job['kind'] ?? $job['job_id'])] = 'AutoSprite failed: '.($status['error'] ?? 'no reason given');
                    $this->note('autosprite-failed', ['character' => $key, 'animation' => $job['name'], 'job' => $job['job_id'], 'error' => $status['error'] ?? null]);
                } elseif (($status['status'] ?? '') === 'succeeded') {
                    $sheetId = (string) (($status['spritesheetIds'] ?? [])[0] ?? '');
                    try {
                        if ($sheetId === '') {
                            throw new GenerationError('the job finished without a sprite sheet');
                        }
                        $job = $this->fetchSheet($key, $sheetId, $job, $dir);
                        $this->say("AutoSprite animated $name: {$job['name']} (".count($job['frames']).' frames)');
                    } catch (GenerationError $e) {
                        // A download that failed is tried again next round; a sheet that cannot be read is given up.
                        if (str_contains($e->getMessage(), 'cannot be read')) {
                            $job['failed'] = true;
                            $state['missing'][$job['name'] ?? $sheetId] = $e->getMessage();
                        }
                        $this->say("Could not fetch $name's {$job['name']} from AutoSprite: ".$e->getMessage());
                    }
                }
                unset($job);
                $save();
            }
        }
    }

    /** One finished sheet: its details, the PNG and the atlas, cut into frames kept as files. */
    private function fetchSheet(string $key, string $sheetId, array $job, string $dir): array
    {
        $sheet = $this->get('/spritesheets/'.rawurlencode($sheetId));
        // A job found after a lost answer only learns what it is from its sheet.
        $job['name'] ??= $this->nameFor(array_keys(self::ANIMATIONS), (string) ($sheet['kind'] ?? ''), [], []);
        if ($job['name'] === null) {
            throw new GenerationError("a sheet of an animation that was not asked for ({$sheet['kind']}) cannot be read as one of ours");
        }
        $png = $this->download((string) ($sheet['sheetUrl'] ?? ''));
        $atlas = ($sheet['atlasUrl'] ?? '') !== '' ? json_decode($this->download((string) $sheet['atlasUrl']), true) : null;
        try {
            $image = ImageTools::load($png);
        } catch (GenerationError) {
            throw new GenerationError("the sheet for {$job['name']} cannot be read as a picture");
        }
        $boxes = self::frameBoxes(is_array($atlas) ? $atlas : [], $sheet, imagesx($image), imagesy($image));
        if (! $boxes) {
            throw new GenerationError("the sheet for {$job['name']} cannot be read: it says nothing about its frames");
        }
        $files = [];
        foreach ($boxes as $i => [$x, $y, $w, $h]) {
            $files[] = $file = "$dir/autosprite-".self::slug($key)."-{$job['name']}-$i.png";
            file_put_contents($file, ImageTools::png(ImageTools::crop($image, $x, $y, $w, $h)));
        }
        // Where the feet stand, as a fraction of the cell: the same for every frame, so the motion is kept.
        $pivot = $atlas['meta']['pivot'] ?? null;
        [, , $cw, $ch] = $boxes[0];
        $seconds = (float) ($atlas['meta']['duration_s'] ?? 0);
        $fps = (float) ($atlas['meta']['fps'] ?? 0);
        $ms = $seconds > 0 ? $seconds * 1000 : ($fps > 0 ? count($boxes) / $fps * 1000 : self::FALLBACK_MS);
        $speed = (float) ($sheet['speedMultiplier'] ?? 1) ?: 1.0;
        $this->note('autosprite-sheet', ['character' => $key, 'animation' => $job['name'], 'job' => $job['job_id'], 'spritesheet' => $sheetId, 'kind' => $sheet['kind'] ?? null, 'frames' => count($files), 'meta' => $atlas['meta'] ?? null]);

        return $job + [
            'spritesheet_id' => $sheetId,
            'frames' => $files,
            'pivot' => is_array($pivot) && isset($pivot['x'], $pivot['y']) ? [(float) $pivot['x'] * $cw, (float) $pivot['y'] * $ch] : null,
            'duration' => max(200, (int) round($ms / $speed)),
        ];
    }

    /**
     * The frames' boxes [x, y, w, h], in order: from the atlas (frames keyed "0", "1", ..., or a
     * TexturePacker-style list), else from the grid the sheet's details describe.
     *
     * @return array<int, array{0: int, 1: int, 2: int, 3: int}>
     */
    public static function frameBoxes(array $atlas, array $sheet, int $width, int $height): array
    {
        $frames = $atlas['frames'] ?? [];
        $boxes = [];
        if (is_array($frames) && $frames) {
            if (! array_is_list($frames)) {
                uksort($frames, fn ($a, $b) => (int) preg_replace('/\D+/', '', (string) $a) <=> (int) preg_replace('/\D+/', '', (string) $b));
            }
            foreach ($frames as $f) {
                $f = isset($f['frame']) && is_array($f['frame']) ? $f['frame'] : $f;
                if (isset($f['x'], $f['y'], $f['w'], $f['h'])) {
                    $boxes[] = [(int) $f['x'], (int) $f['y'], (int) $f['w'], (int) $f['h']];
                }
            }
        }
        if (! $boxes && ($fw = (int) ($sheet['frameWidth'] ?? 0)) > 0 && ($fh = (int) ($sheet['frameHeight'] ?? 0)) > 0) {
            $columns = max(1, (int) ($sheet['columns'] ?? intdiv($width, $fw)));
            $count = (int) ($sheet['frameCount'] ?? $columns * intdiv($height, $fh));
            for ($i = 0; $i < $count; $i++) {
                $boxes[] = [($i % $columns) * $fw, intdiv($i, $columns) * $fh, $fw, $fh];
            }
        }

        // Never outside the picture.
        return array_values(array_filter($boxes, fn ($b) => $b[2] > 0 && $b[3] > 0 && $b[0] >= 0 && $b[1] >= 0 && $b[0] + $b[2] <= $width && $b[1] + $b[3] <= $height));
    }

    private function upload(string $key, string $name, string $description, string $sheetPath, string $dir): string
    {
        // Names must be unique in the account: the run and the drawing make it so.
        $tag = substr(sha1($dir.'|'.$key.'|'.sha1_file($sheetPath)), 0, 8);
        $body = [
            'name' => mb_substr("QBL $name", 0, 88)." $tag",
            'image' => new CURLFile($sheetPath, 'image/png', self::slug($key).'.png'),
            'isHumanoid' => 'true',
            'characterDescription' => mb_substr("$name: $description", 0, 1000),
        ];
        $response = $this->once->send('POST', $this->url('/characters'), $this->headers(), $body, multipart: true, timeout: 120);
        $data = self::json($response);
        $this->note('autosprite-character', ['character' => $key, 'name' => $body['name'], 'status' => $response->status, 'answer' => $data]);
        if (! $response->ok() || empty($data['id'])) {
            throw new GenerationError(self::problem($response, $data));
        }

        return (string) $data['id'];
    }

    private function get(string $path): array
    {
        $response = $this->http->send('GET', $this->url($path), $this->headers(), timeout: 60);
        $data = self::json($response);
        if (! $response->ok()) {
            throw new GenerationError(self::problem($response, $data));
        }

        return $data;
    }

    /** A presigned file: no key is sent (it is not AutoSprite's own address, and the signature is the permission). */
    private function download(string $url): string
    {
        if ($url === '') {
            throw new GenerationError('AutoSprite gave no address for the file');
        }
        $response = $this->http->send('GET', $url, [], timeout: 120);
        if (! $response->ok()) {
            throw new GenerationError("the download failed ({$response->status})");
        }

        return $response->body;
    }

    private function headers(): array
    {
        return ['x-api-key' => $this->apiKey, 'Accept' => 'application/json'];
    }

    private function url(string $path): string
    {
        return rtrim($this->baseUrl, '/').$path;
    }

    private static function json(HttpResponse $response): array
    {
        $data = json_decode($response->body, true);

        return is_array($data) ? $data : [];
    }

    /** "INSUFFICIENT_CREDITS (402): Not enough credits for all animations" */
    private static function problem(HttpResponse $response, array $data): string
    {
        $error = $data['error'] ?? null;
        $code = is_array($error) ? ($error['code'] ?? null) : null;
        $message = is_array($error) ? ($error['message'] ?? null) : (is_string($error) ? $error : null);

        return trim(($code ? "$code " : '')."({$response->status}): ".($message ?? mb_substr($response->body, 0, 200)));
    }

    private function result(array $animations, array $missing, ?string $refused): array
    {
        if ($refused !== null) {
            $this->say('AutoSprite: '.$refused);
        }

        return ['animations' => $animations, 'missing' => $missing, 'refused' => $refused];
    }

    private function pause(int $seconds): void
    {
        $this->sleep ? ($this->sleep)($seconds) : sleep($seconds);
    }

    private function note(string $what, array $detail): void
    {
        $this->trace && ($this->trace)($what, $detail);
    }

    private function say(string $message): void
    {
        $this->log && ($this->log)($message);
    }

    private static function slug(string $key): string
    {
        return preg_replace('/[^a-z0-9_-]+/', '-', strtolower($key));
    }
}
