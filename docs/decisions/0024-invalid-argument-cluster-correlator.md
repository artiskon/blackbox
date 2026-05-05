# 0024 — `invalid_argument_cluster` correlator in bb-check + `fingerprint` in panel report

- **Status:** Active
- **Date:** 2026-05-05
- **Version:** 1.9.4

## Context

A v1.9.3 dogfood session shipped a wholesale `stripUndefinedDeep` fix at
the proposal-service layer ON THE SECOND occurrence of "Firestore write
rejected because the app passed undefined for an optional field". The FIRST
occurrence (savedSections collection, hours earlier) had been fixed
narrowly. The two errors lived under separate fingerprints because their
`documentPath` collections differed (`proposals/...` vs `savedSections/...`),
and BB's existing correlators (`same_path_session`, `multi_path`,
`url_host_cluster` from ADR-0010) didn't link them.

The agent's report:

> A category cluster on the error message pattern (`/Unsupported field
> value: undefined/`) would have surfaced "you have N flavors of this
> bug across M collections" → I would have done the service-layer
> stripUndefinedDeep fix on the FIRST occurrence, not the SECOND.

Separately, the same agent flagged that the panel's exported report
(`copyFullReport`) was missing the `fingerprint` field on each error
entry — making `bb-ack <fp>` impossible directly from the export.

## Decision

Two additive changes shipped together:

1. **`bb-check` correlator: `invalid_argument_cluster`.** Mirrors the
   `url_host_cluster` shape from ADR-0010. When 2+ Firestore-write
   fingerprints surface a message matching `/Unsupported field value:
   undefined|invalid-argument/i` AND span 2+ distinct collections (first
   path segment of `documentPath`), they're flagged as one cluster with
   total occurrence count and a hint:

       #3 + #5 — invalid-argument across 2 collections
       (proposals, savedSections) — fix at the write/service
       layer, not per collection

   Same-collection clusters of `invalid-argument` are usually one bug
   already merged by fingerprint upstream — the cluster condition
   intentionally requires distinct collections.

2. **Panel report `fingerprint` field.** Each error entry in the panel's
   `copyFullReport` JSON now includes `fingerprint: err._fingerprint`.
   The fingerprint was computed and used internally for history grouping
   but stripped at export. With it present, agents can `bb-ack <fp>`
   directly from the export instead of cross-referencing `bb-check`
   output.

## Reasoning

- The pattern (one underlying bug, multiple Firestore collections) is the
  Firestore-write equivalent of "one upstream root cause, multiple
  fingerprints" that ADR-0010 already addressed for hostnames. Same
  shape, same value: fix once at the layer where data flows, not N times
  at the leaf.
- Matching on the message pattern (regex against `Unsupported field
  value: undefined`) rather than `error.code` is intentional. The code
  field on persisted errors is in `context.code`; matching the message
  is more robust to the consumer optionally stripping context fields.
- The `documentPath` first-segment heuristic is a good-enough proxy for
  "different collection". Subcollection paths (`users/X/posts/Y`) cluster
  by their root collection (`users`), which is what we want.
- Surfacing `fingerprint` per entry was a one-line gap, but a real one —
  the export was the user-facing artifact, and "self-sufficient export"
  is a property the rest of the report had.

## Trade-offs / what we explicitly didn't do

- We did NOT extend the cluster correlator to other Firestore error codes
  (`permission-denied`, `not-found`). Permission-denied across collections
  is most often a rules-deploy issue (one ADR-0015 `action_hint` at a time
  is the right resolution); not-found is per-document. Keep the correlator
  scoped to `invalid-argument` where the pattern actually exists.
- We did NOT cluster across sources (e.g. `network` 4xx + `firebase`
  invalid-argument). Different roots, same symptom would be misleading.
- We did NOT add a CLI filter for `--cluster=invalid_argument`. The
  cluster appears in the `correlations` block of the JSON output by
  default; agents that want only those can grep/jq.

## Subsequent feedback

- This decision is additive to ADR-0010 (`url_host_cluster`). The
  reasoning there about "single bug, one row" applies to this correlator
  too.
- This decision is also additive to ADR-0009 (`bbWrapWrites`) — the
  cluster depends on the wrapper's `documentPath` capture being present
  in the persisted error context.
