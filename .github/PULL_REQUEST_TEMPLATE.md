## Summary

<!-- What does this change and why? Include the cache-economics reasoning if it touches pruning. -->

## Changes

-

## Checklist

- [ ] `npm test` passes (53+ tests)
- [ ] `test/cache-invariant.test.ts` is unchanged or strengthened (never weakened)
- [ ] Behavior stays **fail-open** (no path can break a session)
- [ ] Pruning stays **lossless** (anything removed is spilled + stubbed)
- [ ] No new runtime dependencies
- [ ] Docs updated if behavior changed
- [ ] If pruning behavior changed: re-ran `scalpel bench` and reported real before/after numbers
