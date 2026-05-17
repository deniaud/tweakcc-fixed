// Please see the note about writing patches in ./index
//
// Citation Tool JSX Bridge — Full-screen citation modal via setToolJSX
// =====================================================================
//
// Replaces the empty `_8.useEffect(()=>{},[])` in CC's App component
// (`$r6` in 2.1.143) with an effect that wires up the citation modal.
//
//   1. Exposes `lK` (CC's setToolJSX) as `globalThis.__cc_set_tool_jsx`.
//      `lK` is `useCallback(fn, [])` — stable identity across renders,
//      so the reference captured on mount remains valid forever.
//
//   2. Defines `globalThis.__cc_CitationModal` — a React component that
//      renders a full-width "modal". NB6 wraps the JSX with
//      position:absolute, bottom:0, left:0, right:0, maxHeight:rows-kB6
//      so the modal slides over the message scroll area from the bottom
//      — same mechanism as /help.
//
//   3. Defines `globalThis.__cc_open_citation_modal(text)` — a bridge
//      callable from MG8 (the OSC52 toast formatter, which runs outside
//      React context).
//
// Component UX:
//
//   ┌─ Citation ──────── type · Enter inserts · ↓ switch · Esc cancel ─┐
//   │ "preview text..."                                                │
//   │                                                                  │
//   │ ▶ Custom: <comment buffer>_                                      │
//   │   Copy (already in clipboard via OSC 52)                         │
//   │   Cancel                                                         │
//   └──────────────────────────────────────────────────────────────────┘
//
// Default mode: 'custom' — typing immediately appends to comment.
// In any non-custom mode, typing switches back to custom + appends.
// Arrows / Tab rotate Custom → Copy → Cancel (wrapping). Shift+Tab
// reverses. Enter: Custom inserts placeholder + closes; Copy/Cancel
// just close. Esc closes.
//
// Keyboard input is read via `process.stdin.on('data')` because CC
// does NOT use Ink's useInput. The listener is attached in the
// component's useEffect (mount) and torn down on unmount.

import { showDiff, findBoxComponent, findTextComponent } from './index';

// Anchor: empty useEffect immediately followed by App's main state
// hooks. The captured group order:
//   1: React var (e.g. _8)
//   2: jsx state (W8)
//   3: jsx setter (Iq)
//   4: jsx ref (ZK)
//   5: setToolJSX callback name (lK)
const APP_HOOKS_ANCHOR =
  /([$\w]+)\.useEffect\(\(\)=>\{\},\[\]\);let\[([$\w]+),([$\w]+)\]=\1\.useState\(null\),([$\w]+)=\1\.useRef\(null\),([$\w]+)=\1\.useCallback/;

