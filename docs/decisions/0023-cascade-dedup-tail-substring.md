# 0023 — Panel cascade dedup via tail-substring matching + `uniqueIncidents`

- **Status:** Active
- **Date:** 2026-05-05
- **Version:** 1.9.4

## Context

A v1.9.3 dogfood session reported one Save-proposal crash that produced
THREE separate entries in the panel report — same root cause, three layers
of try/catch wrapping the same throw:

1. `Firestore updateDoc failed (sync): Function updateDoc() called with invalid data...` (source: firebase, the `bbWrapWrites` tap)
2. `Error updating proposal: Function updateDoc() called with invalid data...` (source: console.error, from `proposalService.ts`)
3. `Save failed: Function updateDoc() called with invalid data...` (source: console.error, from `ProposalEditor.tsx`)

Each got `count: 1`. The session's reported `errorCount: 3` was therefore
3× inflated. At scale, this turns a 50-event session into a 150-event
report and makes triage confusing — "how many distinct problems?" no
longer has a one-glance answer.

The pre-1.9.4 panel dedup did exist (BlackBoxPanel.js:241) — it merged
cross-source rethrows when the message and timestamp matched. But it
matched only on:

- exact equality after stripping `Uncaught \w+:` prefix
- prefix containment (one's first 40 chars inside the other)
- a 50ms timestamp window

None of these caught this cascade. The three messages share a *suffix*
("Function updateDoc() called with invalid data...") — each layer prepends
its own prefix ("Save failed:", "Error updating proposal:", "Firestore
updateDoc failed:"), so prefix matching can't link them. The 50ms window
was also too tight for rethrows that bubble through 2-3 service-layer
try/catches before reaching the bottom-most console.error.

## Decision

Two changes to the panel's `copyFullReport` dedup:

1. **Tail-substring matching.** After the existing prefix checks, compare
   the last 80 characters of each message. If either's tail is contained
   in the other, treat them as the same incident. The tail must be ≥30
   characters to count (avoids merging short generic messages like
   "Network error" or "Failed").
2. **Window widened to 250ms** (from 50ms). Service-layer rethrows that
   pass through 2-3 `try/catch/throw` layers can take 100ms+ on a slow
   render tick.

When a merge happens, `sources[]` collects the channels the cascade fired
on (e.g. `["firebase", "console.error"]`) — same as the existing behavior.

A new `session.uniqueIncidents` field exposes the post-dedup distinct
count alongside the raw `errorCount`. The instructions blurb at the top
of the report explains the difference.

## Reasoning

- Tail matching is the natural pattern for cascade detection: each layer
  ADDS context (a service-name prefix, a UI-action prefix), preserving
  the underlying message at the suffix.
- A 30-character minimum keeps the dedup safe — generic short messages
  ("Failed", "Error") wouldn't merge across truly different incidents.
- Widening to 250ms catches realistic try/catch chains without merging
  unrelated errors that happen to share a suffix in the same quarter-second
  (these would also need to share a 200-char prefix or tail to merge).
- We chose to expose BOTH `errorCount` and `uniqueIncidents` rather than
  swap. `errorCount` remains useful for "how chatty is this session" and
  for matching what the panel badge displays in the corner.
- We did NOT go through `Error.cause` chains. Modern apps frequently use
  `throw new Error('Save failed', { cause: e })`, but the pre-existing
  cascades were plain rethrows, not cause-wrapped. Tail matching catches
  both shapes; cause-chain inspection would only catch the modern shape
  and miss the others.

## Trade-offs / what we explicitly didn't do

- **Risk: false-positive merges.** Two truly distinct errors with similar
  suffixes that happen within 250ms could merge incorrectly. In practice
  the suffix would have to match for ≥30 chars AND timestamps within
  250ms — extremely unlikely except for actual cascades.
  Mitigation: when the new dedup misfires, `sources[]` will list
  channels that don't make sense together; an agent reading the report
  can spot it.
- We did NOT change the in-memory dedup in `blackbox.js` (`_recentErrors`
  with the existing 200ms window and same-fingerprint rule). That layer
  serves a different purpose (storm suppression on repeated identical
  errors); collapsing cross-source cascades there would lose data the
  panel needs. The panel-export dedup is correctly the place to merge.
- We did NOT auto-suppress the redundant cascade entries from the
  Firestore-persisted history. Persistence keeps the raw stream for
  forensic value; only the panel report — the AI-facing artifact —
  collapses.
- We did NOT introduce a config knob to disable cascade dedup. The
  failure mode is "missed merge" (fixable by adding a hint), not "broken
  signal" (which would justify an off switch).

## Subsequent feedback

- None yet. Watch for: (a) "two unrelated errors got merged" — would
  argue for tightening the tail length or adding a fingerprint check;
  (b) "a real cascade was missed because timestamps were >250ms" — the
  rethrow chain crossed an `await`. If that happens often, widen the
  window further or move dedup to a fingerprint-similarity check instead
  of a timestamp-window one.
- The "3 errors for 1 incident" feedback also flagged that the
  `bbWrapWrites` writes for presence/typing-indicators were noisy in the
  breadcrumb trail. We deferred auto-collapsing presence writes — see the
  "what we did NOT do" note in the project-level discussion of v1.9.4
  feedback. The right answer is consumer-side categorization, not
  heuristic auto-collapse.
