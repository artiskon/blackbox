## BlackBox: Dev-Time Error Monitoring (v1.2.0)

This project uses BlackBox for error monitoring and activity recording during development.

### Debugging Workflow (ALWAYS follow this)

1. **Before debugging any issue**, run: `npm run bb:check`
   - This pulls the latest errors from Firestore into `dev-logs/blackbox.json`
   - Output is **grouped by fingerprint** — 20 raw docs might be only 4 unique issues
   - Read the `grouped` array first for an overview, then drill into `errors` for full detail
   - Each error includes breadcrumbs showing the user actions that led to the error
   - Use the breadcrumbs to understand the sequence of events, not just the error message

2. **When making significant changes to components or logic**, run: `npm run bb:health`
   - This generates a health summary at `dev-logs/bb-health.json`
   - Check the verdict field for a quick status
   - Check for new errors introduced by your changes

3. **When investigating "nothing happens" bugs or timing issues**, run: `npm run bb:timeline`
   - This dumps recent activity to `dev-logs/bb-timeline.json`
   - Look for gaps: a click event with no following network call means a handler is broken or missing
   - Network noise (Firestore internal, HMR) is automatically filtered out

4. **After a major fix or refactor**, run: `npm run bb:clear`
   - Clears errors older than 1 day by default (use `--all` for everything, `--days N` for custom)

### Log Format Quick Reference

Each error in `dev-logs/blackbox.json` has:
- `message` + `stack`: what broke and where
- `source`: how it was caught (window.onerror, network, firebase, console.error, form_validation, etc.)
- `breadcrumbs`: array of the last 80 actions before the error (clicks, navigation, network calls, etc.)
- `occurrences`: how many times this exact error repeated
- `fingerprint`: unique hash for grouping identical errors
- `context`: extra details specific to the error type
- `environment`: tagged environment (e.g. 'development', 'staging')
- `tags`: arbitrary key-value metadata set by the app
- `user`: user context if set (id, role)

Click breadcrumbs may include an `autoLabel` field when the element text was too short — this contains the aria-label, title, or parent button text.

### Important

- Errors with high `occurrences` are systemic, fix those first.
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash.
- If `dev-logs/` files are empty, run `npm run bb:check` first. It creates the `dev-logs/` directory automatically if it doesn't exist.
- The `__blackbox` Firestore collection is dev-only. Do not use it in app logic.
- Activity documents auto-expire after 48 hours (via Firestore TTL `expireAt` field).
