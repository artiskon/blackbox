#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize, formatError } from './shared/utils.js';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';

const CURRENT_SCHEMA = 1;

async function main() {
  try {
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

    // Handle schema version mismatches
    const errors = docs.map(doc => {
      const entry = { ...doc };
      // Convert Firestore timestamps to ISO strings
      if (entry.firstSeen?.toDate) entry.firstSeen = entry.firstSeen.toDate().toISOString();
      if (entry.lastSeen?.toDate) entry.lastSeen = entry.lastSeen.toDate().toISOString();
      if (entry.createdAt?.toDate) entry.createdAt = entry.createdAt.toDate().toISOString();
      if (entry.schemaVersion !== CURRENT_SCHEMA) {
        entry._warning = 'schema version mismatch, some fields may differ';
      }
      return entry;
    });

    // Group errors by fingerprint
    const groups = new Map();
    for (const err of errors) {
      const fp = err.fingerprint || 'unknown';
      if (!groups.has(fp)) {
        groups.set(fp, { fingerprint: fp, message: err.message, source: err.source, docs: 0, totalOccurrences: 0, lastSeen: err.lastSeen, errors: [] });
      }
      const g = groups.get(fp);
      g.docs++;
      g.totalOccurrences += (err.occurrences || 1);
      if (err.lastSeen > g.lastSeen) g.lastSeen = err.lastSeen;
      g.errors.push(err);
    }
    const grouped = [...groups.values()].sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    const output = {
      pulledAt: new Date().toISOString(),
      sessionInfo: 'Current BlackBox session data',
      errorCount: errors.length,
      uniqueFingerprints: grouped.length,
      grouped,
      errors
    };

    const filePath = writeLog('blackbox.json', output);

    console.log(`\n[BlackBox] Pulled ${errors.length} error(s) → ${grouped.length} unique issues → dev-logs/blackbox.json\n`);
    grouped.forEach((g, i) => {
      const src = `[${g.source || 'error'}]`.padEnd(12);
      const msg = (g.message || '').slice(0, 60);
      console.log(`  ${i + 1}. ${src} ${msg}  (${g.docs} doc${g.docs > 1 ? 's' : ''}, ${g.totalOccurrences} occurrences)`);
    });
    if (grouped.length > 0) console.log('');

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
