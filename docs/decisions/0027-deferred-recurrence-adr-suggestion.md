# 0027 — DEFERRED: Recurrence-pattern ADR suggestion in CLI / panel

- **Status:** Deferred
- **Date:** 2026-05-05
- **Version:** —

## Context

The DigitalDen runner-integration handoff (May 2026) suggested:

> When the same fingerprint hits N times across distinct sessions, the
> dev panel (or the CLI) should suggest "this looks like a recurring
> bug; consider an ADR." Threads BB into the architectural-memory layer
> rather than just the bug-collection layer.

The data is largely there — `occurrences`, `uniqueUserCount`, and the
implicit session-count via per-doc `lastSeenSessionId` history all support
the threshold check. The implementation is mostly UX:

- A `bb-check --suggest-adrs` flag (or a dedicated `bb-suggest-adrs`
  subcommand) that walks fingerprints and emits a one-paragraph ADR seed
  (fingerprint, message, first/last seen, occurrence count, sample stack
  frame) for any fingerprint above the threshold.
- A dev-panel call-to-action when a fingerprint crosses the threshold.

## Decision

**Defer to a v1.9.6 (or later) cut.** The ask is real and additive, but
not blocking the runner integration v1 rollout. v1.9.4 already carries
two thematic batches (Firestore-write debugging + runner-integration
plumbing); adding a third dilutes the release-note clarity.

## Reasoning

- **Real value, real work.** Thresholding is straightforward; the actual
  ADR-seed generation (template, slug suggestion, area-folder routing)
  is the work. None of it is technically hard, but it's all UX/copy
  decisions that benefit from real-world iteration after shipping.
- **Right layer is the CLI, not the panel.** The panel is a live debug
  surface; ADR suggestion is a "look back at what's been hitting for
  weeks" action. CLI is the better fit, especially since DigitalDen's
  ADR layout (`docs/adr/<area>/NNNN-<slug>.md`) is repo-specific.
- **Threshold is consumer-specific.** The handoff suggests 5 distinct
  sessions; DigitalDen's sweet spot may differ. The flag should accept
  `--threshold=N` with a reasonable default. That's a config surface
  that benefits from waiting for one or two consumers to express
  preferences before locking it in.

## What we'd ship when un-deferring

- `bb-suggest-adrs [--threshold=5] [--since=30d]` — walks the fingerprint
  index, picks the rows above the threshold that aren't already acked,
  emits a markdown block per fingerprint:

      ## Recurring: <truncated message>
      - First seen: <date> | Last seen: <date>
      - Occurrences: N | Distinct sessions: M | Distinct users: K
      - Sample stack: <topAppFrame>
      - Sample fingerprint: <hash>
      - Suggested ADR slug: <kebab-from-message>
      - Suggested ADR area folder: (consumer to fill in)

- Optionally a panel CTA: when a `_recentErrors` entry's fingerprint has
  cross-session count above the threshold, surface a button that copies
  the same markdown block to clipboard.

- We would NOT auto-create the ADR file. The agent operator picks the
  slug, the area, and refines.

## Trade-offs / what we explicitly didn't do today

- We did NOT ship a partial version (e.g. just the threshold, no markdown
  generation). Half a feature is worse than no feature for "consider an
  ADR" prompts — the friction has to drop all the way for the ergonomic
  win to land.
- We did NOT add the threshold tracking to the persistence layer. The
  data is queryable from the existing fingerprint index when the CLI
  runs; no schema change needed.

## Subsequent feedback

- None yet. The next consumer who proposes this should also clarify
  what "distinct sessions" means in their context — sessionId only, or
  sessionId+sessionTag (audit run tagging changes the count semantics).
  See ADR-0025 for the sessionTag context.
