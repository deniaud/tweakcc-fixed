// Please see the note about writing patches in ./index
//
// Citation Selection Hook
//
// Hooks into CC's OSC52 toast formatter (MG8 in 2.1.143) to do three
// things in one place:
//
//   1. Snapshot the selected text into globalThis.__cc_last_selection__
//      = { text: <H>, ts: Date.now() }. The citation modal reads from
//      here if it needs the raw selection independent of the prop.
//
//   2. Call globalThis.__cc_open_citation_modal(text) (registered by
//      citationToolJsxBridge.ts), which mounts the full-screen citation
//      modal via setToolJSX.
//
//   3. Replaces the `case "osc52"` toast text from
//          `sent ${q} ${K} via OSC 52 · check terminal clipboard settings if paste fails`
//      to
//          `Selected ${q} ${K} · citation modal…`
//
//      OSC 52 copying itself is upstream of this formatter and is
//      unaffected — only the user-facing toast text changes.
//
// Anchor strategy: regex match on the toast-formatter function body
// shape, capturing the H parameter name (it's the selection text) so
// the snapshot statement uses the same identifier the rest of the
// function uses.
//
// Body shape (CC 2.1.143):
//   function MG8(H){
//     let $ = mr$(),
//         q = qLH(H),
//         K = q === 1 ? "char" : "chars",
//         _;
//     switch ($) {
//       case "native":      _ = `copied ${q} ${K} to clipboard`; break;
//       case "tmux-buffer": _ = `copied ${q} ${K} to tmux buffer · paste with prefix + ]`; break;
//       case "osc52":       _ = `sent ${q} ${K} via OSC 52 · check terminal clipboard settings if paste fails`; break;
//     }
//     return {
//       key: "selection-copied",
//       text: _,
//       color: "suggestion",
//       priority: "immediate",
//       timeoutMs: $ === "native" ? 2000 : 4000
//     };
//   }
//
// The regex is anchored on the literal switch-case strings
// "to clipboard" / "to tmux buffer" / "via OSC 52" — these are CC's
// stable user-facing strings, not minified identifiers.

import { showDiff } from './index';

// Capture groups (in order):
//   1: outer function name      (e.g. MG8)
//   2: selection-text param     (e.g. H)
//   3: clipboard-mode var       (e.g. $)
//   4: mode-getter function     (e.g. mr$)
//   5: char-count var           (e.g. q)
//   6: char-counter function    (e.g. qLH)
//   7: chars-label var          (e.g. K) — value is "char" or "chars"
//   8: message var              (e.g. _) — assembled toast text
const TOAST_PATTERN =
  /function ([$\w]+)\(([$\w]+)\)\{let ([$\w]+)=([$\w]+)\(\),([$\w]+)=([$\w]+)\(\2\),([$\w]+)=\5===1\?"char":"chars",([$\w]+);switch\(\3\)\{case"native":\8=`copied \$\{\5\} \$\{\7\} to clipboard`;break;case"tmux-buffer":\8=`copied \$\{\5\} \$\{\7\} to tmux buffer \\xB7 paste with prefix \+ \]`;break;case"osc52":\8=`sent \$\{\5\} \$\{\7\} via OSC 52 \\xB7 check terminal clipboard settings if paste fails`;break\}return\{key:"selection-copied",text:\8,color:"suggestion",priority:"immediate",timeoutMs:\3==="native"\?2000:4000\}\}/;

export const writeCitationSelectionToast = (
  oldFile: string
): string | null => {
  const m = oldFile.match(TOAST_PATTERN);
  if (!m || m.index === undefined) {
    console.error(
      'patch: citationSelectionToast: failed to find toast formatter'
    );
    return null;
  }
  // Guard against accidental second match.
  const globalRe = new RegExp(TOAST_PATTERN.source, 'g');
  let count = 0;
  while (globalRe.exec(oldFile) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationSelectionToast: pattern matched ${count} times (expected 1)`
    );
    return null;
  }

  const [
    full,
    fn, // 1: outer fn name (e.g. MG8)
    H, // 2: selection-text param (e.g. H)
    _mode, // 3: clipboard-mode var ($)
    _modeGetter, // 4: mode getter (mr$)
    q, // 5: char-count var (q)
    _counter, // 6: char counter (qLH)
    K, // 7: chars-label var (K)
    msg, // 8: message var (_)
  ] = m;
  void _mode;
  void _modeGetter;
  void _counter;

  // Rebuild the function body with two surgical changes:
  //   - Inject a snapshot of the selection text into
  //     globalThis.__cc_last_selection__ right at function entry, so all
  //     three switch cases share it. Wrapped in try/catch for defense
  //     in case H is some unexpected type.
  //   - Replace ONLY the osc52 toast text with our hook indicator.
  //     Copy logic is upstream and unaffected.
  // After snapshotting the selection, open the citation modal via
  // globalThis.__cc_open_citation_modal (registered by the
  // citationToolJsxBridge patch). That helper calls setToolJSX(lK)
  // which mounts __cc_CitationModal as a full-screen local-jsx
  // overlay — same mechanism used by /help, /model, etc.
  const patched = full
    .replace(
      `function ${fn}(${H}){`,
      `function ${fn}(${H}){try{globalThis.__cc_last_selection__={text:typeof ${H}==="string"?${H}:"",ts:Date.now()};if(typeof globalThis.__cc_open_citation_modal==="function")globalThis.__cc_open_citation_modal(${H})}catch(_e){}`
    )
    .replace(
      'case"osc52":' +
        msg +
        '=`sent ${' +
        q +
        '} ${' +
        K +
        '} via OSC 52 \\xB7 check terminal clipboard settings if paste fails`',
      'case"osc52":' +
        msg +
        '=`Selected ${' +
        q +
        '} ${' +
        K +
        '} \\xB7 citation modal\\u2026`'
    );

  if (patched === full) {
    console.error(
      'patch: citationSelectionToast: replacement produced no diff (sub-replace failed)'
    );
    return null;
  }

  const startIndex = m.index;
  const endIndex = startIndex + full.length;
  const newFile =
    oldFile.slice(0, startIndex) + patched + oldFile.slice(endIndex);
  showDiff(oldFile, newFile, patched, startIndex, endIndex);
  return newFile;
};
