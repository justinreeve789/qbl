<?php

namespace App\Qbl\Standards;

use PDO;

/**
 * Fixed reference rows: countries and their subdivisions, normalised subjects,
 * and the education levels of each school system with a US-grade equivalent so
 * "Year 4" (England), "P5" (Scotland, second level) and "grade 3" can be found together.
 *
 * Seeding is additive and idempotent (upsert by natural key), so new systems or
 * jurisdictions are added by appending here and running `qbl:standards-library seed`.
 */
final class Reference
{
    /** code => [name, kind, parent code, country, level system] */
    public const JURISDICTIONS = [
        'US' => ['United States', 'country', null, 'US', 'GRADE'],
        'CA' => ['Canada', 'country', null, 'CA', 'GRADE'],
        'GB' => ['United Kingdom', 'country', null, 'GB', null],
        // Sets imported by hand (a JSON list, Learning Commons) and an organization's own standards
        'QBL' => ['Imported into QBL', 'organization', null, null, 'GRADE'],
        'US-CCSS' => ['Common Core State Standards', 'consortium', 'US', 'US', 'GRADE'],
        'US-NGSS' => ['Next Generation Science Standards', 'consortium', 'US', 'US', 'GRADE'],
        'US-AL' => ['Alabama', 'state', 'US', 'US', 'GRADE'], 'US-AK' => ['Alaska', 'state', 'US', 'US', 'GRADE'],
        'US-AZ' => ['Arizona', 'state', 'US', 'US', 'GRADE'], 'US-AR' => ['Arkansas', 'state', 'US', 'US', 'GRADE'],
        'US-CA' => ['California', 'state', 'US', 'US', 'GRADE'], 'US-CO' => ['Colorado', 'state', 'US', 'US', 'GRADE'],
        'US-CT' => ['Connecticut', 'state', 'US', 'US', 'GRADE'], 'US-DE' => ['Delaware', 'state', 'US', 'US', 'GRADE'],
        'US-DC' => ['District of Columbia', 'district', 'US', 'US', 'GRADE'], 'US-FL' => ['Florida', 'state', 'US', 'US', 'GRADE'],
        'US-GA' => ['Georgia', 'state', 'US', 'US', 'GRADE'], 'US-HI' => ['Hawaii', 'state', 'US', 'US', 'GRADE'],
        'US-ID' => ['Idaho', 'state', 'US', 'US', 'GRADE'], 'US-IL' => ['Illinois', 'state', 'US', 'US', 'GRADE'],
        'US-IN' => ['Indiana', 'state', 'US', 'US', 'GRADE'], 'US-IA' => ['Iowa', 'state', 'US', 'US', 'GRADE'],
        'US-KS' => ['Kansas', 'state', 'US', 'US', 'GRADE'], 'US-KY' => ['Kentucky', 'state', 'US', 'US', 'GRADE'],
        'US-LA' => ['Louisiana', 'state', 'US', 'US', 'GRADE'], 'US-ME' => ['Maine', 'state', 'US', 'US', 'GRADE'],
        'US-MD' => ['Maryland', 'state', 'US', 'US', 'GRADE'], 'US-MA' => ['Massachusetts', 'state', 'US', 'US', 'GRADE'],
        'US-MI' => ['Michigan', 'state', 'US', 'US', 'GRADE'], 'US-MN' => ['Minnesota', 'state', 'US', 'US', 'GRADE'],
        'US-MS' => ['Mississippi', 'state', 'US', 'US', 'GRADE'], 'US-MO' => ['Missouri', 'state', 'US', 'US', 'GRADE'],
        'US-MT' => ['Montana', 'state', 'US', 'US', 'GRADE'], 'US-NE' => ['Nebraska', 'state', 'US', 'US', 'GRADE'],
        'US-NV' => ['Nevada', 'state', 'US', 'US', 'GRADE'], 'US-NH' => ['New Hampshire', 'state', 'US', 'US', 'GRADE'],
        'US-NJ' => ['New Jersey', 'state', 'US', 'US', 'GRADE'], 'US-NM' => ['New Mexico', 'state', 'US', 'US', 'GRADE'],
        'US-NY' => ['New York', 'state', 'US', 'US', 'GRADE'], 'US-NC' => ['North Carolina', 'state', 'US', 'US', 'GRADE'],
        'US-ND' => ['North Dakota', 'state', 'US', 'US', 'GRADE'], 'US-OH' => ['Ohio', 'state', 'US', 'US', 'GRADE'],
        'US-OK' => ['Oklahoma', 'state', 'US', 'US', 'GRADE'], 'US-OR' => ['Oregon', 'state', 'US', 'US', 'GRADE'],
        'US-PA' => ['Pennsylvania', 'state', 'US', 'US', 'GRADE'], 'US-RI' => ['Rhode Island', 'state', 'US', 'US', 'GRADE'],
        'US-SC' => ['South Carolina', 'state', 'US', 'US', 'GRADE'], 'US-SD' => ['South Dakota', 'state', 'US', 'US', 'GRADE'],
        'US-TN' => ['Tennessee', 'state', 'US', 'US', 'GRADE'], 'US-TX' => ['Texas', 'state', 'US', 'US', 'GRADE'],
        'US-UT' => ['Utah', 'state', 'US', 'US', 'GRADE'], 'US-VT' => ['Vermont', 'state', 'US', 'US', 'GRADE'],
        'US-VA' => ['Virginia', 'state', 'US', 'US', 'GRADE'], 'US-WA' => ['Washington', 'state', 'US', 'US', 'GRADE'],
        'US-WV' => ['West Virginia', 'state', 'US', 'US', 'GRADE'], 'US-WI' => ['Wisconsin', 'state', 'US', 'US', 'GRADE'],
        'US-WY' => ['Wyoming', 'state', 'US', 'US', 'GRADE'],
        'CA-AB' => ['Alberta', 'province', 'CA', 'CA', 'GRADE'], 'CA-BC' => ['British Columbia', 'province', 'CA', 'CA', 'GRADE'],
        'CA-MB' => ['Manitoba', 'province', 'CA', 'CA', 'GRADE'], 'CA-NB' => ['New Brunswick', 'province', 'CA', 'CA', 'GRADE'],
        'CA-NL' => ['Newfoundland and Labrador', 'province', 'CA', 'CA', 'GRADE'], 'CA-NS' => ['Nova Scotia', 'province', 'CA', 'CA', 'GRADE'],
        'CA-ON' => ['Ontario', 'province', 'CA', 'CA', 'GRADE'], 'CA-PE' => ['Prince Edward Island', 'province', 'CA', 'CA', 'GRADE'],
        'CA-QC' => ['Quebec', 'province', 'CA', 'CA', 'GRADE'], 'CA-SK' => ['Saskatchewan', 'province', 'CA', 'CA', 'GRADE'],
        'CA-NT' => ['Northwest Territories', 'territory', 'CA', 'CA', 'GRADE'], 'CA-NU' => ['Nunavut', 'territory', 'CA', 'CA', 'GRADE'],
        'CA-YT' => ['Yukon', 'territory', 'CA', 'CA', 'GRADE'],
        'GB-ENG' => ['England', 'nation', 'GB', 'GB', 'GB-ENG'], 'GB-SCT' => ['Scotland', 'nation', 'GB', 'GB', 'GB-SCT'],
        'GB-WLS' => ['Wales', 'nation', 'GB', 'GB', 'GB-WLS'], 'GB-NIR' => ['Northern Ireland', 'nation', 'GB', 'GB', 'GB-NIR'],
    ];

