#!/usr/bin/env node

/**
 * Acknowledge / mute an error fingerprint so it stops cluttering bb-check.
 * Use when you've triaged a known error (e.g. "expected 403 until user adds
 * scope") and want to suppress it for a fixed window. The error returns
 * automatically when ackedUntil expires — no permanent ignores.
 *
 * Usage:
 *   bb-ack <fingerprint>                 # default: 7 days, no comment
 *   bb-ack <fingerprint> --for 1d        # 1 day TTL
 *   bb-ack <fingerprint> --for 30d       # 30 days
 *   bb-ack <fingerprint> --comment "waiting on CF scope"
 *   bb-ack <fingerprint> --clear         # remove the ack
 *   bb-ack --list                        # list currently-acked fingerprints
 */

import { connectToFirestore } from './shared/firebase-connect.js';
import { collection, query, where, getDocs, updateDoc, doc as docRef, deleteField } from 'firebase/firestore';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { fingerprint: null, forStr: '7d', comment: '', clear: false, list: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--list') out.list = true;
    else if (a === '--clear') out.clear = true;
    else if (a === '--for' && args[i + 1]) { out.forStr = args[++i]; }
    else if (a.startsWith('--for=')) { out.forStr = a.slice(6); }
    else if (a === '--comment' && args[i + 1]) { out.comment = args[++i]; }
    else if (a.startsWith('--comment=')) { out.comment = a.slice(10); }
    else if (!a.startsWith('--') && !out.fingerprint) { out.fingerprint = a; }
  }
  return out;
}

function parseDuration(s) {
  if (!s) return null;
  if (s === 'forever') return 365 * 24 * 60 * 60 * 1000 * 100; // 100 years
  const m = String(s).trim().toLowerCase().match(/^(\d+)([smhd])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = unit === 's' ? 1000 : unit === 'm' ? 60000 : unit === 'h' ? 3600000 : 86400000;
  return n * mult;
}

async function findDocsByFingerprint(db, collectionName, isAdmin, fingerprint) {
  if (isAdmin) {
    const snap = await db.collection(collectionName)
      .where('fingerprint', '==', fingerprint)
      .get();
    return snap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
  }
  const q = query(collection(db, collectionName), where('fingerprint', '==', fingerprint));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
}

async function listAcked(db, collectionName, isAdmin) {
  // No index assumed on ackedUntil — scan in-memory. Collection is small
  // (dev-only, capped by 7-day cleanup in bb-check).
  const nowIso = new Date().toISOString();
  let docs;
  if (isAdmin) {
    const snap = await db.collection(collectionName).where('type', '==', 'error').limit(500).get();
    docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  } else {
    const q = query(collection(db, collectionName), where('type', '==', 'error'));
    const snap = await getDocs(q);
    docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  const acked = docs.filter(d => {
    const until = d.data.ackedUntil;
    const untilIso = until?.toDate ? until.toDate().toISOString() : until;
    return untilIso && untilIso > nowIso;
  });
  return acked;
}

async function main() {
  const { fingerprint, forStr, comment, clear, list } = parseArgs();
  const { db, collectionName, isAdmin } = await connectToFirestore();

  if (list) {
    const acked = await listAcked(db, collectionName, isAdmin);
    if (acked.length === 0) {
      console.log('\n[BlackBox] No acknowledged errors.\n');
      process.exit(0);
    }
    console.log(`\n[BlackBox] ${acked.length} acknowledged error(s):\n`);
    for (const a of acked) {
      const until = a.data.ackedUntil?.toDate ? a.data.ackedUntil.toDate().toISOString() : a.data.ackedUntil;
      const fp = a.data.fingerprint || '?';
      const msg = (a.data.message || '').slice(0, 60);
      const cmt = a.data.ackComment ? ` — ${a.data.ackComment}` : '';
      console.log(`  ${fp}  until ${until}${cmt}`);
      console.log(`         ${msg}`);
    }
    console.log('');
    process.exit(0);
  }

  if (!fingerprint) {
    console.error('Usage: bb-ack <fingerprint> [--for 7d] [--comment "text"]');
    console.error('       bb-ack <fingerprint> --clear');
    console.error('       bb-ack --list');
    process.exit(1);
  }

  const docs = await findDocsByFingerprint(db, collectionName, isAdmin, fingerprint);
  if (docs.length === 0) {
    console.error(`\n[BlackBox] No errors found with fingerprint: ${fingerprint}\n`);
    process.exit(1);
  }

  if (clear) {
    let cleared = 0;
    for (const d of docs) {
      try {
        if (isAdmin) {
          await d.ref.update({ ackedUntil: null, ackComment: null });
        } else {
          await updateDoc(d.ref, { ackedUntil: deleteField(), ackComment: deleteField() });
        }
        cleared++;
      } catch (e) {
        console.warn(`Failed to clear on doc ${d.id}: ${e.message}`);
      }
    }
    console.log(`\n[BlackBox] Cleared acknowledgement on ${cleared} doc(s) for fingerprint ${fingerprint}\n`);
    process.exit(0);
  }

  const ms = parseDuration(forStr);
  if (!ms) {
    console.error(`Invalid --for duration: ${forStr}. Use 30s, 5m, 2h, 7d, or forever.`);
    process.exit(1);
  }
  const ackedUntil = new Date(Date.now() + ms);

  let updated = 0;
  for (const d of docs) {
    try {
      const update = { ackedUntil, ackComment: comment || null };
      if (isAdmin) {
        await d.ref.update(update);
      } else {
        await updateDoc(d.ref, update);
      }
      updated++;
    } catch (e) {
      console.warn(`Failed to update doc ${d.id}: ${e.message}`);
    }
  }
  const human = forStr === 'forever' ? 'forever' : `until ${ackedUntil.toISOString()}`;
  console.log(`\n[BlackBox] Acknowledged ${updated} doc(s) for fingerprint ${fingerprint} ${human}${comment ? ` ("${comment}")` : ''}\n`);
  process.exit(0);
}

main().catch(e => {
  console.error(`[BlackBox] bb-ack failed: ${e.message}`);
  process.exit(1);
});
