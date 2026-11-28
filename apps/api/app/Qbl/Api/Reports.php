<?php

namespace App\Qbl\Api;

use App\Qbl\ActivityStore;
use App\Qbl\ClassStore;
use App\Qbl\ProgressStore;
use App\Qbl\Standards\StandardsStore;
use DateTimeImmutable;
use DateTimeZone;
use PDO;

/**
 * What an organization learns from QBL: grades, engagement and learning, for one student, one
 * assignment, or the whole organization, and the raw activity feed for its own warehouse.
 *
 * Everything is read from what the game already keeps (save data, the activity log, the message
 * log, the rewards ledger) through ActivityStore::report, the same report teachers see in the
 * editor, so the numbers agree everywhere. Students appear by QBL id, external_id and pseudonym.
 *
 * How the derived figures are worked out is in docs/src/content/docs/api-v1/reports.mdx,
 * "How the numbers are worked out"; change both together.
 */
class Reports
{
    use Sql;

    /** A gap longer than this between two things a student did starts a new session. */
    public const SESSION_GAP = 900;

    /** The weights of a score's parts. A part a mission has nothing for is left out, and the rest share its weight. */
    public const WEIGHTS = ['objectives' => 0.6, 'accuracy' => 0.25, 'vocabulary' => 0.15];

    private ClassStore $classes;

    private ActivityStore $activity;

    private array $documents = [];

    public function __construct(PDO $pdo, private ?array $ranks = null)
    {
        $this->pdo = $pdo;
        $this->classes = new ClassStore($pdo);
        $this->activity = new ActivityStore($pdo);
    }

    // -------------------------------------------------------------- assignments

    /** An assignment of one of the organization's teachers, or not found. */
    public function assignmentRow(int $rootId, int $assignmentId): array
    {
        $a = $this->one('SELECT a.* FROM assignments a JOIN users t ON t.id = a.teacher_id WHERE a.id = ? AND t.organization_id = ?', [$assignmentId, $rootId]);

        return $a ?? throw ApiError::notFound('The assignment');
    }

    /**
     * The full report on an assignment: the summary, each objective, and each student with their
     * progress, answers, evidence of learning and grade.
     */
    public function assignment(int $rootId, int $assignmentId): array
    {
        $a = $this->assignmentRow($rootId, $assignmentId);
        $on = $this->classes->reportOn((int) $a['teacher_id'], $assignmentId);
        $document = $this->document($on['scenario_id']);
        $report = $this->activity->report($on['scenario_id'], $on['students'], $document);
        $external = $this->externalIds(array_column($on['students'], 'id'));
        $questions = self::questions($document);
        $report['students'] = array_map(function ($row) use ($external, $questions, $a, $on) {
            $row['questions'] = array_map(fn ($q) => self::question($q, $questions), $row['questions']);

            return ['student_id' => $row['id'], 'external_id' => $external[$row['id']] ?? null, 'display_name' => $row['name']]
                + array_diff_key($row, ['id' => 1, 'name' => 1])
                + ['grade' => $this->grade($row, $a, $on['scenario_id'])];
        }, $report['students']);
        $report['summary']['average_score'] = self::mean(array_map(fn ($s) => $s['grade']['score'], $report['students']));
        $report['summary']['completion_rate'] = $report['summary']['students'] ? round($report['summary']['finished'] / $report['summary']['students'], 3) : null;

        return ['assignment_id' => (int) $a['id'], 'scenario_id' => $on['scenario_id'], 'due_at' => self::iso($a['due_at'])] + $report;
    }

    /** One line per student, ready for a gradebook. */
    public function grades(int $rootId, int $assignmentId): array
    {
        $report = $this->assignment($rootId, $assignmentId);

        return array_map(fn ($s) => [
            'student_id' => $s['student_id'], 'external_id' => $s['external_id'], 'display_name' => $s['display_name'], 'team' => $s['team'],
        ] + $s['grade'], $report['students']);
    }

    /** The activity log of an assignment's instances, newest first. */
    public function assignmentActivity(int $rootId, int $assignmentId, ?int $studentId = null, int $limit = 500): array
    {
        $a = $this->assignmentRow($rootId, $assignmentId);
        $on = $this->classes->reportOn((int) $a['teacher_id'], $assignmentId);
        $rows = $this->activity->activity($on['scenario_id'], $on['groups'], $studentId, $limit);
        $external = $this->externalIds(array_column($rows, 'user_id'));

        return array_map(fn ($r) => ['student_id' => $r['user_id'], 'external_id' => $external[$r['user_id']] ?? null] + array_diff_key($r, ['user_id' => 1, 'name' => 1]) + ['display_name' => $r['name'] ?? null], $rows);
    }

