# 0006 — bbR2Fetch as a separate `source: 'storage'` label

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.1

## Context

The user moved from Firebase Storage to Cloudflare R2. Object-storage failures look exactly like generic network failures in BlackBox (both fire through the network hook with `source: 'network'`), so they get buried in API noise. The dev wanted a way to filter "show me only storage failures" without adding a URL pattern allowlist.

## Decision

New helper `bbR2Fetch(input, init, { description, bucket, key })` exported from `@artiskon/blackbox` and `@artiskon/blackbox/storage`. It:

1. Uses `blackbox._getNativeFetch()` (not `window.fetch`) so the network hook doesn't double-record.
2. Records breadcrumbs with `source: 'storage'` (panel renders sky-blue badge).
3. Surfaces `description`, `bucket`, `key` in the error context so signed-URL failures aren't opaque.
4. Pairs with `bb-check --source=storage` to filter.

Despite the name, it's vendor-neutral — works for S3, GCS, Azure Blob, anything fetched via signed URL.

## Reasoning

- A separate source is a one-line filter for the dev. Forcing them to grep network errors by URL pattern is friction.
- Native-fetch usage prevents the double-record / double-error problem. The network hook would otherwise record the same failure twice with different sources.
- We chose to keep the `description / bucket / key` triple because they're the three fields a dev typically needs: what kind of operation, which bucket, which key. None reveal the URL's signing token (already stripped via `_stripQueryParams`).

## Trade-offs / what we explicitly didn't do

- We did NOT auto-detect R2 / S3 URLs in the network hook and reclassify. Detection is brittle (custom domains over R2 are common) and changes existing-network-error behavior on apps that haven't opted in.
- We did NOT add an `bbR2Upload` helper for multipart-progress tracking. Progress events are a different problem (XHR vs fetch); keep scope tight.
- We did NOT mirror Firebase Storage's API shape. Different vendor, different ergonomics; thin wrapper is enough.

## Subsequent feedback

- None directly. Successfully exercised in the test harness.
- v1.9.1 fixed an unrelated SSR import problem that affected `bbR2Fetch` along with `bbWrapWrites` (see ADR-0012).
