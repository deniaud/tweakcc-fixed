# tweakcc-fixed — todo

Cross-session follow-up tracker. Read at session start. Canonical technical
context: `docs/NATIVE-BUN-CJS-2.1.160.md`.

## Native CC 2.1.160 (@bun-cjs) — open follow-ups

Context: CC 2.1.156+ ships the claude module as Bun `@bun-cjs`. Two core fixes
already landed on `main` (`ba5c48e` unwrap/rewrap, `2c2e4e0` fail-closed prompt
guard) → patched 2.1.160 boots with a minimal customization set. Remaining:

- [ ] **Re-derive 2 skipped system prompts for native 2.1.160.** The guard skips
  them because their `${IDENTIFIER}` capture regexes (synced vs npm cli.js)
  under-capture on the native bundle:
  - `Tool Description: AskUserQuestion` → `${EXIT_PLAN_MODE_TOOL_NAME}`
  - `Agent Prompt: Explore` → `${GLOB_TOOL_NAME, GREP_TOOL_NAME, READ_TOOL_NAME, SHELL_TOOL_NAME}`
  Fix = update those prompts' search regexes so the placeholders resolve to the
  real native minified vars. Verify: apply to a copy, `--help` boots, the names
  no longer appear in `Skipping …` output.
- [ ] **Fix `tokenCountRounding` patch-overlap.** Correct in isolation but its
  `Math.round((EXPR)/N)*N` insertion gets truncated by an overlapping
  token-display patch on 2.1.160 → SyntaxError. Currently worked around by
  disabling `settings.misc.tokenCountRounding` in `~/.tweakcc/config.json`.
  Fix = coordinate patch order / paren-balance-aware capture, or make it
  fail-closed; then re-enable in config.
- [ ] **Open upstream PR** to `skrabe/tweakcc-fixed` for both core fixes — upstream
  also lacks @bun-cjs wrapper handling. (We are 0 behind upstream.)

## cc-tooling ecosystem — blocked on 2.1.160 (separate repos)

- [ ] **cc-prompt-rewriter + cc-quote: apply on CC 2.1.160.** Both version-gated at
  `SUPPORTED_CC_VERSION = 2.1.146`, NOT applied on the live 2.1.160. Each needs:
  (a) bump their tweakcc-lib dep to include this repo's @bun-cjs unwrap/rewrap fix,
  (b) re-derive their own anchors against the native 2.1.160 bundle,
  (c) bump `SUPPORTED_CC_VERSION`. See cc-quote `docs/ANCHORS.md` (also tracks the
  pending tool-jsx-bridge graduation) and this repo's `docs/NATIVE-BUN-CJS-2.1.160.md` §follow-up 4.

## Done (2026-06-02)

- [x] CC updated 2.1.156 → 2.1.160.
- [x] @bun-cjs unwrap/rewrap fix (`ba5c48e`) — patched 2.1.160 boots.
- [x] Fail-closed `${SCREAMING_SNAKE}` prompt guard (`2c2e4e0`).
- [x] Applied minimal working set to live 2.1.160 (tweakcc 4.0.13; `--version`/`--help`/`mcp list` ok).
- [x] Merged to `main`, dist rebuilt, 18/18 test files pass, pushed to origin.
- [x] Docs: `docs/NATIVE-BUN-CJS-2.1.160.md`; status mirrored in forge `index/internal.md` + agent-treasures `REPOS.md`.
