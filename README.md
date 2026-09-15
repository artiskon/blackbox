# @artiskon/blackbox

Dev-time error monitoring and activity recording for React/Firebase apps. BlackBox captures errors, user actions, and network activity during development and stores structured logs in Firestore. Designed for AI-assisted debugging — every error includes a breadcrumb trail showing exactly what the user did before the crash.

## Quick Start

```bash
# latest (HEAD of main)
npm install github:artiskon/blackbox

# pin to a specific release tag (recommended for reproducible builds)
npm install github:artiskon/blackbox#v1.9.5
```

Release tags are published from `v1.9.4` onward. Older versions live on `main` history but aren't tagged — pin to a commit SHA if you need an earlier point release.

```javascript
import blackbox from '@artiskon/blackbox';
import { BlackBoxProvider, BlackBoxPanel } from '@artiskon/blackbox/components';
import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, getDocs, increment, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';

blackbox.init({
  db,
  firestoreFns: { collection, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit, getDocs, increment, onSnapshot, serverTimestamp, Timestamp }
});

// Optional but recommended: identify the user so uniqueUserCount works
// and you can tell one-user bugs from everyone-bugs. Safe to call before
// init(): the value is applied when init() runs.
blackbox.setUser({ id: currentUser.uid, role: currentUser.role });

function App() {
  return (
    <>
      <BlackBoxProvider>
        {/* your app */}
      </BlackBoxProvider>
      <BlackBoxPanel />
    </>
  );
}
```

- **Render `<BlackBoxPanel />` outside `<BlackBoxProvider>`**, as a sibling. On a render crash the provider replaces all of its children with the fallback, so a panel nested inside it would unmount on exactly the crash you want to inspect.
- **The panel renders nothing until `blackbox.init()` has enabled BlackBox**: no launcher, no Ctrl/Cmd+Shift+B shortcut. With `enabled: false`, or in a production build without `enabled: true`, it is invisible.
- **`firestoreFns`**: `increment` makes occurrence counts atomic across tabs, `orderBy` lets the panel's History/Health/Timeline queries use the indexes below, and `onSnapshot` makes `bbOnSnapshot` use your SDK copy instead of BlackBox's own import. Each is optional with a fallback; without `orderBy` the panel's Health tab counts errors first seen (`createdAt`) in the last 24h instead of seen (`lastSeen`), and Timeline misses re-fires of older errors.

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "bb:check": "bb-check",
    "bb:health": "bb-health",
    "bb:timeline": "bb-timeline",
    "bb:clear": "bb-clear",
    "bb:ack": "bb-ack"
  }
}
```

## Firebase Auth Tracking (Optional)

```javascript
import { bbTrackAuth } from '@artiskon/blackbox/firebase';
import { auth } from './firebase';

bbTrackAuth(auth);
```

## Auto-instrumented Firestore writes (Recommended)

Silent permission-denied on `deleteDoc` / `setDoc` / `updateDoc` / `addDoc` is invisible to BlackBox unless the caller adds `.catch()`. Wrap the write functions once at import time and use the wrapped versions throughout the app — every silent rejection becomes a BlackBox error with the document path and Firestore error code:

```javascript
import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { bbWrapWrites } from '@artiskon/blackbox';

const fs = bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc });
// use fs.addDoc / fs.deleteDoc / etc. in your app code
```

**Safe to call from shared client/server modules.** As of v1.9.1, `bbWrapWrites` short-circuits to a passthrough on the server (returns the input fns unchanged), so the call works at module top in any file imported by both client components and Next.js App Router route handlers — no `typeof window` guard needed at the call site. Non-write functions you pass in the same object (`getDoc`, `writeBatch`, ...) come back unchanged on the client too.

Recorded messages name the collection, with doc IDs as `:id` (e.g. `Firestore deleteDoc failed on proposals: Missing or insufficient permissions.`), so denials on different collections are separate rows.

If you use `bbFirestoreOp` for a one-off write instead, pass a function, not a promise: `bbFirestoreOp('setDoc', () => setDoc(ref, data), { path, data })`. The SDK throws `invalid-argument` synchronously, before any promise exists, so a promise you already created can never capture it.

**`invalid-argument` introspection (v1.9.4).** When the wrapped write rejects with Firestore's `invalid-argument` (e.g. an `undefined` value somewhere in the payload), the recorded error context carries:

- `firstUndefinedPath` — the dotted/indexed path within the document of the first undefined value (e.g. `sections[5].subtitle`). Firestore's own error tells you which document was rejected; this tells you which field.
- `payloadShape` — top 2 levels of the payload, type-only (no values). Lets you triage without reading the source. SDK objects show their class name (e.g. `DocumentReference`, `Timestamp`) and are never walked into.
- `writeFields` / `undefinedFields` — top-level key list and the subset that were undefined (carried over from v1.9.0).
- `callerFrame` — the first non-framework JS frame from the wrapped call site (e.g. `ProposalEditor.tsx:819:24`). Same `extractTopAppFrame` extraction as `console.error`. Captured BEFORE the SDK call so the app frame survives the await.

## Object Storage Wrapper (Cloudflare R2 / S3 / GCS)

Tag fetches against object storage so failures filter cleanly with `bb-check --source=storage` instead of getting lost in generic network noise:

```javascript
import { bbR2Fetch } from '@artiskon/blackbox';