    /** slug => [name, parent slug] */
    public const SUBJECTS = [
        'mathematics' => ['Mathematics', null],
        'ela' => ['English language arts and literacy', null],
        'english-language-development' => ['English language development', 'ela'],
        'science' => ['Science', null],
        'engineering' => ['Engineering and design', 'science'],
        'social-studies' => ['Social studies', null],
        'history' => ['History', 'social-studies'],
        'geography' => ['Geography', 'social-studies'],
        'civics' => ['Civics, government and citizenship', 'social-studies'],
        'economics' => ['Economics', 'social-studies'],
        'financial-literacy' => ['Financial literacy', 'social-studies'],
        'arts' => ['The arts', null],
        'visual-arts' => ['Visual arts', 'arts'],
        'music' => ['Music', 'arts'],
        'drama' => ['Drama and theatre', 'arts'],
        'dance' => ['Dance', 'arts'],
        'media-arts' => ['Media arts', 'arts'],
        'physical-education' => ['Physical education', null],
        'health' => ['Health and wellbeing', null],
        'world-languages' => ['World languages', null],
        'computer-science' => ['Computing and technology', null],
        'career-technical' => ['Career and technical education', null],
        'religious-education' => ['Religious and moral education', null],
        'personal-social' => ['Personal, social and life skills', null],
        'early-learning' => ['Early learning', null],
        'library' => ['Library and information literacy', null],
        'special-education' => ['Special education and alternate standards', null],
        'educator' => ['Educator standards', null],
        'other' => ['Other', null],
    ];

