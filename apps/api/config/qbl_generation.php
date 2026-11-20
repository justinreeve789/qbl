<?php

/**
 * The AI scenario generator: `php artisan qbl:generate "..."`. See docs/src/content/docs/developers/generation.md.
 *
 * Every value comes from the environment (.env); what is written here is only the fallback when a
 * variable is missing or empty. Nothing here is needed to run QBL; it is only read when a scenario is
 * generated.
 */
$env = fn (string $key, mixed $default) => ($v = env($key)) === null || $v === '' ? $default : $v;

return [
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
        // Scenario (scenario.com), with a model trained on the house style. See docs/src/content/docs/developers/generation.md.
        'scenario' => [
            'api_key' => (string) $env('SCENARIO_API_KEY', ''),
            'api_secret' => (string) $env('SCENARIO_API_SECRET', ''),
            'model_id' => (string) $env('SCENARIO_MODEL_ID', ''),
            'base_url' => $env('SCENARIO_BASE_URL', 'https://api.cloud.scenario.com/v1'),
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
    ],

    // Every picture is checked against the style's anchors before it is kept.
    'judge' => [
        'enabled' => filter_var($env('QBL_GEN_JUDGE', true), FILTER_VALIDATE_BOOL),
        // Out of 10. Below this the picture is drawn again, with the judge's notes added to the prompt.
        'min_score' => (float) $env('QBL_GEN_JUDGE_MIN_SCORE', 7),
        'max_attempts' => (int) $env('QBL_GEN_MAX_ATTEMPTS', 3),
    ],

    // Curriculum standards come from the curriculum_standards table, filled by `php artisan qbl:standards`.
    'standards' => [
        // https://platform.learningcommons.org: every US state's standards and CCSS, with CASE identifiers.
        'learning_commons_api_key' => (string) $env('LEARNING_COMMONS_API_KEY', ''),
        'learning_commons_base_url' => $env('LEARNING_COMMONS_BASE_URL', 'https://api.learningcommons.org/knowledge-graph/v0'),
        // https://commonstandardsproject.com: standard sets by id.
        'csp_api_key' => (string) $env('CSP_API_KEY', ''),
        'csp_base_url' => $env('CSP_BASE_URL', 'https://api.commonstandardsproject.com/api/v1'),
    ],

    // The most the mission designer may put in one mission.
    'limits' => [
        'max_scenes' => (int) $env('QBL_GEN_MAX_SCENES', 8),
        'max_characters' => (int) $env('QBL_GEN_MAX_CHARACTERS', 6),
        'max_items' => (int) $env('QBL_GEN_MAX_ITEMS', 14),
    ],
];
