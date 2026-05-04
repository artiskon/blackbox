# BlackBox — Instructions for AI Assistants

This app uses BlackBox for dev-time error monitoring. Follow these instructions exactly.

## Step 0: Read these files BEFORE doing anything

You MUST read these files to understand the current BlackBox setup. Do not skip this step — misconfigurations are silent and hard to catch later.

1. **`package.json`** — check if `@artiskon/blackbox` is in dependencies and if `bb:check`/`bb:clear` scripts exist
2. **Root layout file** (e.g., `src/app/layout.tsx`) — check if `BlackBoxInit`, `BlackBoxProviderWrapper`, and `BlackBoxPanelWrapper` are included
3. **BlackBoxInit component** (e.g., `src/components/BlackBoxInit.tsx`) — check if `blackbox.init()` is called with BOTH `db` and `firestoreFns`
4. **Firebase config file** (e.g., `src/lib/firebase.ts`) — check that the Firestore `db` instance exists and is exported
5. **`dev-logs/blackbox.json`** — if it exists, read it. It contains the last `bb:check` output with persisted errors
6. **`.firebaserc`** — check which Firebase project is active
7. **`firestore.rules`** — check that `__blackbox` collection has read/write rules
8. **`firestore.indexes.json`** — check that the required composite indexes are defined

