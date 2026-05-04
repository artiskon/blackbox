# 0012 — Per-entry `'use client'` directive (banner removed; components dropped from root re-export)

- **Status:** Active
- **Date:** 2026-05-04
- **Version:** 1.9.1

## Context

v1.9.0's `bbWrapWrites` was unimportable from Next.js App Router server route handlers. Any `app/api/*/route.ts` transitively reaching the helper threw "Attempted to call bbWrapWrites() from the server" during page-data collection. Root cause: tsup's `banner: { js: "'use client'" }` config slapped the directive on every dist entry, including `firebase.js`, `storage.js`, and the root `index.js` — all of which contain SSR-safe code.

## Decision

1. **Removed the global tsup banner.** `'use client'` directives now live in source files that genuinely need them: `src/components/BlackBoxPanel.js`, `src/components/BlackBoxProvider.js`, `src/components/index.js` (added in v1.9.1).

2. **Removed `BlackBoxPanel` / `BlackBoxProvider` from the root re-export** (`src/index.js`). The root entry no longer carries `'use client'`; if components were re-exported from it, server consumers could import them from the root without the client boundary, silently bundling client-only code server-side.

3. The documented import path for components has always been `@artiskon/blackbox/components` (which carries the directive). The root is reserved for the singleton + SSR-safe helpers.

## Reasoning

- Per-entry directives is the correct shape: the directive is a per-module statement in the React Server Components spec, not a per-package one. tsup's blanket banner was wrong by construction.
- Removing components from the root re-export was preferable to keeping them and accepting silent server-bundling. Loud breakage > silent corruption.
- This is technically a breaking change for any consumer who imported components from the root — but the README documented the subpath since the package's first release. Effective surface affected: zero (verified against the test harness and the user's main app).

## Trade-offs / what we explicitly didn't do

- We did NOT make the root entry `'use client'` instead of removing components. That would have re-broken the SSR import of helpers — same bug, different shape.
- We did NOT add a runtime warning when consumers try to import components from the root. The TypeScript types never re-exported them either, so consumers who used the root were already opted out at the type level.
- We did NOT split firebase helpers into separate per-helper subpaths. The single `./firebase` subpath plus the root re-export covers all use cases without further fragmentation.

## Subsequent feedback

- The agent who reported the v1.9.0 server-import bug confirmed v1.9.1 unblocked them.
- **If a future agent asks to "re-add the global 'use client' banner because import errors are happening":** check this ADR first. The banner caused the import errors it claims to fix.
