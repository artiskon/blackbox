# 0002 — Build-aware error tracking

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.8.0

## Context

A debugging session described 5 minutes spent grepping `git log` to figure out whether old errors were still active or had been fixed in the most recent deploy. The agent wrote: *"a 'fresh vs stale' indicator. I had to manually compare each error's lastSeen timestamp to the git log to figure out: were these errors STILL happening, or were they all from before commit 4751e09 which presumably fixed them?"*

## Decision

Every error doc's `metadata` carries `buildSha` and `nodeEnv`. Auto-detected at `init()` time from common host env vars (priority order):

- `process.env.NEXT_PUBLIC_BUILD_SHA`
- `process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`
- `process.env.VERCEL_GIT_COMMIT_SHA`
- `process.env.NETLIFY_COMMIT_REF`
- `process.env.GITHUB_SHA`

`nodeEnv` defaults to `process.env.NODE_ENV`. Both are overridable via explicit `init({ buildSha, nodeEnv })`. bb-check surfaces them in the sessionInfo banner.

## Reasoning

- The dev's actual question is "is this fresh or fixed?" — the answer requires comparing the error's build to the current build. Capturing the build SHA at write time is the cheapest way to make the answer one field-lookup away.
- Auto-detection from common env vars covers ~95% of consumers without requiring config. Explicit override handles the rest.
- We chose `buildSha` (not `version` or `release`) because git SHA is the unambiguous canonical reference; semver versions can be ambiguous on monorepos / multi-deploy-per-version setups.

## Trade-offs / what we explicitly didn't do

- We did NOT compute `staleSinceCommit` (i.e. "this fingerprint last fired on build X; current build is Y, so it's fixed"). Requires the dev tool to know the current build, which would be runtime-only (not available in bb-check at all). Deferred — see ADR-0019 for related discussion.
- We did NOT add a 7-day trend sparkline per fingerprint. Repeated ask but represents enough net-new aggregation logic to deserve its own scope.
- We did NOT auto-detect from `git rev-parse HEAD` at init time. That requires shelling out from the browser, which doesn't work; it's pre-build's job.

## Subsequent feedback

- None directly contradicting. Multiple agents have positively cited the sessionInfo banner.
