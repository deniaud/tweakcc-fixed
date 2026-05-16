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

  if (patched === 3) {
    showDiff(oldFile, content, '(rewrite mode added)', 0, 0);
    return content;
  }

  console.error(
    `patch: rewriteMode: applied ${patched}/3 — ${diag.join(', ')}`
  );
  return null;
};
