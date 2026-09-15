# BlackBox — Instructions for AI Assistants

This app uses BlackBox for dev-time error monitoring. Follow these instructions exactly.

## Step 0: Read these files BEFORE doing anything

You MUST read these files to understand the current BlackBox setup. Do not skip this step — misconfigurations are silent and hard to catch later.

1. **`package.json`** — check if `@artiskon/blackbox` is in dependencies and if `bb:check`/`bb:clear` scripts exist
2. **Root layout file** (e.g., `src/app/layout.tsx`) — check if `BlackBoxInit`, `BlackBoxProviderWrapper`, and `BlackBoxPanelWrapper` are included, with the panel rendered as a sibling AFTER the provider, not inside it (a render crash replaces the provider's children, which would unmount a nested panel)
3. **BlackBoxInit component** (e.g., `src/components/BlackBoxInit.tsx`) — check if `blackbox.init()` is called with BOTH `db` and `firestoreFns`
4. **Firebase config file** (e.g., `src/lib/firebase.ts`) — check that the Firestore `db` instance exists and is exported
5. **`dev-logs/blackbox.json`** — if it exists, read it. It contains the last `bb:check` output with persisted errors
6. **`.firebaserc`** — check which Firebase project is active
7. **`firestore.rules`** — check that the app's client can write to the `__blackbox` collection (the browser persists errors there, and the panel's History/Health tabs read it). The `bb-*` CLIs normally read with Firebase Admin credentials, which bypass rules: never open rules to make the CLI work
8. **`firestore.indexes.json`** — check that the required composite indexes are defined

If any of these files are missing or misconfigured, fix them before debugging.

## Step 1: Check if BlackBox is installed

Look for `@artiskon/blackbox` in `package.json` dependencies. If missing:

```bash
# latest (HEAD of main)
npm install github:artiskon/blackbox

# or pin to a specific release tag (v1.9.4 onward are tagged)
npm install github:artiskon/blackbox#v1.9.5
```

## Step 2: Check if BlackBox is set up

Look for a BlackBox init call in the app (usually in a component or layout). It must have `db` AND `firestoreFns`:

```tsx
import blackbox from '@artiskon/blackbox';
import { db } from '@/lib/firebase';
import { collection, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, getDocs, increment, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';

blackbox.init({
  enabled: true,
  db,
  firestoreFns: { collection, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, getDocs, increment, onSnapshot, serverTimestamp, Timestamp }
});
```

If `firestoreFns` is missing, add it. Without it, errors won't persist to Firestore. `increment` makes occurrence counts atomic across tabs, `orderBy` lets the panel's History/Health/Timeline queries use the documented indexes, and `onSnapshot` makes `bbOnSnapshot` use the app's SDK copy (older lists without them still work, with fallbacks: without `orderBy` the panel Health tab counts errors first seen in 24h rather than seen, and Timeline misses re-fires of older errors).

