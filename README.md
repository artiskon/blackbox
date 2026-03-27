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

blackbox.init({ db });

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
    "bb:clear": "bb-clear"
  }
}
```

## Firebase Auth Tracking (Optional)

```javascript
import { bbTrackAuth } from '@artiskon/blackbox/firebase';
import { auth } from './firebase';

bbTrackAuth(auth);
```

## CLI Tools

| Command | Description |
|---------|-------------|
| `npm run bb:check` | Pull latest errors from Firestore into `dev-logs/blackbox.json` |
| `npm run bb:health` | Generate a health summary with HEALTHY/WARNING/UNHEALTHY verdict |
| `npm run bb:timeline` | Dump recent activity timeline to `dev-logs/bb-timeline.json` |
| `npm run bb:clear` | Clear old error data from Firestore and local dev-logs |

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

## CLAUDE.md Integration

Adding the BlackBox debugging workflow to your project's `CLAUDE.md` file makes AI assistants automatically check BlackBox data before debugging. See `CLAUDEMD-SNIPPET.md` in this package for the exact text to paste.

## Known Limitations

- **Fingerprint grouping is heuristic.** Browser stack trace formats vary. React and bundlers add wrapper frames. The same error may occasionally get two different fingerprints, or two different errors may rarely share one. The `groupingInputs` field on each error document lets you inspect what went into the hash if grouping seems wrong.

- **Suspicious silence has false positives.** Many valid button clicks produce no network call, navigation, or console output (modals, toggles, clipboard, client-side filtering). Suspicious silence is a hint, not proof of a bug.

- **Console capture includes framework noise.** React dev mode, Firebase SDK warnings, and bundler output all fire console.error and console.warn. Common patterns are filtered by default via `consoleIgnorePatterns`, but some noise will get through. This is usually useful context for AI debugging, but can clutter the breadcrumb buffer.

- **CLI auto-detection is best effort.** The CLI tools try to find your Firebase config automatically (emulator, .firebaserc, env vars, source files). Most standard setups work. Non-standard project structures may require a `blackbox.config.json` file.

- **Timeline deduplication is approximate.** Two distinct events can share a timestamp. The timeline deduplicates by timestamp string, which is usually correct but not guaranteed.

- **Dev-only by default.** BlackBox disables itself when `NODE_ENV === 'production'`. Do not rely on BlackBox for production monitoring. It is designed exclusively for development.

- **Emulator is the recommended Firestore target.** Using cloud Firestore requires authenticated security rules. Never use open rules (`allow read, write: if true`) on a cloud Firestore project.

## License

MIT