If any of these files are missing or misconfigured, fix them before debugging.

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
import { collection, addDoc, updateDoc, deleteDoc, query, where, limit, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';

blackbox.init({
  enabled: true,
  db,
  firestoreFns: { collection, addDoc, updateDoc, deleteDoc, query, where, limit, getDocs, serverTimestamp, Timestamp }
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
  "bb:clear": "bb-clear",
  "bb:ack": "bb-ack"
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
- `npm run bb:check -- --id <fingerprint>` — deep dive into one error (full stack, breadcrumbs, headers)
- `npm run bb:check -- --new` — only errors since last check
- `npm run bb:check -- --path=/admin/foo` — filter by path substring
- `npm run bb:check -- --source=storage` — filter by source (`network`, `storage`, `firebase`, `console.error`, `resource_load`, etc.)
- `npm run bb:check -- --since=1h` — last hour (also `30s`, `5m`, `2h`, `7d`)
- `npm run bb:check -- --include-internal` — show framework-internal errors (react-dom warnings, Next chunks). Hidden by default

The output also includes a `correlations` block. Pay attention to:
- `same_path_session` — same page + same session, likely one flow
- `multi_path` — same fingerprint on multiple routes
- `url_host_cluster` — multiple fingerprints all hitting the same hostname (almost always ONE upstream root cause)

If the user shares a diagnostic report JSON (from the panel's copy button), use that instead. The report contains deduplicated errors, a chronological breadcrumb trail, suspicious silences, and health data.

## Step 4: Fix errors

When fixing errors found by BlackBox:
- Errors with high `occurrences` are systemic — fix those first. Also check `uniqueUserCount` to tell one-user bugs from everyone-bugs
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash
- Errors sharing the same page path + session are likely related (one root cause). Look at the `correlations` block in the report for cross-error grouping
- `resource_load` errors include `urlReachability`: `'ok'` (server returned 2xx — failure was image decode/CORS during render), `'http_error'` (server returned 4xx/5xx — see `httpStatus`), `'opaque_response'` (reachable but status couldn't be read client-side — check the Network tab for the real status), `'unreachable_origin'` (DNS / TLS / connection refused — hostname is dead). Probes also capture `responseHeaders` (cf-ray, content-type, etc.) and `responseBodyPreview` (first 200 bytes)
- `console.error` errors from Firebase include `context.code` (e.g., `permission-denied`, `not-found`). If the error came through `bbOnSnapshot`/`bbFirestoreOp`/`bbWrapWrites`, it also has `queryPath`, `queryFilters`, or `documentPath`
- Errors with `lastSeenSessionId` different from current session may be stale. Compare `metadata.buildSha` to current commit to confirm
- Errors with `internal: true` had a stack of only framework frames — usually framework warnings, not app bugs. Ignore unless `--include-internal` shows they're spiking

## Step 5: After fixing, verify

```bash
npm run bb:check -- --new
```

If no new errors appear, the fix worked. Then clean up:
```bash
npm run bb:clear -- --fingerprint <hash>   # clear specific fixed error
npm run bb:clear                            # clear errors older than 1 day
# (bb:check itself silently drops docs >7d at the start of each run)
```

If an error is **expected** (e.g. waiting on the user to add a Cloudflare scope) and you want to suppress it from triage without deleting it:
```bash
npm run bb:ack <fingerprint> -- --comment "waiting on CF scope" --for 7d
npm run bb:ack -- --list                       # show muted fingerprints
npm run bb:ack <fingerprint> -- --clear        # remove the mute early
```
The mute auto-expires after the TTL.

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
- Network failures (4xx/5xx) with duration, request/response body preview, and Cloudflare/nginx error-page detection
- Resource load failures (images/scripts/video) with `urlReachability` classification, status probe, allowlisted response headers (cf-ray, content-type, content-length, x-amz-request-id, etc.), and a body preview
- Storage failures (R2 / S3 / GCS) with `source: 'storage'` when fetched through `bbR2Fetch`
- Firebase/Firestore errors with error code, document path, and (for queries via `bbOnSnapshot`/`bbFirestoreOp`) auto-extracted query path + filters
- Silent Firestore write failures (when wrapped via `bbWrapWrites`) including permission-denied that was never `.catch`'d
- React component crashes via error boundary
- Breadcrumbs: clicks (with data-bb attributes), navigation, network, forms, custom logs
- Suspicious silences: buttons clicked with no followup action
- Slow requests (> 3s; first occurrence per URL is suppressed in dev to ignore Next cold compiles)

Helpers (import from `@artiskon/blackbox`; all SSR-safe — root entry has no `'use client'` directive as of v1.9.1):
- `bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc })` — auto-track silent Firestore write rejections; returns passthrough on the server, real instrumentation on the client. Safe to call at module top in shared client/server services
- `bbR2Fetch(url, init, { description, bucket, key })` — tag object-storage fetches as `source: 'storage'`
- `bbOnSnapshot(query, onNext, onError, { description })` — Firestore listener with auto query-path extraction
- `bbFirestoreOp(name, promise, { path, queryRef, queryDescription })` — wrap one-off Firestore ops
- `bbTrackAuth(auth)` — Firebase Auth state-change breadcrumbs
- `blackbox.setUser({ id, role })` — attribute errors to a user (drives `uniqueUserCount`)
- `blackbox.setEnvironment(env)` / `blackbox.setTag(k, v)` — context tagging

Components (import from `@artiskon/blackbox/components` — this subpath carries `'use client'`):
- `BlackBoxPanel` — floating debug panel
- `BlackBoxProvider` — error-boundary wrapper

Config options (pass to `blackbox.init()`):
- `errorExcludePatterns: ['fbcdn.net']` — suppress known errors by message substring
- `consoleIgnorePatterns: [...]` — drop noisy console messages
- `networkExcludePatterns: [...]` — skip URLs from network tracking
- `sanitize: (breadcrumb) => breadcrumb` — redact breadcrumbs before storage
- `buildSha` — deploy identifier (auto-detected from common host env vars; surfaces in `bb-check`)
- `nodeEnv` — override for `process.env.NODE_ENV` (auto-detected; rarely needed)
- `tags: { env: 'dev' }` — arbitrary metadata on every doc

Panel: click the BB badge (bottom-right) or press Ctrl+Shift+B. Copy button in panel header produces a compact JSON diagnostic report. Internal errors are hidden by default with a toggle to reveal.
