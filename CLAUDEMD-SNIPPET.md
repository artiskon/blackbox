## BlackBox v1.8.0 — Dev-Time Error Monitoring

### What's new in v1.8.1:
- **`bbR2Fetch(url, init, { description, bucket, key })`** new helper at `@artiskon/blackbox/storage`: wraps a fetch against Cloudflare R2 (or any object storage) and tags breadcrumbs/errors with `source: 'storage'`. Filter with `bb-check --source=storage`. Uses native fetch internally so the network hook doesn't double-record.
- Removed the legacy Firebase Studio (`.idx/dev.nix`) projectId-detection step in the CLI — env vars and `.firebaserc` cover the same ground.

### What's new in v1.8.0:
- **Framework-internal error suppression**: errors with stacks 100% inside react-dom / next/dist / pdfjs / webpack-internal are flagged `internal: true` and hidden by default in panel and bb-check (use `--include-internal` to show)
- **`urlReachability` on resource_load**: every failed image/script/link is classified as `ok`, `http_error`, `cors_blocked`, `unreachable_origin`, or `unknown` — distinguishes DNS-dead from CORS-blocked instantly
- **CDN transform fingerprint collapse**: Cloudflare `cdn-cgi/image/width=400/...` and `width=600/...` variants of the same source URL now share one fingerprint
- **Cloudflare/nginx error page detection**: HTML upstream-error responses are summarized to a single line in responseBody instead of dumping 4 KB of boilerplate HTML
- **Firestore query context on permission errors**: `bbOnSnapshot` and `bbFirestoreOp` now auto-extract the queryPath and where-filter shape from the queryRef, so permission-denied errors include `queryPath` and `queryFilters` in context
- **Build-aware errors**: every error doc now carries `metadata.buildSha` and `metadata.nodeEnv`; auto-detected from `NEXT_PUBLIC_BUILD_SHA`, `VERCEL_GIT_COMMIT_SHA`, `NETLIFY_COMMIT_REF`, `GITHUB_SHA`, or set via `init({ buildSha, nodeEnv })`
- **Unique-user count**: errors track `uniqueUserCount` alongside `occurrences` so you can tell one-user bugs from everyone-bugs
- **Stronger click auto-labels**: img alt, parent text, input placeholder/value all feed the autoLabel waterfall — no more bare `el: 'img'` breadcrumbs
- **bb-check filter flags**: `--path=/admin/sites`, `--source=network`, `--since=1h`, `--include-internal`
- **`bb-ack <fingerprint>`** new CLI command: mark a fingerprint acknowledged for `--for 7d` (default) with an optional `--comment`. Acked errors hide from bb-check until TTL expires. `bb-ack --list` to see what's currently muted; `--clear` to remove
- **Silent stale cleanup**: bb-check now silently drops docs >7 days old at the start of each run, replacing the noisy "501-doc warning"
- **Cross-route correlation**: bb-check's "Possibly related" now includes `multi_path` clusters — same fingerprint observed on 2+ pages collapses into one row
- **sessionInfo header**: bb-check's JSON output and CLI banner show `environment`, `nodeEnv`, `buildSha` from the most recent error
- Fixed: panel's React duplicate-key crash on same-millisecond errors with same-prefix messages

### Foundation (carried from v1.x):
- Error capture with dedup (fingerprint-based, local cache + Firestore query)
- Breadcrumb trails: clicks, network, navigation, errors, console, forms, resources
- Network noise filtering (Firestore/Auth/HMR auto-excluded)
- Activity TTL (48h auto-expiry via Firestore `expireAt` field)
- Flush on page unload + recovery on next init
- Panel: fullscreen mode, search, copy JSON/Markdown, collapsible stack traces, breadcrumb filter chips
- CLI: bb-check, bb-health, bb-timeline, bb-clear, **bb-ack**

### Debugging Workflow (ALWAYS follow this)

1. **Before debugging any issue**, run: `npm run bb:check`
   - Output is grouped by fingerprint — 20 raw docs might be only 4 unique issues
   - Read the `grouped` array first, then drill into `errors` for full detail
   - Each error includes breadcrumbs showing the user actions that led to the error

