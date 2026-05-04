# 0019 — Deferred: Sourcemap-aware stack-trace resolution

- **Status:** Deferred (large scope, partial coverage already exists via fingerprint normalization)
- **Date:** 2026-05-04
- **Latest re-ask:** BB-1.8 agent feedback batch (acted on in v1.9.2)

## The recurring ask

Production / Turbopack stacks reference minified files with shifting line numbers across deploys. The dev sees `AiSiteWorkspace.tsx:2463:97` in an error captured weeks ago, but their current file is a different version — they can't tell if the line still exists, let alone what code was there. The ask: BlackBox should resolve minified frames back to original source via sourcemaps.

## Why we have NOT shipped this

1. **Sourcemaps are large.** Even gzipped, a typical Next.js bundle's sourcemaps are 5–50 MB. Bundling with BlackBox would bloat the package; downloading at runtime would hit the consumer's bandwidth budget.

2. **Sourcemap location is non-portable.** Some build pipelines emit `.map` files alongside chunks, some inline them, some upload to Sentry / Datadog. There's no universal way to find them.

3. **Partial coverage already exists.** Per ADR-0001 and the fingerprint normalization in v1.6.5+, line-number drift across deploys is collapsed at the *fingerprint* level via Turbopack/webpack chunk-hash normalization (`chunk-:hash.js`, `:hash.bundle.js`, `_:hash._.js`). The error still shows the minified line, but it doesn't fragment fingerprints across deploys. That solves the "phantom new error after every deploy" problem without resolving the actual frame.

4. **The right place for sourcemap resolution is at view time, not write time.** A future bb-check enhancement could shell out to `source-map-support` against a configured `.next/build` path to resolve frames lazily on `--id <fp>` lookups. Cheaper than runtime resolution for every error.

## Conditions to revisit

- A consumer reports they routinely hit "the line number is meaningless" for *current-deploy* errors (not just stale ones). The chunk-hash normalization handles stale; live mismatch would be a real new gap.
- We're willing to add `source-map` as a dependency and accept the bundle-size hit, OR we ship the bb-check view-time resolution path (smaller scope).

## Subsequent feedback

- BB-1.8 agent (acted v1.9.2 batch) re-asked. Workaround at the time: rely on fingerprint stability; treat line numbers as advisory. Premise unchanged.
