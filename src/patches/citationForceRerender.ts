// Please see the note about writing patches in ./index
//
// Citation Force-Rerender
//
// Registers a force-rerender callback that the MG8 toast formatter
// invokes after every copy event. This forces the Dn5 footer renderer
// to re-evaluate against the latest globalThis.__cc_last_selection__.
//
// Why this lives in the Dn5 *caller* scope, not in Dn5 itself:
//
//   Dn5 is React Forget-compiled and its scope exposes only
//   a5.createElement / a5.Fragment — no hooks. The previous attempt
//   to do useState inside Dn5 silently threw TypeError into a catch.
//
//   The caller of Dn5 (an anonymous function around offset
//   12,930,000 in CC 2.1.143) has FULL React access through `wq`
//   (wq.useState, wq.useEffect, wq.useCallback, ...). It already
//   manages helpOpen state via `[AH, YH] = wq.useState(!1)`. We
//   piggy-back on the same scope.
//
// Anchor: the literal pair of useState calls right before the
//   `wH = KH || AH;` expression. This pattern is stable across CC
//   versions in the 2.1.x line — it's the bottom of a multi-state
//   block in the prompt-input wrapper component.
//
// The callback uses `|0` on the increment to coerce to a 32-bit int
// so the state value can't grow unbounded across many selections.

import { showDiff } from './index';

// Capture groups:
//   1: first state ident (KH)
//   2: first setter ident (OH)
//   3: React module ident (wq)
//   4: second state ident (AH = helpOpen)
//   5: second setter ident (YH)
//   6: derived var (wH)
const HOOK_ANCHOR =
  /let\[([$\w]+),([$\w]+)\]=([$\w]+)\.useState\(!1\),\[([$\w]+),([$\w]+)\]=\3\.useState\(!1\),([$\w]+)=\1\|\|\4;/;

export const writeCitationForceRerender = (oldFile: string): string | null => {
  const m = oldFile.match(HOOK_ANCHOR);
  if (!m || m.index === undefined) {
    console.error(
      'patch: citationForceRerender: failed to find caller hook anchor'
    );
    return null;
  }
  // Sanity: anchor should be unique (this exact triple-state shape
  // only appears in the prompt-input wrapper that hosts Dn5).
  const re = new RegExp(HOOK_ANCHOR.source, 'g');
  let count = 0;
  while (re.exec(oldFile) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationForceRerender: anchor matched ${count} times (expected 1)`
    );
    return null;
  }

  const [, KH, OH, wq, AH, YH, wH] = m;

  // Same statement reconstructed verbatim + a fresh useState + a
  // useEffect that registers/unregisters the global callback.
  const replacement =
    `let[${KH},${OH}]=${wq}.useState(!1),` +
    `[${AH},${YH}]=${wq}.useState(!1),` +
    `[__ccCitT,__ccCitS]=${wq}.useState(0),` +
    `${wH}=${KH}||${AH};` +
    `${wq}.useEffect(function(){` +
    `globalThis.__cc_force_dn5_rerender=function(){` +
    `__ccCitS(function(n){return (n+1)|0})` +
    `};` +
    `return function(){globalThis.__cc_force_dn5_rerender=null}` +
    `},[]);`;

  const newFile =
    oldFile.slice(0, m.index) +
    replacement +
    oldFile.slice(m.index + m[0].length);

  showDiff(oldFile, newFile, replacement, m.index, m.index + m[0].length);
  return newFile;
};
