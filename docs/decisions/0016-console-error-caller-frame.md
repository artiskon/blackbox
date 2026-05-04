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

- None yet. Should noticeably improve console.error triage in the typical case.