    /** keyword (regex, case-insensitive) => subject slug; first match wins */
    public const SUBJECT_KEYWORDS = [
        '/teacher|teaching standards|educator|leader|principal|qts|pgce/' => 'educator',
        '/significant disabilit|alternate (academic|assessment|achievement)|expanded core|deaf|hard of hearing|blind|visual impair|gifted|connectors for students|transition standards|principles of transition|special education/' => 'special-education',
        '/librar|information fluency|information literacy|media literacy and research/' => 'library',
        '/\bcte\b|\bctae\b|career and technical|career & technical|career-technical|vocation|études professionnelles|administration et travail|carrière/' => 'career-technical',
        '/financ|personal finance|money/' => 'financial-literacy',
        '/math|numera|algebra|geometr|calculus|statistic|arithm|mathé/' => 'mathematics',
        '/english language (development|proficiency)|\belp\b|\beld\b|\besl\b|english as an additional|english as a second|second language english|nouveaux arrivants|actualisation linguistique/' => 'english-language-development',
        '/other than english|second language|langue seconde|foreign language|world language|modern language|classical language|international language/' => 'world-languages',
        '/english|language arts|literacy|reading|writing|\bela\b|literature|speaking and listening|français|french language arts|langue et littérature|domaine des langues|lenguaje|journalism|communication/' => 'ela',
        '/computer|comput|digital|coding|\bict\b|cyber|information tech|informatique/' => 'computer-science',
        '/social science|social studies|humanit|world studies|canadian|first nations|premières nations|indigenous stud|native stud|études (canadiennes|sociales|autochtones)|sciences humaines|univers social/' => 'social-studies',
        '/engineer|design and technology|technology and design/' => 'engineering',
        '/science|biolog|chemi|physics|earth|environment|astronom|scien|ngss|\bstem\b/' => 'science',
        '/technolog/' => 'computer-science',
        '/history|histoire/' => 'history',
        '/geograph/' => 'geography',
        '/civic|government|citizen|politic|droit/' => 'civics',
        '/econom/' => 'economics',
        '/social/' => 'social-studies',
        '/music|musique/' => 'music',
        '/dance|danse/' => 'dance',
        '/drama|theat|théâtre|art dramatique/' => 'drama',
        '/media arts|media literacy|film/' => 'media-arts',
        '/visual art|art and design|arts plastiques|visual/' => 'visual-arts',
        '/\barts?\b|fine arts|expressive|artistique/' => 'arts',
        '/physical education|\bpe\b|éducation physique|physical development|movement/' => 'physical-education',
        '/health|wellbeing|well-being|wellness|santé|family life|driver/' => 'health',
        '/languages|spanish|french|german|latin|chinese|mandarin|japanese|arabic|italian|korean|russian|ojibwe|cree|irish|gaelic|gàidhlig|welsh|\basl\b|sign language|espagnol|anglais|allemand/' => 'world-languages',
        '/^language\b|^langue\b/' => 'ela',
        '/career|technical|agricult|business|marketing|family and consumer|culinary|automotive|manufactur|construction|hospitality|employab|affaires/' => 'career-technical',
        '/religio|moral|ethic|spiritual|catholic|enseignement religieux/' => 'religious-education',
        '/personal|life skills|learning for life|guidance|counsel|\bsel\b|social-emotional|social emotional|character|développement de la personne|21st century|student success|essential skills|practical living/' => 'personal-social',
        '/early (learning|childhood)|pre-?k|preschool|préscolaire|maternelle|jardin d|foundation stage|kindergarten|infant|toddler/' => 'early-learning',
    ];


