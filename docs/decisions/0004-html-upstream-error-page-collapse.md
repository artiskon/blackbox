# 0004 — HTML upstream error page collapse

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0

## Context

A debugging session captured a `DELETE 502` on `/api/cf/zones/.../delete`. The network hook dutifully captured the full HTML response body — 4 KB of Cloudflare's `<!DOCTYPE html>... cf-error-details ... Cloudflare Ray ID ... [if lt IE 7]...` boilerplate. The actual signal (status 502 served by Cloudflare's edge, not the origin) was buried under noise. The dev had to manually scroll past the HTML to find the diagnostic detail in `<title>`.

## Decision

In the network hook, after capturing a non-2xx responseBody, run `classifyHtmlErrorPage(text, status)`:

- Returns `{ kind: 'cloudflare_error_page', summary }` if the body matches Cloudflare's distinctive markers (`cf-error-details`, `cloudflare-static`, `cloudflare.com/5xx-error-landing`, `<title>...|Cloudflare`, or "Cloudflare Ray ID" within first 8 KB)
- Returns `{ kind: 'nginx_error_page', summary }` if it matches nginx's `<center><h1>NNN ...</h1>` + `nginx` signature
- Returns `{ kind: 'html_error_page', summary }` for any other 5xx HTML body
- Returns `null` if the body looks like JSON / a normal API response — keep it verbatim

When classified, the responseBody is replaced with `[Cloudflare 502 page — Bad gateway]` (or equivalent) and `responseBodyKind` is set on the error context.

## Reasoning

- These error pages are noise *because* they're a known shape. Detecting that shape and keeping the title (which is the actual one-line signal) is high-leverage.
- We chose to *replace* the body, not augment it (e.g. body + summary). Privileges signal over completeness — the dev never wants the raw 4 KB.
- The 200-char minimum body length filter prevents tiny JSON `{"error":"x"}` bodies from being mistaken for HTML pages.

## Trade-offs / what we explicitly didn't do

- We did NOT build a generic HTML-vs-JSON discriminator. Only the three known patterns are caught. Other upstream patterns (Akamai, Fastly, AWS Cloudfront) would need explicit additions.
- We did NOT preserve the original body on a side field. If the dev needs the full HTML, they can re-fetch the URL with curl. Acceptable given the reduction in report size.
- We did NOT report Ray IDs as a structured field. The summary captures the title; a future ADR could add per-vendor structured headers.

## Subsequent feedback

- BB-1.8 agent re-asked for "response body for failed network/resource loads". The body is captured (via `maxErrorBodyLength`); this ADR governs collapse, not capture. Both behaviors are independent and simultaneous.
