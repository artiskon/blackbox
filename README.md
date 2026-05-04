# @artiskon/blackbox

Dev-time error monitoring and activity recording for React/Firebase apps. BlackBox captures errors, user actions, and network activity during development and stores structured logs in Firestore. Designed for AI-assisted debugging — every error includes a breadcrumb trail showing exactly what the user did before the crash.

## Quick Start

```bash
npm install github:artiskon/blackbox
```

```javascript
import blackbox from '@artiskon/blackbox';
import { BlackBoxProvider, BlackBoxPanel } from '@artiskon/blackbox/components';
import { db } from './firebase';
import { collection, addDoc, updateDoc, deleteDoc, query, where, limit, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';

blackbox.init({
  db,
  firestoreFns: { collection, addDoc, updateDoc, deleteDoc, query, where, limit, getDocs, serverTimestamp, Timestamp }
});

// Optional but recommended: identify the user so uniqueUserCount works
// and you can tell one-user bugs from everyone-bugs.
blackbox.setUser({ id: currentUser.uid, role: currentUser.role });

function App() {
  return (
    <BlackBoxProvider>
      {/* your app */}
      <BlackBoxPanel />
    </BlackBoxProvider>
  );
}
```

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

**Safe to call from shared client/server modules.** As of v1.9.1, `bbWrapWrites` short-circuits to a passthrough on the server (returns the input fns unchanged), so the call works at module top in any file imported by both client components and Next.js App Router route handlers — no `typeof window` guard needed at the call site.

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

The wrapper uses native `fetch` internally so it doesn't double-record with the network hook, and surfaces `bucket`/`key`/`description` in error context.

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

The result lands at `error.context.diagnostics['r2-asset-state']`. Diagnostics that exceed `timeoutMs` get `{error: 'timeout'}` and the slow probe's late result is dropped — design probes to be fast.

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

## CLI Tools

| Command | Description |
|---------|-------------|
| `npm run bb:check` | Pull latest errors from Firestore into `dev-logs/blackbox.json` (silently drops docs >7d at the start of each run) |
| `npm run bb:check -- --verbose` | Full messages, paths, and context |
| `npm run bb:check -- --id <fingerprint>` | Full detail for a single error (stack, breadcrumbs, context) |
| `npm run bb:check -- --new` | Only errors since last check |
| `npm run bb:check -- --path=/admin/foo` | Only errors fired from a path substring |
| `npm run bb:check -- --source=storage` | Only errors with the given source (`network`, `storage`, `firebase`, `console.error`, `resource_load`, etc.) |
| `npm run bb:check -- --since=1h` | Only errors from the last duration (`30s`, `5m`, `2h`, `7d`) |
| `npm run bb:check -- --status=404` | Only errors with the given HTTP status (matches `context.httpStatus` or `context.status`) |
| `npm run bb:check -- --include-internal` | Show framework-internal errors (react-dom warnings, Next chunks) — hidden by default |
| `npm run bb:ack <fingerprint>` | Mute a fingerprint for `--for 7d` (default), with optional `--comment "waiting on X"`. Auto-unmutes when TTL expires |
| `npm run bb:ack -- --list` | Show currently-muted fingerprints |
| `npm run bb:ack <fingerprint> -- --clear` | Remove the mute |
| `npm run bb:health` | Generate a health summary with HEALTHY/WARNING/UNHEALTHY verdict |
| `npm run bb:timeline` | Dump recent activity timeline to `dev-logs/bb-timeline.json` |
| `npm run bb:clear` | Clear old error data from Firestore and local dev-logs |
| `npm run bb:clear -- --all` | Clear everything |
| `npm run bb:clear -- --fingerprint <hash>` | Delete only errors matching a fingerprint |

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
| `stripQueryParams` | `true` | Removes query strings from all stored URLs |
| `captureRequestBodies` | `false` | Request/response bodies are never stored unless explicitly enabled |
| `sanitize` | `null` | Custom redaction hook — a function that processes every breadcrumb before storage. Return `null` to drop the breadcrumb entirely |
| `consoleIgnorePatterns` | `[...]` | Console messages matching these patterns are silently dropped |
| `errorExcludePatterns` | `[]` | Errors matching these patterns are dropped entirely (e.g. `['fbcdn.net']`) |
| `firestoreFns` | `null` | Pass Firestore SDK functions to avoid module duplication (see Quick Start) |
| `environment` | `null` | Free-form label (`'development'`, `'staging'`) tagged on every doc and surfaced in `bb-check` |
| `buildSha` | auto | Identifies the deploy. Auto-detected from `NEXT_PUBLIC_BUILD_SHA`, `VERCEL_GIT_COMMIT_SHA`, `NETLIFY_COMMIT_REF`, or `GITHUB_SHA`. Lets you tell stale errors from fresh ones |
| `nodeEnv` | auto | Override for `process.env.NODE_ENV`. Auto-detected; rarely needed |
| `tags` | `{}` | Arbitrary `Record<string,string>` tagged on every doc |

Form values are never captured — only field names and validation status.

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
  consoleIgnorePatterns: [
    'Download the React DevTools',
    'Warning: ReactDOM.render is no longer supported',
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

Then deploy with `firebase deploy --only firestore:indexes`. Alternatively, the first time a query fails, the Firestore error message will include a direct link to create the required index.

## CLAUDE.md Integration

Adding the BlackBox debugging workflow to your project's `CLAUDE.md` file makes AI assistants automatically check BlackBox data before debugging. See `CLAUDEMD-SNIPPET.md` in this package for the exact text to paste.

## Known Limitations

- **Fingerprint grouping is heuristic.** Browser stack trace formats vary. React and bundlers add wrapper frames. The same error may occasionally get two different fingerprints, or two different errors may rarely share one. The `groupingInputs` field on each error document lets you inspect what went into the hash if grouping seems wrong.

- **Suspicious silence has false positives.** Many valid button clicks produce no network call, navigation, or console output (modals, toggles, clipboard, client-side filtering). Suspicious silence is a hint, not proof of a bug.

- **Console capture includes framework noise.** React dev mode, Firebase SDK warnings, and bundler output all fire console.error and console.warn. Common patterns are filtered by default via `consoleIgnorePatterns`, but some noise will get through. This is usually useful context for AI debugging, but can clutter the breadcrumb buffer.

- **CLI auto-detection is best effort.** The CLI tools try to find your Firebase config automatically (emulator, .firebaserc, env vars, source files). Most standard setups work. Non-standard project structures may require a `blackbox.config.json` file.

- **Timeline deduplication is approximate.** Two distinct events can share a timestamp. The timeline deduplicates by timestamp string, which is usually correct but not guaranteed.

- **Dev-only by default.** BlackBox disables itself when `NODE_ENV === 'production'`. To override this (e.g. if you test in production builds), pass `enabled: true` in `blackbox.init({ db, enabled: true })`. This forces BlackBox on regardless of `NODE_ENV`. Do not rely on BlackBox for production monitoring — it is designed for development debugging.

- **Health query requires a composite Firestore index.** The first time `queryHealth()` runs on cloud Firestore (not the emulator), it will fail with an error containing a link to create the required index. Click that link to auto-create it. This only needs to be done once per project.

- **Emulator is the recommended Firestore target.** Using cloud Firestore requires authenticated security rules. Never use open rules (`allow read, write: if true`) on a cloud Firestore project.

## License

MIT
