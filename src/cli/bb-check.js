#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize, formatError } from './shared/utils.js';
import { collection, query, where, orderBy, limit, getDocs, deleteDoc, doc as docRef } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const CURRENT_SCHEMA = 1;
const LAST_CHECK_FILE = path.join(process.cwd(), 'dev-logs', '.bb-last-check');

// Silently drop docs older than this so the collection doesn't grow forever
// and the "501-doc warning" doesn't fire while you're still mid-debug. The
// previous behavior nagged the user; new behavior cleans up in the same
// breath as the read.
const STALE_DAYS = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  let verbose = false;
  let id = null;
  let newOnly = false;
  let pathFilter = null;
  let sourceFilter = null;
  let sinceFilter = null; // ms
  let includeInternal = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--verbose' || a === '-v') verbose = true;
    else if (a === '--new') newOnly = true;
    else if (a === '--include-internal') includeInternal = true;
    else if (a === '--id' && args[i + 1]) { id = args[++i]; }
    else if (a.startsWith('--id=')) { id = a.slice(5); }
    else if (a === '--path' && args[i + 1]) { pathFilter = args[++i]; }
    else if (a.startsWith('--path=')) { pathFilter = a.slice(7); }
    else if (a === '--source' && args[i + 1]) { sourceFilter = args[++i]; }
    else if (a.startsWith('--source=')) { sourceFilter = a.slice(9); }
    else if (a === '--since' && args[i + 1]) { sinceFilter = parseDuration(args[++i]); }
    else if (a.startsWith('--since=')) { sinceFilter = parseDuration(a.slice(8)); }
  }
  return { verbose, id, newOnly, pathFilter, sourceFilter, sinceFilter, includeInternal };
}

// Parses "1h", "30m", "2d", "10s" → milliseconds. Anything unrecognized
// silently maps to null so the caller can treat it as "no filter".
function parseDuration(s) {
  if (!s) return null;
  const m = String(s).trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
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

// Best-effort cleanup of docs older than STALE_DAYS. Runs silently and never
// throws — if it fails (rules, network, transient), we just continue. This
// replaces the prior "501 docs, queries may be slow" warning.
async function purgeStaleDocs(db, collectionName, isAdmin) {
  const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  let purged = 0;
  try {
    if (isAdmin) {
      const snap = await db.collection(collectionName)
        .where('lastSeen', '<', cutoff)
        .limit(200)
        .get();
      for (const d of snap.docs) {
        try { await d.ref.delete(); purged++; } catch { /* skip */ }
      }
    } else {
      const q = query(
        collection(db, collectionName),
        where('lastSeen', '<', cutoff),
        limit(200)
      );
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        try { await deleteDoc(docRef(db, collectionName, d.id)); purged++; } catch { /* skip */ }
      }
    }
  } catch { /* ignore — cleanup is best-effort */ }
  return purged;
}