const buildBridgeEffect = (
  R: string, // React var (e.g. _8)
  lK: string, // setToolJSX (e.g. lK)
  Box: string, // Box component (e.g. p)
  Text: string // Text component (e.g. k)
): string => {
  return (
    'try{' +
    'globalThis.__cc_set_tool_jsx=' +
    lK +
    ';' +
    // ----- Define __cc_CitationModal (idempotent) -----
    'if(!globalThis.__cc_CitationModal){' +
    'var __ccCe=' +
    R +
    '.createElement;' +
    'var __ccUS=' +
    R +
    '.useState;' +
    'var __ccUE=' +
    R +
    '.useEffect;' +
    'var __ccUR=' +
    R +
    '.useRef;' +
    'var __ccB=' +
    Box +
    ';' +
    'var __ccT=' +
    Text +
    ';' +
    'var __ccModes=["custom","cancel"];' +
    'globalThis.__cc_CitationModal=function(props){' +
    'var text=(props&&props.text)||"";' +
    'var ms=__ccUS("custom");var mode=ms[0];var setMode=ms[1];' +
    'var cs=__ccUS("");var comment=cs[0];var setComment=cs[1];' +
    'var close=function(){try{if(globalThis.__cc_set_tool_jsx)globalThis.__cc_set_tool_jsx({clearLocalJSX:true})}catch(e){}};' +
    // Refs to latest values for the stdin listener (avoid stale closure)
    'var modeRef=__ccUR(mode);modeRef.current=mode;' +
    'var commentRef=__ccUR(comment);commentRef.current=comment;' +
    'var textRef=__ccUR(text);textRef.current=text;' +
    // Stdin listener + modal-active marker
    '__ccUE(function(){' +
    'try{globalThis.__cc_modal_active=true}catch(_e){}' +
    'var onData=function(buf){' +
    'try{' +
    'var s=buf&&buf.toString?buf.toString("utf8"):String(buf);' +
    'if(!s||s.length===0)return;' +
    // Ctrl+C: close (let CC handle subsequent if needed)
    'if(s==="\\u0003"){close();return}' +
    // Pure Esc (single 0x1b byte)
    'if(s==="\\u001b"){close();return}' +
    // Arrow down or Tab → next mode
    'if(s==="\\u001b[B"||s==="\\t"){' +
    'var i=__ccModes.indexOf(modeRef.current);' +
    'setMode(__ccModes[(i+1)%__ccModes.length]);' +
    'return;' +
    '}' +
    // Arrow up or Shift+Tab → prev mode
    'if(s==="\\u001b[A"||s==="\\u001b[Z"){' +
    'var j=__ccModes.indexOf(modeRef.current);' +
    'setMode(__ccModes[(j-1+__ccModes.length)%__ccModes.length]);' +
    'return;' +
    '}' +
    // Enter → action
    'if(s==="\\r"||s==="\\n"){' +
    'var m=modeRef.current;' +
    'if(m==="custom"){' +
    'try{' +
    'if(globalThis.__cc_citations__&&globalThis.__cc_input_ref&&globalThis.__cc_input_ref.current&&typeof globalThis.__cc_input_ref.current.insert==="function"){' +
    'var ph=globalThis.__cc_citations__.insertPlaceholder(textRef.current,commentRef.current||"");' +
    'globalThis.__cc_input_ref.current.insert(ph);' +
    '}' +
    '}catch(e){try{globalThis.__cc_modal_insert_err=String(e&&e.message||e)}catch(_){}}' +
    '}' +
    'close();return;' +
    '}' +
    // Backspace (delete in some terminals)
    'if(s==="\\u007f"||s==="\\b"){' +
    'if(modeRef.current==="custom"){' +
    'setComment((commentRef.current||"").slice(0,-1));' +
    '}' +
    'return;' +
    '}' +
    // Bracketed paste — strip \x1b[200~ ... \x1b[201~ wrapper
    'if(s.indexOf("\\u001b[200~")===0){' +
    'var content=s.slice(6);' +
    'var end=content.indexOf("\\u001b[201~");' +
    'if(end>=0)content=content.slice(0,end);' +
    'if(content.length>0&&modeRef.current==="custom"){' +
    'setComment((commentRef.current||"")+content.replace(/[\\r\\n\\t]/g," "));' +
    '}' +
    'return;' +
    '}' +
    // Other escape sequences — ignore
    'if(s.charCodeAt(0)===27)return;' +
    // Printable chars only
    'var out="";' +
    'for(var k=0;k<s.length;k++){' +
    'var cc=s.charCodeAt(k);' +
    'if(cc>=32&&cc!==127)out+=s.charAt(k);' +
    '}' +
    'if(out.length>0){' +
    'if(modeRef.current!=="custom")setMode("custom");' +
    'setComment((commentRef.current||"")+out);' +
    '}' +
    '}catch(e){try{globalThis.__cc_modal_kb_err=String(e&&e.message||e)}catch(_){}}' +
    '};' +
    'try{' +
    'if(globalThis.process&&globalThis.process.stdin&&typeof globalThis.process.stdin.on==="function"){' +
    'globalThis.process.stdin.on("data",onData);' +
    '}' +
    '}catch(e){try{globalThis.__cc_modal_attach_err=String(e&&e.message||e)}catch(_){}}' +
    'return function(){' +
    'try{globalThis.__cc_modal_active=false}catch(_e){}' +
    'try{' +
    'if(globalThis.process&&globalThis.process.stdin){' +
    'if(typeof globalThis.process.stdin.off==="function")globalThis.process.stdin.off("data",onData);' +
    'else if(typeof globalThis.process.stdin.removeListener==="function")globalThis.process.stdin.removeListener("data",onData);' +
    '}' +
    '}catch(e){}' +
    '};' +
    '},[]);' +
    // ----- Render -----
    'var prev=String(text).replace(/[\\r\\n\\t]+/g," ").replace(/\\s+/g," ").trim();' +
    'if(prev.length>80)prev=prev.slice(0,80)+"\\u2026";' +
    'var hint=(mode==="custom")?"type \\u00b7 Enter to insert quote \\u00b7 \\u2193 to cancel \\u00b7 Esc":"Enter to dismiss \\u00b7 \\u2191 to write a comment \\u00b7 Esc";' +
    'var marker=function(m){return modeRef.current===m||mode===m?"\\u25b6 ":"  "};' +
    'var rowCustom=__ccCe(__ccB,{flexDirection:"row"},' +
    '__ccCe(__ccT,{color:mode==="custom"?"permission":undefined,bold:mode==="custom"},marker("custom")+"Comment: "),' +
    '__ccCe(__ccT,{color:mode==="custom"?"permission":undefined},comment),' +
    '(mode==="custom")?__ccCe(__ccT,{color:"permission",inverse:true}," "):null,' +
    '(comment.length===0&&mode==="custom")?__ccCe(__ccT,{dimColor:true,italic:true}," (type, Enter to insert)"):null' +
    ');' +
    'var rowCancel=__ccCe(__ccB,{flexDirection:"row"},' +
    '__ccCe(__ccT,{color:mode==="cancel"?"permission":undefined,bold:mode==="cancel"},marker("cancel")+"Cancel")' +
    ');' +
    'return __ccCe(__ccB,{flexDirection:"column",paddingX:2,paddingY:1,borderStyle:"round",borderColor:"permission",width:"100%"},' +
    '__ccCe(__ccB,{flexDirection:"row",justifyContent:"space-between",marginBottom:1},' +
    '__ccCe(__ccT,{bold:true,color:"permission"},"Quote"),' +
    '__ccCe(__ccT,{dimColor:true},hint)' +
    '),' +
    '__ccCe(__ccB,{marginBottom:1},' +
    '__ccCe(__ccT,{dimColor:true},"\\""+prev+"\\"")' +
    '),' +
    '__ccCe(__ccB,{flexDirection:"column"},rowCustom,rowCancel)' +
    ');' +
    '};' +
    '}' +
    // ----- Define opener bridge (idempotent) -----
    'if(!globalThis.__cc_open_citation_modal){' +
    'globalThis.__cc_open_citation_modal=function(text){' +
    'try{' +
    // Guards: drop empty/whitespace-only/too-short selections.
    'if(typeof text!=="string")return;' +
    'if(text.replace(/\\s+/g,"").length<2)return;' +
    // Don't reopen if the citation modal is already mounted —
    // protects the comment buffer from being wiped by a stray
    // re-selection.
    'if(globalThis.__cc_modal_active===true)return;' +
    'var setX=globalThis.__cc_set_tool_jsx;' +
    'if(!setX||!globalThis.__cc_CitationModal)return;' +
    // lK guards non-clearLocalJSX while ZK.current is set, so clear
    // any open modal first, then mount the citation modal.
    'setX({clearLocalJSX:true});' +
    'setX({' +
    'jsx:' +
    R +
    '.createElement(globalThis.__cc_CitationModal,{text:text}),' +
    'isLocalJSXCommand:true,' +
    'isImmediate:false,' +
    'shouldHidePromptInput:true,' +
    'showSpinner:false' +
    '});' +
    '}catch(e){try{globalThis.__cc_open_err=String(e&&e.message||e)}catch(_){}}' +
    '};' +
    '}' +
    '}catch(e){' +
    'try{globalThis.__cc_bridge_err=String(e&&e.message||e)}catch(_){}' +
    '}'
  );
};

