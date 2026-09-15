# 0030 — Network body capture defaults and request-body redaction

- **Status:** Active
- **Date:** 2026-09-13
- **Version:** unreleased (after 1.9.5)

## Context

An audit found the README and `index.d.ts` promising that request/response bodies "are never stored unless explicitly enabled" (`captureRequestBodies: false`). The network hook actually stored bodies by default:

- same-origin POST/PUT/PATCH request bodies on every network breadcrumb (300 chars),
- the request body of every failed request, for any host, on the error context,
- the response body of every non-2xx response, for any host.

So login forms (`{"email":..,"password":..}`) and token refreshes reached Firestore on the first 4xx. Bodies are also some of the highest-signal fields BlackBox has (an `{"error":"URL not allowed"}` response names the cause instantly; the request body shows a missing `projectId`), which is why they were captured in the first place.

## Decision

Keep capturing bodies by default, make the default honest, and redact secrets:

1. **Request bodies, default:** same-origin POST/PUT/PATCH bodies on breadcrumbs (first 300 chars, or `maxBodyLength`), and same-origin failed-request bodies on the error context (up to `maxErrorBodyLength`). Cross-origin request bodies are not captured by default (external APIs often carry keys in the body).
2. **`captureRequestBodies: true`** extends request-body capture to cross-origin hosts and all methods, for both breadcrumbs and error context.
3. **Redaction:** before storage, values of keys matching password/passcode, token, secret, authoriz(ation), api key in JSON bodies and form-encoded bodies are replaced with `[redacted]`. `FormData` bodies record key names only.
4. **Response bodies** of non-2xx responses stay captured for any host (the error body is the signal; ADR-0004 collapses HTML error pages). They are not redacted.
5. Same rules for `fetch` and `XMLHttpRequest`. A body that lives only on a `Request` object (not in `init`) is not captured, because reading it would consume the app's stream.

Docs (README privacy table, `index.d.ts`, CLAUDEMD-SNIPPET) describe exactly this.

## Reasoning

- Turning body capture off by default would remove the field agents cite most for same-origin API errors. Fixing the promise and redacting the dangerous keys keeps the signal and closes the leak.
- Same-origin vs cross-origin is a real origin comparison (`new URL(url, location.href).origin`), not a string prefix, so `//other.com/x` or `https://app.com.evil.net` can't pass as same-origin.
- Key-name redaction is cheap, predictable and covers the common cases (login, OAuth refresh, API-key payloads) without parsing arbitrary formats.

## Trade-offs / what we explicitly didn't do

- We did NOT redact response bodies. An error response echoing a token is rare; redacting would cost signal on every error body. Use `sanitize` or `networkExcludePatterns` for endpoints that do.
- Redaction is key-name based: a secret under an unrelated key name (`{"value": "sk_live_..."}`) is not caught. `sanitize` remains the escape hatch.
- The key text around the keyword is bounded to 40 chars on each side, so a key name longer than that (`"<41+ chars>token"`) is not redacted. An unbounded match backtracked quadratically on large bodies that mention "token"/"password" often (a 160KB AI-chat POST took ~1s, synchronously, before the app got its response); bounded, redaction stays linear and still covers the whole body, not just the stored prefix.
- We did NOT add a separate `captureResponseBodies` switch. Revisit if a consumer needs response bodies off.
- `securetoken.googleapis.com` (Firebase Auth token refresh) was added to the default `networkExcludePatterns`, so refresh tokens aren't captured at all, alongside the existing `identitytoolkit.googleapis.com`.

## Subsequent feedback

- None yet. Related: ADR-0004 (error-page collapse and body read timing), ADR-0021 (underscore-prefixed ephemeral keys).
