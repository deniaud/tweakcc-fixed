// Please see the note about writing patches in ./index
//
// Citation Expander On Send - Expand `[Pasted citation #N "preview"]`
// placeholders in user messages into a structured XML-wrapped block
// before the message reaches the API.
//
// Approach: hook the existing placeholder expander (whose minified
// name shifts between CC versions — was FfH in 2.1.141/2.1.142,
// renamed to afH in 2.1.143). Anchor on the function body shape, not
// the name. Capture the function name + its KI-parser name so the
// patched version preserves them.
//
//   Body shape (stable across CC 2.1.x):
//     function NAME(H,$){
//       let q=PARSER(H), K=H;
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
//   registry at `globalThis.__cc_citations__`. The KI-parser regex
//   was extended by citationPlaceholderParser to recognize citation
//   placeholders, so they appear in q but trigger `continue`
//   (z?.type !== "text"), passing through unchanged.
//
//   After the standard expansion runs, we call __cc_expand_citations,
//   which resolves citation placeholders against our registry and
//   builds the citation block.
//
// Runtime injected immediately after the expander function:
//
//   globalThis.__cc_citations__         — id-keyed registry
//   globalThis.__cc_expand_citations(s) — second-pass expander
//
// Expansion format:
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

// Regex matches the entire expander function definition. Captures:
//   group 1: expander function name (FfH / afH / ...)
//   group 2: KI-parser function name (KI / OI / ...)
const EXPANDER_PATTERN =
  /function ([$\w]+)\(H,\$\)\{let q=([$\w]+)\(H\),K=H;for\(let _=q\.length-1;_>=0;_--\)\{let A=q\[_\],z=\$\[A\.id\];if\(z\?\.type!=="text"\)continue;K=K\.slice\(0,A\.index\)\+z\.content\+K\.slice\(A\.index\+A\.match\.length\)\}return K\}/;

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
  const match = oldFile.match(EXPANDER_PATTERN);
  if (!match || match.index === undefined) {
    console.error(
      'patch: citationExpanderOnSend: failed to find placeholder expander function'
    );
    return null;
  }

  // Ensure only one occurrence so we don't accidentally rewrite a
  // similar-shaped helper somewhere else.
  const globalRe = new RegExp(EXPANDER_PATTERN.source, 'g');
  let count = 0;
  while (globalRe.exec(oldFile) !== null) count++;
  if (count > 1) {
    console.error(
      `patch: citationExpanderOnSend: expander pattern matched ${count} times (expected 1)`
    );
    return null;
  }

  const fnName = match[1]; // e.g. FfH (CC 2.1.142) or afH (CC 2.1.143)
  const parserName = match[2]; // e.g. KI or OI

  // Rebuild the same function body, but wrap the final `return K` in
  // the citation-expander guard. Identifiers are preserved verbatim.
  const patchedBody = `function ${fnName}(H,$){let q=${parserName}(H),K=H;for(let _=q.length-1;_>=0;_--){let A=q[_],z=$[A.id];if(z?.type!=="text")continue;K=K.slice(0,A.index)+z.content+K.slice(A.index+A.match.length)}return globalThis.__cc_expand_citations?globalThis.__cc_expand_citations(K):K}`;

  const replacement = patchedBody + CITATION_RUNTIME;
  const startIndex = match.index;
  const endIndex = startIndex + match[0].length;

  const newFile =
    oldFile.slice(0, startIndex) + replacement + oldFile.slice(endIndex);

  showDiff(oldFile, newFile, replacement, startIndex, endIndex);
  return newFile;
};
