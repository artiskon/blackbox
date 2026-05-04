# 0015 — `action_hint` on Firestore permission-denied

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.2

## Context

A BB-1.8 debugging session called out the existing `action_url` + `action_hint` fields (added for "requires an index" errors) as the gold standard: *"BB extracted Firebase's create-index URL and surfaced it as actionable. I clicked, deployed the index, done. This is the model other errors should follow."* The agent asked for the same shape on permission-denied: *`action_hint: 'Check Firestore rule at rules/X.rules:line'`*.

## Decision

When a Firebase error in `bbFirestoreOp` / `bbOnSnapshot` / `bbWrapWrites` has `code === 'permission-denied'`, attach a generic action_hint:

> Open firestore.rules and verify a matching match{} block grants the requesting user access to {documentPath || queryPath || 'the rejected path'} ({queryDescription if available}). Check the user's auth state and any role/uid fields the rule reads.

Hint composes the captured `documentPath`, `queryPath`, `queryDescription` (per ADR-0003) so the message is specific to the failing query, not generic.

## Reasoning

- The hint is the *advice* layer that the existing `queryPath` + `queryFilters` fields support. They tell you what failed; the hint tells you where to look.
- We chose a *generic* hint rather than parsing rules-file line numbers because:
  - Parsing `firestore.rules` requires a runtime parser
  - Line numbers shift with edits and the hint would rot
  - Even an imperfect generic hint shortcuts the "where do I start" question
- Bundled into the existing wrappers — no separate config / opt-in. Consumers who use the wrappers get hints for free.

## Trade-offs / what we explicitly didn't do

- We did NOT parse `firestore.rules` to surface specific match-block line numbers. See ADR-0020 for the related rules-trace plugin (also deferred).
- We did NOT add hints for other Firebase error codes (`not-found`, `failed-precondition`, etc.) at this stage. Permission-denied is the most common; others can be added incrementally if reported.
- We did NOT extract the user's auth state into the hint payload (e.g. "the user has uid X and role Y; rule expected role Z"). Privacy concern + complexity; the dev can read the user object themselves.

## Subsequent feedback

- None yet. The hint shape is identical to the praised index-creation hint, so should land well.
