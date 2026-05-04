# 0007 — `urlReachability` classification on resource_load (supersedes original `cors_blocked` label)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.0 (label `opaque_response` introduced; supersedes 1.8.0's `cors_blocked` label)

## Context

v1.8.0 introduced a probe step in `resourceHook.js`: when an `<img>` / `<script>` etc. fired an error event, BlackBox would HEAD the URL to classify it. The original labels were:

- `ok` (2xx/3xx)
- `http_error` (4xx/5xx with status)
- `cors_blocked` (cors HEAD failed → no-cors HEAD succeeded)
- `unreachable_origin` (both HEAD attempts failed)

**The `cors_blocked` label was wrong** any time the actual response was a 4xx served *without* CORS headers — both branches collapse: cors HEAD fails (because 4xx + no `Access-Control-Allow-Origin` is a CORS-style error to the browser), and no-cors HEAD succeeds (opaque responses don't enforce CORS). Two debugging sessions (BB-1.8) burned ~20 min total chasing imaginary CORS problems before the dev gave up and curled the URL.

## Decision

v1.9.0 renamed `cors_blocked` → `opaque_response` with a clearer hint: `statusHint: 'reachable_but_status_unknown_check_network_tab'`. v1.9.0 also upgraded the cors HEAD to a Range GET so we capture status + key response headers + a 200-byte body preview when CORS allows it. The full label set is now:

- `ok` — 2xx/3xx
- `http_error` — 4xx/5xx with `httpStatus`
- `tag_content_type_mismatch` — 200 OK but body is the wrong KIND for the tag (added in 1.9.2; see ADR-0013)
- `opaque_response` — reachable but client-side cannot read the status (could be CORS, could be a plain 4xx without CORS headers — *we do not know*, hence the honest label)
- `unreachable_origin` — DNS / TLS / connection refused
- `unknown` — could not probe (data: URL, relative, no fetch)

## Reasoning

- **Honest "I don't know" beats confident wrong guesses.** The original `cors_blocked` was a confident wrong guess that misled real debugging sessions. The new label reflects the actual epistemic state of the classifier.
- We considered making the label `cors_or_4xx` to be more concrete, but `opaque_response` is the correct technical term (matches the Fetch spec) and the hint says what to do.
- The Range GET upgrade (instead of HEAD) was layered in because if we *can* get a body, the body preview + content-type from headers is what unlocks ADR-0013 (tag mismatch detection) and removes manual `curl -I` from every failed-image investigation.

## Trade-offs / what we explicitly didn't do

- We did NOT do server-side probing through a proxy to disambiguate `opaque_response` further. That would need infrastructure the CDN doesn't usually have.
- We did NOT cache probe results across errors. Each resource error fires its own probe — minor cost, but avoids stale-cache footguns when the upstream changes.
- We did NOT add a `urlReachability: 'cors_blocked'` value (true CORS, definitively). Browsers don't expose enough info to be confident; we'd be back where we started.

## Subsequent feedback

- BB-1.8 agent (acted on in v1.9.2 batch) re-cited misleading `cors_blocked`. That was on a runtime predating this decision; confirmed shipped fix.
- **If a future agent asks to "rename `opaque_response` back to `cors_blocked`" or "remove the verbose hint":** check this ADR first. The wrong-confident label was actively misleading; reverting requires a stronger justification than "the new label is verbose".
