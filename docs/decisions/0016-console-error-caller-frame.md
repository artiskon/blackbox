# 0016 — Caller frame on bare `console.error`

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.2

## Context

A BB-1.8 debugging session described spending 5 minutes grepping the codebase to find what called a bare `console.error("Missing or insufficient permissions")`. The error message had no Error object, no prefix, no service-name marker. The agent had to grep for the literal string to find the caller (`mediaLibraryService.ts:746`).

The console hook *was* capturing `new Error().stack` synthetically at call time (line 62 of `consoleHook.js`) — but the stack was just the BB wrapper chain, never surfaced as a structured field, so the agent never noticed it.

## Decision

In `consoleHook.js`'s `bbHandleError`, after the synthetic stack is captured, run it through `extractTopAppFrame(stack)` (the same helper used by fingerprinting in `fingerprint.js`). The first non-framework / non-BB frame is surfaced as `context.callerFrame` (max 200 chars).

Required exporting `extractTopAppFrame` from `fingerprint.js` (was previously file-local).

## Reasoning

- The existing synthetic stack capture was solving the wrong half of the problem: it captured the data, but didn't extract the diagnostic field. The dev shouldn't have to read raw stacks to find a call site.
- Reusing `extractTopAppFrame` (which already powers fingerprinting's "skip framework noise" logic) keeps the filter consistent between the fingerprint and the surfaced frame — same definition of "app code" everywhere.
- We chose to surface as `context.callerFrame` (separate field) rather than amending the message, because the message is for grouping / display, not for identification metadata.

## Trade-offs / what we explicitly didn't do

- We did NOT walk multiple frames and surface a stack array. The first app frame is the one the dev needs in the typical case; if they need more they can read `stack`.
- We did NOT extend this to `console.warn`. Warnings are less commonly bare and less commonly debugged; can add later.
- We did NOT add caller-frame extraction to `_recordError` directly (i.e. for all errors). Errors with real Error objects already have stacks; the synthetic-stack case is unique to console.error.

## Subsequent feedback

- **v1.9.3 (bug fix):** the v1.9.2 dogfood session showed `context.callerFrame` was never populated under Next.js dev mode. Root cause: `SKIP_FRAMES_RE` in `fingerprint.js` matched a bare `webpack` token, but in Next dev mode every frame (including app code) carries the `webpack-internal:///` prefix. Result: `extractTopAppFrame` skipped *all* frames and returned empty. Fix: removed the bare `webpack` alternation. Framework code under that prefix is still caught by the `node_modules` token (e.g. `webpack-internal:///(app-pages-browser)/./node_modules/next/...`); webpack runtime functions are still caught by `__webpack`. App code at `webpack-internal:///(app-pages-browser)/./src/...` now correctly survives the filter and lands in `context.callerFrame`.
- **v1.9.4 (additive):** `extractTopAppFrame` is now also applied to `bbWrapWrites` and `bbFirestoreOp` errors, surfaced as `context.callerFrame` on the recorded `source: 'firebase'` error. The stack snapshot is taken synchronously in the wrapper BEFORE the SDK call so the app frame survives the await/microtask boundary — `error.stack` after rejection contains only Firebase internal frames. The "we did NOT add caller-frame extraction to `_recordError` directly" trade-off above still holds; this is a wrapper-level extension, not a global one. Driven by a v1.9.3 dogfood session where the agent had to grep `handleSave` to find the call site.
