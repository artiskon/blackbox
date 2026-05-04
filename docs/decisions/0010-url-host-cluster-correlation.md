# 0010 — `url_host_cluster` correlation in bb-check

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.0

## Context

Even after ADR-0008 collapsed per-route resource_load fingerprints, a single dead host could still produce multiple distinct fingerprints across *different sources* — e.g. one `resource_load` from the `<img>` failure plus one `network` source from a separate `fetch()` to the same host. Both rows were the same root cause.

## Decision

bb-check's correlation pass (in addition to the pre-existing `same_path_session` and `multi_path` correlations) now adds `url_host_cluster`: when 2+ different fingerprints with `source` in `{resource_load, network}` hit the same hostname, they're grouped under one cluster with total occurrence count.

Hostname is taken from `error.context.hostname` first; falls back to parsing the URL out of the message (`/https?:\/\/([^/\s]+)/`) for older docs without the field.

## Reasoning

- After ADR-0008, single-source clusters are already collapsed via the fingerprint. The remaining shape is *cross-source* same-host. A separate correlation kind names the relationship without forcing it into the fingerprint.
- Bb-check's correlation block is the right place; the panel could also surface it in a future iteration.
- `network` and `resource_load` are the two sources where hostname is identity. `firebase` errors don't carry hostname; `console.error` rarely does. Limiting the cluster to those two keeps signal-to-noise high.

## Trade-offs / what we explicitly didn't do

- We did NOT add a separate `bb-check --host=foo.com` filter. Possible future addition; correlations cover the common discovery case.
- We did NOT add cross-source correlation by URL pattern (e.g. all errors involving `/api/storage/signed-url/*`). Too noisy without further heuristics.
- We did NOT propagate cluster info back into individual error docs. Read-time aggregation only; persistence stays per-error.

## Subsequent feedback

- None directly. BB-1.8 agent re-cited "cluster by host + status would have given me one row not 48" — that was on a pre-1.9 runtime; this ADR is the shipped form.