The app also needs these components in the root layout:
- `BlackBoxInit` — calls `blackbox.init()` in a useEffect
- `BlackBoxProviderWrapper` — React error boundary that captures crashes (recorded as `source: 'react_boundary'`)
- `BlackBoxPanelWrapper` — the floating debug panel. Render it as a sibling AFTER the provider, never inside it. It renders nothing until `blackbox.init()` has enabled BlackBox

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
- `npm run bb:check -- --new` — only errors seen since the last UNFILTERED `bb:check` (runs with `--path`/`--source`/`--since`/`--status` don't move that baseline)
- `npm run bb:check -- --path=/admin/foo` — filter by path substring
- `npm run bb:check -- --source=storage` — filter by source (`network`, `storage`, `firebase`, `firebase_listener`, `console.error`, `resource_load`, `react_boundary`, `manual`, etc.)
- `npm run bb:check -- --since=1h` — last hour (also `30s`, `5m`, `2h`, `7d`; other units like `1w` are rejected)
- `npm run bb:check -- --status=404` — filter by HTTP status (against `context.httpStatus`/`context.status`)
- `npm run bb:check -- --include-internal` — show framework-internal errors (react-dom warnings, Next chunks). Hidden by default
- `npm run bb:check -- --help` — every `bb-*` command supports `--help`. `--flag value` and `--flag=value` both work; unknown flags or malformed values exit 1 with usage instead of being silently ignored

`bb:check` also deletes docs not seen in 7 days and activity docs past their 48h `expireAt` at the start of each run (not with `--id`). `bb:health` covers errors seen (`lastSeen`) in the last 24h; its "Total occurrences" are lifetime counts. `bb:timeline -- --minutes N` widens the default 5-minute window.

The output also includes a `correlations` block. Pay attention to:
- `same_path_session` — same page + same session, likely one flow
- `multi_path` — same fingerprint on multiple routes
- `url_host_cluster` — multiple fingerprints all hitting the same hostname (almost always ONE upstream root cause)
- `invalid_argument_cluster` — multiple Firestore-write fingerprints with `Unsupported field value: undefined` across DIFFERENT collections. Fix at the write/service layer (e.g. recursive `stripUndefinedDeep` before every write), not per-collection

If the user shares a diagnostic report JSON (from the panel's copy button), use that instead. The report contains deduplicated errors, a chronological breadcrumb trail, suspicious silences, and health data. Framework-only errors in it carry `internal: true` (a merged group keeps it only if every member is internal). Click breadcrumbs show `text`, or `label` (the synthesized auto-label) when the element had no text.

## Step 4: Fix errors

When fixing errors found by BlackBox:
- Errors with high `occurrences` are systemic — fix those first. Also check `uniqueUserCount` to tell one-user bugs from everyone-bugs
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash
- Errors sharing the same page path + session are likely related (one root cause). Look at the `correlations` block in the report for cross-error grouping
- `resource_load` errors include `urlReachability`: `'ok'` (server returned 2xx — failure was image decode), `'http_error'` (server returned 4xx/5xx — see `httpStatus`), `'tag_content_type_mismatch'` (server returned 200 but the body is the wrong KIND for the host tag — `<img>` got `video/mp4` etc.; see `contentType` and `action_hint`), `'opaque_response'` (reachable but status couldn't be read client-side — check the Network tab), `'unreachable_origin'` (DNS / TLS / connection refused — hostname is dead). Probes also capture `responseHeaders` (cf-ray, content-type, etc.) and `responseBodyPreview` (first 200 bytes). For `next/image` / Vercel optimizer URLs, `context.upstreamSrc` holds the real asset URL and `hostname` is the asset's host (message: `Resource failed to load: img - <upstream> (via /_next/image)`). `emptySrc: true` (with `urlReachability: 'unknown'`, message `<tag> - (empty src)`) means the element was rendered with `src=""`: the URL variable was empty at render time
- `network` errors (fetch AND XMLHttpRequest): cross-origin requests that got no response carry `urlReachability` — `'opaque_response'` (origin reachable, request blocked; CORS is likely, check the Network tab; `preflight_if_cors: { method, headers?, reason? }` says what would trigger a preflight), `'unreachable_origin'` (DNS / refused / offline), or `'unknown'` (the probe got no answer in 2s: origin slow or hung) — plus `statusHint`. Same-origin failures carry neither (they can't be CORS). There is no `cors_blocked` field. XHR failures with no response read `Network error: METHOD url - XHR error` / `XHR timeout`. Intentionally aborted requests are breadcrumbs with `aborted: true`, never error rows. `responseType: 'opaque'`/`'opaqueredirect'` on a breadcrumb means a successful `no-cors` / `redirect: 'manual'` fetch, not a failure
- `unhandled_promise` errors with a non-Error reason carry `context.reasonType` (`'object'`, `'Response'`, `'string'`, `'undefined'`, `'null'`, ...) and `context.code` / `context.status` when the reason had them. A rejected `Response` reads `HTTP <status> <url>`
- `console.error` errors include `context.callerFrame` — the first non-framework JS frame from the call site (e.g. `MediaLibrary.tsx:746:50`). Skips the `console.error` codebase grep step. From Firebase, errors also include `context.code` (e.g., `permission-denied`, `not-found`); if routed through `bbOnSnapshot`/`bbFirestoreOp`/`bbWrapWrites` the message names the collection (`Firestore <op> failed on <collection>: ...`, `Firestore listener error on <collection>: ...`, doc IDs as `:id`) and the context also has `queryPath` (collection-group queries: `**/<collectionId>`), `queryFilters` (field + op only; `or()`/`and()` as `(a == ? or b == ?)`), `documentPath`, `callerFrame` (the app frame that called the wrapped write), and (on permission-denied) an `action_hint` pointing at `firestore.rules`. For `invalid-argument` writes, the context additionally carries `firstUndefinedPath` (the dotted/indexed path within the document, e.g. `sections[5].subtitle`), `payloadShape` (top 2 levels of the payload, type-only — no values; SDK objects show their class name, e.g. `DocumentReference`), `writeFields`, and `undefinedFields`. Jump straight to `firstUndefinedPath` instead of grepping the calling service or writing a wholesale `stripUndefinedDeep`. `bbOnSnapshot could not attach listener ...` (source `firebase_listener`) means the listener never started
- `groupingInputs.topFrame` (what the fingerprint hashed) is normalized: no line numbers, no origin, chunk hashes replaced. For the real line, read `stack` or `context.callerFrame`
- Errors with `lastSeenSessionId` different from current session may be stale. Compare `metadata.buildSha` to current commit to confirm (`metadata.buildSha` / `metadata.nodeEnv` reflect the MOST RECENT occurrence, not the first)
- Errors with `internal: true` had a stack of only framework frames — usually framework warnings, not app bugs. Ignore unless `--include-internal` shows they're spiking

## Step 5: After fixing, verify

```bash
npm run bb:check -- --new
```

If no new errors appear, the fix worked. Then clean up:
```bash
npm run bb:clear -- --fingerprint <hash>   # clear specific fixed error (aliases --fp, --id)
npm run bb:clear                            # clear docs created more than 1 day ago
npm run bb:clear -- --days 3                # ... more than N days ago (N >= 1)
# Options can't be combined; a typo or bad value exits with usage instead of deleting.
# (bb:check itself silently drops docs not seen in 7d, and expired activity docs, at the start of each run)
```

`--new` only counts errors since the last UNFILTERED `bb:check`, so if you ran filtered checks in between, those don't hide anything from it.

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
- Network failures (4xx/5xx and no-response failures) from `fetch` and `XMLHttpRequest` (axios, Firebase Storage SDK) with duration, request/response body preview (secret-looking request-body keys `[redacted]`), and Cloudflare/nginx error-page detection. The network breadcrumb is added as soon as the response arrives (so an app error raised on `!res.ok` has the failing request in its trail); the non-OK error row is recorded after the body preview is read (time-boxed, ~1.5s max), so it can land after that app error. `sendBeacon` and WebSocket are not captured
- Resource load failures (images/scripts/video) with `urlReachability` classification, status probe, allowlisted response headers (cf-ray, content-type, content-length, x-amz-request-id, etc.), and a body preview
- Storage failures (R2 / S3 / GCS) with `source: 'storage'` when fetched through `bbR2Fetch`
- Firebase/Firestore errors with error code, document path, and (for queries via `bbOnSnapshot`/`bbFirestoreOp`) auto-extracted query path + filters
- Silent Firestore write failures (when wrapped via `bbWrapWrites`) including permission-denied that was never `.catch`'d
- For Firestore `invalid-argument` errors (writes through `bbWrapWrites` / `bbFirestoreOp`): `context.firstUndefinedPath` (dotted/indexed path of the first undefined value, e.g. `sections[5].subtitle`), `context.payloadShape` (top 2 levels, type-only), `context.callerFrame` (the app frame that called the wrapped write)
- React component crashes via error boundary (`source: 'react_boundary'`)
- Breadcrumbs: clicks (with data-bb attributes), navigation, network (`aborted: true` for intentional cancels), forms (`blocked: true` when native validation stopped the submit; `form_validation` errors fire for those too), custom logs
- Suspicious silences: buttons clicked with no followup action
- Slow requests (> 3s; first occurrence per URL is suppressed in dev to ignore Next cold compiles)

Helpers (import from `@artiskon/blackbox`; all SSR-safe — root entry has no `'use client'` directive as of v1.9.1):
- `bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc })` — auto-track silent Firestore write rejections; returns passthrough on the server, real instrumentation on the client. Safe to call at module top in shared client/server services. Other functions in the object pass through unchanged
- `bbR2Fetch(url, init, { description, bucket, key })` — tag object-storage fetches as `source: 'storage'` (aborted requests: breadcrumb only)
- `bbOnSnapshot(query, onNext, onError, { description })` — Firestore listener with auto query-path extraction. Uses `init({ firestoreFns: { onSnapshot } })` when provided; an attach failure records a `firebase_listener` error and calls `onError`. Throws inside `onNext`/`onError` are not swallowed
- `bbFirestoreOp(name, promiseOrFn, { path, data, queryRef, queryDescription })` — wrap one-off Firestore ops. For writes pass a function (`() => setDoc(ref, data)`) or use `bbWrapWrites`: the SDK throws invalid-argument synchronously, so an already-created promise can't capture it
- `bbTrackAuth(auth)` — Firebase Auth state-change breadcrumbs
- `blackbox.setUser({ id, role })` — attribute errors to a user (drives `uniqueUserCount`)
- `blackbox.setEnvironment(env)` / `blackbox.setTag(k, v)` — context tagging. Calls made before `init()` (with `setUser`) are applied when `init()` runs; explicit `init()` options win, tags merge
- `blackbox.registerDiagnostic(name, { match, run, timeoutMs })` — pluggable app-defined probe. `match` is a `RegExp` tested against message/url/context.src OR a function `(errorEntry) => boolean`. `run` returns extra context attached to `error.context.diagnostics[name]`. Capped at `timeoutMs` (default 200ms); the error's Firestore write waits for matching probes, so `context.diagnostics` is in `bb-check` output too

Components (import from `@artiskon/blackbox/components` — this subpath carries `'use client'`):
- `BlackBoxPanel` — floating debug panel (render outside `BlackBoxProvider`; renders nothing until `init()` enabled BB)
- `BlackBoxProvider` — error-boundary wrapper

Config options (pass to `blackbox.init()`):
- `errorExcludePatterns: ['fbcdn.net']` — suppress known errors by message substring
- `consoleIgnorePatterns: [...]` — drop noisy console messages (added to the built-in defaults)
- `networkExcludePatterns: [...]` — skip URLs from network tracking (added to the built-in defaults)
- An option passed as `undefined` uses its default
- `sanitize: (breadcrumb) => breadcrumb` — redact breadcrumbs before storage
- `buildSha` — deploy identifier (auto-detected from common host env vars; surfaces in `bb-check`)
- `nodeEnv` — override for `process.env.NODE_ENV` (auto-detected; rarely needed)
- `tags: { env: 'dev' }` — arbitrary metadata on every doc
- `sessionTag` — correlation token persisted as top-level `sessionTag` on new docs, and as `lastSeenSessionTag` on both create and update. Auto-read from `window.__BB_SESSION_TAG__`. Used by audit runners (Playwright / ui-check) to filter `__blackbox` by their own session: `where('lastSeenSessionTag', '==', tag)` finds new and re-fired fingerprints alike
- `failFast` — boolean. When true, BB sets `window.__BB_FAIL_FAST_TRIPPED__` and fires a `blackbox:fail-fast` CustomEvent on the first non-internal error. Auto-on when `window.__BB_FAIL_FAST__` is truthy at init. Never use in real-user sessions

Panel: click the launcher dot (bottom-left corner — 8×8 green when no errors, expands to a 22×22 amber/red number badge when errors arrive, single ripple pulse on each new error) or press Ctrl+Shift+B (Cmd+Shift+B on Mac); Esc closes it (first the report overlay or delete confirm, if open). Copy button in panel header produces a compact JSON diagnostic report. Internal errors are hidden by default with a toggle to reveal. An expanded error row shows the full message, `action_hint` with a clickable `action_url`, and a collapsible "Context (N)" list of the error's context fields. A failed Firestore query (e.g. a missing index) shows a red "Query failed" block with a "Create index" link.
