import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
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

  // 5. .idx/dev.nix (Firebase Studio)
  try {
    const nix = fs.readFileSync(path.join(root, '.idx', 'dev.nix'), 'utf8');
    const match = nix.match(/projectId\s*=\s*"([^"]+)"/);
    if (match) return match[1];
  } catch { /* not found */ }

  // 6. Environment variables
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

  // Method 2: Firebase CLI / Application Default Credentials
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || hasDefaultCredentials()) {
    try {
      const admin = await import('firebase-admin');
      const adm = admin.default || admin;
      const pid = projectId || undefined;
      if (!adm.apps.length) {
        adm.initializeApp({ projectId: pid });
      }
      const db = adm.firestore();
      console.log(`[BlackBox] Connected via Firebase Admin (project: ${pid || 'auto'})`);
      return { db, collectionName, isAdmin: true };
    } catch (e) {
      tried.push(`2. Firebase CLI credentials (error: ${e.message})`);
    }
  } else {
    tried.push('2. Firebase CLI credentials (not found)');
  }

  // Method 3: Service account key file
  const root = findProjectRoot();
  const saFiles = ['serviceAccountKey.json', 'service-account.json'];
  for (const saFile of saFiles) {
    const saPath = path.join(root, saFile);
    if (fs.existsSync(saPath)) {
      try {
        const admin = await import('firebase-admin');
        const adm = admin.default || admin;
        const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
        if (!adm.apps.length) {
          adm.initializeApp({ credential: adm.credential.cert(sa), projectId: sa.project_id });
        }
        const db = adm.firestore();
        console.log(`[BlackBox] Connected via service account (${saFile})`);
        return { db, collectionName, isAdmin: true };
      } catch (e) {
        tried.push(`3. Service account key ${saFile} (error: ${e.message})`);
      }
    }
  }
  if (!tried.some(t => t.startsWith('3.'))) {
    tried.push('3. Service account key (not found)');
  }

  // Method 4: Web SDK with just projectId
  if (projectId) {
    try {
      const app = initializeApp({ projectId }, `blackbox-cli-${Date.now()}`);
      const db = getFirestore(app);
      console.log(`[BlackBox] Connected via Web SDK (project: ${projectId})`);
      return { db, collectionName };
    } catch (e) {
      tried.push(`4. Web SDK with open rules (error: ${e.message})`);
    }
  } else {
    tried.push('4. Web SDK with open rules (no projectId detected)');
  }

  // All methods failed
  console.error(`\n[BlackBox] Could not connect to Firestore.\n`);
  console.error('Tried:');
  for (const t of tried) console.error(`  ${t}`);
  console.error(`\nSolutions:`);
  console.error(`  - If using Firebase Emulator: make sure it's running (firebase emulators:start)`);
  console.error(`  - If using cloud Firestore: run 'firebase login' first`);
  console.error(`  - Or create a blackbox.config.json with: { "projectId": "your-project-id" }\n`);
  process.exit(1);
}

function hasDefaultCredentials() {
  // Check common locations for Firebase CLI credentials
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const paths = [
    path.join(home, '.config', 'firebase', 'application_default_credentials.json'),
    path.join(home, '.config', 'gcloud', 'application_default_credentials.json'),
  ];
  if (process.env.APPDATA) {
    paths.push(path.join(process.env.APPDATA, 'firebase', 'application_default_credentials.json'));
  }
  return paths.some(p => fs.existsSync(p));
}
