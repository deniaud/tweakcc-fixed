// Please see the note about writing patches in ./index
//
// Citation Force-Rerender (rewritten — isolated child component)
//
// Previous attempt injected useState/useEffect into in5 itself. That
// caused React error #300 ("post-claim init failed") in the bg-spare
// worker — adding hooks to a 30k-char compiled component is fragile.
//
// New approach: render the citation overlay as a SEPARATE child
// component (a sibling of the Dn5 call in in5's return tree). That
// child:
//   1. Owns its own hooks (wq.useState + wq.useEffect) — independent
//      of in5's hook ordering.
//   2. Registers globalThis.__cc_force_dn5_rerender which the MG8
//      toast formatter invokes after every copy event.
//   3. Reads globalThis.__cc_last_selection__ on every render and
//      returns either the bordered overlay or null.
//
// Because the child has its own hooks, setState there re-renders THE
// CHILD (no need to touch in5 or Dn5). MG8 → setState → child
// re-renders → shows up-to-date overlay.
//
// This patch does two surgical edits:
//   1. Insert the component definition at module scope, immediately
//      before `function in5({` — both `wq` (hooks) and `hK`
//      (createElement) plus `p` (Box) and `k` (Text) closures are
//      reachable from this position.
//   2. Insert `hK.createElement(__cc_CitationOverlay),` immediately
//      before `hK.createElement(<Dn5 alias>,{apiKeyStatus:...})` so
//      the new component is mounted as a sibling of Dn5 in in5's
//      return tree.

import { showDiff } from './index';

// === Component definition injected before function in5({ ===
//
// Uses wq.useState + wq.useEffect (hooks) and hK.createElement +
// closure-bound `p` / `k` (Box / Text). All four are module-scope
// references in the in5 module.
const COMPONENT_DEF =
  'function __cc_CitationOverlay(){' +
  // Hooks: stable count (1 useState + 1 useEffect on every render).
  'var __ccPair=wq.useState(0);' +
  'wq.useEffect(function(){' +
  'globalThis.__cc_force_dn5_rerender=function(){' +
  '__ccPair[1](function(n){return (n+1)|0})' +
  '};' +
  'return function(){globalThis.__cc_force_dn5_rerender=null}' +
  '},[]);' +
  // Conditional read of the selection snapshot.
  'try{' +
  'var __ccS=globalThis.__cc_last_selection__;' +
  'if(!__ccS||typeof __ccS.text!=="string"||__ccS.text.length===0||' +
  'Date.now()-(__ccS.ts||0)>30000||__ccS.dismissed)return null;' +
  'var __ccPrev=__ccS.text.length>72?__ccS.text.slice(0,72)+"\\u2026":__ccS.text;' +
  '__ccPrev=__ccPrev.replace(/\\s+/g," ");' +
  'return hK.createElement(p,{' +
  'borderStyle:"round",borderColor:"permission",' +
  'flexDirection:"column",paddingX:2,paddingY:0,marginX:1' +
  '},' +
  'hK.createElement(p,{flexDirection:"row",justifyContent:"space-between"},' +
  'hK.createElement(k,{bold:true,color:"permission"},"Citation"),' +
  'hK.createElement(k,{dimColor:true},"esc")' +
  '),' +
  'hK.createElement(p,{marginTop:1},' +
  'hK.createElement(k,{dimColor:true},"\\"" + __ccPrev + "\\"")' +
  '),' +
  'hK.createElement(p,{marginTop:1,flexDirection:"column"},' +
  'hK.createElement(k,null,hK.createElement(k,{bold:true},"c"),hK.createElement(k,{dimColor:true}," copy to clipboard")),' +
  'hK.createElement(k,null,hK.createElement(k,{bold:true},"q"),hK.createElement(k,{dimColor:true}," quote with comment"))' +
  ')' +
  ');' +
  '}catch(_e){' +
  'try{globalThis.__cc_overlay_err=String(_e&&_e.message||_e)}catch(_e2){}' +
  'return null;' +
  '}' +
  '}';

// === Mount: render <__cc_CitationOverlay/> as sibling of <Dn5/> ===
//
// Anchor: `,hK.createElement(<alias>,` IMMEDIATELY followed (lookahead)
// by a props blob containing `helpOpen:` — which is unique to Dn5
// (`Q28` and other adjacent createElement calls take `apiKeyStatus`
// too, but only Dn5 has `helpOpen`).
//
// Lookahead doesn't consume — m[0] ends after the `(<alias>,`, so the
// replacement is surgical.
const MOUNT_ANCHOR =
  /,hK\.createElement\(([$\w]+),(?=\{[^}]{0,1500}helpOpen:)/;

const IN5_ANCHOR = 'function in5({';

export const writeCitationForceRerender = (
  oldFile: string
): string | null => {
  // --- Edit 1: inject COMPONENT_DEF before function in5 ---
  const in5Idx = oldFile.indexOf(IN5_ANCHOR);
  if (in5Idx === -1) {
    console.error(
      'patch: citationForceRerender: failed to find `function in5({` anchor'
    );
    return null;
  }
  if (oldFile.indexOf(IN5_ANCHOR, in5Idx + 1) !== -1) {
    console.error(
      'patch: citationForceRerender: `function in5({` matched more than once'
    );
    return null;
  }

  let file = oldFile.slice(0, in5Idx) + COMPONENT_DEF + oldFile.slice(in5Idx);

  // --- Edit 2: inject the sibling createElement call ---
  const mountM = file.match(MOUNT_ANCHOR);
  if (!mountM || mountM.index === undefined) {
    console.error(
      'patch: citationForceRerender: failed to find Dn5 mount anchor'
    );
    return null;
  }
  const globalMountRe = new RegExp(MOUNT_ANCHOR.source, 'g');
  let count = 0;
  while (globalMountRe.exec(file) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationForceRerender: mount anchor matched ${count} times (expected 1)`
    );
    return null;
  }
  const dn5Alias = mountM[1];

  // Lookahead in the anchor means m[0] ends after `(<alias>,`, so we
  // only need to rebuild that prefix + prepend our sibling element.
  // The original `{apiKeyStatus:...}` blob remains untouched after.
  const mountReplacement =
    `,hK.createElement(__cc_CitationOverlay),` +
    `hK.createElement(${dn5Alias},`;

  const newFile =
    file.slice(0, mountM.index) +
    mountReplacement +
    file.slice(mountM.index + mountM[0].length);

  showDiff(
    oldFile,
    newFile,
    mountReplacement,
    mountM.index,
    mountM.index + mountM[0].length
  );
  return newFile;
};