await bbR2Fetch(signedUrl, { method: 'PUT', body: file }, {
  description: 'upload avatar',
  bucket: 'my-private-bucket',
  key: `users/${uid}/avatar.jpg`,
});
```

The wrapper uses native `fetch` internally so it doesn't double-record with the network hook, and surfaces `bucket`/`key`/`description` in error context. An intentionally aborted request (AbortController) is recorded as a breadcrumb with `aborted: true`, not as an error; timeouts (`AbortSignal.timeout`) still record an error.

## App-defined diagnostics (Recommended for opaque-id systems)

When errors point at app-specific state (a missing Cloudflare KV pointer, a stale R2 object, a Firestore doc that should exist) BlackBox can call your probe and embed the result in the error context. Eliminates the "now write a script to check 5 systems" debugging loop.

```javascript
import blackbox from '@artiskon/blackbox';

blackbox.registerDiagnostic('r2-asset-state', {
  // String regex tested against message + url + context.src
  match: /m\.mycdn\.example\/[a-zA-Z0-9]+$/,
  // OR a function: (errorEntry) => boolean
  run: async (errorEntry) => {
    const id = errorEntry.context.src.split('/').pop();
    return {
      kv: await checkCloudflareKV(id),
      r2_public: await headR2Object('public-bucket', id),
      firestore: await getDoc(doc(db, 'assets', id)).then(d => d.exists()),
    };
  },
  timeoutMs: 200, // default; cap is per-diagnostic
});
```

The result lands at `error.context.diagnostics['r2-asset-state']`. Diagnostics that exceed `timeoutMs` get `{error: 'timeout'}` and the slow probe's late result is dropped — design probes to be fast. When a diagnostic matches, the Firestore write for that error waits for it (up to its `timeoutMs`), so `context.diagnostics` lands in the stored doc and in `bb-check`, including on repeat occurrences.

**RegExp matchers see the raw URL.** Hooks expose `context._rawSrc` (resource_load) and `context._rawUrl` (network / storage) for the matcher to probe — these carry query strings (signed-URL tokens, `?mode=` selectors) that the persisted `context.url` strips. The underscore-prefixed surfaces are ephemeral: visible to the matcher, never written to Firestore, never included in the panel report. Function-style `match` callbacks always have access to the full entry.

## Firestore Query Context (Recommended for subscriptions)

Pass an optional `description` to `bbOnSnapshot` and BlackBox auto-extracts `queryPath` + `queryFilters` from the queryRef when the subscription emits permission-denied:

```javascript
import { bbOnSnapshot } from '@artiskon/blackbox/firebase';

