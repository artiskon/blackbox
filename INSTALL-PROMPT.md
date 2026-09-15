# BlackBox Install Prompt

Copy and paste everything below to the LLM working on your app:

---

Install and set up BlackBox error monitoring in this app. Follow these steps exactly:

1. Install from GitHub:
   npm install github:artiskon/blackbox
   (or pin to a specific tag, e.g. `npm install github:artiskon/blackbox#v1.9.5` — release tags are published from v1.9.4 onward)

2. Find the app's Firestore db instance (look for where firebase/firestore is initialized). If the app uses Firebase Auth, also find the auth instance.

3. Create an init component (for Next.js apps, make it a 'use client' component):
   - Import blackbox from '@artiskon/blackbox'
   - In a useEffect, call: blackbox.init({ db, enabled: true })
   - The "enabled: true" flag is intentional — the app owner tests in production builds
   - If Firebase Auth exists, also import { bbTrackAuth } from '@artiskon/blackbox/firebase' and call bbTrackAuth(auth) after init
   - Once auth resolves, call blackbox.setUser({ id: user.uid, role: user.role }) so uniqueUserCount tracks one-user vs everyone-bugs

4. Create an error boundary wrapper:
   - Import { BlackBoxProvider } from '@artiskon/blackbox/components'
   - Wrap the app's children in <BlackBoxProvider>

5. Add the floating debug panel:
   - Import { BlackBoxPanel } from '@artiskon/blackbox/components'
   - Render <BlackBoxPanel /> at the root layout level, OUTSIDE the error boundary, as a sibling after it (e.g. <><BlackBoxProvider>{children}</BlackBoxProvider><BlackBoxPanel /></>). On a render crash the provider replaces all of its children with the fallback, so a panel nested inside it would disappear on exactly the crash you need to inspect
   - The panel renders nothing until blackbox.init() has enabled BlackBox, so it appears only after the init component's effect runs

6. Add these scripts to package.json:
   "bb:check": "bb-check",
   "bb:health": "bb-health",
   "bb:timeline": "bb-timeline",
   "bb:clear": "bb-clear",
   "bb:ack": "bb-ack"

7. Create dev-logs/ directory and add "dev-logs/" to .gitignore

8. FIRESTORE RULES:
   - Check: does this project use the Firebase Emulator? (look for FIRESTORE_EMULATOR_HOST or emulator config in firebase.json)
   - IF EMULATOR: No rule changes needed. Skip to step 9.
   - IF CLOUD FIRESTORE: Ask the user before modifying any rules. NEVER add open rules.
   - IF UNSURE: Ask the user.
   - The bb-* CLI tools do NOT need client rules opened. For cloud Firestore they read through Firebase Admin: install firebase-admin as a dev dependency (npm i -D firebase-admin) and have the user authenticate with `gcloud auth application-default login`, set GOOGLE_APPLICATION_CREDENTIALS, or place serviceAccountKey.json in the project root (add it to .gitignore). Every bb-* command supports --help.

9. FIRESTORE INDEXES (Cloud Firestore only, skip if using emulator):
   - Read the "Firestore Indexes" section in node_modules/@artiskon/blackbox/README.md
   - Add the indexes to the project's firestore.indexes.json
   - Deploy with: firebase deploy --only firestore:indexes
   - Without these indexes, error deduplication and CLI queries will fail silently
   - Optional: activity docs carry a 48h `expireAt`. `bb:check` deletes expired ones on each run; to let Firestore do it instead, ask the user before enabling a TTL policy: gcloud firestore fields ttls update expireAt --collection-group=__blackbox --enable-ttl

10. Add the BlackBox debugging workflow to CLAUDE.md:
   - Read CLAUDEMD-SNIPPET.md inside node_modules/@artiskon/blackbox/ and paste its contents into CLAUDE.md (create if needed)

11. Verify setup:
    - Open the app in browser
    - A small green dot (8×8px) should appear flush in the bottom-left corner (if it doesn't, blackbox.init() hasn't enabled BlackBox: check the init component is mounted and `enabled: true` is passed)
    - Click it to open the BlackBox panel
    - Trigger a test error — the dot should grow into an amber/red number badge and pulse once
    - The panel header has a Copy button that produces a JSON diagnostic report

Do NOT modify any BlackBox source files. Just install, wire up, and verify.

## Recommended add-ons (after basic setup works)

- **Wrap Firestore writes** so silent permission-denied becomes visible. Find every `import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'` and route through `bbWrapWrites` from '@artiskon/blackbox':
  ```ts
  import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
  import { bbWrapWrites } from '@artiskon/blackbox';
  const fs = bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc });
  // use fs.deleteDoc(...) etc. throughout the app
  ```
  Safe to call from a shared module imported by both client components AND server route handlers — `bbWrapWrites` is a server-side passthrough, no `typeof window` guard needed.

- **Wrap object-storage fetches** (Cloudflare R2 / S3 / GCS) with `bbR2Fetch` from '@artiskon/blackbox' so failures appear with `source: 'storage'` and bucket/key context, instead of generic network errors.

- **Add `description` to `bbOnSnapshot` calls** so permission-denied errors carry a human-readable label of which query was rejected — auto-extracted query path + filters come along for free.

- **Register diagnostics for opaque-id assets.** If the app serves files via a URL pattern like `/assets/{id}` and resolution involves multiple systems (Cloudflare KV → R2 → Firestore), register a `blackbox.registerDiagnostic(name, { match: /pattern/, run })` so failed loads automatically embed the full system state in the error context instead of forcing a manual probe-script-writing session.

## Updating BlackBox

To pull the latest version of BlackBox, run:
   npm update @artiskon/blackbox

If your `package.json` pins a specific tag (e.g. `github:artiskon/blackbox#v1.9.5`), bump the tag in `package.json` first, then run `npm install`. List published tags with:
   gh api repos/artiskon/blackbox/tags --jq '.[].name'

This replaces the package files only. No changes needed to your app's setup code unless told otherwise.
