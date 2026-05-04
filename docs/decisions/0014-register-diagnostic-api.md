# 0014 — `registerDiagnostic` API for app-defined error probes

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.2

## Context

A BB-1.8 debugging session described writing `scripts/diagnose-asset.cjs` to manually probe (a) Cloudflare KV mapping, (b) R2 public bucket, (c) R2 private bucket, (d) Firestore `assets` doc, (e) Firestore `inspirationItems` doc to diagnose ONE failing image URL. The agent wrote: *"Hooks for app-specific state probing would close most of my pain points in one feature."*

## Decision

New `blackbox.registerDiagnostic(name, { match, run, timeoutMs })` API:

- `name` — result key under `error.context.diagnostics`
- `match` — `RegExp` tested against `message + url + context.src + context.url`, OR a function `(errorEntry) => boolean`
- `run` — `async (errorEntry) => any`. Result is attached verbatim
- `timeoutMs` — hard cap (default 200ms). Slow probes get `{error: 'timeout'}`; the late result is dropped

Diagnostics fire in the background after the error is recorded; results land via `_notifySubscribers` so the panel updates and Firestore writes pick up the latest snapshot when next they flush. Re-registering a diagnostic with the same name replaces the prior registration (HMR-friendly).

Companion `blackbox.unregisterDiagnostic(name)` for cleanup.

## Reasoning

- BlackBox can never know an app's domain-specific state (which KV key to check, which R2 bucket, which Firestore collection). The app does. The right architecture is a thin pluggable hook the app fills in.
- Background-fire-with-timeout was chosen over inline-await because:
  - Inline await would change `_recordError`'s sync contract.
  - Background-fire has predictable latency at the call site.
  - The `_notifySubscribers` callback ensures both the panel and the persistence layer get the diagnostic data once it lands.
- Hard 200ms default cap forces consumers to design fast probes. Slow probes are usually bugs anyway (a probe that waits on a real backend defeats the "10-second diagnosis" goal).

## Trade-offs / what we explicitly didn't do

- We did NOT make diagnostics able to cancel the error capture (e.g. "this isn't really an error"). Errors persist regardless; diagnostics enrich, they don't gate.
- We did NOT support multiple `match` patterns per registration. Register multiple diagnostics with descriptive names instead.
- We did NOT serialize `run`'s return value through a sanitizer. Consumers are responsible for not putting secrets in the result. Documented in the README and the JSDoc.
- We did NOT auto-retry timed-out diagnostics. Slow once probably means slow always.
- We did NOT ship server-side diagnostic registration (e.g. for SSR contexts). Diagnostics fire from `_recordError` which only runs on the client.

## Subsequent feedback

- None yet. Watch for "diagnostic ran but result didn't show in panel" reports — would indicate the `_notifySubscribers` flow isn't propagating fast enough; consider sync-await with longer timeout if so.
