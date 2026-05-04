# BlackBox decision log

Every non-trivial design choice in @artiskon/blackbox is recorded here as an ADR (Architecture Decision Record). The point: feedback often contradicts older feedback, and without a written rationale we'd thrash — flipping decisions every time a new agent hits a different edge case.

## Meta-rule (must follow)

**Before acting on new BB feedback, search this directory for the relevant area first.**

If a relevant ADR exists, the new feedback is one of:

- **(a) New use case the existing decision didn't cover** → ship as additive, cite the ADR in the commit message.
- **(b) Regression of a known trade-off** → write a *superseding* ADR with explicit reversal rationale; mark the old ADR `Status: superseded by NNNN` and point at the new one.
- **(c) Disagreement on a deliberate non-decision** (a "deferred" ADR) → confirm the original reasoning still applies before flipping. If the premise has actually changed (new tooling available, scope justified by repeat asks, etc.), supersede.

**Never silently reverse a prior decision because the latest agent didn't see the rationale.** That's the failure mode this log exists to prevent.

If you ship a behavior change that touches an ADR area, update or supersede the ADR in the same commit (the existing CLAUDE.md "update related docs with every code edit" rule applies to ADRs too).

## Format

Each ADR is one file: `NNNN-short-kebab-name.md`. Numbers are zero-padded and assigned sequentially.

Required sections:

- **Status** — `Active` | `Superseded by NNNN` | `Deferred (with rationale)`
- **Date** — when the decision was made
- **Version** — the BB version that shipped the decision
- **Context** — what feedback / debugging session drove it
- **Decision** — what we shipped (or explicitly didn't ship)
- **Reasoning** — why this approach over alternatives
- **Trade-offs / what we explicitly didn't do** — known costs; out-of-scope companion features and why
- **Subsequent feedback** — cross-references when later sessions touched this area

## Index

### v1.8.x

- [0001 — Internal-stack suppression](0001-internal-error-suppression.md)
- [0002 — Build-aware error tracking](0002-build-aware-error-tracking.md)
- [0003 — Firestore queryRef introspection](0003-firestore-queryref-introspection.md)
- [0004 — HTML upstream error page collapse](0004-html-upstream-error-page-collapse.md)
- [0005 — Click auto-label waterfall](0005-click-auto-label-waterfall.md)
- [0006 — bbR2Fetch storage source](0006-bbr2fetch-storage-source.md)

### v1.9.0 / v1.9.1

- [0007 — urlReachability classification (supersedes original `cors_blocked` label)](0007-url-reachability-classification.md)
- [0008 — Resource_load fingerprint by host+tagName only](0008-resource-load-fingerprint-host-only.md)
- [0009 — bbWrapWrites + SSR-safe bundle split](0009-bbwrapwrites-and-ssr-bundle-split.md)
- [0010 — `url_host_cluster` correlation in bb-check](0010-url-host-cluster-correlation.md)
- [0011 — Dev-noise suppression (Next overlay clicks, first-compile slow_request)](0011-dev-noise-suppression.md)
- [0012 — Per-entry `'use client'` directive (banner removed)](0012-per-entry-use-client-directive.md)

### v1.9.2

- [0013 — Tag content-type mismatch detection](0013-tag-content-type-mismatch.md)
- [0014 — `registerDiagnostic` API](0014-register-diagnostic-api.md)
- [0015 — `action_hint` on Firestore permission-denied](0015-action-hint-firestore-permission-denied.md)
- [0016 — Caller frame on `console.error`](0016-console-error-caller-frame.md)

### v1.9.3

- [0021 — Underscore-prefixed context keys are ephemeral](0021-ephemeral-context-keys.md)
- (also touches ADR-0007 / ADR-0014 / ADR-0016 — see "Subsequent feedback" sections in each)

### Deferred (recurring asks we have NOT shipped)

- [0017 — React fiber component lineage on resource_load](0017-deferred-react-fiber-component-lineage.md)
- [0018 — Server-log correlation for /api/* errors](0018-deferred-server-log-correlation.md)
- [0019 — Sourcemap-aware stack-trace resolution](0019-deferred-sourcemap-aware-stack-traces.md)
- [0020 — Firestore rules-trace plugin](0020-deferred-firestore-rules-trace.md)
