// Please see the note about writing patches in ./index
//
// Rewrite Mode Patch — adds a `~` input mode parallel to `!` bash mode.
//
// When the user types `~` as the first character, the input enters "rewrite"
// mode. Functionally, this lets a UserPromptSubmit hook detect and rewrite the
// prompt via an external LLM; visually, the footer shows "~ for rewrite mode".
//
// The `~` character is intentionally NOT stripped from the prompt body (unlike
// `!` in bash mode), so the hook receives the marker in `prompt` and can act on
// it deterministically.
//
// Three concrete edits in cli.js:
//
// 1. Mode detector — function returning the input mode based on first char:
//      function z0(H){if(H.startsWith("!"))return"bash";return"prompt"}
//    → insert a `~`-branch before the fallthrough return.
//
// 2. Mode stripper — function that strips the prefix char for non-prompt modes:
//      function gE(H){if(z0(H)==="prompt")return H;return H.slice(1)}
//    → treat "rewrite" like "prompt" (do NOT slice), so the hook still sees `~`.
//
// 3. Footer hint render (inside fn5):
//      if(H==="bash")return hq.createElement(k,{color:"bashBorder"},"! for shell mode");
//    → after this line, add the analogous branch for `"rewrite"` with label
//      `~ for rewrite mode` (reusing bashBorder color for now).
//
// 4. Re-prefixer cpH — adds the marker char back when serializing (text, mode)
//    pairs to the wire format that user-prompt-submit handlers read. For bash:
//      function cpH(H,$){switch($){case"bash":return`!${H}`;default:return H}}
//    → insert a `case"rewrite":return`~${H}`;` branch so the submitted prompt
//      carries the `~` prefix and the UserPromptSubmit hook can detect it.
//
// 5. Submit gate — the LLM-submit call is gated on `mode === "prompt"`. Without
//    this patch, a `~`-mode submit only adds the message to chat display (via
//    opH) but never reaches vw(X$),Vw() — i.e. the LLM and the UserPromptSubmit
//    hook never see it. We widen the gate to accept "rewrite" too:
//      ...clearBuffer(),VG.current=!1,!PK && sy==="prompt" && ...
//    → ...clearBuffer(),VG.current=!1,!PK && (sy==="prompt"||sy==="rewrite") && ...
//
// 6. UserPromptSubmit additionalContext — isMeta flag fix. CC normally marks
//    async_hook_response payloads with isMeta:!0, which filters them out of
//    the LLM-bound message stream (see kq$ in the bundle: `if(H.isMeta===!0)
//    return;`). systemMessage stays meta (UI-only indicator), but the
//    additionalContext branch is flipped to !1 so the model actually receives
//    the rewritten prompt block:
//      K.push(D8({content:q.hookSpecificOutput.additionalContext,isMeta:!0}));
//    → K.push(D8({content:q.hookSpecificOutput.additionalContext,isMeta:!1}));
//
// 7. Rewrite-mode submit interceptor — two-step UX with scramble→erase intro
//    and realtime streaming. Flow:
//      1. Lock keyboard via mode="rewriting" (Patch 8 enforces).
//      2. Scramble phase (4 frames × 40ms): each char of the user's text is
//         replaced with random block-glyphs (▓░█▒◆◈) every frame.
//      3. Erase phase (~8 frames × 30ms): text shrinks from the end toward 0.
//      4. Stream phase: fetch with stream:true, parse SSE deltas, feed tokens
//         into the input box as they arrive (via uA/setCursorOffset).
//      5. On stream done: mode resets to "prompt" so user can edit/resubmit.
//      6. On any failure (no API key, network error, parse error): original
//         text is restored and mode resets so user can retry or submit as-is.
//
// 8. Typing-handler lockout for mode === "rewriting". Without this, any
//    keystroke during the stream would land in the input buffer alongside
//    the in-progress rewrite. Insert at the very top of the l$ keydown
//    handler: if mode is "rewriting", preventDefault and return.

import { showDiff } from './index';

