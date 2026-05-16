// Please see the note about writing patches in ./index
//
// Citation Expander On Send - Expand `[Pasted citation #N "preview"]`
// placeholders in user messages into a structured XML-wrapped block
// before the message reaches the API.
//
// Approach: hook the existing placeholder expander FfH(H, $).
//
//   Original (single line in the bundle):
//     function FfH(H,$){
//       let q=KI(H), K=H;
//       for (let _ = q.length-1; _ >= 0; _--) {
//         let A=q[_], z=$[A.id];
//         if (z?.type !== "text") continue;
//         K = K.slice(0, A.index) + z.content + K.slice(A.index + A.match.length);
//       }
//       return K;
//     }
//
//   $ is CC's id→{type,content} map for pasted-text/image entries.
//   Citation ids do NOT exist in $ — they live in our own runtime
//   registry at `globalThis.__cc_citations__`. The KI regex was
//   extended by citationPlaceholderParser to recognize citation
//   placeholders, so they appear in q but trigger `continue`
//   (z?.type !== "text"), passing through unchanged.
//
//   After FfH finishes its standard expansion, we run a second pass
//   that resolves citation placeholders against our registry and
//   builds the citation block.
//
// Runtime injected immediately after FfH:
//
//   globalThis.__cc_citations__         — id-keyed registry
//   globalThis.__cc_expand_citations(s) — second-pass expander
//
// The wrapped FfH calls __cc_expand_citations at the end, guarded by
// `globalThis.__cc_expand_citations ? ... : K` so it stays safe even
// if the IIFE somehow hasn't run yet (it always has, since the IIFE
// is in the same function-definition statement group, but defense in
// depth).
//
// Expansion format (chosen after researching OpenCode's
// formatEditorContext synthetic-part pattern — XML wrapper for clean
// model parsing, keeping the user-requested "you:" / "But:" inline
// shape for readability):
//
//   <assistant-quotes-with-comments>
//   Below are passages from your previous reply that the user is highlighting, with their comments where applicable.
//
//   you: "<text 1>"
//   you: "<text 2>"
//   But: <comment 2>
//   you: "<text 3>"
//   But: <comment 3>
//   </assistant-quotes-with-comments>
//
//   <remaining user text with placeholders stripped>

import { showDiff } from './index';

// Exact text of the original FfH definition in the bundle.
const FFH_ORIGINAL =
  'function FfH(H,$){let q=KI(H),K=H;for(let _=q.length-1;_>=0;_--){let A=q[_],z=$[A.id];if(z?.type!=="text")continue;K=K.slice(0,A.index)+z.content+K.slice(A.index+A.match.length)}return K}';

// Replacement: same body but the return wraps K through the citation
// expander (guarded by feature-flag presence check).
const FFH_PATCHED =
  'function FfH(H,$){let q=KI(H),K=H;for(let _=q.length-1;_>=0;_--){let A=q[_],z=$[A.id];if(z?.type!=="text")continue;K=K.slice(0,A.index)+z.content+K.slice(A.index+A.match.length)}return globalThis.__cc_expand_citations?globalThis.__cc_expand_citations(K):K}';

// Runtime that defines:
//   globalThis.__cc_citations__         (the registry)
//   globalThis.__cc_expand_citations(s) (the expander)
//
// Written as a single-statement IIFE so it slots cleanly between two
// `function` declarations in the bundle without inventing extra
// semicolons or affecting hoisting.
const CITATION_RUNTIME =
  ';(function(){if(globalThis.__cc_citations__)return;var R=globalThis.__cc_citations__={nextId:1,items:new Map(),add:function(t,c){var i=this.nextId++;this.items.set(i,{text:t,comment:c||""});return i},get:function(i){return this.items.get(i)},clear:function(){this.items.clear()},preview:function(t,m){m=m||32;var s=String(t==null?"":t).replace(/\\s+/g," ").trim();return s.length>m?s.slice(0,m-1)+"\\u2026":s},insertPlaceholder:function(t,c){var i=this.add(t,c);return "[Pasted citation #"+i+" \\""+this.preview(t).replace(/"/g,"\'")+"\\"]"}};globalThis.__cc_expand_citations=function(text){if(!text||typeof text!=="string")return text;var reg=globalThis.__cc_citations__;if(!reg||!reg.items||reg.items.size===0)return text;var re=/\\[Pasted citation #(\\d+)(?: "[^"]*")?\\]/g;var matches=[];var m;while((m=re.exec(text))!==null){var id=parseInt(m[1],10);var entry=reg.items.get(id);if(entry)matches.push({id:id,match:m[0],index:m.index,entry:entry})}if(matches.length===0)return text;var stripped=text;for(var i=matches.length-1;i>=0;i--){var x=matches[i];stripped=stripped.slice(0,x.index)+stripped.slice(x.index+x.match.length)}stripped=stripped.replace(/[ \\t]+/g," ").replace(/\\s*\\n\\s*/g,"\\n").trim();var header="Below are passages from your previous reply that the user is highlighting, with their comments where applicable.";var lines=[header,""];for(var j=0;j<matches.length;j++){var e=matches[j].entry;var safeText=String(e.text).replace(/\\\\/g,"\\\\\\\\").replace(/"/g,"\\\\\\"").replace(/\\n/g," ");lines.push("you: \\""+safeText+"\\"");if(e.comment&&e.comment.length>0){lines.push("But: "+e.comment)}}var block="<assistant-quotes-with-comments>\\n"+lines.join("\\n")+"\\n</assistant-quotes-with-comments>";return block+(stripped?"\\n\\n"+stripped:"")}})();';

export const writeCitationExpanderOnSend = (oldFile: string): string | null => {
  const firstIdx = oldFile.indexOf(FFH_ORIGINAL);
  if (firstIdx === -1) {
    console.error(
      'patch: citationExpanderOnSend: failed to find FfH definition'
    );
    return null;
  }
  const secondIdx = oldFile.indexOf(FFH_ORIGINAL, firstIdx + 1);
  if (secondIdx !== -1) {
    console.error(
      'patch: citationExpanderOnSend: FfH definition matched more than once'
    );
    return null;
  }

  const replacement = FFH_PATCHED + CITATION_RUNTIME;
  const newFile =
    oldFile.slice(0, firstIdx) +
    replacement +
    oldFile.slice(firstIdx + FFH_ORIGINAL.length);

  showDiff(
    oldFile,
    newFile,
    replacement,
    firstIdx,
    firstIdx + FFH_ORIGINAL.length
  );
  return newFile;
};
