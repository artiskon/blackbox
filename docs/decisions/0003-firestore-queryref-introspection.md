# 0003 — Firestore queryRef introspection on permission errors

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0 (extended in 1.9.2 with `action_hint` — see ADR-0015)

## Context

Multiple sessions reported the same complaint: a Firestore `permission-denied` error has a generic message ("Missing or insufficient permissions"), no collection name, no `where()` filters, no document path. Devs had to grep the codebase for the calling service file, read the function, and reconstruct the query before they could even read `firestore.rules` to diagnose.

## Decision

The wrappers `bbFirestoreOp(name, promise, details)` and `bbOnSnapshot(query, onNext, onError, opts)` introspect the SDK's internal `_query` shape (`internal.path.segments`, `internal.filters`) on error and attach to the error context:

- `queryPath` — the canonical collection path (e.g. `prompts`, `users/{uid}/projects`)
- `queryFilters` — the rejected `where()` shape with field name and op preserved, but VALUES dropped (`createdBy == ?`, `ownerOnly == ?`) to avoid leaking user data into BlackBox docs
- `queryDescription` — caller-supplied human label (`{ description: 'agency prompts where ownerOnly==false' }` on bbOnSnapshot, `{ queryDescription: '...' }` on bbFirestoreOp)

The Firestore JS SDK exposes `_query` / `_delegate._query` as semi-internal but stable across v9+. We tolerate breakage on a major SDK rewrite; for now this is the cheapest way to avoid forcing every call site to thread a description string.

## Reasoning

- This is the single biggest investigative win for permission-denied: the dev's first question is "which collection / which where()". Surfacing it removes a 5-step grep dance.
- Filter VALUES are dropped to keep BlackBox compliant with the existing privacy posture (no user data in error docs). Field names + ops are pure schema and safe.
- Description-as-fallback handles the case where SDK introspection fails on a new SDK version; the human label still surfaces.

## Trade-offs / what we explicitly didn't do

- We did NOT fire a rules-emulator API call to actually trace which rule branch failed. That's a rules-trace plugin — see ADR-0020.
- We did NOT introspect at the *write* site (setDoc/updateDoc/deleteDoc) at this stage — those go through `bbWrapWrites` and the path is already on the DocumentReference (added in v1.9.0; see ADR-0009).
- We did NOT build an introspection layer for the modular SDK's lite or admin variants. The host app passes the SDK fns; we depend on what's in scope.

## Subsequent feedback

- v1.9.2 — Agent asked for `action_hint` on permission-denied (mirroring the gold-standard index-creation hint). Shipped as ADR-0015 — additive, doesn't change this introspection behavior.
- BB-1.8 agent feedback session (acted on in v1.9.2 batch) re-cited that "the Firestore query path / constraints in the error context" was missing — but that report was on a runtime older than v1.8.0. Confirms this decision, doesn't contradict.
- **2026-09-13 (unreleased, after v1.9.5; additive):** four fixes in this area.
  1. **Collection in the message.** Recorded messages now read `Firestore <op> failed on <collection>: ...`, `Firestore <op> failed (sync) on <collection>: ...` and `Firestore listener error on <collection>: ...` (doc IDs as `:id`, a trailing doc ID dropped, collection groups as `**/<collectionId>`). The SDK's "Missing or insufficient permissions." never names a collection and its stack has no app frame, so denials on different collections shared one fingerprint, the 200ms message-keyed dedup dropped the second, and the row kept the first collection's `queryPath` / `action_hint`. The collection sits before the colon so ADR-0023's tail-substring cascade dedup still matches. Existing firebase rows re-fingerprint once.
  2. **Introspection accuracy.** `queryPath` now comes from `_query.path.canonicalString()` (the `segments` array is shared with parent refs, so joining it could add segments); collection-group queries report `**/<collectionId>` (was empty); `or()` / `and()` composite filters render as `(a == ? or b == ?)`. Filter values are still never captured. `bbOnSnapshot` reuses `describeQueryRef` instead of an inlined copy.
  3. **`bbOnSnapshot` prefers `init({ firestoreFns: { onSnapshot } })`** over its own dynamic import, which in submodule/path installs is a second SDK copy that rejects the app's query. If attaching fails it now records a `firebase_listener` error (`bbOnSnapshot could not attach listener ...`) and calls `onError`, instead of a `console.warn` the `[BlackBox]` filter kept out of the log.
  4. **App callbacks are no longer wrapped.** Throws inside `onNext` / `onError` surface as normal uncaught errors (the SDK already runs each event in its own task); catching them hid data-mapping bugs in snapshot handlers.
