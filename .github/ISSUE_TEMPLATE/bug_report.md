---
name: Bug report
about: Report something scalpel did wrong (wrong pruning, a broken session, bad numbers)
title: "[bug] "
labels: bug
---

**What happened?**
A clear description of the bug.

**Expected behavior**
What you expected instead.

**Reproduction**
Steps to reproduce. If it involves a specific conversation pattern (e.g. re-read after
edit, a failed command), describe the sequence.

**Did a session break or did Claude get confused?**
scalpel is fail-open and should never break a session — if it did, that's high priority.

**Environment**
- scalpel version / commit:
- Node version (`node --version`):
- Tier (1 or 2):
- Hooks companion enabled? (yes/no)
- OS:

**Logs / output**
Any relevant output from `scalpel status`, `scalpel report`, or the proxy.
Do **not** paste credentials or private conversation content.
