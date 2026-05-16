// Please see the note about writing patches in ./index
//
// Citation Placeholder Parser - Extend CC's placeholder regex set with
// "Pasted citation" so the input UX (caret traversal, highlighting,
// backspace-as-one-token) treats `[Pasted citation #N "preview..."]`
// the same way it treats `[Pasted text #N]`, `[Image #N]`, and
// `[...Truncated text #N ...]`.
//
// Three regex literals in the bundle define the placeholder set:
//
//   1. KI parser (line ~677, inside `function KI(H){...}`):
//      let $=/\[(Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
//
//   2. Input-side word-boundary matcher (line ~687):
//      /(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Image #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]/
//
//   3. String-defined regex constant v_6 (line ~693):
//      v_6="\\[(?:Pasted text|Image|\\.\\.\\.Truncated text) #\\d+(?: \\+\\d+ lines)?\\.*\\]"
//
// For each we add a `Pasted citation` alternative plus an optional
// quoted preview field `(?: "[^"]*")?` so the per-citation snippet is
// recognized as part of the same token.
//
// Note: when FfH (the expander) calls KI on a text containing a citation
// placeholder, it looks up the id in its $ map. Citation ids do NOT exist
// in that map (they live in globalThis.__cc_citations__), so
// `z?.type !== "text"` triggers `continue` and the placeholder passes
// through FfH unchanged. The citationExpanderOnSend patch wraps FfH and
// resolves citation placeholders afterwards.

import { showDiff } from './index';

interface Replacement {
  label: string;
  find: string;
  replace: string;
}

const REPLACEMENTS: Replacement[] = [
  {
    label: 'KI parser regex (line ~677)',
    find: '/\\[(Pasted text|Image|\\.\\.\\.Truncated text) #(\\d+)(?: \\+\\d+ lines)?(\\.)*\\]/g',
    replace:
      '/\\[(Pasted text|Image|\\.\\.\\.Truncated text|Pasted citation) #(\\d+)(?: \\+\\d+ lines)?(?: "[^"]*")?(\\.)*\\]/g',
  },
  {
    // The literal ends with `\]$/` — `$` is an end-of-string anchor inside
    // the regex, used by CC's caret-position-aware backspace logic that
    // only fires when the placeholder is at the very end of the buffer.
    label: 'input word-boundary matcher (line ~687)',
    find: '/(^|\\s)\\[(Pasted text #\\d+(?: \\+\\d+ lines)?|Image #\\d+|\\.\\.\\.Truncated text #\\d+ \\+\\d+ lines\\.\\.\\.)\\]$/',
    replace:
      '/(^|\\s)\\[(Pasted text #\\d+(?: \\+\\d+ lines)?|Image #\\d+|\\.\\.\\.Truncated text #\\d+ \\+\\d+ lines\\.\\.\\.|Pasted citation #\\d+(?: "[^"]*")?)\\]$/',
  },
  {
    label: 'string-defined v_6 regex constant (line ~693)',
    find: '"\\\\[(?:Pasted text|Image|\\\\.\\\\.\\\\.Truncated text) #\\\\d+(?: \\\\+\\\\d+ lines)?\\\\.*\\\\]"',
    replace:
      '"\\\\[(?:Pasted text|Image|\\\\.\\\\.\\\\.Truncated text|Pasted citation) #\\\\d+(?: \\\\+\\\\d+ lines)?(?: \\"[^\\"]*\\")?\\\\.*\\\\]"',
  },
];

export const writeCitationPlaceholderParser = (
  oldFile: string
): string | null => {
  let file = oldFile;

  for (const { label, find, replace } of REPLACEMENTS) {
    const firstIdx = file.indexOf(find);
    if (firstIdx === -1) {
      console.error(
        `patch: citationPlaceholderParser: failed to find ${label}`
      );
      return null;
    }
    const secondIdx = file.indexOf(find, firstIdx + 1);
    if (secondIdx !== -1) {
      console.error(
        `patch: citationPlaceholderParser: ${label} matched more than once (first @${firstIdx}, second @${secondIdx})`
      );
      return null;
    }

    const newFile =
      file.slice(0, firstIdx) + replace + file.slice(firstIdx + find.length);
    showDiff(file, newFile, replace, firstIdx, firstIdx + find.length);
    file = newFile;
  }

  return file;
};
