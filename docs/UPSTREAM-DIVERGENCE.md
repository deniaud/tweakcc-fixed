# Upstream divergence — deniaud/tweakcc-fixed vs skrabe/tweakcc-fixed

Snapshot: **2026-06-02 (synced)**. Upstream remote = `skrabe/tweakcc-fixed`, branch tracked = `upstream/main` only (per maintenance policy — upstream feature branches are ignored).

## Status

- `main` is **0 commits behind** `upstream/main` and **7 commits ahead** (our fork's unique work + the sync merge).
- Installed Claude Code on this machine: **2.1.156** (prompts present: `data/prompts/prompts-2.1.156.json`).
- Upstream version support now merged: CC **2.1.154, 2.1.156, 2.1.157, 2.1.158, 2.1.159, 2.1.160** + robustness fixes.
- Build clean (`npm run build`); test suite **259 passed, 5 skipped** (`vitest run`).

## What was pulled from upstream (19 commits, merged 2026-06-02)

Version-support / prompt-extraction:

- `feat: support CC 2.1.160` + `Prompts for 2.1.160`
- `feat: support CC 2.1.159` + `Prompts for 2.1.159`
- `feat: support CC 2.1.158` (+ suppress 2 unworkable general-purpose fragments) + `Prompts for 2.1.158`
- `Prompts for 2.1.157`, `Prompts for 2.1.156`, `Prompts for 2.1.154`

Robustness fixes:

- `fix(systemPrompts): survive regex-compile stack overflow on Windows`
- `fix(systemPrompts): normalize CRLF prompt overrides`
- `fix(maxEffortDefault): keep effort overrides usable`
- new `src/safeRegexMatch.ts` (+ tests), `src/patches/maxEffortDefault.test.ts`, `src/patches/systemPrompts.test.ts`, `tools/promptExtractor.js`

Merge was **conflict-free**: our ahead commits touch a disjoint file set
(`src/nativeInstallation.ts`, `src/patches/statuslineUpdateThrottle.ts`,
`.gitignore`, `docs/`) from upstream's (`data/prompts/*`, `README.md`,
`src/patches/{maxEffortDefault,systemPrompts}.ts`, `src/safeRegexMatch.ts`,
`tools/promptExtractor.js`).

## Our fork's unique work (ahead of upstream)

- `fix(nativeInstallation): guard repackELFSection against catastrophic file bloat` — **the load-bearing fix** behind `claude update` (ELF repack safety on this machine's native install). Verified intact post-merge (10 references).
- `chore: move citation patches to cc-quote repo` — citation feature graduated to `deniaud/cc-quote`. Verified intact (0 citation patches remain in `src/patches/`).
- `feat(citation): isolated child component for auto-updating overlay`
- `fix(statuslineUpdateThrottle): match new HC shape in CC 2.1.143` — verified intact.

## Not checked

- No live `tweakcc --apply` against the running 2.1.156 binary (the cleanup
  pass deliberately avoids patching the live install). Build + unit tests only.
  A live re-apply is exercised naturally by the `claude update` shell wrapper
  on the next CC upgrade.