    /** Every message sent in an assignment's instances, newest first, for a safety review. */
    public function assignmentMessages(int $rootId, int $assignmentId, int $limit = 1000): array
    {
        $a = $this->assignmentRow($rootId, $assignmentId);
        $on = $this->classes->reportOn((int) $a['teacher_id'], $assignmentId);
        $rows = $this->activity->messages($on['scenario_id'], $on['groups'], $limit);
        $external = $this->externalIds(array_merge(array_column($rows, 'user_id'), array_filter(array_column($rows, 'to_user_id'))));

        return array_map(fn ($r) => [
            'from_id' => $r['user_id'], 'from_external_id' => $external[$r['user_id']] ?? null, 'from_display_name' => $r['name'] ?? null,
            'to_id' => $r['to_user_id'] ?? null, 'to_external_id' => isset($r['to_user_id']) ? ($external[$r['to_user_id']] ?? null) : null,
            'kind' => $r['kind'], 'group' => $r['group'], 'scene_id' => $r['scene_id'] ?? null, 'text' => $r['text'], 'at' => $r['at'],
        ], $rows);
    }

    // ----------------------------------------------------------------- students

    /** Everything about one student's learning: each assignment with its grade, totals, standards and engagement. */
    public function student(int $rootId, int $studentId, array $filter = []): array
    {
        $student = $this->one("SELECT * FROM users WHERE id = ? AND organization_id = ? AND role = 'student'", [$studentId, $rootId]) ?? throw ApiError::notFound('The student');
        $assignments = [];
        $standards = [];
        foreach ($this->all('SELECT a.id FROM assignment_student s JOIN assignments a ON a.id = s.assignment_id JOIN users t ON t.id = a.teacher_id WHERE s.student_id = ? AND t.organization_id = ? ORDER BY a.id', [$studentId, $rootId]) as $row) {
            $report = $this->assignment($rootId, (int) $row['id']);
            $mine = array_values(array_filter($report['students'], fn ($s) => $s['student_id'] === $studentId))[0] ?? null;
            if (! $mine) {
                continue;
            }
            $title = $this->document($report['scenario_id'])['title'] ?? null;
            $assignments[] = [
                'assignment_id' => $report['assignment_id'], 'scenario_id' => $report['scenario_id'], 'title' => $title, 'due_at' => $report['due_at'], 'team' => $mine['team'],
                'grade' => $mine['grade'], 'time_spent' => $mine['time_spent'], 'visits' => $mine['visits'], 'last_seen' => $mine['last_seen'],
                'words_learned' => $mine['words_learned'], 'words_total' => $mine['words_total'], 'badges' => $mine['badges'], 'learning' => $mine['learning'],
            ];
            foreach ($this->standardsOf($report['scenario_id']) as $code => $std) {
                $standards[$code] ??= $std + ['assignments' => 0, 'completed' => 0, 'scores' => []];
                $standards[$code]['assignments']++;
                $standards[$code]['completed'] += $mine['grade']['status'] === 'completed' ? 1 : 0;
                $standards[$code]['scores'][] = $mine['grade']['score'];
            }
        }
        $progress = (new ProgressStore($this->pdo, $this->ranks ?? ProgressStore::DEFAULT_RANKS))->progress($studentId);
        $grades = array_column($assignments, 'grade');

        return [
            'student_id' => $studentId, 'external_id' => $student['external_id'], 'display_name' => $student['name'], 'grade_level' => $student['grade_level'], 'school_id' => $student['school_id'] === null ? null : (int) $student['school_id'],
            'totals' => [
                'assignments' => count($assignments),
                'completed' => count(array_filter($grades, fn ($g) => $g['status'] === 'completed')),
                'missing' => count(array_filter($grades, fn ($g) => $g['missing'])),
                'late' => count(array_filter($grades, fn ($g) => $g['late'])),
                'average_score' => self::mean(array_column($grades, 'score')),
                'time_spent' => array_sum(array_column($assignments, 'time_spent')),
                'words_learned' => array_sum(array_column($assignments, 'words_learned')),
                'stars' => $progress['stars'], 'xp' => $progress['xp'], 'rank' => $progress['rank'],
                'badges' => count($this->activity->badges($studentId)),
            ],
            'engagement' => $this->engagement($rootId, $filter + ['student_ids' => [$studentId]])['totals'],
            'standards' => array_values(array_map(fn ($s) => array_diff_key($s, ['scores' => 1]) + ['average_score' => self::mean($s['scores'])], $standards)),
            'assignments' => $assignments,
        ];
    }

    // --------------------------------------------------------------- engagement

