# 0026 — DEFERRED: Browser-side / ingestion-time sourcemap resolution

- **Status:** Deferred
- **Date:** 2026-05-05
- **Version:** —

## Context

The DigitalDen runner-integration handoff (May 2026) flagged that BB stack
traces in `__blackbox` are minified bundle paths
(`chunk-abc123.js:42:18`) — the runner surfaces these in the audit summary
verbatim, and the receiving agent gets noise. Resolved traces (component
name + line) would be dramatically more useful.

Two implementation paths were considered:

1. **Browser-side resolution.** BB fetches the source map at error-capture
   time, runs the captured stack through `source-map`, persists the
   resolved version.
2. **Ingestion-time resolution.** BB persists the raw stack; bb-check (or
   a sibling CLI) resolves stacks against a known source-map location at
   read time.

## Decision

**Defer.** Push the work to the runner side. The DigitalDen ui-check
runner already builds the bundle locally and has the source maps on
disk; it is the correct layer to do post-hoc stack resolution before
surfacing in the audit summary.

## Reasoning

- **Browser-side resolution** adds a meaningful runtime cost. The
  `source-map` package is ~50KB unminified; the WASM mappings parser is
  more. Fetching a `*.map` file for every error capture also pulls extra
  network + has the host app paying for the dev-tool's debugging cost.
- **Ingestion-time resolution** would require BB to know the source-map
  URL or storage location, which varies per consumer (Vercel vs Netlify
  vs custom CDN). That config surface is "where to find the maps" — every
  consumer's answer is different. Punting that surface to the consumer
  (the runner, or `bb-check` plus a `--sourcemap-dir` flag) keeps BB
  itself agnostic.
- **Runner-side resolution** has neither problem. The runner already
  knows where its built artifacts and source maps live; resolving 1-3
  stack traces per audit run is cheap and synchronous. The right layer
  to add complexity is the layer that has the context.
- **Existing partial mitigation.** BB already extracts a single non-framework
  app frame as `context.callerFrame` (ADR-0016, extended in v1.9.4 to
  Firestore wrappers — ADR-0009/0022). For the dominant
  "what code called this?" question, the caller frame is enough.
  Sourcemap resolution buys finer-grained line numbers; it doesn't
  fundamentally change diagnostic capability.

## What would change the calculus

- A consumer asks for sourcemap resolution AND has no out-of-band ability
  to do it themselves (e.g. a CLI-only consumer with no build context).
  None today.
- BB itself starts shipping pre-built artifacts that load consumer source
  maps trivially (e.g. via a registered URL pattern at init). Premature
  to design for now.
- A second runner integration appears with the same ask. One ask is
  user-facing; two suggests a pattern.

## Trade-offs / what we explicitly didn't do

- We did NOT add an opt-in `init({ resolveSourceMaps: { url: ... } })`.
  Even opt-in, the opaque-config surface ("where do I get my maps from")
  is too consumer-specific to commit to.
- We did NOT add a `bb-resolve-stacks <input.json> --sourcemap-dir <path>`
  CLI as a separate package. Plausible if the runner-side cost turns out
  to be high; not yet justified.

## Subsequent feedback

- None yet. If a future agent re-proposes this without first confirming
  their runner can't resolve client-side, point them here. The premise
  needs to actually shift.
