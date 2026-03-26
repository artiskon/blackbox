## BlackBox: Dev-Time Error Monitoring

This project uses BlackBox for error monitoring and activity recording during development.

### Debugging Workflow (ALWAYS follow this)

1. **Before debugging any issue**, run: `npm run bb:check`
   - This pulls the latest errors from Firestore into `dev-logs/blackbox.json`
   - Read the file. Each error entry includes breadcrumbs showing the user actions that led to the error.
   - Use the breadcrumbs to understand the sequence of events, not just the error message.

2. **When making significant changes to components or logic**, run: `npm run bb:health`
   - This generates a health summary at `dev-logs/bb-health.json`
   - Check the verdict field for a quick status.
   - Check for new errors introduced by your changes.

3. **When investigating "nothing happens" bugs or timing issues**, run: `npm run bb:timeline`
   - This dumps recent activity to `dev-logs/bb-timeline.json`
   - Look for gaps: a click event with no following network call means a handler is broken or missing.

4. **After a major fix or refactor**, run: `npm run bb:clear`
   - Clears old errors so the log stays clean and relevant.

### Log Format Quick Reference

Each error in `dev-logs/blackbox.json` has:
- `message` + `stack`: what broke and where
- `source`: how it was caught (window.onerror, network, firebase, console.error, form_validation, etc.)
- `breadcrumbs`: array of the last 80 actions before the error (clicks, navigation, network calls, etc.)
- `occurrences`: how many times this exact error repeated
- `context`: extra details specific to the error type

### Important

- Errors with high `occurrences` are systemic, fix those first.
- Look at the FULL breadcrumb trail. The cause is usually 2-5 actions before the crash.
- If `dev-logs/` files are empty, run `npm run bb:check` first.
- The `__blackbox` Firestore collection is dev-only. Do not use it in app logic.
