#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize, formatError, parseCliArgs } from './shared/utils.js';
import { collection, query, where, orderBy, limit, getDocs, deleteDoc, doc as docRef } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const CURRENT_SCHEMA = 1;
const LAST_CHECK_FILE = path.join(process.cwd(), 'dev-logs', '.bb-last-check');

// Silently drop docs older than this so the collection doesn't grow forever
// and the "501-doc warning" rarely fires while you're still mid-debug.
const STALE_DAYS = 7;

const USAGE = `Usage: bb-check [options]
  --id <fingerprint>        Full detail for one error (skips the stale-doc purge)
  --new                     Only errors seen since the last unfiltered bb-check
                            (--path/--source/--since/--status runs don't move it)
  --since <duration>        Only errors seen within 30s, 5m, 2h, 7d, ...
  --path <substring>        Only errors whose path contains the substring
  --source <source>         Only errors with this source (network, storage, firebase, ...)
  --status <code>           Only errors with this HTTP status
  --include-internal        Also show framework-internal errors
  -v, --verbose             Full messages, paths and context
  -h, --help                Show this help
Both --flag value and --flag=value work.`;

// Unknown flags and unparseable values exit before connecting, so a typo like
// --since=1w can't silently return unfiltered results (and --help doesn't run
// the purge or reset the --new baseline).
function parseArgs() {
  const { flags } = parseCliArgs({
    '--verbose|-v': 'bool',
    '--new': 'bool',
    '--include-internal': 'bool',
    '--id': 'string',
    '--path': 'string',
    '--source': 'string',
    '--since': 'duration',
    '--status': 'int',
  }, USAGE);
  return {
    verbose: flags.verbose === true,
    id: flags.id ?? null,
    newOnly: flags.new === true,
    pathFilter: flags.path ?? null,
    sourceFilter: flags.source ?? null,
    sinceFilter: flags.since ?? null, // ms
    statusFilter: flags.status ?? null, // number | null
    includeInternal: flags['include-internal'] === true,
  };
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

function saveLastCheckTime(isoString) {
  try {
    const dir = path.dirname(LAST_CHECK_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_CHECK_FILE, isoString);
  } catch { /* ignore */ }
}

// Best-effort cleanup of docs not seen for STALE_DAYS, plus activity docs past
// their expireAt (they have no lastSeen, and the 48h expiry only happens on
// its own if the project enabled a Firestore TTL policy on expireAt). Runs
// silently and never throws — if a query fails (rules, network, transient),
// we just continue. checkCollectionSize still runs after it as a backstop.
async function purgeStaleDocs(db, collectionName, isAdmin) {
  const cutoffs = [
    ['lastSeen', new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000)],
    ['expireAt', new Date()],
  ];
  let purged = 0;
  for (const [field, cutoff] of cutoffs) {
    try {
      if (isAdmin) {
        const snap = await db.collection(collectionName)
          .where(field, '<', cutoff)
          .limit(200)
          .get();
        for (const d of snap.docs) {
          try { await d.ref.delete(); purged++; } catch { /* skip */ }
        }
      } else {
        const q = query(
          collection(db, collectionName),
          where(field, '<', cutoff),
          limit(200)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          try { await deleteDoc(docRef(db, collectionName, d.id)); purged++; } catch { /* skip */ }
        }
      }
    } catch { /* ignore — cleanup is best-effort */ }
  }
  return purged;
}

