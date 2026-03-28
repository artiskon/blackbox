import blackbox from '../blackbox.js';

/**
 * Wraps a Firestore operation promise with error tracking.
 * @param {string} operationName - e.g., 'getDoc', 'setDoc', 'updateDoc', 'deleteDoc'
 * @param {Promise} promise - the Firestore operation promise
 * @param {object} [details] - optional details like { path: 'collection/docId', data: {...} }
 */
export async function bbFirestoreOp(operationName, promise, details = {}) {
  try {
    const result = await promise;
    try {
      blackbox._addBreadcrumb('firebase', {
        action: operationName,
        status: 'success',
        path: details.path || null,
      });
    } catch { /* ignore */ }
    return result;
  } catch (error) {
    try {
      const ctx = {
        code: error.code,
        operation: operationName,
      };
      if (details.path) ctx.documentPath = details.path;
      // Include sanitized write payload for invalid-argument errors
      if (error.code === 'invalid-argument' && details.data) {
        try {
          const keys = Object.keys(details.data);
          const undefinedKeys = keys.filter(k => details.data[k] === undefined);
          ctx.writeFields = keys.slice(0, 20);
          if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
        } catch { /* ignore */ }
      }
      blackbox._recordError({
        message: `Firestore ${operationName} failed: ${error.message || error.code}`,
        stack: error.stack || '',
        source: 'firebase',
        context: ctx
      });
    } catch { /* ignore */ }
    throw error;
  }
}

export async function bbTrackAuth(auth) {
  try {
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(auth, (user) => {
      try {
        if (user) {
          blackbox._addBreadcrumb('firebase', {
            action: 'auth_state_changed',
            status: 'signed_in',
            uid: user.uid,
            provider: user.providerData?.[0]?.providerId || 'unknown'
          });
        } else {
          blackbox._addBreadcrumb('firebase', {
            action: 'auth_state_changed',
            status: 'signed_out'
          });
        }
      } catch { /* ignore */ }
    });
  } catch (e) {
    console.warn('[BlackBox] bbTrackAuth failed:', e);
  }
}

export async function bbOnSnapshot(queryRef, onNext, onError) {
  try {
    const { onSnapshot } = await import('firebase/firestore');
    return onSnapshot(
      queryRef,
      (snapshot) => {
        try {
          blackbox._addBreadcrumb('firebase', {
            action: 'snapshot_received',
            docs: snapshot.size,
            fromCache: snapshot.metadata?.fromCache || false
          });
        } catch { /* ignore */ }
        try { onNext(snapshot); } catch { /* ignore */ }
      },
      (error) => {
        try {
          blackbox._recordError({
            message: `Firestore listener error: ${error.message || error.code}`,
            stack: error.stack || '',
            source: 'firebase_listener',
            context: { code: error.code, message: error.message }
          });
        } catch { /* ignore */ }
        if (onError) {
          try { onError(error); } catch { /* ignore */ }
        }
      }
    );
  } catch (e) {
    console.warn('[BlackBox] bbOnSnapshot failed:', e);
  }
}
