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
