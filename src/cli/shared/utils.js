import fs from 'fs';
import path from 'path';
import { collection, query, limit, getDocs } from 'firebase/firestore';

export function ensureDevLogs() {
  const dir = path.join(process.cwd(), 'dev-logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeLog(filename, data) {
  const dir = ensureDevLogs();
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return filePath;
}

export async function checkCollectionSize(db, collectionName, isAdmin = false) {
  try {
    if (isAdmin) {
      // firebase-admin uses a different API
      const snapshot = await db.collection(collectionName).limit(501).get();
      const count = snapshot.size;
      if (count > 500) {
        console.warn(`\n[BlackBox] WARNING: __blackbox has ${count}+ documents. Queries may be slow.`);
        console.warn(`[BlackBox] Run "npm run bb:clear" to clean up old entries.\n`);
      }
      return count;
    }

    const snapshot = await getDocs(query(collection(db, collectionName), limit(501)));
    const count = snapshot.size;
    if (count > 500) {
      console.warn(`\n[BlackBox] WARNING: __blackbox has ${count}+ documents. Queries may be slow.`);
      console.warn(`[BlackBox] Run "npm run bb:clear" to clean up old entries.\n`);
    }
    return count;
  } catch (e) {
    // Don't fail the tool because of a size check
    return -1;
  }
}

export function formatError(idx, err) {
  const occ = err.occurrences > 1 ? ` (x${err.occurrences})` : '';
  const msg = (err.message || '').slice(0, 60);
  const src = (err.source || 'unknown').padEnd(15);
  return `  #${String(idx).padStart(2)}  ${src}| ${msg}${occ}`;
}