    /**
     * Who took part, how often and for how long, over a period, in days or weeks.
     *
     * @param  array  $filter  from, to (default: the last 30 days), timezone, interval (day|week), school_id, teacher_id, grade_level,
     *                         group_by (school|grade_level|teacher), include_students, student_ids (internal)
     */
    public function engagement(int $rootId, array $filter = []): array
    {
        [$from, $to, $zone] = self::period($filter);
        $interval = ($filter['interval'] ?? 'day') === 'week' ? 'week' : 'day';
        $students = $this->population($rootId, $filter);
        $ids = array_keys($students);

        $lines = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($this->all('SELECT user_id, type, created_at FROM activity_log WHERE user_id IN ('.self::marks($chunk).') AND created_at >= ? AND created_at < ? ORDER BY user_id, created_at',
                [...$chunk, $from->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'), $to->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')]) as $l) {
                $lines[(int) $l['user_id']][] = [strtotime($l['created_at'].' UTC'), $l['type']];
            }
        }
        $messages = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            foreach ($this->all('SELECT user_id, COUNT(*) AS n FROM chat_messages WHERE user_id IN ('.self::marks($chunk).') AND created_at >= ? AND created_at < ? GROUP BY user_id',
                [...$chunk, $from->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s'), $to->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s')]) as $m) {
                $messages[(int) $m['user_id']] = (int) $m['n'];
            }
        }

        $bucket = function (int $t) use ($zone, $interval): string {
            $d = (new DateTimeImmutable('@'.$t))->setTimezone($zone);

            return $interval === 'week' ? $d->modify('monday this week')->format('Y-m-d') : $d->format('Y-m-d');
        };
        $series = [];
        for ($d = $interval === 'week' ? $from->modify('monday this week') : $from; $d < $to; $d = $d->modify($interval === 'week' ? '+1 week' : '+1 day')) {
            $series[$d->format('Y-m-d')] = ['start' => $d->format('Y-m-d'), 'active_students' => 0, 'sessions' => 0, 'active_minutes' => 0, 'actions' => 0];
        }
        $per = [];
        foreach ($students as $id => $s) {
            $sessions = self::sessions($lines[$id] ?? []);
            $days = [];
            $seenIn = [];
            $actions = 0;
            foreach ($lines[$id] ?? [] as [$t, $type]) {
                $days[(new DateTimeImmutable('@'.$t))->setTimezone($zone)->format('Y-m-d')] = true;
                $seenIn[$bucket($t)] = true;
                $actions += in_array($type, ['hotspot', 'choice', 'objective', 'glossary', 'award'], true) ? 1 : 0;
                if (isset($series[$bucket($t)]) && in_array($type, ['hotspot', 'choice', 'objective', 'glossary', 'award'], true)) {
                    $series[$bucket($t)]['actions']++;
                }
            }
            foreach ($seenIn as $key => $_) {
                if (isset($series[$key])) {
                    $series[$key]['active_students']++;
                }
            }
            foreach ($sessions as [$start, $seconds]) {
                if (isset($series[$bucket($start)])) {
                    $series[$bucket($start)]['sessions']++;
                    $series[$bucket($start)]['active_minutes'] += $seconds / 60;
                }
            }
            $per[$id] = [
                'student_id' => $id, 'external_id' => $s['external_id'], 'display_name' => $s['name'], 'school_id' => $s['school_id'], 'grade_level' => $s['grade_level'],
                'active_days' => count($days), 'sessions' => count($sessions), 'active_minutes' => (int) round(array_sum(array_column($sessions, 1)) / 60),
                'actions' => $actions, 'messages' => $messages[$id] ?? 0,
                'last_active_at' => isset($lines[$id]) ? gmdate('Y-m-d\TH:i:s\Z', end($lines[$id])[0]) : null,
            ];
        }
        foreach ($series as &$point) {
            $point['active_minutes'] = (int) round($point['active_minutes']);
        }
        unset($point);

        $out = [
            'period' => ['from' => $from->format('c'), 'to' => $to->format('c'), 'timezone' => $zone->getName(), 'interval' => $interval],
            'totals' => self::engagementTotals($per),
            'series' => array_values($series),
        ];
        $groupBy = $filter['group_by'] ?? null;
        if ($groupBy === 'school' || $groupBy === 'grade_level') {
            $groups = [];
            foreach ($per as $p) {
                $groups[(string) ($p[$groupBy === 'school' ? 'school_id' : 'grade_level'] ?? '')][] = $p;
            }
            ksort($groups);
            $out['groups'] = array_map(fn ($k, $g) => [$groupBy === 'school' ? 'school_id' : 'grade_level' => $k === '' ? null : ($groupBy === 'school' ? (int) $k : $k)] + self::engagementTotals($g), array_keys($groups), $groups);
        } elseif ($groupBy === 'teacher') {
            $out['groups'] = [];
            foreach ($this->all("SELECT id FROM users WHERE organization_id = ? AND role = 'teacher' ORDER BY id", [$rootId]) as $t) {
                $mine = array_map('intval', array_column($this->all('SELECT student_id FROM teacher_student WHERE teacher_id = ?', [$t['id']]), 'student_id'));
                $out['groups'][] = ['teacher_id' => (int) $t['id']] + self::engagementTotals(array_intersect_key($per, array_flip($mine)));
            }
        }
        if (! empty($filter['include_students'])) {
            $out['students'] = array_values($per);
        }

        return $out;
    }

    // ----------------------------------------------------------------- learning

    /**
     * What students learned, mission by mission and standard by standard: completion, scores,
     * how often questions were answered right the first time, which wrong answers were common,
     * the words learned, and the evidence each learning objective collected.
     *
     * @param  array  $filter  from, to (assignments made in this period), school_id, teacher_id, grade_level, scenario_id
     */
    public function learning(int $rootId, array $filter = []): array
    {
        $students = $this->population($rootId, $filter);
        $scenarios = [];
        foreach ($this->assignmentsIn($rootId, $filter) as $a) {
            $report = $this->assignment($rootId, (int) $a['id']);
            $rows = array_values(array_filter($report['students'], fn ($s) => isset($students[$s['student_id']])));
            if (! $rows) {
                continue;
            }
            $sid = $report['scenario_id'];
            $doc = $this->document($sid);
            $scenarios[$sid] ??= [
                'scenario_id' => $sid, 'title' => $doc['title'] ?? null, 'standards' => array_values($this->standardsOf($sid)),
                'assignments' => 0, 'rows' => [], 'objectives' => [], 'questions' => [], 'learning_objectives' => [],
            ];
            $sc = &$scenarios[$sid];
            $sc['assignments']++;
            array_push($sc['rows'], ...$rows);
            foreach ($report['objectives'] as $o) {
                $sc['objectives'][$o['id']] ??= ['id' => $o['id'], 'text' => $o['text'], 'optional' => $o['optional'], 'completed_by' => 0];
                $sc['objectives'][$o['id']]['completed_by'] += count(array_filter($rows, fn ($r) => in_array(true, array_map(fn ($d) => $d['id'] === $o['id'] && $d['complete'], $r['objectives']), true)));
            }
            foreach ($rows as $r) {
                foreach ($r['questions'] as $q) {
                    $key = $q['action_id'];
                    $sc['questions'][$key] ??= ['action_id' => $key, 'prompt' => $q['prompt'] ?? null, 'students' => 0, 'attempts' => 0, 'first_try' => 0, 'first_correct' => 0, 'graded' => 0, 'first_answers' => []];
                    $qq = &$sc['questions'][$key];
                    $qq['students']++;
                    $qq['attempts'] += $q['attempts'];
                    $qq['first_try'] += $q['attempts'] === 1 ? 1 : 0;
                    if (isset($q['first_answer_correct'])) {
                        $qq['graded']++;
                        $qq['first_correct'] += $q['first_answer_correct'] ? 1 : 0;
                    }
                    $answer = (string) ($q['first_answer'] ?? '');
                    $qq['first_answers'][$answer] = ($qq['first_answers'][$answer] ?? 0) + 1;
                    unset($qq);
                }
                foreach ($r['learning'] as $lo) {
                    $sc['learning_objectives'][$lo['id']] ??= ['id' => $lo['id'], 'students_with_evidence' => 0, 'values' => []];
                    $any = false;
                    foreach ($lo['evidence'] as $e) {
                        foreach ($e['values'] as $k => $v) {
                            if ($v === null || $v === '' || $v === 0 || $v === '0') {
                                continue;
                            }
                            $any = true;
                            $label = ($e['interaction'] ?? 'evidence').'.'.$k;
                            $sc['learning_objectives'][$lo['id']]['values'][$label][(string) $v] = ($sc['learning_objectives'][$lo['id']]['values'][$label][(string) $v] ?? 0) + 1;
                        }
                    }
                    $sc['learning_objectives'][$lo['id']]['students_with_evidence'] += $any ? 1 : 0;
                }
            }
            foreach ($report['learning_objectives'] as $lo) {
                if (isset($sc['learning_objectives'][$lo['id']])) {
                    $sc['learning_objectives'][$lo['id']] = ['id' => $lo['id'], 'text' => $lo['text'], 'standards' => $lo['standards']] + $sc['learning_objectives'][$lo['id']];
                }
            }
            unset($sc);
        }

        $standards = [];
        $out = [];
        foreach ($scenarios as $sc) {
            $rows = $sc['rows'];
            $grades = array_column($rows, 'grade');
            $n = count($rows);
            $entry = [
                'scenario_id' => $sc['scenario_id'], 'title' => $sc['title'], 'standards' => $sc['standards'], 'assignments' => $sc['assignments'],
                'students' => $n,
                'started' => count(array_filter($rows, fn ($r) => $r['started'])),
                'completed' => count(array_filter($grades, fn ($g) => $g['status'] === 'completed')),
                'completion_rate' => $n ? round(count(array_filter($grades, fn ($g) => $g['status'] === 'completed')) / $n, 3) : null,
                'average_score' => self::mean(array_column($grades, 'score')),
                'average_time_spent' => self::mean(array_column(array_filter($rows, fn ($r) => $r['started']), 'time_spent'), 0),
                'first_try_rate' => self::ratio(array_sum(array_column($sc['questions'], 'first_try')), array_sum(array_column($sc['questions'], 'students'))),
                'vocabulary_rate' => self::ratio(array_sum(array_column($rows, 'words_learned')), array_sum(array_column($rows, 'words_total'))),
                'objectives' => array_values(array_map(fn ($o) => $o + ['completion_rate' => self::ratio($o['completed_by'], $n)], $sc['objectives'])),
                'questions' => array_values(array_map(function ($q) {
                    ksort($q['first_answers']);
                    arsort($q['first_answers']);

                    return [
                        'action_id' => $q['action_id'], 'prompt' => $q['prompt'], 'students' => $q['students'],
                        'average_attempts' => round($q['attempts'] / max(1, $q['students']), 2),
                        'first_try_rate' => self::ratio($q['first_try'], $q['students']),
                        'first_answer_correct_rate' => $q['graded'] ? self::ratio($q['first_correct'], $q['graded']) : null,
                        'first_answers' => array_map(fn ($a, $c) => ['answer' => $a, 'students' => $c], array_keys($q['first_answers']), array_values($q['first_answers'])),
                    ];
                }, $sc['questions'])),
                'learning_objectives' => array_values(array_map(function ($lo) use ($n) {
                    foreach ($lo['values'] as &$counts) {
                        ksort($counts);
                        arsort($counts); // most common first; ties in alphabetical order
                    }

                    return $lo + ['evidence_rate' => self::ratio($lo['students_with_evidence'], $n)];
                }, $sc['learning_objectives'])),
            ];
            $out[] = $entry;
            foreach ($sc['standards'] as $std) {
                $standards[$std['code']] ??= $std + ['scenarios' => [], 'student_ids' => [], 'completed' => 0, 'rows' => 0, 'scores' => []];
                $standards[$std['code']]['scenarios'][] = $sc['scenario_id'];
                foreach ($rows as $r) {
                    $standards[$std['code']]['student_ids'][$r['student_id']] = true;
                    $standards[$std['code']]['rows']++;
                    $standards[$std['code']]['completed'] += $r['grade']['status'] === 'completed' ? 1 : 0;
                    $standards[$std['code']]['scores'][] = $r['grade']['score'];
                }
            }
        }
        ksort($standards);

        return [
            'scenarios' => $out,
            'standards' => array_values(array_map(fn ($s) => array_diff_key($s, ['student_ids' => 1, 'rows' => 1, 'scores' => 1, 'completed' => 1]) + [
                'scenarios' => array_values(array_unique($s['scenarios'])), 'students' => count($s['student_ids']),
                'completion_rate' => self::ratio($s['completed'], $s['rows']), 'average_score' => self::mean($s['scores']),
            ], $standards)),
        ];
    }

    // ------------------------------------------------------------ organization

    /** The headline numbers for an organization or one of its schools. */
    public function summary(int $rootId, array $filter = []): array
    {
        $students = $this->population($rootId, $filter);
        $assignments = $this->assignmentsIn($rootId, $filter);
        $now = time();
        $grades = [];
        foreach ($assignments as $a) {
            foreach ($this->assignment($rootId, (int) $a['id'])['students'] as $s) {
                if (isset($students[$s['student_id']])) {
                    $grades[] = $s['grade'];
                }
            }
        }
        $week = $this->engagement($rootId, $filter + ['from' => gmdate('c', $now - 7 * 86400), 'to' => gmdate('c', $now + 60)])['totals'];
        $month = $this->engagement($rootId, $filter + ['from' => gmdate('c', $now - 30 * 86400), 'to' => gmdate('c', $now + 60)])['totals'];

        return [
            'schools' => (int) $this->one('SELECT COUNT(*) AS n FROM organizations WHERE parent_id = ?', [$rootId])['n'],
            'teachers' => (int) $this->one("SELECT COUNT(*) AS n FROM users WHERE organization_id = ? AND role = 'teacher' AND deactivated_at IS NULL".(isset($filter['school_id']) ? ' AND school_id = '.(int) $filter['school_id'] : ''), [$rootId])['n'],
            'students' => count($students),
            'assignments' => count($assignments),
            'assignments_open' => count(array_filter($assignments, fn ($a) => $a['due_at'] === null || strtotime($a['due_at'].' UTC') >= $now)),
            'student_assignments' => count($grades),
            'completion_rate' => self::ratio(count(array_filter($grades, fn ($g) => $g['status'] === 'completed')), count($grades)),
            'missing' => count(array_filter($grades, fn ($g) => $g['missing'])),
            'average_score' => self::mean(array_column($grades, 'score')),
            'active_students_7_days' => $week['active_students'],
            'active_students_30_days' => $month['active_students'],
            'participation_rate_30_days' => $month['participation_rate'],
            'active_minutes_30_days' => $month['active_minutes'],
        ];
    }

    /**
     * Everything the organization's students did, oldest first, from a cursor: for loading into
     * the organization's own data warehouse. Each line says which assignment and team it was in.
     *
     * @return array{0: list<array>, 1: ?string}
     */
    public function feed(int $rootId, ?string $cursor, int $limit = 1000, array $filter = []): array
    {
        $limit = max(1, min(5000, $limit));
        $where = ['u.organization_id = ?'];
        $params = [$rootId];
        if ($cursor !== null && $cursor !== '') {
            $where[] = 'l.id > ?';
            $params[] = Roster::cursor($cursor);
        }
        if (isset($filter['since'])) {
            $where[] = 'l.created_at >= ?';
            $params[] = Roster::when($filter['since'], 'since');
        }
        if (! empty($filter['types'])) {
            $types = array_values(array_intersect(explode(',', (string) $filter['types']), ActivityStore::ACTIVITY_TYPES));
            $where[] = 'l.type IN ('.self::marks($types).')';
            array_push($params, ...$types);
        }
        $rows = $this->all('SELECT l.*, u.external_id FROM activity_log l JOIN users u ON u.id = l.user_id WHERE '.implode(' AND ', $where).' ORDER BY l.id LIMIT '.($limit + 1), $params);
        $more = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        $teams = [];

        return [array_map(function ($r) use (&$teams) {
            [$assignment, $team] = [null, null];
            if (preg_match('/^a(\d+)$/', (string) $r['group_key'], $m)) {
                $assignment = (int) $m[1];
            } elseif (preg_match('/^t(\d+)$/', (string) $r['group_key'], $m)) {
                $team = (int) $m[1];
                $assignment = $teams[$team] ??= (int) ($this->one('SELECT assignment_id FROM teams WHERE id = ?', [$team])['assignment_id'] ?? 0) ?: null;
            }

            return [
                'id' => (int) $r['id'], 'student_id' => (int) $r['user_id'], 'external_id' => $r['external_id'], 'scenario_id' => (int) $r['scenario_id'],
                'assignment_id' => $assignment, 'team_id' => $team, 'scene_id' => $r['scene_id'] === null ? null : (int) $r['scene_id'],
                'type' => $r['type'], 'ref' => $r['ref'], 'label' => $r['label'], 'value' => $r['value'] === null ? null : $r['value'] + 0, 'at' => self::iso($r['created_at']),
            ];
        }, $rows), $more ? (string) end($rows)['id'] : null];
    }

    // ------------------------------------------------------------------ helpers

    /**
     * A student's grade on an assignment.
     *
     * status: not_started, in_progress or completed. missing: past due and not completed.
     * late: completed after the due date. score: 0–100 from the parts (see WEIGHTS).
     */
    private function grade(array $row, array $assignment, int $scenarioId): array
    {
        $parts = [];
        if ($row['objectives_total'] > 0) {
            $parts['objectives'] = $row['objectives_done'] / $row['objectives_total'];
        }
        $graded = array_filter($row['questions'], fn ($q) => isset($q['first_answer_correct']));
        if ($graded) {
            $parts['accuracy'] = count(array_filter($graded, fn ($q) => $q['first_answer_correct'])) / count($graded);
        } elseif ($row['questions']) {
            $parts['accuracy'] = count(array_filter($row['questions'], fn ($q) => $q['attempts'] === 1)) / count($row['questions']);
        }
        if ($row['words_total'] > 0) {
            $parts['vocabulary'] = $row['words_learned'] / $row['words_total'];
        }
        $weight = array_sum(array_intersect_key(self::WEIGHTS, $parts));
        // No score until the student has started: not_started (and missing, once due) say why.
        $score = $row['started'] && $weight > 0 ? round(100 * array_sum(array_map(fn ($k, $v) => self::WEIGHTS[$k] * $v, array_keys($parts), $parts)) / $weight, 1) : null;

        $completedAt = null;
        if ($row['finished']) {
            $last = $this->one("SELECT MAX(created_at) AS t FROM activity_log WHERE scenario_id = ? AND user_id = ? AND group_key = ? AND type = 'objective'", [$scenarioId, $row['id'], $row['group']]);
            $completedAt = self::iso($last['t'] ?? null) ?? $row['last_seen'];
        }
        $due = $assignment['due_at'] ? strtotime($assignment['due_at'].' UTC') : null;

        return [
            'status' => $row['finished'] ? 'completed' : ($row['started'] ? 'in_progress' : 'not_started'),
            'score' => $score,
            'score_parts' => array_map(fn ($v) => round(100 * $v, 1), $parts),
            'objectives_done' => $row['objectives_done'], 'objectives_total' => $row['objectives_total'],
            'questions_answered' => count($row['questions']),
            'answered_first_try' => count(array_filter($row['questions'], fn ($q) => $q['attempts'] === 1)),
            'words_learned' => $row['words_learned'], 'words_total' => $row['words_total'],
            'time_spent' => $row['time_spent'],
            'started_at' => $row['first_seen'], 'completed_at' => $completedAt,
            'late' => $due !== null && $completedAt !== null && strtotime($completedAt) > $due,
            'missing' => $due !== null && ! $row['finished'] && time() > $due,
        ];
    }

    /** The organization's active students, narrowed by the filter. @return array<int, array> by id */
    private function population(int $rootId, array $filter): array
    {
        $where = ['organization_id = ?', "role = 'student'", 'deactivated_at IS NULL'];
        $params = [$rootId];
        if (isset($filter['school_id'])) {
            $where[] = 'school_id = ?';
            $params[] = (int) $filter['school_id'];
        }
        if (isset($filter['grade_level'])) {
            $where[] = 'grade_level = ?';
            $params[] = Privacy::gradeLevel($filter['grade_level']);
        }
        if (isset($filter['teacher_id'])) {
            $where[] = 'id IN (SELECT student_id FROM teacher_student WHERE teacher_id = ?)';
            $params[] = (int) $filter['teacher_id'];
        }
        if (isset($filter['student_ids'])) {
            $ids = array_map('intval', (array) $filter['student_ids']);
            $where[] = 'id IN ('.self::marks($ids).')';
            array_push($params, ...$ids);
        }
        $out = [];
        foreach ($this->all('SELECT id, external_id, name, school_id, grade_level FROM users WHERE '.implode(' AND ', $where).' ORDER BY id', $params) as $s) {
            $out[(int) $s['id']] = ['external_id' => $s['external_id'], 'name' => $s['name'], 'school_id' => $s['school_id'] === null ? null : (int) $s['school_id'], 'grade_level' => $s['grade_level']];
        }

        return $out;
    }

    /** The organization's teachers' assignments, narrowed by the filter. */
    private function assignmentsIn(int $rootId, array $filter): array
    {
        $where = ['t.organization_id = ?'];
        $params = [$rootId];
        if (isset($filter['teacher_id'])) {
            $where[] = 'a.teacher_id = ?';
            $params[] = (int) $filter['teacher_id'];
        }
        if (isset($filter['school_id'])) {
            $where[] = 't.school_id = ?';
            $params[] = (int) $filter['school_id'];
        }
        if (isset($filter['scenario_id'])) {
            $where[] = 'a.scenario_id = ?';
            $params[] = (int) $filter['scenario_id'];
        }
        if (isset($filter['from'])) {
            $where[] = 'a.created_at >= ?';
            $params[] = Roster::when($filter['from'], 'from');
        }
        if (isset($filter['to'])) {
            $where[] = 'a.created_at < ?';
            $params[] = Roster::when($filter['to'], 'to');
        }

        return $this->all('SELECT a.* FROM assignments a JOIN users t ON t.id = a.teacher_id WHERE '.implode(' AND ', $where).' ORDER BY a.id', $params);
    }

    /** The curriculum standards a mission is aligned to, by code. */
    private function standardsOf(int $scenarioId): array
    {
        $out = [];
        try {
            foreach (array_map([StandardsStore::class, 'present'], $this->all(StandardsStore::SCENARIO_SQL, [$scenarioId])) as $s) {
                $out[$s['code']] = ['code' => $s['code'], 'framework' => $s['framework'], 'description' => $s['description'], 'alignment' => $s['alignment']];
            }
        } catch (\PDOException) {
            // No standards tables (a development database): fall back to the codes the mission names.
        }
        foreach ($this->document($scenarioId)['curriculum']['learning_objectives'] ?? [] as $lo) {
            foreach ((array) ($lo['standards'] ?? []) as $code) {
                $out[(string) $code] ??= ['code' => (string) $code, 'framework' => null, 'description' => null, 'alignment' => 'primary'];
            }
        }

        return $out;
    }

    private function document(int $scenarioId): array
    {
        return $this->documents[$scenarioId] ??= self::json($this->one('SELECT document FROM scenarios WHERE id = ?', [$scenarioId])['document'] ?? null);
    }

    /** @return array<int, ?string> */
    private function externalIds(array $userIds): array
    {
        $userIds = array_values(array_unique(array_map('intval', $userIds)));
        if (! $userIds) {
            return [];
        }

        return array_column($this->all('SELECT id, external_id FROM users WHERE id IN ('.self::marks($userIds).')', $userIds), 'external_id', 'id');
    }

    /**
     * Every question in a mission, by the reference its answers are logged with: an infobox with
     * buttons (its action id) and a conversation line with choices (`action id:line id`). Its prompt
     * and which answers are right, if marked.
     */
    private static function questions(array $document): array
    {
        $out = [];
        $walk = function ($node) use (&$walk, &$out) {
            if (! is_array($node)) {
                return;
            }
            if (($node['type'] ?? null) === 'infobox' && isset($node['id']) && ! empty($node['call_to_actions'])) {
                $correct = [];
                foreach ($node['call_to_actions'] as $cta) {
                    if (array_key_exists('correct', (array) $cta)) {
                        $correct[strip_tags((string) ($cta['text'] ?? ''))] = (bool) $cta['correct'];
                    }
                }
                $out[(string) $node['id']] = ['prompt' => trim(preg_replace('/\s+/', ' ', html_entity_decode(strip_tags((string) ($node['content'] ?? ''))))) ?: null, 'correct' => $correct];
            }
            if (($node['type'] ?? null) === 'conversation' && isset($node['id'])) {
                foreach ((array) ($node['lines'] ?? []) as $line) {
                    if (! is_array($line) || empty($line['choices']) || ! isset($line['id'])) {
                        continue;
                    }
                    $correct = [];
                    foreach ((array) $line['choices'] as $choice) {
                        if (array_key_exists('correct', (array) $choice)) {
                            $correct[strip_tags((string) ($choice['text'] ?? ''))] = (bool) $choice['correct'];
                        }
                    }
                    $out[$node['id'].':'.$line['id']] = ['prompt' => trim(preg_replace('/\s+/', ' ', strip_tags((string) ($line['text'] ?? '')))) ?: null, 'correct' => $correct];
                }
            }
            foreach ($node as $child) {
                $walk($child);
            }
        };
        $walk($document);

        return $out;
    }

    private static function question(array $q, array $questions): array
    {
        $info = $questions[$q['action_id']] ?? null;
        $out = $q + ['prompt' => $info['prompt'] ?? null];
        if ($info && $info['correct']) {
            $out['first_answer_correct'] = (bool) ($info['correct'][(string) $q['first_answer']] ?? false);
            $out['last_answer_correct'] = (bool) ($info['correct'][(string) $q['last_answer']] ?? false);
        }

        return $out;
    }

    /** Group a student's activity times into sessions. @return list<array{0:int,1:int}> start, seconds */
    private static function sessions(array $lines): array
    {
        $out = [];
        $start = $last = null;
        foreach ($lines as [$t]) {
            if ($start === null || $t - $last > self::SESSION_GAP) {
                if ($start !== null) {
                    $out[] = [$start, max(60, $last - $start)];
                }
                $start = $t;
            }
            $last = $t;
        }
        if ($start !== null) {
            $out[] = [$start, max(60, $last - $start)];
        }

        return $out;
    }

    private static function engagementTotals(array $per): array
    {
        $active = array_filter($per, fn ($p) => $p['sessions'] > 0);
        $n = count($active);

        return [
            'students' => count($per), 'active_students' => $n, 'participation_rate' => self::ratio($n, count($per)),
            'sessions' => array_sum(array_column($per, 'sessions')), 'active_minutes' => array_sum(array_column($per, 'active_minutes')),
            'actions' => array_sum(array_column($per, 'actions')), 'messages' => array_sum(array_column($per, 'messages')),
            'average_minutes_per_active_student' => $n ? round(array_sum(array_column($active, 'active_minutes')) / $n, 1) : null,
            'average_sessions_per_active_student' => $n ? round(array_sum(array_column($active, 'sessions')) / $n, 1) : null,
            'average_active_days_per_active_student' => $n ? round(array_sum(array_column($active, 'active_days')) / $n, 1) : null,
        ];
    }

    /** @return array{0: DateTimeImmutable, 1: DateTimeImmutable, 2: DateTimeZone} */
    private static function period(array $filter): array
    {
        try {
            $zone = new DateTimeZone((string) ($filter['timezone'] ?? 'UTC'));
        } catch (\Exception) {
            throw ApiError::invalid('timezone', 'timezone must be an IANA name, such as America/Denver.');
        }
        $parse = function (string $key, string $default) use ($filter, $zone) {
            $value = (string) ($filter[$key] ?? $default);
            try {
                return new DateTimeImmutable($value, $zone);
            } catch (\Exception) {
                throw ApiError::invalid($key, "$key must be a date or time, such as 2026-09-01.");
            }
        };
        $to = isset($filter['to']) ? $parse('to', 'now') : (new DateTimeImmutable('tomorrow', $zone));
        $from = $parse('from', $to->modify('-30 days')->format('Y-m-d'));
        if ($from >= $to) {
            throw ApiError::invalid('from', 'from must be before to.');
        }
        if ($to->getTimestamp() - $from->getTimestamp() > 400 * 86400) {
            throw ApiError::invalid('from', 'A period may be at most 400 days.');
        }

        return [$from->setTimezone($zone), $to->setTimezone($zone), $zone];
    }

    private static function mean(array $values, int $decimals = 1): ?float
    {
        $values = array_filter($values, fn ($v) => $v !== null);

        return $values ? round(array_sum($values) / count($values), $decimals) : null;
    }

    private static function ratio(int|float $part, int|float $whole): ?float
    {
        return $whole > 0 ? round($part / $whole, 3) : null;
    }
}
