#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize, parseCliArgs, exitWithUsage } from './shared/utils.js';
import { collection, query, where, orderBy, getDocs, Timestamp } from 'firebase/firestore';

const USAGE = `Usage: bb-timeline [--minutes N]
  --minutes N               Window size in minutes (default 5, N >= 1)
  -h, --help                Show this help
Both --flag value and --flag=value work.`;

function parseArgs() {
  const { flags } = parseCliArgs({ '--minutes': 'int' }, USAGE);
  if (flags.minutes !== undefined && flags.minutes < 1) exitWithUsage('--minutes must be 1 or more', USAGE);
  return { minutes: flags.minutes ?? 5 };
}

async function main() {
  try {
    const { minutes } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();
    await checkCollectionSize(db, collectionName, isAdmin);

    const cutoff = new Date(Date.now() - minutes * 60 * 1000);

    let docs;

    // Error docs are deduped by fingerprint: a re-fire bumps lastSeen and
    // refreshes breadcrumbs but keeps the original createdAt. So createdAt
    // alone misses recurring errors; also pull errors by lastSeen and merge
    // (the breadcrumb dedup below absorbs the overlap).
    if (isAdmin) {
      const snapshot = await db.collection(collectionName)
        .where('createdAt', '>=', cutoff)
        .get();
      const errSnap = await db.collection(collectionName)
        .where('type', '==', 'error')
        .where('lastSeen', '>=', cutoff)
        .orderBy('lastSeen', 'desc')
        .get();
      docs = [...snapshot.docs, ...errSnap.docs].map(d => d.data());
    } else {
      const ts = Timestamp.fromDate(cutoff);
      const q = query(
        collection(db, collectionName),
        where('createdAt', '>=', ts)
      );
      const errQ = query(
        collection(db, collectionName),
        where('type', '==', 'error'),
        where('lastSeen', '>=', ts),
        orderBy('lastSeen', 'desc')
      );
      const snapshot = await getDocs(q);
      const errSnap = await getDocs(errQ);
      docs = [...snapshot.docs, ...errSnap.docs].map(d => d.data());
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

    // Deduplicate by timestamp + type + identifier
    const seen = new Set();
    const unique = [];
    for (const crumb of allBreadcrumbs) {
      const key = (crumb.timestamp || '') + '|' + (crumb.type || '') + '|' + (crumb.url || crumb.message || crumb.action || crumb.to || crumb.tag || '');
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
