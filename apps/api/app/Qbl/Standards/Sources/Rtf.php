<?php

namespace App\Qbl\Standards\Sources;

/**
 * RTF to plain text, keeping table structure: cells end with CELL and rows with ROW
 * (the constants below). Enough for the Education Scotland experiences and outcomes file.
 */
final class Rtf
{
    public const CELL = "\u{1F}";   // unit separator

    public const ROW = "\u{1E}";    // record separator

    private const SKIP = ['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf',
        'footerl', 'footerr', 'footerf', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'themedata',
        'colorschememapping', 'latentstyles', 'datastore', 'object', 'fldinst', 'filetbl', 'revtbl', 'pgdsctbl', 'bkmkstart',
        'bkmkend', 'field', 'shp', 'shpinst', 'sp', 'sn', 'sv', 'nonshppict', 'blipuid', 'mmathPr', 'pnseclvl', 'pntext', 'listtext',
        'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'docvar', 'userprops', 'wgrffmtfilter', 'xe', 'tc', 'atnid', 'atnauthor',
        'annotation', 'operator', 'author', 'title', 'subject', 'keywords', 'comment', 'company', 'category'];

    public static function toText(string $rtf): string
    {
        $out = '';
        $stack = [];
        $ignore = false;
        $uc = 1;
        $skipChars = 0;
        $len = strlen($rtf);
        for ($i = 0; $i < $len; $i++) {
            $c = $rtf[$i];
            if ($c === '{') {
                $stack[] = [$ignore, $uc];
                continue;
            }
            if ($c === '}') {
                [$ignore, $uc] = array_pop($stack) ?? [false, 1];
                continue;
            }
            if ($c === '\\') {
                $n = $rtf[$i + 1] ?? '';
                if ($n === '\\' || $n === '{' || $n === '}') {
                    $i++;
                    if (! $ignore) {
                        $out .= $n;
                    }
                    continue;
                }
                if ($n === '*') {          // \* destination we don't know: ignore the group
                    $ignore = true;
                    $i++;
                    continue;
                }
                if ($n === "'") {          // \'hh (Windows-1252)
                    $hex = substr($rtf, $i + 2, 2);
                    $i += 3;
                    if ($skipChars > 0) {
                        $skipChars--;
                    } elseif (! $ignore) {
                        $out .= mb_convert_encoding(chr(hexdec($hex)), 'UTF-8', 'Windows-1252');
                    }
                    continue;
                }
                if (! ctype_alpha($n)) {    // control symbol: \~ \- \_ etc.
                    $i++;
                    if (! $ignore) {
                        $out .= match ($n) { '~' => ' ', '_' => '-', "\n", "\r" => "\n", default => '' };
                    }
                    continue;
                }
                preg_match('/\G\\\\([a-zA-Z]+)(-?\d+)? ?/', $rtf, $m, 0, $i);
                $i += strlen($m[0]) - 1;
                $word = $m[1];
                $arg = isset($m[2]) && $m[2] !== '' ? (int) $m[2] : null;
                if (in_array($word, self::SKIP, true)) {
                    $ignore = true;
                    continue;
                }
                if ($ignore) {
                    continue;
                }
                switch ($word) {
                    case 'par': case 'line': case 'sect': case 'page':
                        $out .= "\n";
                        break;
                    case 'tab':
                        $out .= "\t";
                        break;
                    case 'cell': case 'nestcell':
                        $out .= self::CELL;
                        break;
                    case 'row': case 'nestrow':
                        $out .= self::ROW;
                        break;
                    case 'uc':
                        $uc = $arg ?? 1;
                        break;
                    case 'u':
                        $code = $arg < 0 ? $arg + 65536 : $arg;
                        $out .= mb_chr($code, 'UTF-8');
                        $skipChars = $uc;
                        break;
                    case 'emdash': $out .= '—'; break;
                    case 'endash': $out .= '–'; break;
                    case 'bullet': $out .= '•'; break;
                    case 'lquote': $out .= '‘'; break;
                    case 'rquote': $out .= '’'; break;
                    case 'ldblquote': $out .= '“'; break;
                    case 'rdblquote': $out .= '”'; break;
                }
                continue;
            }
            if ($c === "\r" || $c === "\n") {
                continue;
            }
            if ($skipChars > 0) {
                $skipChars--;
                continue;
            }
            if (! $ignore) {
                $out .= $c;
            }
        }

        return $out;
    }
}
