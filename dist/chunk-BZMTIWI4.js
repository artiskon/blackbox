'use client';
import {
  blackbox_default
} from "./chunk-UGFKFJI7.js";

// src/core/hooks/firebaseHook.js
async function bbFirestoreOp(operationName, promise, details = {}) {
  try {
    const result = await promise;
    try {
      blackbox_default._addBreadcrumb("firebase", {
        action: operationName,
        status: "success",
        path: details.path || null
      });
    } catch (e) {
    }
    return result;
  } catch (error) {
    try {
      const ctx = {
        code: error.code,
        operation: operationName
      };
      if (details.path) ctx.documentPath = details.path;
      if (error.code === "invalid-argument" && details.data) {
        try {
          const keys = Object.keys(details.data);
          const undefinedKeys = keys.filter((k) => details.data[k] === void 0);
          ctx.writeFields = keys.slice(0, 20);
          if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
        } catch (e) {
        }
      }
      blackbox_default._recordError({
        message: `Firestore ${operationName} failed: ${error.message || error.code}`,
        stack: error.stack || "",
        source: "firebase",
        context: ctx
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
async function bbOnSnapshot(queryRef, onNext, onError) {
  try {
    const { onSnapshot } = await import("firebase/firestore");
    return onSnapshot(
      queryRef,
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
            message: `Firestore listener error: ${error.message || error.code}`,
            stack: error.stack || "",
            source: "firebase_listener",
            context: { code: error.code, message: error.message }
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
