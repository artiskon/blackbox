# 0001 — Internal-stack suppression

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0 (extended in 1.9.0)

## Context

A debugging session captured a React duplicate-key warning the BlackBox panel itself was producing — emitted as `console.error` by react-dom-client.development.js. The error was 100% framework internals; the host app could not have caused or fixed it. The dev spent time confirming "no app frames" before dismissing it, and other framework-warning errors regularly clutter the panel and bb-check output.

## Decision

When every "at ..." frame in an error stack matches a framework/vendor pattern, mark the error `internal: true` on the persisted Firestore doc. The panel and bb-check hide internal errors by default; toggle via "Show" chip in the panel and `--include-internal` flag in bb-check. Suppressed-count is surfaced (e.g. "3 framework-internal errors hidden") so the dev knows they exist.

Implemented as `isStackEntirelyInternal(stack)` in `src/core/fingerprint.js`, called in `_recordError` in `src/core/blackbox.js`. Internal-frames regex covers: react-dom*, react/cjs, next/dist, next/router, webpack-internal, `__webpack_require__`, `/_next/static/*`, Next minified bundle hashes (e.g. `64888-f1bd84ac51e4faa1.js`), pdfjs-dist, firebase/*, @firebase/*, @grpc/*, hot-update, chunk-* files, `<anonymous>`, `(native)`. v1.9.0 extended the regex to cover Next minified chunks.

## Reasoning

- Default-hide is the right balance because these errors are 100% noise for the typical debug flow. Suppressed-count + toggle preserves "show me the noise if I really want it".
- Stack-pattern detection is more reliable than message-text matching (warnings change wording across versions).
- Required ≥2 frames before classifying as internal — a single bare `Error()` is too thin a signal.

## Trade-offs / what we explicitly didn't do

- The regex will miss vendors not listed (and may catch app code that happens to live under a `vendor/` directory matching a token). Acceptable false-negative / false-positive rate given the alternative is no suppression.
- We did NOT auto-suppress by source-name pattern (e.g. `console.error` from a known framework module) — too brittle.
- We did NOT add a "user-defined internal patterns" config option — premature; revisit if a real use case shows up.

## Subsequent feedback

- v1.9.0 — Agent reported Next.js minified bundles like `64888-f1bd84ac51e4faa1.js` weren't being classified as internal. Extended the regex; same decision, broader coverage.
- **2026-09-13 (unreleased, after v1.9.5; additive):** three follow-ups from an audit, same decision. (1) `isStackEntirelyInternal` now counts real frames only (V8 `at ...` lines and Firefox/Safari `fn@url:line:col` lines) instead of any line containing `at `. Suppression now works in Firefox/Safari, and a V8 message line containing "at " ("format", "that") is no longer counted as an app frame. (2) Panel counts follow this flag: the launcher badge and Live footer exclude internal errors; the banner is per tab (Live counts live errors, History counts saved ones) and reads "N framework-internal errors shown" / "hidden"; a list holding only internal errors says "Only framework-internal errors (hidden)" instead of "No errors captured". (3) The copied panel report now carries `internal: true` on framework-only errors (its `_instructions` already told readers to rely on it). A cascade-merged group keeps the flag only if every member is internal, so merging never hides an app error.
