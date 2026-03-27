# BlackBox Install Prompt

Copy and paste everything below to the LLM working on your app:

---

Install and set up BlackBox error monitoring in this app. Follow these steps exactly:

1. Install from GitHub:
   npm install github:artiskon/blackbox

2. Find the app's Firestore db instance (look for where firebase/firestore is initialized). If the app uses Firebase Auth, also find the auth instance.

3. Create an init component (for Next.js apps, make it a 'use client' component):
   - Import blackbox from '@artiskon/blackbox'
   - In a useEffect, call: blackbox.init({ db, enabled: true })
   - The "enabled: true" flag is intentional — the app owner tests in production builds
   - If Firebase Auth exists, also import { bbTrackAuth } from '@artiskon/blackbox/firebase' and call bbTrackAuth(auth) after init

4. Create an error boundary wrapper:
   - Import { BlackBoxProvider } from '@artiskon/blackbox/components'
   - Wrap the app's children in <BlackBoxProvider>

5. Add the floating debug panel:
   - Import { BlackBoxPanel } from '@artiskon/blackbox/components'
   - Render <BlackBoxPanel /> at the root layout level, OUTSIDE the error boundary

6. Add these scripts to package.json:
   "bb:check": "bb-check",
   "bb:health": "bb-health",
   "bb:timeline": "bb-timeline",
   "bb:clear": "bb-clear"

7. Create dev-logs/ directory and add "dev-logs/" to .gitignore

8. FIRESTORE RULES:
   - Check: does this project use the Firebase Emulator? (look for FIRESTORE_EMULATOR_HOST or emulator config in firebase.json)
   - IF EMULATOR: No rule changes needed. Skip to step 9.
   - IF CLOUD FIRESTORE: Ask the user before modifying any rules. NEVER add open rules.
   - IF UNSURE: Ask the user.

9. Add the BlackBox debugging workflow to CLAUDE.md:
   - Read CLAUDEMD-SNIPPET.md inside node_modules/@artiskon/blackbox/ and paste its contents into CLAUDE.md (create if needed)

10. Verify setup:
    - Open the app in browser
    - A green circle with "0" should appear at bottom-right
    - Click it to open the BlackBox panel
    - Trigger a test error to confirm it captures it

Do NOT modify any BlackBox source files. Just install, wire up, and verify.

## Updating BlackBox

To pull the latest version of BlackBox, run:
   npm update @artiskon/blackbox

This replaces the package files only. No changes needed to your app's setup code unless told otherwise.
