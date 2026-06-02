# Native @bun-cjs support — CC 2.1.156+ (Bun v1.3.14)

Status snapshot: **2026-06-02**. Applies to the native ELF install at
`~/.local/share/claude/versions/<ver>` (NOT npm installs).

## TL;DR for the next "actualize sessions" pass

- CC **2.1.156+** ships the claude module in Bun's **`@bun-cjs`** format. The two
  fixes below (on `main`, commits `ba5c48e` + `2c2e4e0`) make `--apply` produce a
  **bootable** patched 2.1.160. Verified: `--version` / `--help` / `mcp list` run;
  `npm run build` clean; 18/18 vitest files pass.
- A patched live binary is fine to leave in place. **`--restore` is the always-safe
  revert** (proven). Boot-check = `command claude --version` (shows
  `2.1.160 (Claude Code)` + `4.0.13 (tweakcc)` when patched).
- Two known trade-offs remain (see Follow-ups). They do NOT break boot.

## Root cause + the two fixes

CC 2.1.160's claude module `contents` is the full CJS-wrapped source:
`// @bun @bytecode @bun-cjs\n(function(exports,require,module,__filename,__dirname){…body…})`,
with an **empty** bytecode blob. Bun's standalone loader `JSC::evaluate(contents)`
expects the result to be a **callable** (the function expression).

1. **`ba5c48e` — unwrap/rewrap** (`src/nativeInstallation.ts`).
   The old code, on detecting the `// @bun @bytecode` prefix, substituted the
   **npm cli.js source** (un-wrapped) → dropped the function wrapper → boot crash
   `Expected CommonJS module to have a function wrapper`. Now: unwrap to the inner
   body before patching, re-wrap on repack (module-scoped `bunCjsWrapper` shared
   between `extractClaudeJsFromNativeInstallation` and `repackNativeInstallation`).
   Identity read→write round-trip boots; verified.

2. **`2c2e4e0` — fail-closed prompt guard** (`src/patches/systemPrompts.ts`).
   Prompt search regexes are synced against the **npm** cli.js; on the
   **differently-minified native** bundle they can match but under-capture, leaving
   a `${SCREAMING_SNAKE}` template interpolation unresolved (e.g.
   `${EXIT_PLAN_MODE_TOOL_NAME}`) → runtime `X is not defined`. The guard SKIPS any
   prompt with a surviving `${SCREAMING_SNAKE}` (≥3 segments) interpolation. Matches
   ONLY inside `${...}` so prose like `ANTHROPIC_API_KEY` is never flagged.

## Known trade-offs in the current "minimal working set"

- **`settings.misc.tokenCountRounding` disabled** in `~/.tweakcc/config.json`.
  `tokenCountRounding` is correct in isolation (acorn-parses) but in COMBINATION
  with an overlapping token-display patch its `Math.round((EXPR)/N)*N` insertion is
  truncated to `Math.round((EXPR),` → SyntaxError. Patch-interaction bug, unrelated
  to @bun-cjs.
- **2 system prompts auto-skipped** by the guard (their identifier-capture regexes
  need re-derivation against the native 2.1.160 bundle):
  - `Tool Description: AskUserQuestion` → `${EXIT_PLAN_MODE_TOOL_NAME}`
  - `Agent Prompt: Explore` → `${GLOB_TOOL_NAME, GREP_TOOL_NAME, READ_TOOL_NAME, SHELL_TOOL_NAME}`

## Follow-ups (do these next time)

1. Re-derive the 2 skipped prompts' identifier-capture regexes for native 2.1.160
   (the `${…}` placeholders must resolve to the real minified vars).
2. Fix `tokenCountRounding` overlap with the token-usage patch (coordinate order /
   make it paren-balance-aware) or make it fail-closed.
3. Open an upstream PR for both fixes — `skrabe/tweakcc-fixed` also lacks @bun-cjs
   wrapper handling. (We are 0 behind upstream as of the 2.1.154-160 sync.)
4. **cc-prompt-rewriter + cc-quote** still version-gated at 2.1.146. To apply on
   2.1.160 they need: (a) bump their tweakcc-lib dependency to include this
   @bun-cjs unwrap/rewrap fix, (b) re-derive their own anchors against native
   2.1.160, (c) bump `SUPPORTED_CC_VERSION`. Separate session.

## How to reproduce / verify on a fresh native binary

```sh
cp ~/.local/share/claude/versions/2.1.160 /tmp/cc-work          # work on a copy
# point tweakcc at the copy:
#   jq '.ccInstallationPath="/tmp/cc-work"' ~/.tweakcc/config.json | sponge ...
node dist/index.mjs --apply                                      # patch
/tmp/cc-work --help                                              # boot check (must succeed)
node dist/index.mjs unpack /tmp/body.js /tmp/cc-work             # extract patched body
#   then acorn.parse("(function(...){\n"+body+"\n})") for a syntax gate
node dist/index.mjs --restore                                    # revert
```
