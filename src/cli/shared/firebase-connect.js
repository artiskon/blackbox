import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, query, limit, getDocs } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findProjectRoot() {
  // Walk up from CWD looking for package.json
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function detectProjectId() {
  const root = findProjectRoot();

  // 1. blackbox.config.json
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'blackbox.config.json'), 'utf8'));
    if (cfg.projectId) return cfg.projectId;
  } catch { /* not found */ }

  // 2. .firebaserc
  try {
    const rc = JSON.parse(fs.readFileSync(path.join(root, '.firebaserc'), 'utf8'));
    if (rc.projects?.default) return rc.projects.default;
  } catch { /* not found */ }

  // 3. firebase.json
  try {
    const fj = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
    if (fj.projectId) return fj.projectId;
  } catch { /* not found */ }

  // 4. Source files with firebaseConfig
  const configPaths = [
    'src/firebase.js', 'src/firebase.ts',
    'src/lib/firebase.js', 'src/lib/firebase.ts',
    'src/config/firebase.js', 'src/config/firebase.ts',
  ];
  for (const rel of configPaths) {
    try {
      const content = fs.readFileSync(path.join(root, rel), 'utf8');
      const match = content.match(/projectId\s*[:=]\s*['"]([^'"]+)['"]/);
      if (match) return match[1];
    } catch { /* not found */ }
  }

  // 4b. Broad search for firebaseConfig in src/
  try {
    const srcDir = path.join(root, 'src');
    if (fs.existsSync(srcDir)) {
      const files = findFilesRecursive(srcDir, /\.(js|ts|jsx|tsx)$/);
      for (const file of files) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          if (content.includes('firebaseConfig') || content.includes('firebase_config')) {
            const match = content.match(/projectId\s*[:=]\s*['"]([^'"]+)['"]/);
            if (match) return match[1];
          }
        } catch { /* skip */ }
      }
    }
  } catch { /* skip */ }

  // 5. Environment variables
  const envVars = [
    'VITE_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'REACT_APP_FIREBASE_PROJECT_ID',
    'GCLOUD_PROJECT',
    'FIREBASE_PROJECT_ID',
  ];
  for (const v of envVars) {
    if (process.env[v]) return process.env[v];
  }

  return null;
}

function findFilesRecursive(dir, pattern, results = [], depth = 0) {
  if (depth > 4) return results; // limit recursion
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFilesRecursive(full, pattern, results, depth + 1);
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
  } catch { /* skip */ }
  return results;
}

export async function connectToFirestore(collectionName = '__blackbox') {
  const projectId = detectProjectId();
  const tried = [];

  // Method 1: Firebase Emulator
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    try {
      const [host, portStr] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
      const port = parseInt(portStr, 10);
      const pid = projectId || 'demo-app';
      const app = initializeApp({ projectId: pid }, `blackbox-cli-${Date.now()}`);
      const db = getFirestore(app);
      connectFirestoreEmulator(db, host, port);
      console.log(`[BlackBox] Connected via emulator (${host}:${port}, project: ${pid})`);
      return { db, collectionName };
    } catch (e) {
      tried.push(`1. Emulator (FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST}, error: ${e.message})`);
    }
  } else {
    tried.push('1. Emulator (FIRESTORE_EMULATOR_HOST not set)');
  }

  // Method 2: Firebase Admin. A service account key file in the project root
  // wins; otherwise the SDK discovers credentials itself
  // (GOOGLE_APPLICATION_CREDENTIALS, gcloud ADC, GCE metadata server). One
  // initializeApp only: a failed credential-less attempt used to leave the
  // default app behind, so a later key-file init was silently skipped.
  const root = findProjectRoot();
  const saFile = ['serviceAccountKey.json', 'service-account.json']
    .find(f => fs.existsSync(path.join(root, f)));
  const adminLabel = saFile ? `Firebase Admin via ${saFile}` : 'Firebase Admin';
  try {
    const admin = await import('firebase-admin');
    const adm = admin.default || admin;
    let pid = projectId || undefined;
    if (!adm.apps.length) {
      if (saFile) {
        const sa = JSON.parse(fs.readFileSync(path.join(root, saFile), 'utf8'));
        pid = sa.project_id;
        adm.initializeApp({ credential: adm.credential.cert(sa), projectId: pid });
      } else {
        adm.initializeApp({ projectId: pid });
      }
    }
    const db = adm.firestore();
    // Verify connection works with a quick test query
    await db.collection(collectionName).limit(1).get();
    console.log(`[BlackBox] Connected via ${adminLabel} (project: ${pid || 'auto'})`);
    return { db, collectionName, isAdmin: true };
  } catch (e) {
    tried.push(`2. ${adminLabel} (error: ${e.message})`);
  }

  // Method 3: Web SDK, unauthenticated. Only works if firestore.rules let an
  // unauthenticated client read __blackbox, so probe before claiming success;
  // getFirestore() alone never touches the network, which used to report
  // "Connected" and hide the Admin failure behind a later permissions error.
  if (projectId) {
    try {
      const app = initializeApp({ projectId }, `blackbox-cli-${Date.now()}`);
      const db = getFirestore(app);
      const snap = await getDocs(query(collection(db, collectionName), limit(1)));
      // An unreachable or rejecting backend can resolve from the empty local
      // cache instead of throwing, which would read as "no errors".
      if (snap.metadata.fromCache) throw new Error('no server response: read denied or Firestore unreachable (see the @firebase/firestore log above)');
      console.log(`[BlackBox] Connected via Web SDK (project: ${projectId})`);
      return { db, collectionName };
    } catch (e) {
      tried.push(`3. Web SDK, unauthenticated (error: ${e.code ? `${e.code}: ` : ''}${e.message})`);
    }
  } else {
    tried.push('3. Web SDK, unauthenticated (no projectId detected)');
  }

  // All methods failed
  console.error(`\n[BlackBox] Could not connect to Firestore.\n`);
  console.error('Tried:');
  for (const t of tried) console.error(`  ${t}`);
  console.error(`\nSolutions:`);
  console.error(`  - If using Firebase Emulator: make sure it's running (firebase emulators:start)`);
  console.error(`  - If using cloud Firestore: npm i -D firebase-admin, then run 'gcloud auth application-default login'`);
  console.error(`    (or set GOOGLE_APPLICATION_CREDENTIALS, or put serviceAccountKey.json in the project root).`);
  console.error(`    Do NOT open firestore.rules to make the CLI work.`);
  console.error(`  - Or create a blackbox.config.json with: { "projectId": "your-project-id" }\n`);
  process.exit(1);
}
