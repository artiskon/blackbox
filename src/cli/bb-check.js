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

    const output = {
      pulledAt: new Date().toISOString(),
      sessionInfo: 'Current BlackBox session data',
      errorCount: errors.length,
      errors
    };

    const filePath = writeLog('blackbox.json', output);

    console.log(`\n[BlackBox] Pulled ${errors.length} error(s) to dev-logs/blackbox.json\n`);
    errors.forEach((err, i) => {
      console.log(formatError(i + 1, err));
    });
    if (errors.length > 0) console.log('');

    process.exit(0);
  } catch (e) {
    console.error(`[BlackBox] bb-check failed: ${e.message}`);
    process.exit(1);
  }
}

main();
