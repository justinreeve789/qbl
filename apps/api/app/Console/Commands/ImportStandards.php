<?php

namespace App\Console\Commands;

use App\Qbl\Generation\Curriculum\StandardsImporter;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use Illuminate\Console\Command;

/**
 * Curriculum standards for the generator to align missions to.
 *
 *   php artisan qbl:standards                                         what is imported
 *   php artisan qbl:standards file storage/ngss-5.json --framework=NGSS
 *   php artisan qbl:standards learning-commons <framework uuid> --framework=CA-MATH [--grade=5]
 *   php artisan qbl:standards csp <standard set id> --framework=NGSS
 */
class ImportStandards extends Command
{
    protected $signature = 'qbl:standards
        {source? : file, learning-commons or csp}
        {id? : The file, the Learning Commons framework UUID, or the Common Standards Project standard set id}
        {--framework= : The short name missions refer to this set by (NGSS, CCSS-MATH, TX-TEKS-SCI)}
        {--jurisdiction= : For a file: whose standards these are}
        {--grade=* : Learning Commons: only these grades}';

    protected $description = 'Import curriculum standards for aligning generated missions';

    public function handle(GenerationFactory $factory): int
    {
        $store = $factory->standards();
        $source = $this->argument('source');
        try {
            if ($source) {
                $framework = (string) $this->option('framework');
                if ($framework === '' || ! $this->argument('id')) {
                    $this->error('Give the source\'s id or file and --framework=NAME.');

                    return self::FAILURE;
                }
                $importer = new StandardsImporter($store, $factory->http());
                $count = match ($source) {
                    'file' => $importer->fromFile((string) $this->argument('id'), $framework, $this->option('jurisdiction')),
                    'learning-commons' => $importer->fromLearningCommons((string) $factory->config('standards.learning_commons_api_key'), (string) $this->argument('id'), $framework, $this->option('grade'), (string) $factory->config('standards.learning_commons_base_url')),
                    'csp' => $importer->fromCommonStandardsProject((string) $factory->config('standards.csp_api_key'), (string) $this->argument('id'), $framework, (string) $factory->config('standards.csp_base_url')),
                    default => throw new GenerationError("Unknown source \"$source\": use file, learning-commons or csp."),
                };
                $this->info("Imported $count standards into $framework.");
            }
        } catch (GenerationError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $rows = $store->frameworks();
        if (! $rows) {
            $this->line('No standards imported yet.');
        } else {
            $this->table(['Framework', 'Jurisdiction', 'Subject', 'Standards'], array_map(fn ($r) => [$r['framework'], $r['jurisdiction'], $r['subject'], $r['standards']], $rows));
        }

        return self::SUCCESS;
    }
}
