#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize } from './shared/utils.js';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';

function parseArgs() {
  const args = process.argv.slice(2);
  let minutes = 5;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--minutes' && args[i + 1]) {
      minutes = parseInt(args[i + 1], 10) || 5;
    }
  }
  return { minutes };
}

async function main() {
  try {
    const { minutes } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();
    await checkCollectionSize(db, collectionName, isAdmin);

    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    let docs;

    if (isAdmin) {
      const snapshot = await db.collection(collectionName)
        .where('createdAt', '>=', cutoff)
        .get();
      docs = snapshot.docs.map(d => d.data());
    } else {
      const ts = Timestamp.fromDate(cutoff);
      const q = query(
        collection(db, collectionName),
        where('createdAt', '>=', ts)
      );
      const snapshot = await getDocs(q);
      docs = snapshot.docs.map(d => d.data());
    }

    // Extract breadcrumbs from ALL documents (both error and activity)
    const allBreadcrumbs = [];
    for (const doc of docs) {
      if (Array.isArray(doc.breadcrumbs)) {
        for (const crumb of doc.breadcrumbs) {
          allBreadcrumbs.push(crumb);
        }
      }
    }

    // Deduplicate by timestamp (same timestamp = same event)
    const seen = new Set();
    const unique = [];
    for (const crumb of allBreadcrumbs) {
      const key = crumb.timestamp || '';
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      unique.push(crumb);
    }

    // Sort chronologically (oldest first)
    unique.sort((a, b) => {
      const ta = a.timestamp || '';
      const tb = b.timestamp || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const timeRange = {
      from: unique.length > 0 ? unique[0].timestamp : null,
      to: unique.length > 0 ? unique[unique.length - 1].timestamp : null,
    };

    const output = {
      generatedAt: new Date().toISOString(),
      windowMinutes: minutes,
      eventCount: unique.length,
      timeRange,
      events: unique,
    };

    writeLog('bb-timeline.json', output);

    console.log(`\n[BlackBox] Timeline → dev-logs/bb-timeline.json`);
    console.log(`  Window:  last ${minutes} minutes`);
    console.log(`  Events:  ${unique.length}`);
    if (timeRange.from) {
      console.log(`  Range:   ${timeRange.from} → ${timeRange.to}`);
    }
    console.log('');

    process.exit(0);
  } catch (e) {
    console.error(`[BlackBox] bb-timeline failed: ${e.message}`);
    process.exit(1);
  }
}

main();
