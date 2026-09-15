# 0019 — Deferred: Sourcemap-aware stack-trace resolution

- **Status:** Deferred (large scope, partial coverage already exists via fingerprint normalization)
- **Date:** 2026-05-04
- **Latest re-ask:** BB-1.8 agent feedback batch (acted on in v1.9.2)

## The recurring ask

Production / Turbopack stacks reference minified files with shifting line numbers across deploys. The dev sees `AiSiteWorkspace.tsx:2463:97` in an error captured weeks ago, but their current file is a different version — they can't tell if the line still exists, let alone what code was there. The ask: BlackBox should resolve minified frames back to original source via sourcemaps.

## Why we have NOT shipped this

1. **Sourcemaps are large.** Even gzipped, a typical Next.js bundle's sourcemaps are 5–50 MB. Bundling with BlackBox would bloat the package; downloading at runtime would hit the consumer's bandwidth budget.

2. **Sourcemap location is non-portable.** Some build pipelines emit `.map` files alongside chunks, some inline them, some upload to Sentry / Datadog. There's no universal way to find them.

3. **Partial coverage already exists.** Line-number and bundle drift across edits and deploys is collapsed at the *fingerprint* level: before hashing, the top app frame is reduced to function name + module path (`normalizeFrameForFingerprint` in `fingerprint.js`) — `:line:col` and `scheme://host:port` stripped; content hashes replaced in Turbopack base36/hex module names (`_:hash._.js`), Vite/Rollup and webpack/Next `name-<hash>.js`, bare 16+ hex chunk files (`/:hash.js`), `chunk-:hash.js` and `:hash.bundle.js`; minified 1–2 char function names collapsed to `?`. The error still shows the minified line in `stack` / `context.callerFrame`, but it doesn't fragment fingerprints across deploys. That solves the "phantom new error after every deploy" problem without resolving the actual frame. (Rewritten 2026-09-13: before then only the three chunk patterns were normalized and line:col stayed in the hash, so this point overstated the coverage.)

4. **The right place for sourcemap resolution is at view time, not write time.** A future bb-check enhancement could shell out to `source-map-support` against a configured `.next/build` path to resolve frames lazily on `--id <fp>` lookups. Cheaper than runtime resolution for every error.

## Conditions to revisit

- A consumer reports they routinely hit "the line number is meaningless" for *current-deploy* errors (not just stale ones). The chunk-hash normalization handles stale; live mismatch would be a real new gap.
- We're willing to add `source-map` as a dependency and accept the bundle-size hit, OR we ship the bb-check view-time resolution path (smaller scope).

## Subsequent feedback

- BB-1.8 agent (acted v1.9.2 batch) re-asked. Workaround at the time: rely on fingerprint stability; treat line numbers as advisory. Premise unchanged.
- **2026-09-13 (unreleased, after v1.9.5; additive):** an audit found point 3's premise false: `extractTopAppFrame` kept `:line:col`, origin/port and most real-world chunk hashes, so every edit above a throw site or deploy re-keyed the fingerprint. Fixed by normalizing the frame only for the fingerprint (point 3 rewritten above); `context.callerFrame` stays raw (ADR-0016). This strengthens the "rely on fingerprint stability" workaround; the deferral itself (no sourcemap resolution) is unchanged. One-time fingerprint change for existing stack-bearing rows.
