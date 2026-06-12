# Contributing to scalpel

Thanks for your interest! scalpel is a small, dependency-free TypeScript tool with a
narrow mission: **reduce token cost for Claude Code without ever breaking the prompt
cache or losing data.** Contributions are welcome — please keep that mission in mind.

## Ground rules

1. **Fail-open is non-negotiable.** The proxy and hooks must never break a Claude Code
   session. Any error must forward the original request / allow the original tool call.
2. **Never weaken `test/cache-invariant.test.ts`.** It proves the core safety property:
   surgery never turns a warm cache read into an unplanned write. New features must keep
   it green as written.
3. **No runtime dependencies.** scalpel uses Node built-ins only (`node:sqlite`, native
   `fetch`, `node:http`, etc.). Dev dependencies (TypeScript, vitest, tsx) are fine.
4. **Lossless by construction.** Anything pruned must be spilled to disk and replaced
   with a recoverable stub. Never silently drop content.

## Getting set up

```bash
git clone https://github.com/MohammedBasioni/scalpel.git
cd scalpel
npm install
npm run build
npm test          # 53 tests should pass
```

Requires **Node.js ≥ 24**.

## Development workflow

- **TDD.** Write a failing test first, then the minimal code to pass it.
- **Small commits**, present-tense, conventional style (`feat:`, `fix:`, `docs:`,
  `test:`, `chore:`).
- Run `npm test` before every commit. CI runs build + tests on Node 24.
- If you change pruning behavior, re-run `scalpel bench ~/.claude/projects` on a real
  corpus and report the before/after numbers in your PR. Don't quote savings you didn't
  measure.

## What makes a good PR

- A clear description of the problem and the cache-economics reasoning behind the change.
- Tests that cover the new behavior (and prove the invariant still holds).
- Honest measurements — no inflated savings claims.
- Docs updated if behavior changed (README, config, commands).

## Reporting bugs / requesting features

Open an issue using the templates in `.github/ISSUE_TEMPLATE/`. For anything
security-sensitive, follow [SECURITY.md](./SECURITY.md) instead of filing a public issue.

By contributing, you agree your contributions are licensed under the project's
[MIT License](./LICENSE).
