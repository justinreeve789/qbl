<?php

namespace App\Qbl\Generation\Pipeline;

/**
 * One step of making a scenario: align, design, draw, build... A generation method is a list of
 * these (GenerationMethod::steps()), run in order by ScenarioGenerator.
 *
 * To write a step of your own:
 *
 *   final class MyStep extends Step
 *   {
 *       public function name(): string { return 'my-step'; }        // what the trace and --redo call it
 *       public function stage(): string { return 'designing'; }     // which part of the progress bar it belongs to
 *       public function run(GenerationRun $run): void
 *       {
 *           // read what earlier steps left on $run ($run->alignment, $run->blueprint...)
 *           // do the work: $run->method->model('my-job')->structured(...) is a traced language model
 *           // leave the result on $run for later steps, and $run->output('what', $value) to see it in the trace
 *       }
 *   }
 *
 * then put it in a method's steps(). Steps should be resumable: if what they make is already there
 * (a run that stopped and was resumed), call $run->skip('why') and return, so nothing is paid for twice.
 */
abstract class Step
{
    /** A short name, used in the trace's file names and by `qbl:generate --resume=ID --redo=<name>`. */
    abstract public function name(): string;

    /**
     * Which stage of the progress bar this step belongs to (GenerationProgress::STAGES): aligning,
     * designing, drawing, building, voicing or importing. Several steps can share one.
     */
    abstract public function stage(): string;

    /** Do the work. Read from and write to $run. */
    abstract public function run(GenerationRun $run): void;

    /**
     * `--redo=<this step>`: throw away what this step made in an earlier session of the run, so it
     * runs again (and so do the steps after it, which are forgotten too). Does nothing by default.
     */
    public function forget(GenerationRun $run): void {}
}
