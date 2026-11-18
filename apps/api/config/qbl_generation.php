<?php

/**
 * The AI scenario generator: `php artisan qbl:generate "..."`. See docs/docs/generation.md.
 *
 * Nothing here is needed to run QBL; it is only read when a scenario is generated.
 */
return [
    // Writes the mission: its story, scenes, characters, dialogue, events and questions. Also aligns it
    // to standards and, with judge.enabled, looks at every picture to check it matches the art style.
    'llm' => [
        'api_key' => env('ANTHROPIC_API_KEY', ''),
        'model' => env('QBL_GEN_LLM_MODEL', 'claude-opus-5-5'),
        // The style judge looks at many pictures; a faster model is enough for that.
        'judge_model' => env('QBL_GEN_JUDGE_MODEL', 'claude-sonnet-5-5'),
        'base_url' => env('ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
    ],

    // Draws the pictures. gemini | openai | scenario | placeholder.
    // "placeholder" draws flat labelled shapes locally, with no service: for trying the pipeline out.
    'images' => [
        'driver' => env('QBL_GEN_IMAGE_DRIVER', 'gemini'),
        'gemini' => [
            'api_key' => env('GEMINI_API_KEY', ''),
            // Takes up to 14 reference images, which is what keeps every picture in one style.
            'model' => env('QBL_GEN_GEMINI_MODEL', 'gemini-3-pro-image-preview'),
            'base_url' => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
        ],
        'openai' => [
            'api_key' => env('OPENAI_API_KEY', ''),
            'model' => env('QBL_GEN_OPENAI_MODEL', 'gpt-image-2'),
            'quality' => env('QBL_GEN_OPENAI_QUALITY', 'high'),
            'base_url' => env('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
        ],
        // Scenario (scenario.com): a model trained on the house style gives the tightest consistency
        // of all, once 15-30 approved pictures exist to train it on. See docs/docs/generation.md.
        'scenario' => [
            'api_key' => env('SCENARIO_API_KEY', ''),
            'api_secret' => env('SCENARIO_API_SECRET', ''),
            'model_id' => env('SCENARIO_MODEL_ID', ''),
            'base_url' => env('SCENARIO_BASE_URL', 'https://api.cloud.scenario.com/v1'),
        ],
    ],

    // The art style every picture is drawn in: a folder under styles_dir with style.php and anchors/.
    'style' => env('QBL_GEN_STYLE', 'qbl-cartoon'),
    'styles_dir' => env('QBL_GEN_STYLES_DIR', resource_path('art-styles')),

    // Each run keeps its pictures, prompts and answers here, so an interrupted run can be resumed
    // (`qbl:generate --resume=ID`) without paying for anything twice.
    'work_dir' => env('QBL_GEN_WORK_DIR', storage_path('app/generations')),

    // Every picture is checked against the style's anchors before it is kept.
    'judge' => [
        'enabled' => (bool) env('QBL_GEN_JUDGE', true),
        // Out of 10. Below this the picture is drawn again, with the judge's notes added to the prompt.
        'min_score' => (int) env('QBL_GEN_JUDGE_MIN_SCORE', 7),
        'max_attempts' => (int) env('QBL_GEN_MAX_ATTEMPTS', 3),
    ],

    // Curriculum standards come from the curriculum_standards table, filled by `php artisan qbl:standards`.
    'standards' => [
        // https://commonstandardsproject.com: standards of every US state and of CCSS and NGSS.
        'csp_api_key' => env('CSP_API_KEY', ''),
        'csp_base_url' => env('CSP_BASE_URL', 'https://api.commonstandardsproject.com/api/v1'),
        // https://platform.learningcommons.org: every US state's standards and CCSS, with CASE identifiers.
        'learning_commons_api_key' => env('LEARNING_COMMONS_API_KEY', ''),
    ],

    'limits' => [
        'max_scenes' => 8,
        'max_characters' => 6,
        'max_items' => 14,
    ],
];
