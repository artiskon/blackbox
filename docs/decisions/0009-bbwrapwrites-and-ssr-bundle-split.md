# 0009 — bbWrapWrites for silent permission-denied (with v1.9.1 SSR-safe bundle split)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.0 (introduced); 1.9.1 (bundle split + SSR passthrough)

## Context

A debugging session described a "delete handler called `deleteDoc(ref)` without a `.catch`. The rule rejected it. The Firestore JS SDK rejects the promise but the caller swallowed it; the snapshot listener re-emitted the row unchanged. From BlackBox's point of view, nothing happened — the user clicked 'delete', items came back, no error, no clue." The agent called this "the single most expensive missing capability — BlackBox literally could not see the bug."

A subsequent v1.9.0 user report from another agent then hit a follow-on issue: importing `bbWrapWrites` from a Next.js App Router server route handler threw "Attempted to call bbWrapWrites() from the server" because tsup's `banner: { js: "'use client'" }` had marked every dist entry — including the firebase helpers — as client-only.

## Decision (v1.9.0)

New helper `bbWrapWrites(firestoreFns)` exported from `@artiskon/blackbox`. Returns wrapped versions of `addDoc`/`setDoc`/`updateDoc`/`deleteDoc` that:

1. Tap the returned promise. On rejection, record an error with `source: 'firebase'`, `code` (e.g. `permission-denied`), `documentPath`, and the operation name — even when the caller never `.catch()`'d the promise.
2. Preserve the underlying functions' return values and rethrow errors verbatim — never alter call shape.
3. For `permission-denied` (added v1.9.2), attach `action_hint` pointing at firestore.rules — see ADR-0015.
4. For `invalid-argument`, sanitize-extract field names of the write payload.

## Decision (v1.9.1 — SSR-safe bundle split)

1. Removed the global `banner: { js: "'use client'" }` from `tsup.config.js`. Per-entry `'use client'` directives now live in source files that need them (`BlackBoxPanel.js`, `BlackBoxProvider.js`, `components/index.js`).
2. `bbWrapWrites` short-circuits to identity-passthrough when `typeof window === 'undefined'`. Returns the input fns unchanged — server-side calls are now no-op rather than crash.
3. **Effective breaking change:** `BlackBoxPanel` / `BlackBoxProvider` are no longer re-exported from the package root (`@artiskon/blackbox`). Now that the root entry isn't `'use client'`, re-exporting client components from it would silently bundle them server-side. Documented import path is `@artiskon/blackbox/components`.

## Reasoning

- An opt-in wrap was preferred over auto-monkey-patching the SDK at init time, because monkey-patching the consumer's imports requires the consumer to use the wrapped fns — passing wrapped fns to `init()` would have BlackBox's own writes go through the wrapper and double-record.
- Identity-preserved passthrough on the server (not just an empty object) lets `const fs = bbWrapWrites({...})` be called once at module top in shared client/server services without a `typeof window` guard at the call site.
- The bundle split wasn't optional once we wanted server importability — Next refuses to call any function declared in a `'use client'` module from server code regardless of whether the function itself is server-safe. Removing the banner was the actual fix.
- Removing components from the root re-export was preferable to leaving the footgun in place. The README documented the subpath import already; this brings runtime exports in line with documented usage.

## Trade-offs / what we explicitly didn't do

- We did NOT auto-instrument every Firestore call via `init({ instrumentWrites: true })` that swaps out global SDK fns. Too magical, hard to debug.
- We did NOT auto-detect the consumer using bare unwrapped writes and warn. Possible future addition; not blocking.
- We did NOT keep `BlackBoxPanel` / `BlackBoxProvider` in the root bundle as a transition convenience. Better to break loud than silently corrupt server bundles.

## Subsequent feedback

- v1.9.1 SSR fix was driven by the agent who hit the server-import error post-1.9.0 — same general feature, real follow-on bug.
- BB-1.8 agent (acted on in v1.9.2 batch) re-cited "silent permission-denied". That report predated this decision. Confirms shipped fix.
- **If a future agent asks to "auto-instrument writes globally":** see "We did NOT auto-instrument" trade-off above. Premise hasn't changed.
- **v1.9.4 (additive):** invalid-argument errors now carry `firstUndefinedPath` + `payloadShape` (deep payload introspection — ADR-0022) and `callerFrame` (the app frame that called the wrapped write — see ADR-0016 v1.9.4 section). Same `bbWrapWrites` API; richer context on the recorded error. Driven by a v1.9.3 dogfood session where Firestore's own error gave the document ID but not the field path within it.
