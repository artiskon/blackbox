import blackbox from '../blackbox.js';

export async function bbFirestoreOp(operationName, promise) {
  try {
    const result = await promise;
    try {
      blackbox._addBreadcrumb('firebase', { action: operationName, status: 'success' });
    } catch { /* ignore */ }
    return result;
  } catch (error) {
    try {
      blackbox._recordError({
        message: error.message || String(error),
        stack: error.stack || '',
        source: 'firebase',
        context: { code: error.code, message: error.message, operation: operationName }
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

export async function bbOnSnapshot(query, onNext, onError) {
  try {
    const { onSnapshot } = await import('firebase/firestore');
    return onSnapshot(
      query,
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
            message: error.message || String(error),
            stack: error.stack || '',
            source: 'firebase_listener',
            context: { code: error.code }
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
