# 0025 — Runner-supplied `sessionTag` + `failFast` trip via window globals + CustomEvent

- **Status:** Active
- **Date:** 2026-05-05
- **Version:** 1.9.4

## Context

DigitalDen's `scripts/ui-check` runner now drives BlackBox during unattended
audits — Playwright walks every authenticated route post-deploy, then
queries `__blackbox` for runtime errors that fired during the walk.

Two pain points the runner team flagged after wiring it up
(handoff doc: `DigitalDen/docs/adr/meta/0013-blackbox-runner-integration.md`):

1. The runner already plumbs a unique session token via
   `context.addInitScript(() => { window.__BB_SESSION_TAG__ = '...'; })`,
   but BB ignored it. Without it, audit queries see real-user errors from
   the dev VPS, manual operator clicks, and other concurrent audit sessions
   alongside the run's own.
2. The runner queries `__blackbox` only after the page settles. If a
   runtime error fires in the middle of a route walk, it'd be useful to
   halt the route capture early instead of waiting for the post-settle
   poll. The runner had no signal to halt on.

## Decision

Two new init-time inputs, both read at `blackbox.init()` from either the
options bag or specific `window.__BB_*` globals (the latter set via
`addInitScript` before page boot):

### `sessionTag` (string)

- Read from `options.sessionTag` first, then `window.__BB_SESSION_TAG__`.
- Trimmed and truncated to 64 chars.
- Persisted as a top-level `sessionTag` field on every newly-created
  error doc (alongside `sessionId`, which is BB's own per-page-load id).
- Persisted as `lastSeenSessionTag` on the doc-update path so a re-fire
  of a fingerprint that already existed (from a previous session, perhaps
  a real user) ALSO surfaces in the runner's
  `where('lastSeenSessionTag', '==', tag) AND where('lastSeen', '>', t)` query.

### `failFast` (boolean)

- Read from `options.failFast` first, then `window.__BB_FAIL_FAST__`.
- When true, on the FIRST non-internal error captured by `_recordError`:
  - Sets `window.__BB_FAIL_FAST_TRIPPED__ = { fingerprint, message, source, recordedAt, sessionTag }` (idempotent — only the first non-internal error trips it).
  - Dispatches `CustomEvent('blackbox:fail-fast', { detail })` on `window`.
- The runner watches either signal (cheap polling on the flag, or a
  listener for the event) and halts the route capture.
- Internal-frame-only errors (framework warnings, see ADR-0001) never
  trip. Real audit failures are app-level, not framework-level.
- BB does NOT throw. The runner controls halt.

## Reasoning

- **Why both an option and a window global.** The window-global pattern
  is the cleanest for unattended runners: the runner injects via
  `addInitScript` before any app code runs, BB picks it up at init, and
  no app-code change is required to opt the audit in. The option form
  preserves the explicit-config path for embedded/manual cases.
- **Why not throw on fail-fast.** Throwing inside `_recordError` would
  re-enter the BB capture path via `window.onerror` (sync throw) or via
  `unhandledrejection` (async throw inside a listener). The trip flag +
  CustomEvent decouples capture from halt — halt is the runner's
  responsibility, BB's responsibility is to surface a clear signal.
- **Why both `__BB_FAIL_FAST_TRIPPED__` and the event.** Polling the
  flag is cheaper for the runner (one `page.evaluate` between actions);
  the event is for cases where the runner wants a push-style hook (e.g.
  via `page.exposeFunction` + `window.addEventListener`). Both come for
  free; offering both lets the runner pick.
- **Why update `lastSeenSessionTag` on the update path.** A fingerprint
  that already existed (from a real-user session) might re-fire during
  the audit. Without this field, the runner's
  `where('sessionTag', '==', tag)` query would miss those re-fires
  because the doc's original `sessionTag` is the previous session's. The
  update-path field gives the runner a "did this fire during my
  window" signal independent of when the doc was first created.
- **Why not just use the existing `tags` config?** `tags` is a
  free-form record meant for arbitrary metadata. `sessionTag` is a
  load-bearing query field — it deserves its own typed top-level slot
  so Firestore can index it and consumers can rely on its presence/shape.

## Trade-offs / what we explicitly didn't do

- We did NOT validate the sessionTag beyond trim+truncate. The runner
  controls what it injects; over-validation is theatre. If a malformed
  tag makes it to Firestore, the worst case is a query miss — recoverable.
- We did NOT add a `sessionTags` array on the doc to track every session
  that hit a fingerprint. The runner only needs "did this fingerprint
  fire during my window", which `lastSeenSessionTag` answers without
  a 50-element array hanging off every popular doc.
- We did NOT auto-clear `window.__BB_FAIL_FAST_TRIPPED__` on subsequent
  errors. Tripping on the FIRST one is the contract; the runner halts
  after, and on retry it resets the flag itself.
- We did NOT add a `failFastSources: ['firebase', 'console.error']`
  config to filter which sources can trip. Internal-frame filtering is
  enough for the audit use case; per-source filtering can be added if a
  real ask appears (it hasn't yet).
- We did NOT add server-side init-time recognition of these globals.
  `bbWrapWrites` short-circuits to passthrough on the server (ADR-0009);
  `_recordError` is client-only. The window globals are inherently
  client-only by design.
- We did NOT throw on fail-fast (see Reasoning). Future agents proposing
  "make fail-fast actually throw so my SPA boundary catches it" should
  re-read the recursion concern above before flipping.

## Subsequent feedback

- None yet. Watch for: (a) a runner-side request to also trip on
  internal errors (would mean a config like `failFastIncludeInternal`);
  (b) a runner-side request to dispatch the event on EVERY error, not
  just the first (would split into a separate `blackbox:error` event —
  the trip is intentionally one-shot).