2. **When making significant changes**, run: `npm run bb:health`
   - Check the verdict field for a quick status
   - Check for new errors introduced by your changes

3. **When investigating "nothing happens" bugs**, run: `npm run bb:timeline`
   - Look for gaps: a click event with no following network call = broken handler

4. **After a major fix**, run: `npm run bb:clear`
   - Clears errors older than 1 day by default (`--all` for everything, `--days N` for custom)

### init() config options:
- `db` — Firestore instance (required for persistence)
- `enabled` — boolean, forces BB on even in production builds (default: auto based on NODE_ENV)
- `environment` — string tag on every document (e.g. 'development', 'staging')
- `buildSha` — string, identifies the deploy. Auto-detected from `NEXT_PUBLIC_BUILD_SHA` / `VERCEL_GIT_COMMIT_SHA` / `NETLIFY_COMMIT_REF` / `GITHUB_SHA` if not set
- `nodeEnv` — string, override for `process.env.NODE_ENV`
- `tags` — Record<string, string>, arbitrary metadata on every document
- `networkExcludePatterns` — string[], URL patterns to skip in network breadcrumbs (defaults: Firestore, Auth, HMR, Next.js internals)
- `maxBreadcrumbs` — number (default: 80)
- `stripQueryParams` — boolean (default: true)
- `consoleIgnorePatterns` — string[], console messages to skip
- `sanitize` — function to redact/drop breadcrumbs before storage

### Methods on the `blackbox` object:
- `blackbox.init(config)` — initialize with Firestore and options
- `blackbox.setUser({ id, role })` — tag all subsequent errors/activity with user context
- `blackbox.setTag(key, value)` — add/update a metadata tag
- `blackbox.setEnvironment(env)` — change the environment tag
- `blackbox.log(event, data)` — add a custom breadcrumb
- `blackbox.captureError(error, context)` — manually capture an error
- `blackbox.destroy()` — remove all hooks, clear timers, reset state

### bbTrackAuth(auth) vs setUser():
- `bbTrackAuth(auth)` listens to Firebase Auth state changes and logs sign-in/sign-out events as **breadcrumbs** (activity trail). It does NOT set user context on error documents.
- `blackbox.setUser({ id, role })` tags all **error and activity documents** with user identity.
- **Use both:** `bbTrackAuth` for the activity trail, `setUser` for error attribution.

### Panel capabilities:
The floating panel (bottom-right badge) includes:
- **Live tab:** real-time errors with expandable breadcrumb trails
- **History tab:** persisted errors from Firestore, timeline view with time-range selector
- **Health tab:** HEALTHY/WARNING/UNHEALTHY verdict, stats, top errors
- **Fullscreen mode:** expand toggle in header
- **Search:** filter errors by text across message, source, path
- **Copy:** JSON and Markdown copy buttons per error
- **Stack traces:** collapsible, monospace formatted
- **Breadcrumb filter chips:** toggle click, network, error, navigation, performance, custom
- **Keyboard shortcut:** Ctrl+Shift+B / Cmd+Shift+B to toggle

### Log format:
Each error in `dev-logs/blackbox.json` has:
- `message` + `stack` — what broke and where
- `source` — how it was caught (window.onerror, network, firebase, console.error, etc.)
- `fingerprint` — unique hash for grouping identical errors
- `breadcrumbs` — array of last 80 actions before the error
- `occurrences` — how many times this exact error repeated
- `context` — extra details specific to the error type
- `environment`, `tags`, `user` — context tags set by the app
- Click breadcrumbs may include `autoLabel` (aria-label/title fallback when text is empty)

### Important:
- Errors with high `occurrences` are systemic — fix those first
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash
- If `dev-logs/` files are empty, run `npm run bb:check` first (auto-creates the directory)
- The `__blackbox` Firestore collection is dev-only. Do not use it in app logic
- Activity documents auto-expire after 48 hours
- **Cloud Firestore requires composite indexes** for CLI tools — see README "Firestore Indexes" section
