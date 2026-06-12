# Changelog

All notable changes to scalpel are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source project metadata: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, GitHub issue/PR templates, and CI (build + tests on Node 24).

## [0.1.0] — 2026-06-12

First working release. Cache-aware context-surgery proxy for Claude Code plus a
duplicate-read prevention hooks companion.

### Added
- **Proxy core** — local proxy (`ANTHROPIC_BASE_URL=http://127.0.0.1:4242`) with a pure
  `ledger → economist → surgeon` pipeline, SSE passthrough, and a fail-open path.
- **Cache-stability invariant** — surgery only at cache-doomed moments (idle past TTL,
  model/system/tools change) or economics-positive moments; warm cache prefixes are
  never disturbed. Enforced by `test/cache-invariant.test.ts`.
- **Span kinds** — superseded reads, duplicate results, failed commands, stale large
  results, dead snapshots, gated by tier (Tier 1 conservative, Tier 2 default).
- **Spill & stub** — pruned content is content-addressed to `~/.scalpel/spill/` and
  replaced with a recoverable stub.
- **CLI** — `start`, `status`, `report`, `tier`, `bench`, `install`, `install-hooks`.
- **`bench`** — single-pass corpus replay with honest skip accounting; measured **19.3%**
  weighted saving on a 131-session corpus.
- **Hooks companion** — PreToolUse deny for duplicate full reads + PostToolUse read
  ledger; both fail-open. `install-hooks` prints the settings snippet (never auto-edits).
- **Calibration** — EMA token-estimate calibration wired through the proxy on 200s.

### Tuning
- Corpus OFAT (one-factor-at-a-time) sweep: lowered `staleMinTokens` 2000 → 1000
  (+2–3pp). `minSpanTokens` and `safetyMargin` were already optimal — loosening them hurt.
- Corrected the subscription cache-write weight to **2.0** (1-hour TTL pricing).

### Known limitations
- The original ≥30% long-session target is **not met** by structural pruning alone; it
  needs Tier 3 (LLM summarization), which is future work.
