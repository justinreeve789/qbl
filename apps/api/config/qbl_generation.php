<?php

/**
 * The AI scenario generator: `php artisan qbl:generate "..."`. See docs/src/content/docs/developers/generation.mdx.
 *
 * Every value comes from the environment (.env); what is written here is only the fallback when a
 * variable is missing or empty. Nothing here is needed to run QBL; it is only read when a scenario is
 * generated.
 */
$env = fn (string $key, mixed $default) => ($v = env($key)) === null || $v === '' ? $default : $v;

return [
    // How scenarios are made: which steps, in what order, and who does each job (see
    // app/Qbl/Generation/Methods). classic | draft | gemini-judge | sprite-app | critic | best-of |
    // outline-first. `php artisan qbl:generate --list-methods` says what each one does; --method=...
    // chooses one for a single run.
    'method' => $env('QBL_GEN_METHOD', 'classic'),
    // Methods of your own, without editing GenerationMethods: JSON like {"mine": "App\\Qbl\\Generation\\Methods\\MyMethod"}.
    'methods' => (array) (json_decode((string) $env('QBL_GEN_METHODS', '{}'), true) ?: []),
    // Each method's own settings (read with GenerationMethod::setting()).
    'method_options' => [
        'gemini-judge' => [
            'min_score' => (float) $env('QBL_GEN_GJ_MIN_SCORE', 8),
            'attempts' => (int) $env('QBL_GEN_GJ_ATTEMPTS', 4),
        ],
        'sprite-app' => [
            // Which driver draws characters, animations and props; the scenes come from images.driver.
            'sprite_driver' => $env('QBL_GEN_SPRITE_DRIVER', 'scenario'),
            // Which kinds of picture count as sprites (comma-separated). Empty: the method's default list.
            'sprite_kinds' => $env('QBL_GEN_SPRITE_KINDS', '') ?: null,
        ],
        'critic' => [
            'rounds' => (int) $env('QBL_GEN_CRITIC_ROUNDS', 2),
            'pass' => (float) $env('QBL_GEN_CRITIC_PASS', 8),
        ],
        'best-of' => [
            'candidates' => (int) $env('QBL_GEN_BEST_OF', 3),
        ],
    ],

    // Every step of a run and every call it makes to an AI service, written to the run's work folder
    // (trace/README.md first), for developers. Read it with `php artisan qbl:generation-trace <run>`.
    'trace' => [
        'enabled' => filter_var($env('QBL_GEN_TRACE', true), FILTER_VALIDATE_BOOL),
        // thumb: a 512 px copy of every picture sent or received; full: the pictures as they were; none: only their hashes.
        'pictures' => $env('QBL_GEN_TRACE_PICTURES', 'thumb'),
    ],

    // Writes the mission: its story, scenes, characters, dialogue, events and questions. Also aligns it
    // to standards and, with judge.enabled, looks at every picture to check it matches the art style.
    'llm' => [
        'api_key' => (string) $env('ANTHROPIC_API_KEY', ''),
        'model' => $env('QBL_GEN_LLM_MODEL', 'claude-opus-5-5'),
        // The style judge looks at many pictures; a faster model is enough for that.
        'judge_model' => $env('QBL_GEN_JUDGE_MODEL', 'claude-sonnet-5-5'),
        // Choosing standards from a list and writing objectives is a smaller job than the mission itself.
        'align_model' => $env('QBL_GEN_ALIGN_MODEL', 'claude-sonnet-5-5'),
        'base_url' => $env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
        // The models think before they answer (Opus 5.5 always does), and thinking counts toward each
        // answer's token limit. This much room is added to every answer's limit for it. Only a ceiling:
        // what is not used is not paid for.
        'thinking_tokens' => (int) $env('QBL_GEN_THINKING_TOKENS', 32000),
        // How hard the models think: low, medium, high, xhigh or max. Empty = each model's default
        // (medium on Opus 5.5, high on Sonnet 5.5). Lower is faster and cheaper.
        'effort' => (string) $env('QBL_GEN_LLM_EFFORT', ''),
        // Seconds to wait for one answer. Writing the mission can take many minutes.
        'timeout' => (int) $env('QBL_GEN_LLM_TIMEOUT', 1800),
    ],

    // Draws the pictures. gemini | openai | scenario | placeholder.
    // "placeholder" draws flat labelled shapes locally, with no service: for trying the pipeline out.
    'images' => [
        'driver' => $env('QBL_GEN_IMAGE_DRIVER', 'gemini'),
        'gemini' => [
            'api_key' => (string) $env('GEMINI_API_KEY', ''),
            // gemini-3-pro-image (Nano Banana Pro) or gemini-3.1-flash-image (Nano Banana 2, about half the price).
            // Both take up to 14 reference images, which is what keeps every picture in one style.
            'model' => $env('QBL_GEN_GEMINI_MODEL', 'gemini-3-pro-image'),
            // 1K, 2K or 4K. Backgrounds are 2250 x 1200, so 2K is enough.
            'image_size' => $env('QBL_GEN_GEMINI_IMAGE_SIZE', '2K'),
            // Small cut-outs (things, sheets of things, doors and holes, the badge) end up a few hundred
            // pixels across: a cheaper model and size is enough, and each is still judged. Set the model
            // to the main one to draw everything with it. Flash at 1K is half the price of Pro.
            'props_model' => $env('QBL_GEN_GEMINI_PROPS_MODEL', 'gemini-3.1-flash-image'),
            'props_size' => $env('QBL_GEN_GEMINI_PROPS_SIZE', '1K'),
            'base_url' => $env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
        ],
        'openai' => [
            'api_key' => (string) $env('OPENAI_API_KEY', ''),
            'model' => $env('QBL_GEN_OPENAI_MODEL', 'gpt-image-2'),
            'quality' => $env('QBL_GEN_OPENAI_QUALITY', 'high'),
            'base_url' => $env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        ],
        // Scenario (scenario.com), with a model trained on the house style. See docs/src/content/docs/developers/generation.mdx.
        'scenario' => [
            'api_key' => (string) $env('SCENARIO_API_KEY', ''),
            'api_secret' => (string) $env('SCENARIO_API_SECRET', ''),
            'model_id' => (string) $env('SCENARIO_MODEL_ID', ''),
            'base_url' => $env('SCENARIO_BASE_URL', 'https://api.cloud.scenario.com/v1'),
        ],
    ],

    // Who animates the characters. Each character's sheet is still drawn (and judged) by the image
    // driver above; the animator then makes all their animations from it.
    //   autosprite  AutoSprite (autosprite.io), the primary source: ONE request per character holding
    //               every animation (idle, walk, wave, cheer, point, think, talk, jump, dance, crouch),
    //               never repeated, not even on resume. Used whenever AUTOSPRITE_API_KEY is set.
    //   draw        each animation drawn as a strip by the image driver (the way before AutoSprite).
    // `qbl:generate --animations=draw` chooses for one run.
    'animations' => [
        'driver' => $env('QBL_GEN_ANIMATION_DRIVER', 'autosprite'),
        // When AutoSprite refuses a character outright (no credits, no plan; nothing spent): "draw" their
        // strips with the image driver instead, or "puppet" (a walk made from the standing picture, and the
        // game's built-in moves for gestures; no more requests to anyone).
        'fallback' => $env('QBL_GEN_ANIMATION_FALLBACK', 'draw'),
        'autosprite' => [
            // Needs a paid plan with API access (Pro). Keys start with vspk_: https://www.autosprite.io/app/api-keys
            'api_key' => (string) $env('AUTOSPRITE_API_KEY', ''),
            'base_url' => $env('AUTOSPRITE_BASE_URL', 'https://www.autosprite.io/api/v1'),
            // Which to ask for, comma-separated, from the list above. Empty: all ten (the most one request
            // holds). Walk, idle and the gestures the mission plays are always asked for.
            'animations' => $env('QBL_GEN_AUTOSPRITE_ANIMATIONS', ''),
            // turbo (5 credits an animation, 2 s), pro (15, 4 s), max (35, 4 s), ultra (10 a second).
            'video_tier' => $env('QBL_GEN_AUTOSPRITE_TIER', 'turbo'),
            // Frames per animation, 2-16 (sixteen 256 px cells make a 4096 px row, the most phones load).
            'frames' => (int) $env('QBL_GEN_AUTOSPRITE_FRAMES', 16),
            // Each frame's size in AutoSprite's sheet, 32-512 px (frames are scaled onto QBL's sheet after).
            'frame_size' => (int) $env('QBL_GEN_AUTOSPRITE_FRAME_SIZE', 256),
            // Background removal: default, or ultra (AutoSprite's AI removal; cleanest edges).
            'remove_bg' => $env('QBL_GEN_AUTOSPRITE_REMOVE_BG', 'default'),
            // Seconds to wait for a character's animations (they usually take 30-90). The slow ones are
            // collected by resuming the run; they are never asked for again.
            'timeout' => (int) $env('QBL_GEN_AUTOSPRITE_TIMEOUT', 900),
        ],
    ],

    // The art style every picture is drawn in: a folder under styles_dir with style.php and anchors/.
    'style' => $env('QBL_GEN_STYLE', 'qbl-adventure'),
    'styles_dir' => $env('QBL_GEN_STYLES_DIR', resource_path('art-styles')),

    // Each run keeps its pictures, prompts and answers here, so an interrupted run can be resumed
    // (`qbl:generate --resume=ID`) without paying for anything twice.
    'work_dir' => $env('QBL_GEN_WORK_DIR', storage_path('app/generations')),

    // What a run may spend on AI services, in US dollars (estimated from list prices). Past it, pictures
    // are no longer redrawn for a better score and extras are skipped; at twice it the run stops (resume
    // it with --budget=...). 0 for no budget. `qbl:generate --design-only` prints an estimate first.
    'budget' => (float) $env('QBL_GEN_BUDGET_USD', 5),
    // List prices, if they change or for another model: JSON like Spend::PRICES,
    // e.g. {"gemini-3-pro-image@2K": 0.134, "claude-opus-5-5": {"input": 4, "output": 20, "cache_read": 0.2, "cache_write": 5}}.
    'prices' => (array) (json_decode((string) $env('QBL_GEN_PRICES', '{}'), true) ?: []),

    // Pictures that are optional or can be made without drawing.
    'pictures' => [
        // crop: a character's portrait is their head and shoulders from their (large) character sheet,
        // free and always the same design. draw: a portrait drawn for it (one more picture each).
        'portraits' => $env('QBL_GEN_PORTRAITS', 'crop'),
        // Draw a breathing idle animation for each character; otherwise their standing picture is the idle.
        'idle_frames' => filter_var($env('QBL_GEN_IDLE_FRAMES', false), FILTER_VALIDATE_BOOL),
        // Draw a mission's small things several to a picture (a sheet cut apart) instead of one each.
        'prop_sheets' => filter_var($env('QBL_GEN_PROP_SHEETS', true), FILTER_VALIDATE_BOOL),
        // Send a scale guide (the floor and child-sized figures) with each background, so the scenery is
        // painted at the size of the people who walk in it.
        'scale_guide' => filter_var($env('QBL_GEN_SCALE_GUIDE', true), FILTER_VALIDATE_BOOL),
    ],

    // Every picture is checked against the style's anchors before it is kept.
    'judge' => [
        'enabled' => filter_var($env('QBL_GEN_JUDGE', true), FILTER_VALIDATE_BOOL),
        // Out of 10. Below this the picture is drawn again, with the judge's notes added to the prompt.
        'min_score' => (float) $env('QBL_GEN_JUDGE_MIN_SCORE', 7),
        'max_attempts' => (int) $env('QBL_GEN_MAX_ATTEMPTS', 3),
    ],

    // After the pictures, each background is read by a language model that can see (the judge's model):
    // where the floor really meets the buildings, walls and water (the walkable area is traced to the
    // painted line), and which things on the floor people walk around (cut out of the picture pixel for
    // pixel, with a sort line, so figures pass behind them). Off: the blueprint's plain floor.
    'survey' => [
        'enabled' => filter_var($env('QBL_GEN_SURVEY', true), FILTER_VALIDATE_BOOL),
    ],

    // Little life in scenes (birds, squirrels, cats, fish, cars...) comes from the asset library's
    // ready-made animals and vehicles where one fits (scenarios/assets/library), and is drawn only when
    // none does. Off: always drawn.
    'library_critters' => filter_var($env('QBL_GEN_LIBRARY_CRITTERS', true), FILTER_VALIDATE_BOOL),
    'library_dir' => $env('QBL_LIBRARY_DIR', null),

    // Curriculum standards come from the curriculum_standards table, filled by `php artisan qbl:standards`.
    'standards' => [
        // https://platform.learningcommons.org: every US state's standards and CCSS, with CASE identifiers.
        'learning_commons_api_key' => (string) $env('LEARNING_COMMONS_API_KEY', ''),
        'learning_commons_base_url' => $env('LEARNING_COMMONS_BASE_URL', 'https://api.learningcommons.org/knowledge-graph/v0'),
        // https://commonstandardsproject.com: standard sets by id.
        'csp_api_key' => (string) $env('CSP_API_KEY', ''),
        'csp_base_url' => $env('CSP_BASE_URL', 'https://api.commonstandardsproject.com/api/v1'),
    ],

    // How many missions, out of 1, may have a big tense moment (a character falls, is trapped or swept
    // away, and students save them). Kept rare so it stays special; decided by chance for each mission.
    'pacing' => [
        'big_moment_chance' => (float) $env('QBL_GEN_BIG_MOMENT_CHANCE', 0.25),
    ],

    // The most the mission designer may put in one mission.
    'limits' => [
        'max_scenes' => (int) $env('QBL_GEN_MAX_SCENES', 8),
        'max_characters' => (int) $env('QBL_GEN_MAX_CHARACTERS', 6),
        'max_items' => (int) $env('QBL_GEN_MAX_ITEMS', 18),
    ],
];