    /**
     * [system, code, label, is_band, age_from, age_to, grade_from, grade_to, sort]
     * Ages are typical at the start of the school year.
     */
    public static function levels(): array
    {
        $rows = [
            ['GRADE', 'IT', 'Infant/toddler', 0, 0, 2, -3, -3, 1],
            ['GRADE', 'PK', 'Pre-kindergarten', 0, 3, 4, -1, -1, 2],
            ['GRADE', 'K', 'Kindergarten', 0, 5, 5, 0, 0, 3],
        ];
        for ($g = 1; $g <= 12; $g++) {
            $rows[] = ['GRADE', sprintf('%02d', $g), "Grade $g", 0, 5 + $g, 5 + $g, $g, $g, 3 + $g];
        }
        array_push($rows,
            ['GRADE', 'HE', 'Higher education', 1, 18, null, 13, 16, 20],
            ['GRADE', 'VOC', 'Vocational training', 1, 14, null, 9, 14, 21],
            ['GRADE', 'ADULT', 'Adult education', 1, 18, null, 13, 16, 22],
            ['GRADE', 'PRO', 'Professional development', 1, 21, null, 16, 16, 23],
            ['GRADE', 'LLL', 'Lifelong learning', 1, 18, null, 13, 16, 24],
        );
        // England: Reception then Years 1-13; Year n is roughly US grade n-1.
        $rows[] = ['GB-ENG', 'EYFS', 'Early years foundation stage (Reception)', 1, 3, 4, -1, -1, 1];
        for ($y = 1; $y <= 13; $y++) {
            $rows[] = ['GB-ENG', "Y$y", "Year $y", 0, 4 + $y, 4 + $y, $y - 1, $y - 1, 1 + $y];
        }
        array_push($rows,
            ['GB-ENG', 'KS1', 'Key stage 1 (Years 1-2)', 1, 5, 6, 0, 1, 20],
            ['GB-ENG', 'KS2', 'Key stage 2 (Years 3-6)', 1, 7, 10, 2, 5, 21],
            ['GB-ENG', 'KS3', 'Key stage 3 (Years 7-9)', 1, 11, 13, 6, 8, 22],
            ['GB-ENG', 'KS4', 'Key stage 4 (Years 10-11)', 1, 14, 15, 9, 10, 23],
            // Scotland, Curriculum for Excellence levels (bands)
            ['GB-SCT', 'early', 'Early level (nursery to P1)', 1, 3, 5, -2, 0, 1],
            ['GB-SCT', 'first', 'First level (to the end of P4)', 1, 5, 8, 0, 3, 2],
            ['GB-SCT', 'second', 'Second level (to the end of P7)', 1, 8, 11, 3, 6, 3],
            ['GB-SCT', 'third', 'Third level (S1-S3)', 1, 11, 14, 6, 8, 4],
            ['GB-SCT', 'fourth', 'Fourth level (S1-S3, beyond third)', 1, 12, 15, 7, 9, 5],
            ['GB-SCT', 'senior', 'Senior phase (S4-S6)', 1, 14, 17, 9, 12, 6],
            // Wales, Curriculum for Wales progression steps (reference points at ages 5, 8, 11, 14, 16)
            ['GB-WLS', 'PS1', 'Progression step 1 (around age 5)', 1, 3, 5, -2, 0, 1],
            ['GB-WLS', 'PS2', 'Progression step 2 (around age 8)', 1, 5, 8, 0, 3, 2],
            ['GB-WLS', 'PS3', 'Progression step 3 (around age 11)', 1, 8, 11, 3, 6, 3],
            ['GB-WLS', 'PS4', 'Progression step 4 (around age 14)', 1, 11, 14, 6, 9, 4],
            ['GB-WLS', 'PS5', 'Progression step 5 (around age 16)', 1, 14, 16, 9, 11, 5],
            // Northern Ireland key stages (NI Years 1-12)
            ['GB-NIR', 'FS', 'Foundation stage (Years 1-2)', 1, 4, 5, -1, 0, 1],
            ['GB-NIR', 'KS1', 'Key stage 1 (Years 3-4)', 1, 6, 7, 1, 2, 2],
            ['GB-NIR', 'KS2', 'Key stage 2 (Years 5-7)', 1, 8, 10, 3, 5, 3],
            ['GB-NIR', 'KS3', 'Key stage 3 (Years 8-10)', 1, 11, 13, 6, 8, 4],
            ['GB-NIR', 'KS4', 'Key stage 4 (Years 11-12)', 1, 14, 15, 9, 10, 5],
        );

        return $rows;
    }