export const writeCitationToolJsxBridge = (oldFile: string): string | null => {
  const m = oldFile.match(APP_HOOKS_ANCHOR);
  if (!m || m.index === undefined) {
    console.error(
      'patch: citationToolJsxBridge: failed to find App hooks anchor'
    );
    return null;
  }

  // Sanity: anchor should be unique.
  const globalRe = new RegExp(APP_HOOKS_ANCHOR.source, 'g');
  let count = 0;
  while (globalRe.exec(oldFile) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationToolJsxBridge: App hooks anchor matched ${count} times (expected 1)`
    );
    return null;
  }

  // m[1]=React var, m[2]=W8, m[3]=Iq, m[4]=ZK, m[5]=lK
  const [, R, W8, Iq, ZK, lK] = m;
  void W8;
  void Iq;
  void ZK;

  const boxName = findBoxComponent(oldFile);
  const textName = findTextComponent(oldFile);
  if (!boxName || !textName) {
    console.error(
      `patch: citationToolJsxBridge: failed to resolve Box (${boxName}) or Text (${textName})`
    );
    return null;
  }

  // Note: getReactVar() returns the module-level React alias (e.g.
  // "ivK"), but inside `$r6` App component scope the bundle uses a
  // local alias (`_8` in 2.1.143). The anchor captures the local
  // alias, which is what we need for in-scope references.

  const effectBody = buildBridgeEffect(R, lK, boxName, textName);

  // Rebuild the matched prefix with our bridge effect in place of the
  // no-op useEffect. m[0] ends at "useCallback" — we put that suffix
  // back to keep the surrounding let-chain valid.
  const matchStart = m.index;
  const matchEnd = matchStart + m[0].length;
  const newHead =
    `${R}.useEffect(()=>{${effectBody}},[]);` +
    `let[${m[2]},${m[3]}]=${R}.useState(null),` +
    `${m[4]}=${R}.useRef(null),` +
    `${m[5]}=${R}.useCallback`;

  const newFile =
    oldFile.slice(0, matchStart) + newHead + oldFile.slice(matchEnd);

  showDiff(oldFile, newFile, newHead, matchStart, matchEnd);
  return newFile;
};
