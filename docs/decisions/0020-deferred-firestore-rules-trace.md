# 0020 — Deferred: Firestore rules-trace plugin

- **Status:** Deferred (no client-side API; would require a server proxy)
- **Date:** 2026-05-04
- **Latest re-ask:** BB-1.8 agent feedback batch (acted on in v1.9.2)

## The recurring ask

When a Firestore `permission-denied` error fires, the dev wants a "rules-trace" embedded in the error context — i.e. *"matched isAdminOrTeam: false; matched brand_media branch: false (collection != 'brand_media'); no other branches"*. The Firestore emulator's REST endpoint provides this via `firestore.googleapis.com/v1/projects/{p}/databases/{d}:runQuery` with the right flags. The agent specifically wrote: *"That single feature would have made Issue 1 a 10-second fix."*

## Why we have NOT shipped this

1. **The Firebase JS SDK does not expose a rules-trace API.** The trace endpoint is admin-only and authenticated with Google Cloud credentials, not user credentials. From the browser, BlackBox cannot call it.

2. **A server-side proxy is the only viable architecture.** The consumer would need to:
   - Stand up an `/api/_bb/rules-trace` endpoint that accepts `{queryPath, queryFilters, uid, claims}` and runs the trace using admin credentials
   - Configure BlackBox with the endpoint URL via init
   - Accept the latency / cost of a real backend round-trip on every permission-denied error
   That's a significant integration burden for what's still a "nice to have."

3. **`registerDiagnostic` (ADR-0014) covers the use case for consumers willing to do the integration work.** The same diagnostic that reads the consumer's `firestore.rules` file or proxies a trace request fits naturally into the diagnostic API.

4. **ADR-0015's generic `action_hint`** already shortcuts the dev into the rules file with the queryPath + queryFilters. That's most of the "where do I look" win without a backend.

## Conditions to revisit

- Firebase ships a publicly-accessible rules-trace API callable with user credentials (would solve the auth problem)
- Or: a consumer demonstrates a working server-proxy diagnostic and wants BlackBox to bundle the integration

## Subsequent feedback

- BB-1.8 agent (acted v1.9.2 batch) re-asked. The combination of ADR-0003 (queryRef introspection), ADR-0015 (action_hint), and ADR-0014 (registerDiagnostic for opt-in trace) is the current best-effort answer.
