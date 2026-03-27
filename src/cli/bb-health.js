#!/usr/bin/env node

import { connectToFirestore } from './shared/firebase-connect.js';
import { writeLog, checkCollectionSize } from './shared/utils.js';
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from 'firebase/firestore';

async function main() {
  try {
    const { db, collectionName, isAdmin } = await connectToFirestore();
    await checkCollectionSize(db, collectionName, isAdmin);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    let errorDocs, activityDocs;

    if (isAdmin) {
      const errorSnap = await db.collection(collectionName)
        .where('type', '==', 'error')
        .where('createdAt', '>=', twentyFourHoursAgo)
        .get();
      errorDocs = errorSnap.docs.map(d => d.data());

      const actSnap = await db.collection(collectionName)
        .where('type', '==', 'activity')
        .where('createdAt', '>=', twentyFourHoursAgo)
        .get();
      activityDocs = actSnap.docs.map(d => d.data());
    } else {
      const ts = Timestamp.fromDate(twentyFourHoursAgo);

      const errorQ = query(
        collection(db, collectionName),
        where('type', '==', 'error'),
        where('createdAt', '>=', ts)
      );
      const errorSnap = await getDocs(errorQ);
      errorDocs = errorSnap.docs.map(d => d.data());

      const actQ = query(
        collection(db, collectionName),
        where('type', '==', 'activity'),
        where('createdAt', '>=', ts)
      );
      const actSnap = await getDocs(actQ);
      activityDocs = actSnap.docs.map(d => d.data());
    }

    // Calculate total occurrences
    const totalErrors = errorDocs.reduce((sum, d) => sum + (d.occurrences || 1), 0);
    const uniqueErrors = errorDocs.length;

    // Group by source
    const bySource = {};
    for (const doc of errorDocs) {
      const src = doc.source || 'unknown';
      bySource[src] = (bySource[src] || 0) + (doc.occurrences || 1);
    }

    // Systemic: occurrences > 10
    const systemic = errorDocs
      .filter(d => (d.occurrences || 1) > 10)
      .map(d => ({
        fingerprint: d.fingerprint || '',
        message: d.message || '',
        occurrences: d.occurrences || 1,
        path: d.path || ''
      }));

    // Top 3 by occurrences
    const topErrors = [...errorDocs]
      .sort((a, b) => (b.occurrences || 1) - (a.occurrences || 1))
      .slice(0, 3)
      .map(d => ({
        message: d.message || '',
        occurrences: d.occurrences || 1,
        source: d.source || 'unknown',
        path: d.path || ''
      }));

    // Activity info
    let lastActivityAt = null;
    for (const doc of activityDocs) {
      const ts = doc.createdAt?.toDate?.() || (doc.createdAt ? new Date(doc.createdAt) : null);
      if (ts && (!lastActivityAt || ts > lastActivityAt)) lastActivityAt = ts;
    }

    // Verdict
    let verdict;
    if (uniqueErrors === 0) {
      verdict = 'HEALTHY: No errors in the last 24 hours';
    } else if (systemic.length > 0) {
      verdict = `UNHEALTHY: ${uniqueErrors} unique error(s), ${systemic.length} systemic issue(s) requiring attention`;
    } else {
      verdict = `WARNING: ${uniqueErrors} unique error(s), none systemic`;
    }

    const output = {
      generatedAt: new Date().toISOString(),
      summary: {
        totalErrors,
        uniqueErrors,
        bySource,
        systemic,
        topErrors,
        recentActivity: {
          activityDocsLast24h: activityDocs.length,
          lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null
        }
      },
      verdict
    };

    writeLog('bb-health.json', output);

    console.log(`\n[BlackBox] Health Report → dev-logs/bb-health.json`);
    console.log(`\n  Verdict: ${verdict}`);
    console.log(`  Unique errors (24h): ${uniqueErrors}`);
    console.log(`  Total occurrences:   ${totalErrors}`);
    if (topErrors.length > 0) {
      console.log(`\n  Top errors:`);
      topErrors.forEach((e, i) => {
        const occ = e.occurrences > 1 ? ` (x${e.occurrences})` : '';
        console.log(`    ${i + 1}. [${e.source}] ${e.message.slice(0, 60)}${occ}`);
      });
    }
    console.log('');

    process.exit(0);
  } catch (e) {
    if (e.message?.includes('index') || e.message?.includes('requires an index')) {
      console.error('\n[BlackBox] Firestore composite index required for bb:health.');
      console.error('Add this to your firestore.indexes.json and run: firebase deploy --only firestore:indexes\n');
      console.error(JSON.stringify({ collectionGroup: "__blackbox", queryScope: "COLLECTION", fields: [{ fieldPath: "type", order: "ASCENDING" }, { fieldPath: "createdAt", order: "ASCENDING" }] }, null, 2));
      console.error('\nOr click the link in the original error:', e.message);
    } else {
      console.error(`[BlackBox] bb-health failed: ${e.message}`);
    }
    process.exit(1);
  }
}

main();
