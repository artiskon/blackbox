#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { ensureDevLogs } from './shared/utils.js';
import { collection, query, where, getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  let days = 7;
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--all') all = true;
    if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[i + 1], 10);
      if (isNaN(days)) days = 7;
    }
  }
  return { days, all };
}

async function main() {
  try {
    const { days, all } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();

    let totalDeleted = 0;

    if (isAdmin) {
      // firebase-admin path
      let snapshot;
      if (all) {
        snapshot = await db.collection(collectionName).get();
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        snapshot = await db.collection(collectionName)
          .where('createdAt', '<', cutoff)
          .get();
      }

      // Delete in batches of 50
      const docs = snapshot.docs;
      for (let i = 0; i < docs.length; i += 50) {
        const batch = db.batch();
        const chunk = docs.slice(i, i + 50);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
        totalDeleted += chunk.length;
      }
    } else {
      // Web SDK path
      let q;
      if (all) {
        q = query(collection(db, collectionName));
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const ts = Timestamp.fromDate(cutoff);
        q = query(
          collection(db, collectionName),
          where('createdAt', '<', ts)
        );
      }

      const snapshot = await getDocs(q);
      const docs = snapshot.docs;

      // Delete in batches of 50
      for (let i = 0; i < docs.length; i += 50) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + 50);
        for (const d of chunk) {
          batch.delete(d.ref);
        }
        await batch.commit();
        totalDeleted += chunk.length;
      }
    }

    const label = all ? '(all)' : `(older than ${days} days)`;
    console.log(`[BlackBox] Cleared ${totalDeleted} Firestore documents ${label}`);

    // Clean local log files
    const devLogsDir = path.join(process.cwd(), 'dev-logs');
    if (fs.existsSync(devLogsDir)) {
      const files = fs.readdirSync(devLogsDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(devLogsDir, file));
        } catch { /* skip */ }
      }
    }
    console.log(`[BlackBox] Cleared local log files in dev-logs/`);

    process.exit(0);
  } catch (e) {
    console.error(`[BlackBox] bb-clear failed: ${e.message}`);
    process.exit(1);
  }
}

main();
