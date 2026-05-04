# 0008 — Resource_load fingerprint by host+tagName only (drop path + stack-frame)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.0

## Context

A debugging session reported six different fingerprints (`k8ha7rsp`, `6wqn90cn`, `3j41z5as`, `apj844sn`, `0jrghyvs`, `90dyy2n1`) all pointing at `m.digitalden.solutions/{:hash}` failing across `/admin/radar`, `/admin/media-library`, `/admin/brand-kit`, etc. Same dead CDN host, same failure shape — but six rows instead of one because BlackBox's fingerprint inputs included `normalizedPath` and `topFrame`, which differ per route. Two separate sessions spent ~30 min collectively triaging six rows that were really one bug.

## Decision

For `source === 'resource_load'` only, drop `path` and `topFrame` from the fingerprint inputs. The fingerprint is computed from `truncatedMessage + source` only, where the message has already been normalized (URL host preserved, path-variable IDs replaced with `:id` / `:num` / `:hash`, filename collapsed to `*`, CDN transform prefixes stripped per ADR-0007).

Other sources (`window.onerror`, `console.error`, `network`, `firebase`, etc.) keep the full `message + source + path + topFrame` inputs.

## Reasoning

- A resource_load error describes a network outcome, not a code path. The page the user happened to be on when the image failed is metadata, not identity.
- The stack on resource_load is synthesized empty (the error event has no JS stack) — including it added entropy without signal.
- The message already encodes "img — host.com/path/*" via `normalizeMessageUrls`, so the message alone is the right key.

## Trade-offs / what we explicitly didn't do

- We did NOT extend "host-only fingerprint" to other sources. Different sources have different identity semantics; resource_load is uniquely path-independent.
- We did NOT add a config option to control resource_load fingerprint inputs. Always-on is correct; if a consumer needs path discrimination they should write a separate diagnostic via `registerDiagnostic` (ADR-0014).
- We did NOT collapse cross-tag (e.g. `<img>` and `<script>` failing on the same URL fingerprint to one row). Different tags fail for different reasons even on the same URL — keep separated.

## Subsequent feedback

- None contradicting. BB-1.8 agent feedback session (re-acted v1.9.2 batch) re-cited the per-asset fingerprint explosion — that was on a pre-1.9.0 runtime, confirms this decision works.
- **If a future agent asks to "include path in resource_load fingerprint so I can see per-route impact":** check this ADR first. The signal they want (per-route impact) is already covered by `multi_path` and `url_host_cluster` correlations in bb-check (ADR-0010). Splitting the fingerprint loses the single-bug-one-row property.
