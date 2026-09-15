#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { parseCliArgs, exitWithUsage } from './shared/utils.js';
import { collection, query, where, getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';

const USAGE = `Usage: bb-clear [option]
  (no option)               Delete docs created more than 1 day ago
  --days N                  Delete docs created more than N days ago (N >= 1)
  --fingerprint <hash>      Delete only docs for one fingerprint (aliases: --fp, --id)
  --all                     Delete every doc and the local dev-logs/ BlackBox files
  -h, --help                Show this help
Both --flag value and --flag=value work. Options can't be combined.`;

// Strict on purpose: this command deletes data, so an unrecognized or
// malformed flag must fail loudly instead of falling back to the default
// "older than 1 day" delete.
function parseArgs() {
  const { flags } = parseCliArgs({
    '--all': 'bool',
    '--days': 'int',
    '--fingerprint|--fp|--id': 'string',
  }, USAGE);
  const all = flags.all === true;
  const fingerprint = flags.fingerprint ?? null;
  if (flags.days !== undefined && flags.days < 1) exitWithUsage('--days must be 1 or more', USAGE);
  if ([all, flags.days !== undefined, fingerprint !== null].filter(Boolean).length > 1) {
    exitWithUsage('Use only one of --all, --days, --fingerprint', USAGE);
  }
  return { days: flags.days ?? 1, all, fingerprint };
}

async function main() {
  try {
    const { days, all, fingerprint } = parseArgs();
    const { db, collectionName, isAdmin } = await connectToFirestore();

    let totalDeleted = 0;

    if (isAdmin) {
      let snapshot;
      if (fingerprint) {
        snapshot = await db.collection(collectionName)
          .where('fingerprint', '==', fingerprint)
          .get();
      } else if (all) {
        snapshot = await db.collection(collectionName).get();
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        snapshot = await db.collection(collectionName)
          .where('createdAt', '<', cutoff)
          .get();
      }

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
      let q;
      if (fingerprint) {
        q = query(
          collection(db, collectionName),
          where('fingerprint', '==', fingerprint)
        );
      } else if (all) {
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

    const label = fingerprint ? `(fingerprint: ${fingerprint})`
      : all ? '(all)'
      : `(older than ${days} days)`;
    console.log(`[BlackBox] Cleared ${totalDeleted} Firestore documents ${label}`);

    // Clean local log files only on --all
    if (all) {
      const devLogsDir = path.join(process.cwd(), 'dev-logs');
      if (fs.existsSync(devLogsDir)) {
        const bbFiles = fs.readdirSync(devLogsDir).filter(f =>
          f.startsWith('blackbox') || f.startsWith('bb-') || f.startsWith('.bb-')
        );
        for (const file of bbFiles) {
          try {
            fs.unlinkSync(path.join(devLogsDir, file));
          } catch { /* skip */ }
        }
      }
      console.log(`[BlackBox] Cleared local log files in dev-logs/`);
    }

    process.exit(0);
  } catch (e) {
    console.error(`[BlackBox] bb-clear failed: ${e.message}`);
    process.exit(1);
  }
}

main();