export const writeRewriteMode = (oldFile: string): string | null => {
  let content = oldFile;
  let patched = 0;
  const diag: string[] = [];

  // --- Patch 1: z0 detector ---
  // Match: function NAME(ARG){if(ARG.startsWith("!"))return"bash";return"prompt"}
  const detectorRe =
    /(function [$\w]+\(([$\w]+)\)\{if\(\2\.startsWith\("!"\)\)return"bash";)(return"prompt"\})/;
  const detM = content.match(detectorRe);
  if (detM && detM.index !== undefined) {
    const argName = detM[2];
    const insertion = `if(${argName}.startsWith("~"))return"rewrite";`;
    const before = content.slice(0, detM.index + detM[1].length);
    const after = content.slice(detM.index + detM[1].length);
    content = before + insertion + after;
    patched++;
    diag.push(`z0 detector ✓ (arg=${argName})`);
  } else {
    diag.push('z0 detector ✗');
  }

  // --- Patch 2: gE stripper — treat "rewrite" like "prompt" (no strip) ---
  // Match: function NAME(ARG){if(DETECT(ARG)==="prompt")return ARG;return ARG.slice(1)}
  const stripperRe =
    /(function [$\w]+\(([$\w]+)\)\{if\(([$\w]+)\(\2\)==="prompt"\))(return \2;return \2\.slice\(1\)\})/;
  const strM = content.match(stripperRe);
  if (strM && strM.index !== undefined) {
    const argName = strM[2];
    const detectorName = strM[3];
    const replacement = strM[1].replace(
      /\)$/,
      `||${detectorName}(${argName})==="rewrite")`
    );
    const fullReplacement = replacement + strM[4];
    content = content.replace(strM[0], fullReplacement);
    patched++;
    diag.push(`gE stripper ✓ (detector=${detectorName})`);
  } else {
    diag.push('gE stripper ✗');
  }

  // --- Patch 3: footer hint render — add "rewrite" branch after "bash" branch ---
  // Match: if(MODE==="bash")return NS.createElement(TEXT,{color:"bashBorder"},"! for shell mode");
  const hintRe =
    /(if\(([$\w]+)==="bash"\)return ([$\w]+)\.createElement\(([$\w]+),\{color:"bashBorder"\},"! for shell mode"\);)/;
  const hintM = content.match(hintRe);
  if (hintM && hintM.index !== undefined) {
    const modeVar = hintM[2];
    const reactNs = hintM[3];
    const textComp = hintM[4];
    const insertion = `if(${modeVar}==="rewrite")return ${reactNs}.createElement(${textComp},{color:"bashBorder"},"~ for rewrite mode");`;
    const idx = hintM.index + hintM[1].length;
    content = content.slice(0, idx) + insertion + content.slice(idx);
    patched++;
    diag.push(`footer hint ✓ (modeVar=${modeVar})`);
  } else {
    diag.push('footer hint ✗');
  }

  // --- Patch 4: cpH re-prefixer — add "rewrite" case so submitted text carries `~` ---
  // Match: function NAME(TEXT,MODE){switch(MODE){case"bash":return`!${TEXT}`;default:return TEXT}}
  const reprefixerRe =
    /(function [$\w]+\(([$\w]+),([$\w]+)\)\{switch\(\3\)\{case"bash":return`!\$\{\2\}`;)(default:return \2\})/;
  const repM = content.match(reprefixerRe);
  if (repM && repM.index !== undefined) {
    const textArg = repM[2];
    const insertion = `case"rewrite":return\`~\${${textArg}}\`;`;
    const idx = repM.index + repM[1].length;
    content = content.slice(0, idx) + insertion + content.slice(idx);
    patched++;
    diag.push(`cpH re-prefixer ✓ (textArg=${textArg})`);
  } else {
    diag.push('cpH re-prefixer ✗');
  }

  // --- Patch 5: submit gate — widen `mode === "prompt"` to also accept "rewrite" ---
  // Match: clearBuffer(),REF.current=!1,!FLAG && MODE==="prompt" &&
  // (The chain clearBuffer→.current=!1→!FLAG&& uniquely identifies the submit gate.)
  const submitGateRe =
    /(clearBuffer\(\),[$\w]+\.current=!1,![$\w]+&&)([$\w]+)(==="prompt"&&)/;
  const sgM = content.match(submitGateRe);
  if (sgM && sgM.index !== undefined) {
    const modeVar = sgM[2];
    const replacement = `${sgM[1]}(${modeVar}==="prompt"||${modeVar}==="rewrite")&&`;
    content = content.replace(sgM[0], replacement);
    patched++;
    diag.push(`submit gate ✓ (modeVar=${modeVar})`);
  } else {
    diag.push('submit gate ✗');
  }

  // --- Patch 6: additionalContext isMeta:!0 → !1, so the LLM actually sees it ---
  // Target the SPECIFIC line that wraps additionalContext (NOT systemMessage):
  //   K.push(D8({content:q.hookSpecificOutput.additionalContext,isMeta:!0}));
  // The substring `additionalContext,isMeta:!0` is unique to this one place.
  const isMetaRe = /(hookSpecificOutput\.additionalContext,isMeta:)!0/;
  const imM = content.match(isMetaRe);
  if (imM && imM.index !== undefined) {
    content = content.replace(imM[0], `${imM[1]}!1`);
    patched++;
    diag.push('additionalContext isMeta-flip ✓');
  } else {
    diag.push('additionalContext isMeta-flip ✗');
  }

  // --- Patch 7: rewrite-mode interceptor at submit-handler entry (STREAMING) ---
  // Find the submit-handler's early-out: `if(CTX.isRemoteMode&&!TEXT.trim())return;`
  // Then probe the next ~1200 bytes for the other minified var names we need.
  const entryRe = /(if\(([$\w]+)\.isRemoteMode&&!([$\w]+)\.trim\(\)\)return;)/;
  const entryM = content.match(entryRe);
  if (entryM && entryM.index !== undefined) {
    const textVar = entryM[3];
    const insertAt = entryM.index + entryM[1].length;
    const probe = content.slice(insertAt, insertAt + 1200);

    const escTextVar = textVar.replace(/[$]/g, '\\$&');
    const modeM = probe.match(new RegExp(`cpH\\(${escTextVar},([$\\w]+)\\)`));
    const setQueryM = probe.match(/([$\w]+)\(""\)/);
    const setModeM = probe.match(/([$\w]+)\("prompt"\)/);
    const refsM = probe.match(/([$\w]+)\.setCursorOffset/);

    if (modeM && setQueryM && setModeM && refsM) {
      const modeVar = modeM[1];
      const setQueryFn = setQueryM[1];
      const setModeFn = setModeM[1];
      const refsObj = refsM[1];

      // Streaming injection: animation (scramble→erase) → fetch SSE → realtime
      // token paste-in. Lock keyboard via mode "rewriting" (Patch 8 enforces).
      // On done/error: revert mode to prompt; on error: also restore original text.
      const inject =
        `if(${modeVar}==="rewrite"){try{` +
        `let _x=${textVar}.replace(/^~+/,""),` +
        `_k=process.env.CC_ENHANCE_API_KEY||process.env.OPENROUTER_API_KEY;` +
        `if(_k){` +
        `let _md=process.env.CC_ENHANCE_MODEL||"google/gemma-3-12b-it",` +
        `_sp=require("fs").readFileSync((process.env.HOME||"")+"/.claude/hooks/enhance-prompt.system.md","utf8"),` +
        `_ep=process.env.CC_ENHANCE_ENDPOINT||"https://openrouter.ai/api/v1/chat/completions";` +
        `${setModeFn}("rewriting");` +
        `let _orig=_x,_pool="\\u2593\\u2592\\u2591\\u2588\\u25C6\\u25C8",_scrF=0,_state=_orig,_ctrl,_to;` +
        `let _doFetch=()=>{` +
        `${setQueryFn}("");${refsObj}.setCursorOffset(0);` +
        `_ctrl=new AbortController();_to=setTimeout(()=>_ctrl.abort(),15000);` +
        `fetch(_ep,{method:"POST",signal:_ctrl.signal,headers:{"Authorization":"Bearer "+_k,"Content-Type":"application/json","Accept":"text/event-stream","HTTP-Referer":"https://claude.com/claude-code","X-Title":"cc-rewrite-mode-stream"},body:JSON.stringify({model:_md,max_tokens:500,temperature:0.2,stream:true,messages:[{role:"system",content:_sp},{role:"user",content:_x}]})}).then(async _r=>{` +
        `if(!_r.ok){throw new Error("HTTP "+_r.status)}` +
        `let _rd=_r.body.getReader(),_dc=new TextDecoder(),_bf="",_ac="";` +
        `while(true){` +
        `let{value:_v,done:_d}=await _rd.read();` +
        `if(_d)break;` +
        `_bf+=_dc.decode(_v,{stream:true});` +
        `let _ln=_bf.split("\\n");` +
        `_bf=_ln.pop();` +
        `for(let _l of _ln){` +
        `_l=_l.trim();` +
        `if(!_l.startsWith("data:"))continue;` +
        `let _pl=_l.slice(5).trim();` +
        `if(_pl==="[DONE]")continue;` +
        `try{` +
        `let _dt=JSON.parse(_pl),_de=_dt.choices&&_dt.choices[0]&&_dt.choices[0].delta&&_dt.choices[0].delta.content;` +
        `if(_de){_ac+=_de;${setQueryFn}(_ac);${refsObj}.setCursorOffset(_ac.length)}` +
        `}catch(_){}` +
        `}` +
        `}` +
        `clearTimeout(_to);` +
        `${setModeFn}("prompt");` +
        `${refsObj}.setCursorOffset(_ac.length)` +
        `}).catch(_e=>{` +
        `clearTimeout(_to);` +
        `${setQueryFn}(_x);` +
        `${refsObj}.setCursorOffset(_x.length);` +
        `${setModeFn}("prompt")` +
        `});` +
        `};` +
        `let _anim=()=>{` +
        `if(_scrF<4){` +
        `let _t="";` +
        `for(let _i=0;_i<_state.length;_i++)_t+=_pool[Math.floor(Math.random()*_pool.length)];` +
        `_state=_t;${setQueryFn}(_t);${refsObj}.setCursorOffset(_t.length);` +
        `_scrF++;setTimeout(_anim,160)` +
        `}else if(_state.length>0){` +
        `let _dr=Math.max(1,Math.ceil(_orig.length/8));` +
        `_state=_state.slice(0,Math.max(0,_state.length-_dr));` +
        `${setQueryFn}(_state);${refsObj}.setCursorOffset(_state.length);` +
        `setTimeout(_anim,120)` +
        `}else{_doFetch()}` +
        `};` +
        `if(_orig.length===0)_doFetch();else _anim();` +
        `return` +
        `}` +
        `}catch(_e){}}`;

      content = content.slice(0, insertAt) + inject + content.slice(insertAt);
      patched++;
      diag.push(
        `rewrite-interceptor ✓ (mode=${modeVar} text=${textVar} setQ=${setQueryFn} setM=${setModeFn} refs=${refsObj})`
      );
    } else {
      diag.push(
        `rewrite-interceptor ✗ (mode=${!!modeM} setQ=${!!setQueryM} setM=${!!setModeM} refs=${!!refsM})`
      );
    }
  } else {
    diag.push('rewrite-interceptor entry ✗');
  }

  // --- Patch 8: typing-handler lockout for mode === "rewriting" ---
  // Insert at the very start of l$=(e$)=>{if(J)return;if(B.current==="prompt"){
  // The trailing `e$.key==="right"` is the strongest landmark — unique to this handler.
  const lockoutRe =
    /(\(([$\w]+)\)=>\{)(if\([$\w]+\)return;if\(([$\w]+)\.current==="prompt"\)\{if\([$\w]+\.key==="right")/;
  const loM = content.match(lockoutRe);
  if (loM && loM.index !== undefined) {
    const argName = loM[2];
    const modeRef = loM[4];
    const guard = `if(${modeRef}.current==="rewriting"){${argName}.preventDefault();return;}`;
    const idx = loM.index + loM[1].length;
    content = content.slice(0, idx) + guard + content.slice(idx);
    patched++;
    diag.push(`typing-lockout ✓ (arg=${argName} modeRef=${modeRef})`);
  } else {
    diag.push('typing-lockout ✗');
  }

  if (patched === 8) {
    showDiff(oldFile, content, '(rewrite mode added)', 0, 0);
    return content;
  }

  console.error(
    `patch: rewriteMode: applied ${patched}/8 — ${diag.join(', ')}`
  );
  return null;
};
