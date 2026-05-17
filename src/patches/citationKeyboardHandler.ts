// Please see the note about writing patches in ./index
//
// Citation Input Ref Expose (formerly Citation Keyboard Handler)
//
// This patch was originally two edits — exposing `__cc_input_ref` and
// intercepting c/q/Esc in `I9` (the prompt's onKeyDownBefore). In
// Iteration 2 we rebuilt the modal on top of `setToolJSX` (lK), which
// auto-disables I9 via the `A3H()||qH` guard. Keyboard handling now
// lives inside `__cc_CitationModal` (citationToolJsxBridge.ts) and
// uses a `process.stdin.on('data')` listener bound to component mount.
//
// What survived: exposing `e.current` (the input ref) as
// `globalThis.__cc_input_ref` so the modal can call
// `globalThis.__cc_input_ref.current.insert(placeholder)` when the
// user confirms a custom-mode citation.
//
// The earlier Edit 2 — injecting at `function I9(S$){if(`
// to handle Esc/c/q — was REMOVED because:
//
//   1. `S$.input` was wrong. The keyboard event class `ApH` exposes
//      `name`, `key`, `ctrl`, `shift`, `meta` — not `input`. So the
//      handler matched nothing in practice.
//
//   2. When `W8.isLocalJSXCommand=true` (our modal is mounted via
//      setToolJSX), in5's I9 bails immediately on the `A3H()||qH`
//      guard. The injected code wouldn't run anyway.
//
//   3. The modal's stdin listener handles all keyboard input cleanly,
//      including arrow nav, text input for comments, and dismissal.

import { showDiff } from './index';

// === Edit 1: expose insertTextRef ===
const INSERT_REF_ANCHOR = 'if(e)e.current={cursorOffset:';

const INSERT_REF_PREFIX =
  'if(e){try{globalThis.__cc_input_ref=e}catch(_e){}}' +
  'if(e)e.current={cursorOffset:';

export const writeCitationKeyboardHandler = (
  oldFile: string
): string | null => {
  const refIdx = oldFile.indexOf(INSERT_REF_ANCHOR);
  if (refIdx === -1) {
    console.error(
      'patch: citationKeyboardHandler: failed to find insertTextRef anchor'
    );
    return null;
  }
  if (oldFile.indexOf(INSERT_REF_ANCHOR, refIdx + 1) !== -1) {
    console.error(
      'patch: citationKeyboardHandler: insertTextRef anchor matched more than once'
    );
    return null;
  }
  const newFile =
    oldFile.slice(0, refIdx) +
    INSERT_REF_PREFIX +
    oldFile.slice(refIdx + INSERT_REF_ANCHOR.length);

  showDiff(oldFile, newFile, INSERT_REF_PREFIX, refIdx, refIdx + INSERT_REF_ANCHOR.length);
  return newFile;
};
