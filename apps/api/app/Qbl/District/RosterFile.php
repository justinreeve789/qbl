<?php

namespace App\Qbl\District;

use App\Qbl\Api\Privacy;
use App\Qbl\StoreError;

/**
 * A roster as a CSV file, uploaded in the district admin panel: the same thing the public API's
 * batch upserts do, for districts without a program to call it. One row per person:
 *
 *   role,external_id,school_id,school_name,grade_level,teacher_ids,status
 *   teacher,T-1001,SCH-1,Lincoln Elementary,,,
 *   student,S-2001,SCH-1,Lincoln Elementary,4,T-1001;T-1002,active
 *
 * Only role and external_id are needed. teacher_ids lists a student's teachers by their
 * external_id, separated by ";". A column that would identify someone (name, email, birth date...)
 * makes QBL refuse the whole file, before anything is read from it.
 */
class RosterFile
{
    public const COLUMNS = ['role', 'external_id', 'school_id', 'school_name', 'grade_level', 'teacher_ids', 'status'];

    public const MAX_ROWS = 20000;

    /** @return array RosterSync's shape */
    public static function read(string $path): array
    {
        $handle = @fopen($path, 'r');
        if (! $handle) {
            throw new StoreError(422, 'The file could not be read.');
        }
        try {
            $header = fgetcsv($handle, 0, ',', '"', '');
            if (! $header) {
                throw new StoreError(422, 'The file is empty.');
            }
            $header = array_map(fn ($h) => strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', (string) $h))), $header);
            $pii = array_values(array_intersect($header, Privacy::PII_FIELDS));
            if ($pii) {
                throw new StoreError(422, 'QBL does not store personally identifiable information, so the file was not read. Remove these columns: '.implode(', ', $pii).'.');
            }
            $unknown = array_diff(array_filter($header, 'strlen'), self::COLUMNS);
            if ($unknown) {
                throw new StoreError(422, 'Unknown columns: '.implode(', ', $unknown).'. The columns are: '.implode(', ', self::COLUMNS).'.');
            }
            foreach (['role', 'external_id'] as $needed) {
                if (! in_array($needed, $header, true)) {
                    throw new StoreError(422, "The file needs a \"$needed\" column.");
                }
            }

            $schools = [];
            $teachers = [];
            $students = [];
            $line = 1;
            while (($cells = fgetcsv($handle, 0, ',', '"', '')) !== false) {
                $line++;
                if ($cells === [null] || ! array_filter($cells, fn ($c) => trim((string) $c) !== '')) {
                    continue;
                }
                if ($line > self::MAX_ROWS + 1) {
                    throw new StoreError(422, 'Upload at most '.self::MAX_ROWS.' people in one file.');
                }
                $row = [];
                foreach ($header as $i => $name) {
                    $row[$name] = trim((string) ($cells[$i] ?? ''));
                }
                $role = strtolower($row['role']);
                if (! in_array($role, ['student', 'teacher'], true)) {
                    throw new StoreError(422, "Line $line: role is student or teacher.");
                }
                try {
                    $ext = Privacy::externalId($row['external_id']);
                } catch (\Throwable $e) {
                    throw new StoreError(422, "Line $line: ".$e->getMessage());
                }
                $person = ['external_id' => $ext];
                $status = strtolower($row['status'] ?? '');
                if ($status !== '' && ! in_array($status, ['active', 'inactive'], true)) {
                    throw new StoreError(422, "Line $line: status is active or inactive.");
                }
                if ($status === 'inactive') {
                    $person['status'] = 'inactive';
                }
                if (($row['school_id'] ?? '') !== '') {
                    $person['school'] = $row['school_id'];
                    $schools[$row['school_id']] ??= ['external_id' => $row['school_id'], 'name' => $row['school_name'] ?? ''];
                    if (($row['school_name'] ?? '') !== '') {
                        $schools[$row['school_id']]['name'] = $row['school_name'];
                    }
                }
                if ($role === 'teacher') {
                    $teachers[$ext] = $person;
                } else {
                    if (($row['grade_level'] ?? '') !== '') {
                        $person['grade_level'] = $row['grade_level'];
                    }
                    $person['teachers'] = array_values(array_filter(array_map('trim', preg_split('/[;|]/', $row['teacher_ids'] ?? '')), 'strlen'));
                    $students[$ext] = $person;
                }
            }
        } finally {
            fclose($handle);
        }
        if (! $teachers && ! $students) {
            throw new StoreError(422, 'The file has nobody in it.');
        }

        return ['schools' => array_values($schools), 'teachers' => array_values($teachers), 'students' => array_values($students)];
    }
}
