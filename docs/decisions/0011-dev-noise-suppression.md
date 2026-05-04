# 0011 — Dev-noise suppression (Next dev-overlay clicks + first-compile slow_request)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.0

## Context

Two debugging sessions reported pollution from dev-only noise:

1. Clicks on Next.js's dev error overlay ("Try again" button etc.) showed up as user-action breadcrumbs. The overlay only appears *after* an error, so its clicks pollute the breadcrumb trail right when you most need a clean trail.

2. `[performance] slow_request 7297ms` for the first GET to a route after a fresh `next dev` start. That's almost always a JIT compile, not an app-level performance issue — but it fired a breadcrumb every time.

## Decision

1. **Suppress clicks inside the Next dev error overlay.** In `clickHook.js`, `event.target.closest('nextjs-portal, [data-nextjs-dialog-overlay], [data-nextjs-toast], [data-nextjs-error-overlay]')` returns true → drop the breadcrumb. Covers both the legacy iframe-portal overlay and the modern in-tree overlay.

2. **Suppress the FIRST slow_request per URL per session.** In `networkHook.js`, a `_firstSeenUrls` Set tracks unique URLs hit; the first slow hit for any URL in the session does not fire `performance.slow_request`. Subsequent slow hits to the same URL still fire normally.

## Reasoning

- Both rules are heuristics that dev-mode-only behaviors aren't true app problems. Both are conservative — they suppress only known-noisy patterns, not the actionable signal.
- First-occurrence suppression vs. blanket dev-mode suppression: per-URL-once is more precise. A genuinely slow API call hit twice in a session still surfaces.
- The Next overlay selector list will need maintenance as Next evolves; that's acceptable cost.

## Trade-offs / what we explicitly didn't do

- We did NOT add a config option to disable these heuristics. They're correct in the typical case; if a consumer wants the noise back they can hook `_addBreadcrumb` directly.
- We did NOT raise the global `slowRequestThreshold` for cold compiles. Per-URL-once is more targeted.
- We did NOT extend dev-overlay click suppression to other dev tools (React DevTools, Redux DevTools). They render in iframes/separate windows and don't trigger our handler.

## Subsequent feedback

- None contradicting. Dev noise reports have stopped.