async function main() {
  try {
    const { verbose, id, newOnly, pathFilter, sourceFilter, sinceFilter, statusFilter, includeInternal } = parseArgs();
    // The --new baseline is taken BEFORE the query, so errors that land while
    // this run is reading/printing still count as new next time.
    const checkStartedAt = new Date().toISOString();
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

    // Filter for --status=404 — checks context.httpStatus (resource_load,
    // network errors), context.status (HTTP errors), or storage error status.
    if (statusFilter !== null) {
      filteredErrors = filteredErrors.filter(e => {
        const s = e.context?.httpStatus ?? e.context?.status;
        return s === statusFilter;
      });
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
            const detail = bc.type === 'click'
              ? `${bc.tag || 'element'}${bc.id ? '#' + bc.id : ''} "${bc.text || bc.autoLabel || ''}"`
              : (bc.action || bc.message || bc.url || bc.to || '');
            console.log(`  ${time} [${bc.type}] ${detail}`);
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

    // Same-host clusters across fingerprints: when 2+ DIFFERENT fingerprints
    // hit the same hostname (e.g. m.digitalden.solutions across resource_load
    // and network sources), that's almost certainly one underlying root
    // cause — a dead origin, a misconfigured CDN, a missing KV pointer.
    // Two debug sessions had a 6-fingerprint pile-up from a single bad host
    // before this clustering existed. Now they collapse to one row.
    {
      const byHost = new Map();
      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i];
        if (g.source !== 'resource_load' && g.source !== 'network') continue;
        // Try error.context.hostname first, then fall back to parsing the
        // URL out of the message ("Resource failed to load: img - https://h/..").
        const hostsSeen = new Set();
        for (const e of g.errors) {
          const h = e.context?.hostname;
          if (h) { hostsSeen.add(h); continue; }
          const m = (e.message || '').match(/https?:\/\/([^/\s]+)/);
          if (m) hostsSeen.add(m[1]);
        }
        for (const host of hostsSeen) {
          if (!byHost.has(host)) byHost.set(host, []);
          byHost.get(host).push({ index: i + 1, fingerprint: g.fingerprint, occurrences: g.totalOccurrences });
        }
      }
      for (const [host, entries] of byHost) {
        if (entries.length >= 2) {
          const totalOcc = entries.reduce((a, e) => a + e.occurrences, 0);
          correlations.push({
            kind: 'url_host_cluster',
            host,
            indices: entries.map(e => e.index),
            fingerprints: entries.map(e => e.fingerprint),
            totalOccurrences: totalOcc,
          });
        }
      }
    }

    // Same-shape Firestore-write clusters across DIFFERENT collections.
    // When 2+ fingerprints all surface "Unsupported field value: undefined"
    // (or similar invalid-argument boilerplate) but on different document
    // paths (`proposals/...` vs `savedSections/...` vs `users/...`), they
    // share an underlying app pattern: passing optional fields through
    // without coercing undefined → null/''. Surfacing the cluster on the
    // FIRST occurrence lets the dev fix at the service layer instead of
    // shipping point fixes per-collection. Same shape as url_host_cluster.
    {
      const INVALID_ARG_RE = /Unsupported field value: undefined|invalid-argument/i;
      const byShape = new Map();
      for (let i = 0; i < grouped.length; i++) {
        const g = grouped[i];
        if (g.source !== 'firebase') continue;
        if (!INVALID_ARG_RE.test(g.message || '')) continue;
        // Bucket by the leading collection segment of documentPath.
        const collections = new Set();
        for (const e of g.errors) {
          const p = e.context?.documentPath || e.path || '';
          const seg = String(p).split('/')[0];
          if (seg) collections.add(seg);
        }
        for (const col of collections) {
          if (!byShape.has(col)) byShape.set(col, []);
          byShape.get(col).push({ index: i + 1, fingerprint: g.fingerprint, occurrences: g.totalOccurrences });
        }
      }
      // Cluster condition: 2+ fingerprints across 2+ DIFFERENT collections.
      // (Same-collection invalid-argument clusters are usually one bug;
      // already merged by fingerprint upstream.)
      const allEntries = [];
      const seenIdx = new Set();
      for (const [col, entries] of byShape) {
        for (const e of entries) {
          const k = `${e.index}:${col}`;
          if (seenIdx.has(k)) continue;
          seenIdx.add(k);
          allEntries.push({ ...e, collection: col });
        }
      }
      const distinctCols = new Set(allEntries.map(e => e.collection));
      if (allEntries.length >= 2 && distinctCols.size >= 2) {
        const totalOcc = allEntries.reduce((a, e) => a + e.occurrences, 0);
        correlations.push({
          kind: 'invalid_argument_cluster',
          collections: [...distinctCols],
          indices: allEntries.map(e => e.index),
          fingerprints: allEntries.map(e => e.fingerprint),
          totalOccurrences: totalOcc,
        });
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
      filters: { pathFilter, sourceFilter, sinceFilter, statusFilter, newOnly, includeInternal },
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
        } else if (c.kind === 'url_host_cluster') {
          console.log(`    #${c.indices.join(' + #')} — ${c.indices.length} fingerprints against ${c.host} (${c.totalOccurrences} occ total) — likely ONE root cause`);
        } else if (c.kind === 'invalid_argument_cluster') {
          console.log(`    #${c.indices.join(' + #')} — invalid-argument across ${c.collections.length} collections (${c.collections.slice(0, 4).join(', ')}${c.collections.length > 4 ? ' …' : ''}) — fix at the write/service layer, not per collection`);
        }
      }
      console.log('');
    }

    // Only an unfiltered run moves the --new baseline. A narrow look like
    // --source=storage must not hide other sources' errors from the next --new.
    if ([pathFilter, sourceFilter, sinceFilter, statusFilter].every(f => f === null)) {
      saveLastCheckTime(checkStartedAt);
    }
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