bbOnSnapshot(
  query(collection(db, 'prompts'), where('ownerOnly', '==', false)),
  snap => render(snap),
  err => handle(err),
  { description: 'agency prompts where ownerOnly==false' }
);
```

- Collection-group queries report `queryPath: '**/<collectionId>'`; `or()` / `and()` filters report as `(a == ? or b == ?)`. Filter values are never captured.
- The recorded message names the collection (`Firestore listener error on prompts: ...`).
- If the listener can't attach (SDK copy mismatch, bad query), BlackBox records a `firebase_listener` error (`bbOnSnapshot could not attach listener ...`) and calls `onError`. Pass `onSnapshot` in `init({ firestoreFns })` to avoid the SDK-copy mismatch.
- Throws inside your `onNext` / `onError` callbacks are not swallowed; they surface as normal uncaught errors.

## Audit-Runner Integration (Playwright / unattended UI checks)

When BlackBox is being driven by an unattended browser-automation runner — e.g. the DigitalDen ui-check Playwright runner that exercises every route after a deploy — two globals let the runner correlate errors to its own session and halt early on the first runtime failure.

```javascript
// In the runner, BEFORE the page loads:
await context.addInitScript((tag) => {
  window.__BB_SESSION_TAG__ = tag;       // unique correlation token for this audit run
  window.__BB_FAIL_FAST__ = true;        // stop on the first runtime error
}, `audit-${Date.now()}-${randomUUID()}`);
```

BlackBox reads both at `init()` and:

- **Persists `sessionTag`** as a top-level field on each new error doc, plus `lastSeenSessionTag` on both the create and update paths. `where('lastSeenSessionTag', '==', tag)` is the single query that finds every error that fired during the run, both new fingerprints and re-fires of older ones. Use `where('sessionTag', '==', tag)` only when you want "first created in this run".
- **Trips fail-fast** on the first non-internal error: sets `window.__BB_FAIL_FAST_TRIPPED__ = { fingerprint, message, source, recordedAt, sessionTag }` and dispatches `CustomEvent('blackbox:fail-fast', { detail })` on `window`. Internal-frame-only errors (framework warnings) never trip. BB does not throw — the runner controls halt.

Real-user sessions should never enable `failFast`. The `addInitScript` pattern keeps it scoped to the runner and never reaches production builds.

## CLI Tools

| Command | Description |
|---------|-------------|
| `npm run bb:check` | Pull latest errors from Firestore into `dev-logs/blackbox.json`. At the start of each run it silently deletes docs not seen in 7 days and activity docs past their 48h `expireAt` (skipped with `--id`) |
| `npm run bb:check -- --verbose` | Full messages, paths, and context |
| `npm run bb:check -- --id <fingerprint>` | Full detail for a single error (stack, breadcrumbs, context) |
| `npm run bb:check -- --new` | Only errors seen since the last **unfiltered** `bb:check`. Runs using `--path`, `--source`, `--since` or `--status` don't move that baseline |
| `npm run bb:check -- --path=/admin/foo` | Only errors fired from a path substring |
| `npm run bb:check -- --source=storage` | Only errors with the given source (`network`, `storage`, `firebase`, `firebase_listener`, `console.error`, `resource_load`, `react_boundary`, `manual`, etc.) |
| `npm run bb:check -- --since=1h` | Only errors from the last duration (`30s`, `5m`, `2h`, `7d`). Anything else (e.g. `1w`) exits with usage |
| `npm run bb:check -- --status=404` | Only errors with the given HTTP status (matches `context.httpStatus` or `context.status`) |
| `npm run bb:check -- --include-internal` | Show framework-internal errors (react-dom warnings, Next chunks) — hidden by default |
| `npm run bb:ack <fingerprint>` | Mute a fingerprint for `--for 7d` (default; `30s`, `5m`, `2h`, `7d` or `forever`), with optional `--comment "waiting on X"`. Auto-unmutes when TTL expires |
| `npm run bb:ack -- --list` | Show currently-muted fingerprints |
| `npm run bb:ack <fingerprint> -- --clear` | Remove the mute |
| `npm run bb:health` | Health summary with HEALTHY/WARNING/UNHEALTHY verdict for errors **seen** (`lastSeen`) in the last 24 hours, so recurring older errors count. "Total occurrences" are lifetime counts of those errors |
| `npm run bb:timeline` | Dump recent activity timeline (last 5 minutes) to `dev-logs/bb-timeline.json` |
| `npm run bb:timeline -- --minutes N` | Timeline window of N minutes (N >= 1) |
| `npm run bb:clear` | Delete Firestore docs created more than 1 day ago |
| `npm run bb:clear -- --days N` | Delete docs created more than N days ago (N >= 1) |
| `npm run bb:clear -- --fingerprint <hash>` | Delete only errors matching a fingerprint (aliases: `--fp`, `--id`) |
| `npm run bb:clear -- --all` | Delete every doc plus the BlackBox files in local `dev-logs/` |

Every command supports `--help` / `-h`. `--flag value` and `--flag=value` both work. Unknown flags, missing values and malformed values exit 1 with the usage text instead of being ignored, so a typo can never fall through to a `bb:clear` delete. `bb:clear` options can't be combined.

**Credentials for cloud Firestore.** The CLI connects in this order: the emulator (`FIRESTORE_EMULATOR_HOST`), then Firebase Admin, then an unauthenticated Web SDK read. For cloud Firestore install `firebase-admin` as a dev dependency and authenticate with `gcloud auth application-default login`, `GOOGLE_APPLICATION_CREDENTIALS`, or a `serviceAccountKey.json` in the project root (keep it out of git). The Web SDK fallback only works if your rules let unauthenticated clients read `__blackbox`; it verifies with a real read before reporting "Connected" and otherwise prints the list of what it tried. Do not open `firestore.rules` to make the CLI work.

## Custom Logging

Log business-specific events that appear in breadcrumb trails:

```javascript
import blackbox from '@artiskon/blackbox';

