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

// Parses "1h", "30m", "2d", "10s" → milliseconds, or null if unrecognized.
export function parseDuration(s) {
  if (!s) return null;
  const m = String(s).trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
}

export function exitWithUsage(message, usage) {
  console.error(`[BlackBox] ${message}\n\n${usage}`);
  process.exit(1);
}

// Strict argv parser shared by every bb-* CLI. `spec` maps flag names to a
// kind: 'bool', 'string', 'int' (non-negative integer) or 'duration' (ms).
// A key may list aliases ('--fingerprint|--fp'); the value is stored under
// the first name without dashes. Accepts `--flag value` and `--flag=value`.
// --help/-h prints usage and exits 0; an unknown flag, a missing value or an
// unparseable value exits 1. Callers run this BEFORE connectToFirestore, so
// a help probe or a typo never touches Firestore or dev-logs (a silently
// ignored flag used to fall through to bb-clear's bulk delete).
export function parseCliArgs(spec, usage, { maxPositionals = 0, argv = process.argv.slice(2) } = {}) {
  const kinds = new Map();
  for (const [names, kind] of Object.entries(spec)) {
    const parts = names.split('|');
    const key = parts[0].replace(/^-+/, '');
    for (const p of parts) kinds.set(p, { key, kind });
  }
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(usage);
      process.exit(0);
    }
    if (!a.startsWith('-')) {
      if (positionals.length >= maxPositionals) exitWithUsage(`Unexpected argument: ${a}`, usage);
      positionals.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq === -1 ? a : a.slice(0, eq);
    const def = kinds.get(name);
    if (!def) exitWithUsage(`Unknown option: ${name}`, usage);
    if (def.kind === 'bool') {
      if (eq !== -1) exitWithUsage(`${name} does not take a value`, usage);
      flags[def.key] = true;
      continue;
    }
    let value;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) value = argv[++i];
    if (!value) exitWithUsage(`${name} needs a value`, usage);
    if (def.kind === 'int') {
      if (!/^\d+$/.test(value)) exitWithUsage(`Invalid ${name} "${value}": expected a whole number`, usage);
      value = parseInt(value, 10);
    } else if (def.kind === 'duration') {
      const ms = parseDuration(value);
      if (ms === null) exitWithUsage(`Invalid ${name} "${value}": use 30s, 5m, 2h, 7d`, usage);
      value = ms;
    }
    flags[def.key] = value;
  }
  return { flags, positionals };
}

export function formatError(idx, err) {
  const occ = err.occurrences > 1 ? ` (x${err.occurrences})` : '';
  const msg = (err.message || '').slice(0, 60);
  const src = (err.source || 'unknown').padEnd(15);
  return `  #${String(idx).padStart(2)}  ${src}| ${msg}${occ}`;
}
