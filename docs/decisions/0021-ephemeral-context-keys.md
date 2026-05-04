# 0021 — Underscore-prefixed context keys are ephemeral (not persisted, visible to diagnostics)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.3

## Context

v1.9.2 introduced `registerDiagnostic` (ADR-0014) so apps could attach probe results to errors based on a regex match against `message + url + context.src + context.url`. A v1.9.2 dogfood session immediately exposed a gap: the test diagnostic's regex (`/\/api\/bb-test\?mode=diagnostic/`) couldn't match because the network hook strips query params from `context.url` before persistence (privacy default) — and `?mode=diagnostic` is exactly what the matcher needed. Same problem in the resource hook: `context.src` is the stripped URL.

The matcher needs the raw URL. The persisted Firestore doc and the panel-export report must NOT carry it (signed-URL tokens, session-bearing query params).

## Decision

Underscore-prefixed keys on `errorEntry.context` (e.g. `context._rawUrl`, `context._rawSrc`) are an **ephemeral, in-process-only** convention. They:

1. Are populated by hooks alongside the stripped equivalents (network → `context._rawUrl`, resource → `context._rawSrc`, storage → `context._rawUrl`)
2. Are visible to `registerDiagnostic` matchers via the `_diagnosticMatches` probe surfaces (added two new probes: `_rawSrc`, `_rawUrl`)
3. Are stripped by `stripEphemeralContextKeys()` before:
   - Firestore persistence (`addDoc` path in `persistence.js`)
   - Panel report export (`copyFullReport` in `BlackBoxPanel.js`)
4. Are also visible to function-style `match` callbacks (the entire `errorEntry` is passed in, so the matcher can read whatever it wants)

The convention is enforced by code (the strip helper) rather than by the type system or documentation alone — a naming convention this load-bearing needs an enforcement point.

## Reasoning

- **Privacy default stays intact.** Stripping at write time has been the policy since v1.0; the new field doesn't change that, it just provides a safe in-process shadow for matchers that need the raw value.
- **`_*` is a clear signal** to anyone reading the persistence layer (or the panel report code) that the field shouldn't pass through. Better than a special "do not persist" registry of named fields.
- **Add-once, propagate everywhere** — once the strip helper exists, future hooks can adopt the convention without touching persistence/panel/diagnostic code.
- We considered the alternatives:
  - **Pass raw URL as a separate argument to diagnostic match functions.** Would only help the function-style matchers; regex matchers couldn't access it.
  - **Don't strip query params at all.** Reverses the privacy default; breaks fingerprint stability across signed-URL refreshes.
  - **Two separate context shapes (persisted vs in-process).** Heavier refactor; the `_*` convention is the lightweight version.

## Trade-offs / what we explicitly didn't do

- We did NOT enforce the convention at the type level (TypeScript can't easily express "context keys not starting with underscore"). Enforcement is runtime-only via `stripEphemeralContextKeys`.
- We did NOT add `_rawBody` / `_rawHeaders` etc. for the same use case. If a future diagnostic needs to match against response body content, add `_rawBody` to the matcher probes here and strip via the same helper. The convention scales.
- We did NOT bridge the convention into the existing breadcrumb format. Breadcrumbs are persisted as-is on the error doc; consumers who need raw-URL match against breadcrumbs should use a function-style matcher.
- We did NOT add a runtime warning when consumers explicitly set an `_*` key. They might have a legitimate reason; the strip is silent and correct.

## Subsequent feedback

- None yet. Watch for "diagnostic regex matched against raw URL but context.url is stripped — confusing" reports; if so, document the dichotomy more loudly in `BLACKBOX-PROMPT.md`.
