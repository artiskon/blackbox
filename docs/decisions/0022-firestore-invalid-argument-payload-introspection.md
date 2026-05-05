# 0022 — Recursive payload introspection on Firestore `invalid-argument`

- **Status:** Active
- **Date:** 2026-05-05
- **Version:** 1.9.4

## Context

A v1.9.3 dogfood session debugging a "Save proposal" crash hit Firestore's
`Function updateDoc() called with invalid data. Unsupported field value:
undefined (found in document proposals/jVmboM5HNkfaUdeKIAXh)`. The error
identifies the *document* but not the *field within the document*. The
agent had to:

1. Read three layered errors (firebase wrapper + service-layer console.error +
   UI-layer console.error)
2. Grep for `handleSave` to find the call site
3. Read `proposalService.ts` and `ProposalEditor.tsx` to enumerate optional fields
4. Read the `Proposal` and `ProposalSection` types to see which were optional
5. Decide on a wholesale `stripUndefinedDeep` because no single field was
   identifiable as the culprit

The agent's report named "the path WITHIN the document" as the single
highest-ROI field BlackBox could add: knowing it was `sections[5].subtitle`
would have collapsed a 10-minute investigation to ~30 seconds.

The pre-1.9.4 wrapper already attached top-level `writeFields` and
`undefinedFields`, but only walked `Object.keys(data)` — nested undefined
values were invisible.

## Decision

`bbWrapWrites` and `bbFirestoreOp` now run a bounded recursive walker
(`summarizePayload`, in `firebaseHook.js`) on the rejected write payload
when `error.code === 'invalid-argument'`. The walker emits two new context
fields:

- `firstUndefinedPath` — dotted/indexed path of the first undefined value
  (e.g. `sections[5].subtitle`, `metadata.author.email`, `tags[0]`)
- `payloadShape` — top 2 levels of the payload, types only (no values),
  for triage when no single undefined is at fault (e.g. an unsupported
  Symbol or BigInt at depth 1)

The walker is bounded to keep the per-error cost predictable:

- depth 4 (Firestore's own SDK enforces a 100-level cap; 4 captures the
  realistic shapes — proposals, lists of sections, items within sections —
  without chasing pathological structures)
- 200 visited keys total (bail early on huge payloads)
- cycle-safe via a `WeakSet` (defensive; circular refs in write payloads
  would have already thrown elsewhere, but we don't want to be the one
  that hangs)

The pre-existing top-level `writeFields` / `undefinedFields` are kept as-is.
They're cheaper than the deep walk and remain useful when the deep walk
isn't applicable (e.g. `setDoc` with a top-level scalar undefined).

`callerFrame` was added in the same commit — see ADR-0016's v1.9.4 section.

## Reasoning

- Firestore's own validator already walks the payload internally to find
  the undefined; reproducing that walk in BB costs us one O(n) pass per
  rejected write. Negligible at dev volumes; never runs on success.
- Bounding by depth + key count is preferred over a hard timeout — the
  walk is synchronous, runs after the rejection, and never blocks user
  interaction. A node count cap is the right shape of guard.
- Emitting `payloadShape` (not the actual values) honors the existing
  privacy default: BB has never persisted user data from write payloads,
  and `payloadShape` is types-only.
- We chose `firstUndefinedPath` (singular) over `allUndefinedPaths`
  (plural). In practice, Firestore rejects the FIRST undefined it finds
  and returns; finding the rest requires the dev to fix the first and
  retry. Capturing the first is correct and keeps the field tiny.

## Trade-offs / what we explicitly didn't do

- We did NOT walk recursively for `permission-denied`. The shape of a
  permission-denied error is "rule mismatch on this whole document" —
  nested introspection adds no signal. The existing `documentPath` +
  `action_hint` (ADR-0015) is the right fit there.
- We did NOT capture actual payload values, even truncated. Even type-only
  shapes leak some structure; values would leak user data. The existing
  privacy line (no payload values in the error doc) holds.
- We did NOT extend the walker to other Firestore error codes
  (`already-exists`, `not-found`, `failed-precondition`). Those don't have
  payload-shape root causes; documentPath answers them.
- We did NOT add a `lastSavedShape` diff (a v1.9.3 agent suggestion to show
  "what changed since last successful save"). Would require keeping per-doc-path
  payload state in memory; high cost, marginal value at dev volumes,
  scope creep for a dev-time tracker.

## Subsequent feedback

- None yet. Watch for "the walker missed an undefined inside a Firestore
  `arrayUnion(...)` argument" reports — sentinel values from
  `firebase/firestore` show up as opaque objects with internal `_methodName`
  fields. If the walker descends into one and surfaces a misleading path,
  add a sentinel-detection branch (`value?._methodName === 'arrayUnion'` etc.)
  that stops walking sentinel arguments.
- This decision is additive to ADR-0009 (the original `bbWrapWrites` ADR).
  The "we did NOT auto-instrument every Firestore call" trade-off there
  still holds.
