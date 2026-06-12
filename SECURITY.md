# Security Policy

scalpel sits on the network path between Claude Code and the Anthropic API, so its
security posture matters. This document explains what scalpel does with sensitive data
and how to report a vulnerability.

## Threat model & guarantees

- **Local-only.** scalpel binds to `127.0.0.1` by default. It is not designed to be
  exposed on a network interface; do not bind it to a public address.
- **Credentials are forwarded, never inspected.** Authorization headers (`Authorization`,
  `x-api-key`, OAuth bearer tokens) are passed verbatim to `api.anthropic.com`. scalpel
  does not log, store, parse, or transform them.
- **No credentials on disk.** Nothing under `~/.scalpel/` contains headers, tokens, or
  credentials:
  - `spill/` — pruned tool-result *content only*, keyed by SHA-256.
  - `savings.db` — token counts and savings estimates; no message content.
  - `readledger/` — file hashes and sizes for the hooks companion.
  - `config.json` — your tier/port overrides.
- **Fail-open.** Any internal error forwards the original, unmodified request. scalpel
  cannot corrupt or alter a request on the failure path.
- **Spilled content is plaintext on your disk.** Tool-result content moved to
  `~/.scalpel/spill/` is stored unencrypted, with the same sensitivity as the files and
  command output it came from. Wipe it any time with `rm -rf ~/.scalpel`.

## Supported versions

scalpel is pre-1.0. Security fixes are applied to the latest `main` only.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on the repository, or contact the maintainer
directly.

Please include: a description, reproduction steps, affected version/commit, and the
potential impact. You'll get an acknowledgement as soon as possible, and we'll keep you
updated on the fix and disclosure timeline.
