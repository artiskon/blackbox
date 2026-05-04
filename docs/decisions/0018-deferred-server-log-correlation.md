# 0018 — Deferred: Server-log correlation for /api/* errors

- **Status:** Deferred (revisit if standardized server-log access materializes)
- **Date:** 2026-05-04
- **Latest re-ask:** Multiple sessions across v1.8 and v1.9 batches

## The recurring ask

When a network error fires for `/api/foo` and BB captures the client-side breadcrumb, the dev wants the *server-side* log lines from the same timestamp embedded automatically — e.g. the last 5 lines of `/tmp/next-dev.log` near the request's response time. Would close the "I had to tail the dev server log separately" gap.

## Why we have NOT shipped this

1. **No standard log location.** Next.js dev server output is on stdout (no file). `next start` and `next dev` have different behaviors. Vercel / Netlify / Firebase App Hosting each pipe to different destinations. There's no portable file path BlackBox can read.

2. **Cross-process boundary.** BlackBox runs in the browser. Server logs live in a separate process. To correlate, BlackBox would need either:
   - A side channel (an `/api/_bb/logs?since=ts` endpoint the consumer must implement)
   - A wrapper around the dev server that stamps logs into Firestore / a known location
   Both put the burden back on the consumer.

3. **The consumer can already do this themselves** with `registerDiagnostic` (ADR-0014). A diagnostic that calls `/api/_bb/logs?since=ts` and embeds the result is ~20 lines of consumer code and exactly fits the design.

## Conditions to revisit

- **A standardized log-access protocol emerges** (e.g. the OpenTelemetry trace context becomes mainstream in Next.js dev) AND
- We can implement it without imposing implementation work on the consumer

## Subsequent feedback

- Asked at least 3× across separate sessions. Each time, the recommended workaround has been: register a diagnostic that calls a consumer-defined `/api/_bb/logs` endpoint. **If a future agent asks again:** check whether they considered the diagnostic. If yes and they hit a real blocker, that's new info — open a real implementation discussion.