    /** Common Standards Project education level => [system, code] */
    public const CSP_LEVELS = [
        'Pre-K' => 'PK', 'K' => 'K', 'HigherEducation' => 'HE', 'Undergraduate-LowerDivision' => 'HE',
        'Undergraduate-UpperDivision' => 'HE', 'Postgraduate' => 'HE', 'VocationalTraining' => 'VOC',
        'AdultEducation' => 'ADULT', 'ProfessionalEducation-Development' => 'PRO', 'LifeLongLearning' => 'LLL',
        'Infant/Toddler' => 'IT', 'InfantToddler' => 'IT',
    ];

    public static function subjectFor(string ...$texts): string
    {
        $text = mb_strtolower(implode(' | ', array_filter($texts)));
        foreach (self::SUBJECT_KEYWORDS as $pattern => $slug) {
            if (preg_match($pattern . 'u', $text)) {
                return $slug;
            }
        }

        return 'other';
    }

    public static function seed(PDO $db): void
    {
        $now = date('Y-m-d H:i:s');

        // subjects (parents first)
        foreach (self::SUBJECTS as $slug => [$name, $parent]) {
            $parentId = $parent ? Sql::scalar($db, 'SELECT id FROM standard_subjects WHERE slug = ?', [$parent]) : null;
            Sql::upsert($db, 'standard_subjects', ['slug' => $slug], ['name' => $name, 'parent_id' => $parentId, 'sort' => array_search($slug, array_keys(self::SUBJECTS), true)]);
        }
        foreach (self::levels() as [$system, $code, $label, $band, $af, $at, $gf, $gt, $sort]) {
            Sql::upsert($db, 'standard_education_levels', ['system' => $system, 'code' => $code], [
                'label' => $label, 'is_band' => $band, 'age_from' => $af, 'age_to' => $at,
                'grade_from' => $gf, 'grade_to' => $gt, 'sort' => $sort,
            ]);
        }
        foreach (self::JURISDICTIONS as $code => [$name, $kind, $parent, $country, $system]) {
            $parentId = $parent ? Sql::scalar($db, 'SELECT id FROM standard_jurisdictions WHERE code = ?', [$parent]) : null;
            Sql::upsert($db, 'standard_jurisdictions', ['code' => $code], [
                'name' => $name, 'kind' => $kind, 'parent_id' => $parentId, 'country' => $country,
                'level_system' => $system, 'updated_at' => $now,
            ], ['created_at' => $now]);
        }
    }
}
