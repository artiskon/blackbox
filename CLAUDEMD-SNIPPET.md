## BlackBox v1.2.0 — Dev-Time Error Monitoring

### What's included in v1.2.0:
- Error capture with dedup (fingerprint-based, local cache + Firestore query)
- Breadcrumb trails: clicks, network, navigation, errors, console, forms, resources
- Network noise filtering (Firestore/Auth/HMR auto-excluded)
- Click auto-labeling (aria-label, title, parent button text fallback)
- Environment, tags, user context on all documents
- Activity TTL (48h auto-expiry via Firestore `expireAt` field)
- Flush on page unload + recovery on next init
- Panel: fullscreen mode, search, copy JSON/Markdown, collapsible stack traces, breadcrumb filter chips
- CLI: bb:check (grouped by fingerprint), bb:health, bb:timeline, bb:clear (1-day default)

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
