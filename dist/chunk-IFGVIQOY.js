'use client';
import {
  blackbox_default
} from "./chunk-FL5V6FN3.js";

// src/core/hooks/firebaseHook.js
async function bbFirestoreOp(operationName, promise) {
  try {
    const result = await promise;
    try {
      blackbox_default._addBreadcrumb("firebase", { action: operationName, status: "success" });
    } catch (e) {
    }
    return result;
  } catch (error) {
    try {
      blackbox_default._recordError({
        message: error.message || String(error),
        stack: error.stack || "",
        source: "firebase",
        context: { code: error.code, message: error.message, operation: operationName }
      });
    } catch (e) {
    }
    throw error;
  }
}
async function bbTrackAuth(auth) {
  try {
    const { onAuthStateChanged } = await import("firebase/auth");
    return onAuthStateChanged(auth, (user) => {
      var _a, _b;
      try {
        if (user) {
          blackbox_default._addBreadcrumb("firebase", {
            action: "auth_state_changed",
            status: "signed_in",
            uid: user.uid,
            provider: ((_b = (_a = user.providerData) == null ? void 0 : _a[0]) == null ? void 0 : _b.providerId) || "unknown"
          });
        } else {
          blackbox_default._addBreadcrumb("firebase", {
            action: "auth_state_changed",
            status: "signed_out"
          });
        }
      } catch (e) {
      }
    });
  } catch (e) {
    console.warn("[BlackBox] bbTrackAuth failed:", e);
  }
}
async function bbOnSnapshot(query, onNext, onError) {
  try {
    const { onSnapshot } = await import("firebase/firestore");
    return onSnapshot(
      query,
      (snapshot) => {
        var _a;
        try {
          blackbox_default._addBreadcrumb("firebase", {
            action: "snapshot_received",
            docs: snapshot.size,
            fromCache: ((_a = snapshot.metadata) == null ? void 0 : _a.fromCache) || false
          });
        } catch (e) {
        }
        try {
          onNext(snapshot);
        } catch (e) {
        }
      },
      (error) => {
        try {
          blackbox_default._recordError({
            message: error.message || String(error),
            stack: error.stack || "",
            source: "firebase_listener",
            context: { code: error.code }
          });
        } catch (e) {
        }
        if (onError) {
          try {
            onError(error);
          } catch (e) {
          }
        }
      }
    );
  } catch (e) {
    console.warn("[BlackBox] bbOnSnapshot failed:", e);
  }
}

export {
  bbFirestoreOp,
  bbTrackAuth,
  bbOnSnapshot
};
