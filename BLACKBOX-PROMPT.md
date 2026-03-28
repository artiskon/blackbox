# BlackBox — Instructions for AI Assistants

This app uses BlackBox for dev-time error monitoring. Follow these instructions exactly.

## Step 1: Check if BlackBox is installed

Look for `@artiskon/blackbox` in `package.json` dependencies. If missing:

```bash
npm install github:artiskon/blackbox
```

## Step 2: Check if BlackBox is set up

Look for a BlackBox init call in the app (usually in a component or layout). It must have `db` AND `firestoreFns`:

```tsx
import blackbox from '@artiskon/blackbox';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, query, where, limit, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';

blackbox.init({
  enabled: true,
  db,
  firestoreFns: { collection, addDoc, updateDoc, query, where, limit, getDocs, serverTimestamp, Timestamp }
});
```

If `firestoreFns` is missing, add it. Without it, errors won't persist to Firestore.

The app also needs these components in the root layout:
- `BlackBoxInit` — calls `blackbox.init()` in a useEffect
- `BlackBoxProviderWrapper` — React error boundary that captures crashes
- `BlackBoxPanelWrapper` — the floating debug panel

Check `package.json` for these scripts. If missing, add them:
```json
{
  "bb:check": "bb-check",
  "bb:health": "bb-health",
  "bb:timeline": "bb-timeline",
  "bb:clear": "bb-clear"
}
```

## Step 3: Before debugging anything, check BlackBox

Run this FIRST:
```bash
npm run bb:check
```

This pulls persisted errors from Firestore grouped by fingerprint. Read the output — it tells you what's broken, how often, and when it was last seen.

Useful flags:
- `npm run bb:check -- --verbose` — full messages, paths, context
- `npm run bb:check -- --id <fingerprint>` — deep dive into one error
- `npm run bb:check -- --new` — only errors since last check

If the user shares a diagnostic report JSON (from the panel's copy button), use that instead. The report contains deduplicated errors, a chronological breadcrumb trail, suspicious silences, and health data.

## Step 4: Fix errors

When fixing errors found by BlackBox:
- Errors with high `occurrences` are systemic — fix those first
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash
- Errors sharing the same page path + session are likely related (one root cause)
- `resource_load` errors include `httpStatus` when available (404 = missing file, 0 = unreachable/CORS)
- `console.error` errors from Firebase include `context.code` (e.g., `permission-denied`, `not-found`)
- Errors with `lastSeenSessionId` different from current session may be stale

## Step 5: After fixing, verify

```bash
npm run bb:check -- --new
```

If no new errors appear, the fix worked. Then clean up:
```bash
npm run bb:clear -- --fingerprint <hash>   # clear specific fixed error
npm run bb:clear                            # clear errors older than 1 day
```

## Step 6: Give feedback on BlackBox

After debugging, answer these questions honestly:

1. What information was MISSING from BB's error data that forced you to read source code, check logs, or guess?
2. What was captured but USELESS (noise that made it harder to find the real issue)?
3. What took multiple steps that should have been one step?
4. Were there errors that were obviously related but BB treated as separate issues?
5. Did the breadcrumb trail actually lead you to the root cause, or did you solve it another way?
6. What would have turned a 10-minute investigation into a 10-second diagnosis?
7. What else did you notice — patterns, frustrations, or ideas — that the questions above didn't cover? No limits here.

Be specific — name the exact fields, endpoints, or error messages. Don't suggest features in the abstract. Describe what you needed in the moment you needed it. Format: bullet points, grouped by the error/issue you were debugging. Include the BB fingerprint or error message so the BB dev team can trace it.

## Reference

What BlackBox captures:
- JS errors (window.onerror), console.error, unhandled promise rejections
- Network failures (4xx/5xx) with duration
- Resource load failures (images/scripts/video) with HTTP status probe
- Firebase/Firestore errors with error code and document path
- React component crashes via error boundary
- Breadcrumbs: clicks (with data-bb attributes), navigation, network, forms, custom logs
- Suspicious silences: buttons clicked with no followup action
- Slow requests (> 3s)

Config options:
- `errorExcludePatterns: ['fbcdn.net']` — suppress known errors by message substring
- `consoleIgnorePatterns: [...]` — drop noisy console messages
- `networkExcludePatterns: [...]` — skip URLs from network tracking
- `sanitize: (breadcrumb) => breadcrumb` — redact breadcrumbs before storage

Panel: click the BB badge (bottom-right) or press Ctrl+Shift+B. Copy button in panel header produces a compact JSON diagnostic report.
