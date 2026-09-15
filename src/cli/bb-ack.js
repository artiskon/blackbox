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
import { parseCliArgs, parseDuration } from './shared/utils.js';

const USAGE = `Usage: bb-ack <fingerprint> [--for 7d] [--comment "text"]
       bb-ack <fingerprint> --clear
       bb-ack --list
  --for <duration>          Mute window: 30s, 5m, 2h, 7d or forever (default 7d)
  --comment <text>          Why it's muted
  --clear                   Remove the mute
  --list                    List currently-muted fingerprints
  -h, --help                Show this help
Both --flag value and --flag=value work.`;

function parseArgs() {
  const { flags, positionals } = parseCliArgs({
    '--list': 'bool',
    '--clear': 'bool',
    '--for': 'string',
    '--comment': 'string',
  }, USAGE, { maxPositionals: 1 });
  return {
    fingerprint: positionals[0] ?? null,
    forStr: flags.for ?? '7d',
    comment: flags.comment ?? '',
    clear: flags.clear === true,
    list: flags.list === true,
  };
}

function parseAckDuration(s) {
  if (s === 'forever') return 365 * 24 * 60 * 60 * 1000 * 100; // 100 years
  return parseDuration(s);
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
  if (!list && !fingerprint) {
    console.error(USAGE);
    process.exit(1);
  }
  // Validate before connecting so a bad --for never waits on Firestore.
  const ms = parseAckDuration(forStr);
  if (!ms) {
    console.error(`Invalid --for duration: ${forStr}. Use 30s, 5m, 2h, 7d, or forever.`);
    process.exit(1);
  }
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