blackbox.log('checkout_started', { cartItems: 3 });
blackbox.log('payment_submitted', { method: 'stripe' });
```

## The data-bb Attribute

Add `data-bb` to elements for clearer click breadcrumbs:

```html
<button data-bb="submit-order">Place Order</button>
```

Instead of `button "Place Order"`, the breadcrumb will show `button [submit-order] "Place Order"`.

## Privacy and Configuration

BlackBox is designed with privacy as a default:

| Option | Default | Description |
|--------|---------|-------------|
| `stripQueryParams` | `true` | Removes query strings (including inside `#hash` routes, e.g. `#/reset?token=...`) and `key=value` fragments such as `#access_token=...` from all stored URLs. Hash routes like `#/settings` are kept |
| `captureRequestBodies` | `false` | By default: same-origin POST/PUT/PATCH request bodies go on network breadcrumbs (first 300 chars), same-origin failed-request bodies go on the error context (up to `maxErrorBodyLength`), and non-2xx **response** bodies are captured for any host. Values of secret-looking keys (password, token, secret, authorization, api key) in captured JSON and form-encoded request bodies are replaced with `[redacted]` (response bodies are not redacted). `true` extends request-body capture to cross-origin hosts and all methods |
| `sanitize` | `null` | Custom redaction hook — a function that processes every breadcrumb before storage. Return `null` to drop the breadcrumb entirely |
| `consoleIgnorePatterns` | built-in list | Console messages matching these patterns are silently dropped. Your patterns are **added to** the built-in defaults (React DevTools banner, list-key and unmounted-update warnings, `ReactDOM.render` deprecation) |
| `networkExcludePatterns` | built-in list | URLs matching these patterns are not tracked. Your patterns are **added to** the built-in defaults (`firestore.googleapis.com`, `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`, Next stack-frame requests, `hot-update`) |
| `errorExcludePatterns` | `[]` | Errors matching these patterns are dropped entirely (e.g. `['fbcdn.net']`) |
| `firestoreFns` | `null` | Pass Firestore SDK functions to avoid module duplication (see Quick Start). Include `increment` (atomic occurrence counts across tabs), `orderBy` and `onSnapshot` (used by `bbOnSnapshot`) |
| `sessionTag` | `null` | String correlation token persisted as a top-level field on each error doc. Auto-read from `window.__BB_SESSION_TAG__` if not passed. Used by audit runners (e.g. DigitalDen ui-check) to filter `__blackbox` by their own session and ignore concurrent real-user traffic. Trimmed to 64 chars |
| `failFast` | `false` | When true, BB sets `window.__BB_FAIL_FAST_TRIPPED__` and dispatches a `blackbox:fail-fast` CustomEvent on the first non-internal error captured. Auto-enabled when `window.__BB_FAIL_FAST__` is truthy at init. Intended for unattended audit runners — never enable in real-user sessions |
| `environment` | `null` | Free-form label (`'development'`, `'staging'`) tagged on every doc and surfaced in `bb-check` |
| `buildSha` | auto | Identifies the deploy. Auto-detected from `NEXT_PUBLIC_BUILD_SHA`, `VERCEL_GIT_COMMIT_SHA`, `NETLIFY_COMMIT_REF`, or `GITHUB_SHA`. Lets you tell stale errors from fresh ones |
| `nodeEnv` | auto | Override for `process.env.NODE_ENV`. Auto-detected; rarely needed |
| `tags` | `{}` | Arbitrary `Record<string,string>` tagged on every doc |

An option passed as `undefined` uses its default (so `stripQueryParams: someUnsetFlag` never turns privacy off). Because the ignore/exclude lists extend the defaults, passing `[]` no longer removes a built-in pattern.

Form values are never captured — only field names and validation status. Click breadcrumbs never record typed input values either: an input's label comes from its placeholder, `<label>` text or `name` (only button-type inputs use their value).

```javascript
blackbox.init({
  db,
  stripQueryParams: true,
  captureRequestBodies: false,
  sanitize(breadcrumb) {
    // Redact sensitive paths
    if (breadcrumb.url?.includes('/admin')) return null;
    return breadcrumb;
  },
  // Added to the built-in defaults
  consoleIgnorePatterns: [
    'Warning: Extra attributes from the server',
  ],
});
```

