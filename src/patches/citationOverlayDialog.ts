// Please see the note about writing patches in ./index
//
// Citation Overlay Dialog
//
// Injects an early-return into CC's footer-renderer (Dn5 in 2.1.143)
// so that when there is a fresh selection in globalThis.__cc_last_selection__,
// the footer area renders our citation dialog instead of the usual hints.
//
// This mirrors how /help works in CC: the `helpOpen` prop branches to
// a different component (Qj8) before the default footer renders. We
// inject our citation branch in front of helpOpen so it takes priority.
//
// Visual placement: the dialog appears in the footer area (above the
// status line). It does NOT push existing content upward — CC's layout
// uses `position:"absolute", bottom:0, left:0, right:0` style for the
// footer region, so the dialog overlays the empty space and hints.
//
// In-scope identifiers from the original Dn5 body:
//   a5  — React module (used as a5.createElement)
//   p   — Box component
//   k   — Text component
//
// All three are module-scope closures, so they are reachable from any
// statement we inject inside Dn5. Wrapped in try/catch so that if the
// scope shape ever changes in a future CC build, we fall through to
// the stock footer instead of crashing.
//
// The dialog body uses the same primitives CC uses elsewhere:
//   borderStyle: "round"
//   borderColor: "permission" (orange) — matches the look of CC's own dialogs
//   flexDirection: "column", paddingX, marginX

import { showDiff } from './index';

// Anchor on the function declaration + the `c0$.c(74)` memo-cache call
// that immediately follows. The `c(74)` size alone is not unique
// (another function ej8 starts the same way), so we add a lookahead
// for `helpOpen:` which only appears in the footer renderer Dn5's
// destructured props. Lookahead does NOT consume — m[0] still ends
// after the comma, so replacement is surgical.
//
// Capture group 1: outer function name (Dn5)
// Capture group 2: memo-cache var name (c0$)
const DN5_PATTERN =
  /function ([$\w]+)\(H\)\{let \$=([$\w]+)\.c\(74\),(?=\{[^}]{50,1000}helpOpen:)/;

// Production overlay with explicit re-render mechanism.
//
// Dn5 is memoised by CC's render compiler — it reads
// `globalThis.__cc_last_selection__` outside of React's tracking, so
// just mutating that global does NOT cause Dn5 to re-render.
//
// Fix: register a force-rerender callback through React's useState +
// useEffect. The MG8 toast-formatter calls this callback right after
// updating __cc_last_selection__, which triggers a fresh Dn5 render
// that reads the current selection.
//
// useState / useEffect are placed BEFORE the original `c0$.c(74)`
// memo-cache call — React Forget's compiler cache (`c0$.c(N)`) is
// separate from React's own hook state, so adding our hooks in front
// does not shift any indices in that cache.
const CITATION_OVERLAY_RUNTIME =
  '/*__cc citation overlay__*/' +
  // 1. Register a re-render trigger that MG8 can call.
  'try{' +
  'var __ccPair=a5.useState(0);' +
  'var __ccSetTick=__ccPair[1];' +
  'a5.useEffect(function(){' +
  'globalThis.__cc_force_dn5_rerender=function(){__ccSetTick(Date.now())};' +
  'return function(){globalThis.__cc_force_dn5_rerender=null}' +
  '},[]);' +
  '}catch(__ccEhook){' +
  'try{globalThis.__cc_dn5_hook_err=String(__ccEhook&&__ccEhook.message||__ccEhook)}catch(__ccE2){}' +
  '}' +
  // 2. Render overlay if there is a fresh, non-dismissed selection.
  'try{' +
  'var __ccS=globalThis.__cc_last_selection__;' +
  'if(__ccS&&typeof __ccS.text==="string"&&__ccS.text.length>0&&' +
  'Date.now()-(__ccS.ts||0)<30000&&!__ccS.dismissed){' +
  'var __ccTxt=__ccS.text;' +
  'var __ccPrev=__ccTxt.length>72?__ccTxt.slice(0,72)+"\\u2026":__ccTxt;' +
  '__ccPrev=__ccPrev.replace(/\\s+/g," ");' +
  'return a5.createElement(p,{' +
  'borderStyle:"round",' +
  'borderColor:"permission",' +
  'flexDirection:"column",' +
  'paddingX:2,' +
  'paddingY:0,' +
  'marginX:1' +
  '},' +
  'a5.createElement(p,{flexDirection:"row",justifyContent:"space-between"},' +
  'a5.createElement(k,{bold:true,color:"permission"},"Citation"),' +
  'a5.createElement(k,{dimColor:true},"esc")' +
  '),' +
  'a5.createElement(p,{marginTop:1},' +
  'a5.createElement(k,{dimColor:true},"\\"" + __ccPrev + "\\"")' +
  '),' +
  'a5.createElement(p,{marginTop:1,flexDirection:"column"},' +
  'a5.createElement(k,null,a5.createElement(k,{bold:true},"c"),a5.createElement(k,{dimColor:true}," copy to clipboard")),' +
  'a5.createElement(k,null,a5.createElement(k,{bold:true},"q"),a5.createElement(k,{dimColor:true}," quote with comment"))' +
  ')' +
  ');' +
  '}' +
  '}catch(__ccErender){' +
  'try{globalThis.__cc_dn5_err=String(__ccErender&&__ccErender.message||__ccErender)}catch(__ccE2){}' +
  '}';

export const writeCitationOverlayDialog = (oldFile: string): string | null => {
  const m = oldFile.match(DN5_PATTERN);
  if (!m || m.index === undefined) {
    console.error(
      'patch: citationOverlayDialog: failed to find Dn5 footer renderer'
    );
    return null;
  }

  // Sanity: pattern should appear once (Dn5 is a unique component).
  const globalRe = new RegExp(DN5_PATTERN.source, 'g');
  let count = 0;
  while (globalRe.exec(oldFile) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationOverlayDialog: Dn5 pattern matched ${count} times (expected 1)`
    );
    return null;
  }

  const fnName = m[1]; // e.g. Dn5
  const cacheVar = m[2]; // e.g. c0$

  // Build the injection point: right after `function NAME(H){` and
  // BEFORE `let $=cacheVar.c(74),`. Pattern matches both, so we
  // replace m[0] with:
  //   "function NAME(H){"  +  <citation runtime>  +  "let $=cacheVar.c(74),"
  const matchStart = m.index;
  const matchEnd = matchStart + m[0].length;

  const replacement =
    `function ${fnName}(H){` +
    CITATION_OVERLAY_RUNTIME +
    `let $=${cacheVar}.c(74),`;

  const newFile =
    oldFile.slice(0, matchStart) + replacement + oldFile.slice(matchEnd);

  showDiff(oldFile, newFile, replacement, matchStart, matchEnd);
  return newFile;
};
