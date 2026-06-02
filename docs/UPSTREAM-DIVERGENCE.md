# Upstream divergence — deniaud/tweakcc-fixed vs skrabe/tweakcc-fixed

Snapshot: **2026-06-02**. Upstream remote = `skrabe/tweakcc-fixed`, branch tracked = `upstream/main` only (per maintenance policy — upstream feature branches are ignored).

## Summary

- `main` is **19 commits behind** `upstream/main` and **carries our own commits ahead** (see below).
- Installed Claude Code on this machine: **2.1.156**.
- Upstream already supports CC **2.1.157 → 2.1.160** plus several robustness fixes we lack.

## What upstream has that we don't (19 commits)

Version-support / prompt-extraction (the core maintenance upstream ships):

- `feat: support CC 2.1.160` + `Prompts for 2.1.160`
- `feat: support CC 2.1.159` + `Prompts for 2.1.159`
- `feat: support CC 2.1.158` (+ suppress 2 unworkable general-purpose fragments) + `Prompts for 2.1.158`
- `Prompts for 2.1.157`, `Prompts for 2.1.156`, `Prompts for 2.1.154`

Robustness fixes worth evaluating:

- `fix(systemPrompts): survive regex-compile stack overflow on Windows`
- `fix(systemPrompts): normalize CRLF prompt overrides`
- `fix(maxEffortDefault): keep effort overrides usable`

## What we have that upstream doesn't (our fork's unique work)

- `fix(nativeInstallation): guard repackELFSection against catastrophic file bloat` — **the load-bearing fix** behind `claude update` (ELF repack safety on this machine's native install). Merged to `main` 2026-06-02.
- `chore: move citation patches to cc-quote repo` — citation feature graduated to `deniaud/cc-quote`.
- `feat(citation): isolated child component for auto-updating overlay`
- `fix(statuslineUpdateThrottle): match new HC shape in CC 2.1.143`

## Recommendation (not actioned in this pass)

Pulling `upstream/main` (2.1.157→160 support) is **valuable but non-trivial**: it must be merged carefully against our ELF-guard and citation-graduation commits, and tweakcc-fixed is load-bearing for `claude update`. Tracked as a separate task — not auto-merged during the cleanup pass to avoid destabilizing the live update flow.