## Firestore Indexes

If you use **Cloud Firestore** (not the emulator), BlackBox requires composite indexes for deduplication and CLI queries. Without them, errors won't be deduplicated and CLI commands will fail.

Add this to your `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "__blackbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "fingerprint", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "__blackbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "lastSeen", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "__blackbox",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "type", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    }
  ]
}
```

Then deploy with `firebase deploy --only firestore:indexes`. Alternatively, the first time a query fails, the Firestore error message will include a direct link to create the required index. In the panel, the History, Health and Timeline views show that error in a red "Query failed" block with a "Create index" link instead of an empty state.

**Activity doc expiry.** Activity docs carry an `expireAt` 48 hours after they're written. `bb:check` deletes expired ones at the start of each run. To have Firestore remove them without running `bb:check`, optionally enable a TTL policy:

```bash
gcloud firestore fields ttls update expireAt --collection-group=__blackbox --enable-ttl
```

## CLAUDE.md Integration

Adding the BlackBox debugging workflow to your project's `CLAUDE.md` file makes AI assistants automatically check BlackBox data before debugging. See `CLAUDEMD-SNIPPET.md` in this package for the exact text to paste.

## Known Limitations

- **Fingerprint grouping is heuristic.** Browser stack trace formats vary. React and bundlers add wrapper frames. The same error may occasionally get two different fingerprints, or two different errors may rarely share one. The `groupingInputs` field on each error document lets you inspect what went into the hash if grouping seems wrong. `groupingInputs.topFrame` is the normalized frame (no `:line:col`, no origin, chunk hashes replaced) so edits and deploys don't split a fingerprint; the real line numbers are in `stack` (and in `context.callerFrame` on `console.error` and wrapped-Firestore errors). Normalization rules occasionally improve between releases, which re-keys the affected fingerprints once: the old Firestore rows stop updating and `bb:ack` mutes on them need re-applying.

- **Suspicious silence has false positives.** Many valid button clicks produce no network call, navigation, or console output (modals, toggles, clipboard, client-side filtering). Suspicious silence is a hint, not proof of a bug.

- **Network capture covers `fetch` and `XMLHttpRequest`** (so axios's browser adapter and the Firebase Storage web SDK are included). `navigator.sendBeacon` and WebSocket traffic are not captured, so a click followed only by a beacon or socket message still reads as "no network call".

- **Console capture includes framework noise.** React dev mode, Firebase SDK warnings, and bundler output all fire console.error and console.warn. Common patterns are filtered by default via `consoleIgnorePatterns`, but some noise will get through. This is usually useful context for AI debugging, but can clutter the breadcrumb buffer.

- **CLI auto-detection is best effort.** The CLI tools try to find your Firebase config automatically (emulator, .firebaserc, env vars, source files). Most standard setups work. Non-standard project structures may require a `blackbox.config.json` file.

- **Timeline deduplication is approximate.** Two distinct events can share a timestamp. The timeline deduplicates by timestamp string, which is usually correct but not guaranteed.

- **Dev-only by default.** BlackBox disables itself when `NODE_ENV === 'production'`. To override this (e.g. if you test in production builds), pass `enabled: true` in `blackbox.init({ db, enabled: true })`. This forces BlackBox on regardless of `NODE_ENV`. Do not rely on BlackBox for production monitoring — it is designed for development debugging. The auto-disable relies on your bundler inlining `process.env.NODE_ENV` (Next.js, Vite, webpack 5 and Rspack all do); if yours doesn't, pass `enabled: false` in production builds. When BlackBox is disabled, `<BlackBoxPanel />` renders nothing and `<BlackBoxProvider>` records nothing (its fallback UI still works).

- **Health query requires a composite Firestore index.** The first time `queryHealth()` runs on cloud Firestore (not the emulator), it will fail with an error containing a link to create the required index. The panel's Health tab shows it as a "Query failed" block with a "Create index" link; click it to auto-create the index. This only needs to be done once per project.

- **Unacknowledged Firestore writes don't block capture.** If a write isn't acknowledged within 10 seconds (offline, or the Firestore emulator isn't running), BlackBox logs one console warning (`[BlackBox] Firestore write not acknowledged after 10s; ...`) and moves on; errors still show in the panel, and the SDK delivers the write when it reconnects. Up to 100 error writes wait in the queue; beyond that new writes are dropped until it drains.

- **Emulator is the recommended Firestore target.** Using cloud Firestore requires authenticated security rules. Never use open rules (`allow read, write: if true`) on a cloud Firestore project.

## License

MIT