async function main() {
  try {
    const { verbose, id, newOnly, pathFilter, sourceFilter, sinceFilter, includeInternal } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();

    // Silent cleanup before the read so the user never sees "queries may be
    // slow" mid-debug. Skip when targeting a specific id — debugging a
    // specific error shouldn't pay the cleanup cost.
    if (!id) {
      await purgeStaleDocs(db, collectionName, isAdmin);
    }
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
      if (entry.ackedUntil?.toDate) entry.ackedUntil = entry.ackedUntil.toDate().toISOString();
      if (entry.schemaVersion !== CURRENT_SCHEMA) {
        entry._warning = 'schema version mismatch, some fields may differ';
      }
      return entry;
    });

    // Filter for --new (since last check)
    const lastCheck = getLastCheckTime();
    let filteredErrors = errors;
    if (newOnly && lastCheck) {
      filteredErrors = filteredErrors.filter(e => e.lastSeen && e.lastSeen > lastCheck);
    }

    // Filter for --since=1h (relative time)
    if (sinceFilter) {
      const cutoff = new Date(Date.now() - sinceFilter).toISOString();
      filteredErrors = filteredErrors.filter(e => e.lastSeen && e.lastSeen > cutoff);
    }

    // Filter for --path=/admin/sites (substring match)
    if (pathFilter) {
      filteredErrors = filteredErrors.filter(e => (e.path || e.url || '').includes(pathFilter));
    }

    // Filter for --source=network (exact match)
    if (sourceFilter) {
      filteredErrors = filteredErrors.filter(e => e.source === sourceFilter);
    }

    // Hide framework-internal errors (react-dom warnings, etc) by default —
    // they're noise that distracts from real app bugs. --include-internal
    // shows them. Surface a count so the user knows they exist.
    let hiddenInternalCount = 0;
    if (!includeInternal) {
      const before = filteredErrors.length;
      filteredErrors = filteredErrors.filter(e => e.internal !== true);
      hiddenInternalCount = before - filteredErrors.length;
    }

    // Hide acknowledged errors (ackedUntil > now). --include-internal does
    // NOT also unhide acked — they're independent axes. Acked errors come
    // back automatically once their TTL expires.
    let hiddenAckedCount = 0;
    {
      const before = filteredErrors.length;
      const nowIso = new Date().toISOString();
      filteredErrors = filteredErrors.filter(e => !(e.ackedUntil && e.ackedUntil > nowIso));
      hiddenAckedCount = before - filteredErrors.length;
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
        if (err.uniqueUserCount) console.log(`Unique users: ${err.uniqueUserCount}`);
        if (err.internal) console.log(`Internal:    yes (framework-only stack)`);
        if (err.ackedUntil) console.log(`Acked until: ${err.ackedUntil} (${err.ackComment || 'no comment'})`);
        console.log(`First seen:  ${err.firstSeen || '?'} (${timeAgo(err.firstSeen)})`);
        console.log(`Last seen:   ${err.lastSeen || '?'} (${timeAgo(err.lastSeen)})`);
        console.log(`Session:     ${err.lastSeenSessionId || err.sessionId || '?'}`);
        if (err.metadata?.buildSha) console.log(`Build SHA:   ${err.metadata.buildSha}`);
        if (err.metadata?.nodeEnv) console.log(`Node env:    ${err.metadata.nodeEnv}`);
        if (err.environment) console.log(`Environment: ${err.environment}`);
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
          docs: 0, totalOccurrences: 0, uniqueUserCount: 0,
          firstSeen: err.firstSeen, lastSeen: err.lastSeen,
          lastSeenSessionId: err.lastSeenSessionId || err.sessionId,
          paths: new Set(),
          errors: []
        });
      }
      const g = groups.get(fp);
      g.docs++;
      g.totalOccurrences += (err.occurrences || 1);
      // Take the max seen unique-user count rather than summing — different
      // doc rows for the same fingerprint may double-count the same user.
      if ((err.uniqueUserCount || 0) > g.uniqueUserCount) g.uniqueUserCount = err.uniqueUserCount;
      if (err.path) g.paths.add(err.path);
      if (err.lastSeen > g.lastSeen) g.lastSeen = err.lastSeen;
      if (err.firstSeen && (!g.firstSeen || err.firstSeen < g.firstSeen)) g.firstSeen = err.firstSeen;
      g.errors.push(err);
    }
    for (const g of groups.values()) {
      g.paths = [...g.paths].slice(0, 5);
    }
    const grouped = [...groups.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    // Correlate related errors. Two flavors:
    //   1. Same path + same session (high confidence "same crash flow")
    //   2. Same fingerprint observed across different paths (one bug, many
    //      pages) — surfaces cross-route impact in one view.
    const correlations = [];
    for (let i = 0; i < grouped.length; i++) {
      for (let j = i + 1; j < grouped.length; j++) {
        const a = grouped[i], b = grouped[j];
        const aPath = a.errors[0]?.path || '';
        const bPath = b.errors[0]?.path || '';
        if (!aPath || aPath !== bPath) continue;
        const aSessions = new Set(a.errors.map(e => e.lastSeenSessionId || e.sessionId));
        const bSessions = new Set(b.errors.map(e => e.lastSeenSessionId || e.sessionId));
        const shared = [...aSessions].some(s => bSessions.has(s));
        if (shared) {
          correlations.push({ kind: 'same_path_session', indices: [i + 1, j + 1], path: aPath, fingerprints: [a.fingerprint, b.fingerprint] });
        }
      }
    }
    // Cross-path same-fingerprint clusters: any fingerprint that fired on
    // 2+ paths is one bug, not two. The previous version missed this.
    for (let i = 0; i < grouped.length; i++) {
      const g = grouped[i];
      if (g.paths.length >= 2) {
        correlations.push({ kind: 'multi_path', index: i + 1, paths: g.paths, fingerprint: g.fingerprint });
      }
    }

    // Pull the most recent error's environment/buildSha into sessionInfo so
    // the report header tells you "dev / commit abc1234" without grepping.
    const recent = errors[0];
    const sessionInfo = {
      checkedAt: new Date().toISOString(),
      environment: recent?.environment || null,
      buildSha: recent?.metadata?.buildSha || null,
      nodeEnv: recent?.metadata?.nodeEnv || null,
      lastSeenSessionId: recent?.lastSeenSessionId || recent?.sessionId || null,
    };

    const output = {
      pulledAt: new Date().toISOString(),
      sessionInfo,
      filters: { pathFilter, sourceFilter, sinceFilter, newOnly, includeInternal },
      errorCount: filteredErrors.length,
      uniqueFingerprints: grouped.length,
      hiddenInternalCount: hiddenInternalCount > 0 ? hiddenInternalCount : undefined,
      hiddenAckedCount: hiddenAckedCount > 0 ? hiddenAckedCount : undefined,
      correlations: correlations.length > 0 ? correlations : undefined,
      grouped,
      errors: filteredErrors
    };

    const filePath = writeLog('blackbox.json', output);

    const label = newOnly && lastCheck ? ` (new since ${timeAgo(lastCheck)})` : '';
    console.log(`\n[BlackBox] Pulled ${filteredErrors.length} error(s) → ${grouped.length} unique issues${label} → dev-logs/blackbox.json`);
    if (sessionInfo.environment || sessionInfo.buildSha || sessionInfo.nodeEnv) {
      const envBits = [];
      if (sessionInfo.environment) envBits.push(`env: ${sessionInfo.environment}`);
      if (sessionInfo.nodeEnv) envBits.push(`NODE_ENV: ${sessionInfo.nodeEnv}`);
      if (sessionInfo.buildSha) envBits.push(`build: ${sessionInfo.buildSha.slice(0, 8)}`);
      console.log(`            ${envBits.join(' | ')}`);
    }
    if (hiddenInternalCount > 0) {
      console.log(`            ${hiddenInternalCount} framework-internal error(s) hidden — re-run with --include-internal to see them`);
    }
    if (hiddenAckedCount > 0) {
      console.log(`            ${hiddenAckedCount} acknowledged error(s) hidden`);
    }
    console.log('');

    grouped.forEach((g, i) => {
      const src = `[${g.source || 'error'}]`.padEnd(18);
      const msg = verbose ? g.message : (g.message || '').slice(0, 60);
      const last = timeAgo(g.lastSeen);
      const occ = g.totalOccurrences;
      const userBit = g.uniqueUserCount > 1 ? `, ${g.uniqueUserCount} users` : '';
      console.log(`  ${String(i + 1).padStart(2)}. ${src} ${msg}`);
      console.log(`      ${occ} occ${userBit}, last: ${last}, fp: ${g.fingerprint}`);
      if (g.paths.length > 1) {
        console.log(`      paths: ${g.paths.slice(0, 3).join(', ')}${g.paths.length > 3 ? ' …' : ''}`);
      }
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
        if (c.kind === 'same_path_session') {
          console.log(`    #${c.indices.join(' + #')} — same page (${c.path}), same session`);
        } else if (c.kind === 'multi_path') {
          console.log(`    #${c.index} — same fingerprint on ${c.paths.length} pages: ${c.paths.slice(0, 3).join(', ')}`);
        }
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
