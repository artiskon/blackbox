#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize, formatError } from './shared/utils.js';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const CURRENT_SCHEMA = 1;
const LAST_CHECK_FILE = path.join(process.cwd(), 'dev-logs', '.bb-last-check');

function parseArgs() {
  const args = process.argv.slice(2);
  let verbose = false;
  let id = null;
  let newOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verbose' || args[i] === '-v') verbose = true;
    if (args[i] === '--new') newOnly = true;
    if (args[i] === '--id' && args[i + 1]) id = args[i + 1];
  }
  return { verbose, id, newOnly };
}

function timeAgo(isoString) {
  if (!isoString) return '?';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getLastCheckTime() {
  try {
    return fs.readFileSync(LAST_CHECK_FILE, 'utf8').trim();
  } catch { return null; }
}

function saveLastCheckTime() {
  try {
    const dir = path.dirname(LAST_CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_CHECK_FILE, new Date().toISOString());
  } catch { /* ignore */ }
}

async function main() {
  try {
    const { verbose, id, newOnly } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();
    await checkCollectionSize(db, collectionName, isAdmin);

    let docs;

    if (isAdmin) {
      const snapshot = await db.collection(collectionName)
        .where('type', '==', 'error')
        .orderBy('lastSeen', 'desc')
        .limit(50)
        .get();
      docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      const q = query(
        collection(db, collectionName),
        where('type', '==', 'error'),
        orderBy('lastSeen', 'desc'),
        limit(50)
      );
      const snapshot = await getDocs(q);
      docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // Handle schema version mismatches + convert timestamps
    const errors = docs.map(doc => {
      const entry = { ...doc };
      if (entry.firstSeen?.toDate) entry.firstSeen = entry.firstSeen.toDate().toISOString();
      if (entry.lastSeen?.toDate) entry.lastSeen = entry.lastSeen.toDate().toISOString();
      if (entry.createdAt?.toDate) entry.createdAt = entry.createdAt.toDate().toISOString();
      if (entry.schemaVersion !== CURRENT_SCHEMA) {
        entry._warning = 'schema version mismatch, some fields may differ';
      }
      return entry;
    });

    // Filter for --new (since last check)
    const lastCheck = getLastCheckTime();
    let filteredErrors = errors;
    if (newOnly && lastCheck) {
      filteredErrors = errors.filter(e => e.lastSeen && e.lastSeen > lastCheck);
    }

    // Filter for --id (specific fingerprint)
    if (id) {
      filteredErrors = errors.filter(e => e.fingerprint === id || e.id === id);
      if (filteredErrors.length === 0) {
        console.log(`\n[BlackBox] No errors found with fingerprint/id: ${id}\n`);
        process.exit(0);
      }
      // Show full detail for --id
      for (const err of filteredErrors) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Fingerprint: ${err.fingerprint}`);
        console.log(`Source:      ${err.source}`);
        console.log(`Message:     ${err.message}`);
        console.log(`Path:        ${err.path || err.url || '?'}`);
        console.log(`Occurrences: ${err.occurrences || 1}`);
        console.log(`First seen:  ${err.firstSeen || '?'} (${timeAgo(err.firstSeen)})`);
        console.log(`Last seen:   ${err.lastSeen || '?'} (${timeAgo(err.lastSeen)})`);
        console.log(`Session:     ${err.lastSeenSessionId || err.sessionId || '?'}`);
        if (err.stack) console.log(`Stack:\n${err.stack}`);
        if (err.context && Object.keys(err.context).length > 0) {
          console.log(`Context:     ${JSON.stringify(err.context, null, 2)}`);
        }
        if (err.breadcrumbs && err.breadcrumbs.length > 0) {
          console.log(`Breadcrumbs (last ${Math.min(err.breadcrumbs.length, 10)}):`);
          err.breadcrumbs.slice(-10).forEach(bc => {
            const time = bc.timestamp ? new Date(bc.timestamp).toLocaleTimeString() : '?';
            console.log(`  ${time} [${bc.type}] ${bc.action || bc.message || bc.url || bc.to || ''}`);
          });
        }
      }
      console.log(`\n${'='.repeat(60)}\n`);
      process.exit(0);
    }

    // Group errors by fingerprint
    const groups = new Map();
    for (const err of filteredErrors) {
      const fp = err.fingerprint || 'unknown';
      if (!groups.has(fp)) {
        groups.set(fp, {
          fingerprint: fp, message: err.message, source: err.source,
          docs: 0, totalOccurrences: 0,
          firstSeen: err.firstSeen, lastSeen: err.lastSeen,
          lastSeenSessionId: err.lastSeenSessionId || err.sessionId,
          errors: []
        });
      }
      const g = groups.get(fp);
      g.docs++;
      g.totalOccurrences += (err.occurrences || 1);
      if (err.lastSeen > g.lastSeen) g.lastSeen = err.lastSeen;
      if (err.firstSeen && (!g.firstSeen || err.firstSeen < g.firstSeen)) g.firstSeen = err.firstSeen;
      g.errors.push(err);
    }
    const grouped = [...groups.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    // Correlate related errors (same page + overlapping time window)
    const correlations = [];
    for (let i = 0; i < grouped.length; i++) {
      for (let j = i + 1; j < grouped.length; j++) {
        const a = grouped[i], b = grouped[j];
        const aPath = a.errors[0]?.path || '';
        const bPath = b.errors[0]?.path || '';
        if (!aPath || aPath !== bPath) continue;
        // Check if they share a session
        const aSessions = new Set(a.errors.map(e => e.lastSeenSessionId || e.sessionId));
        const bSessions = new Set(b.errors.map(e => e.lastSeenSessionId || e.sessionId));
        const shared = [...aSessions].some(s => bSessions.has(s));
        if (shared) {
          correlations.push({ indices: [i + 1, j + 1], path: aPath, fingerprints: [a.fingerprint, b.fingerprint] });
        }
      }
    }

    const output = {
      pulledAt: new Date().toISOString(),
      sessionInfo: 'Current BlackBox session data',
      errorCount: filteredErrors.length,
      uniqueFingerprints: grouped.length,
      correlations: correlations.length > 0 ? correlations : undefined,
      grouped,
      errors: filteredErrors
    };

    const filePath = writeLog('blackbox.json', output);

    const label = newOnly && lastCheck ? ` (new since ${timeAgo(lastCheck)})` : '';
    console.log(`\n[BlackBox] Pulled ${filteredErrors.length} error(s) → ${grouped.length} unique issues${label} → dev-logs/blackbox.json\n`);

    grouped.forEach((g, i) => {
      const src = `[${g.source || 'error'}]`.padEnd(18);
      const msg = verbose ? g.message : (g.message || '').slice(0, 60);
      const last = timeAgo(g.lastSeen);
      const occ = g.totalOccurrences;
      console.log(`  ${String(i + 1).padStart(2)}. ${src} ${msg}`);
      console.log(`      ${occ} occ, last: ${last}, fp: ${g.fingerprint}`);
      if (verbose && g.errors[0]) {
        const e = g.errors[0];
        if (e.path) console.log(`      path: ${e.path}`);
        if (e.context && Object.keys(e.context).length > 0) console.log(`      ctx: ${JSON.stringify(e.context)}`);
      }
    });
    if (grouped.length > 0) console.log('');

    // Show correlations
    if (correlations.length > 0) {
      console.log('  Possibly related:');
      for (const c of correlations) {
        console.log(`    #${c.indices.join(' + #')} — same page (${c.path}), same session`);
      }
      console.log('');
    }

    saveLastCheckTime();
    process.exit(0);
  } catch (e) {
    if (e.message?.includes('index') || e.message?.includes('requires an index')) {
      console.error('\n[BlackBox] Firestore composite index required for bb:check.');
      console.error('Add this to your firestore.indexes.json and run: firebase deploy --only firestore:indexes\n');
      console.error(JSON.stringify({ collectionGroup: "__blackbox", queryScope: "COLLECTION", fields: [{ fieldPath: "type", order: "ASCENDING" }, { fieldPath: "lastSeen", order: "DESCENDING" }] }, null, 2));
      console.error('\nOr click the link in the original error:', e.message);
    } else {
      console.error(`[BlackBox] bb-check failed: ${e.message}`);
    }
    process.exit(1);
  }
}

main();
