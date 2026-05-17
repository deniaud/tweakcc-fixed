// Please see the note about writing patches in ./index
//
// Citation Keyboard Handler
//
// Two surgical injections, both anchored on stable shapes that live
// inside `in5` (the prompt-input wrapper component):
//
//   Edit 1 — expose `insertTextRef.current` to globals
//     Anchor: `if(e)e.current={cursorOffset:`
//     Injects right after this assignment block so the rest of in5
//     keeps working. After the inject:
//       globalThis.__cc_input_ref = e
//     The insert API is then reachable from anywhere as
//       globalThis.__cc_input_ref.current.insert("...text...")
//
//   Edit 2 — intercept c / q / Esc in the onKeyDownBefore handler (I9)
//     Anchor: `function I9(S$){if(`
//     Injects at function entry so our checks run BEFORE the rest of
//     I9 (and BEFORE keystrokes reach the input). When the citation
//     overlay is active (fresh, non-dismissed __cc_last_selection__):
//       Esc → dismiss overlay, consume keystroke
//       c   → OSC 52 copy already happened in MG8 on select, so just
//             dismiss overlay
//       q   → insert `[Pasted citation #N "preview"]` placeholder into
//             the main input via globalThis.__cc_input_ref.current.insert,
//             then dismiss overlay
//     Each handler calls __cc_force_dn5_rerender to clear the overlay
//     immediately, and uses preventDefault+stopImmediatePropagation
//     so the rest of I9 (and the input) ignores the keystroke.

import { showDiff } from './index';

// === Edit 1: expose insertTextRef ===
const INSERT_REF_ANCHOR = 'if(e)e.current={cursorOffset:';

const INSERT_REF_PREFIX =
  'if(e){try{globalThis.__cc_input_ref=e}catch(_e){}}' +
  'if(e)e.current={cursorOffset:';

// === Edit 2: hotkey handler at I9 entry ===
const I9_ENTRY_ANCHOR = /function I9\(([$\w]+)\)\{if\(/;

const buildHotkeyInjection = (eventVar: string): string =>
  '/*__cc citation hotkeys*/' +
  'try{' +
  'var __ccS=globalThis.__cc_last_selection__;' +
  'if(__ccS&&typeof __ccS.text==="string"&&__ccS.text.length>0&&' +
  '!__ccS.dismissed&&Date.now()-(__ccS.ts||0)<30000){' +
  // Esc → dismiss
  'if(' + eventVar + '&&' + eventVar + '.name==="escape"){' +
  '__ccS.dismissed=true;' +
  'if(typeof globalThis.__cc_force_dn5_rerender==="function")globalThis.__cc_force_dn5_rerender();' +
  'if(' + eventVar + '.preventDefault)' + eventVar + '.preventDefault();' +
  'if(' + eventVar + '.stopImmediatePropagation)' + eventVar + '.stopImmediatePropagation();' +
  'return;' +
  '}' +
  // 'c' → just dismiss (OSC52 already done in MG8 on select)
  'if(' + eventVar + '&&' + eventVar + '.input==="c"){' +
  '__ccS.dismissed=true;' +
  'if(typeof globalThis.__cc_force_dn5_rerender==="function")globalThis.__cc_force_dn5_rerender();' +
  'if(' + eventVar + '.preventDefault)' + eventVar + '.preventDefault();' +
  'if(' + eventVar + '.stopImmediatePropagation)' + eventVar + '.stopImmediatePropagation();' +
  'return;' +
  '}' +
  // 'q' → insert citation placeholder into input + dismiss
  'if(' + eventVar + '&&' + eventVar + '.input==="q"){' +
  'try{' +
  'if(globalThis.__cc_citations__&&globalThis.__cc_input_ref&&globalThis.__cc_input_ref.current&&typeof globalThis.__cc_input_ref.current.insert==="function"){' +
  'var __ccPh=globalThis.__cc_citations__.insertPlaceholder(__ccS.text,"");' +
  'globalThis.__cc_input_ref.current.insert(__ccPh);' +
  '}' +
  '}catch(_e){' +
  'try{globalThis.__cc_q_err=String(_e&&_e.message||_e)}catch(_e2){}' +
  '}' +
  '__ccS.dismissed=true;' +
  'if(typeof globalThis.__cc_force_dn5_rerender==="function")globalThis.__cc_force_dn5_rerender();' +
  'if(' + eventVar + '.preventDefault)' + eventVar + '.preventDefault();' +
  'if(' + eventVar + '.stopImmediatePropagation)' + eventVar + '.stopImmediatePropagation();' +
  'return;' +
  '}' +
  '}' +
  '}catch(_e){' +
  'try{globalThis.__cc_kb_err=String(_e&&_e.message||_e)}catch(_e2){}' +
  '}';

export const writeCitationKeyboardHandler = (
  oldFile: string
): string | null => {
  // --- Edit 1: insertTextRef export ---
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
  let file =
    oldFile.slice(0, refIdx) +
    INSERT_REF_PREFIX +
    oldFile.slice(refIdx + INSERT_REF_ANCHOR.length);

  // --- Edit 2: hotkey handler at I9 entry ---
  const m = file.match(I9_ENTRY_ANCHOR);
  if (!m || m.index === undefined) {
    console.error(
      'patch: citationKeyboardHandler: failed to find I9 entry anchor'
    );
    return null;
  }
  const globalRe = new RegExp(I9_ENTRY_ANCHOR.source, 'g');
  let count = 0;
  while (globalRe.exec(file) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationKeyboardHandler: I9 entry anchor matched ${count} times (expected 1)`
    );
    return null;
  }

  const eventVar = m[1]; // e.g. S$
  const inject = buildHotkeyInjection(eventVar);
  // We replace `function I9(S$){if(` with `function I9(S$){<inject>if(`
  // to keep the rest of the function body intact.
  const newPrefix = `function I9(${eventVar}){` + inject + `if(`;

  const newFile =
    file.slice(0, m.index) +
    newPrefix +
    file.slice(m.index + m[0].length);

  showDiff(
    oldFile,
    newFile,
    INSERT_REF_PREFIX + ' /* ... */ ' + newPrefix,
    refIdx,
    m.index + m[0].length
  );
  return newFile;
};
