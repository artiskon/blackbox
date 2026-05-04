import {
  blackbox_default
} from "./chunk-JFABW74X.js";

// src/core/hooks/firebaseHook.js
function permissionDeniedActionHint(documentPath, queryPath, queryDescription) {
  const target = documentPath || queryPath || "the rejected path";
  const desc = queryDescription ? ` (${queryDescription})` : "";
  return `Open firestore.rules and verify a matching match{} block grants the requesting user access to ${target}${desc}. Check the user's auth state and any role/uid fields the rule reads.`;
}
function describeQueryRef(queryRef) {
  var _a, _b, _c;
  if (!queryRef) return null;
  const out = {};
  try {
    if (typeof queryRef.path === "string") {
      out.queryPath = queryRef.path.slice(0, 200);
    }
    const internal = queryRef._query || ((_a = queryRef._delegate) == null ? void 0 : _a._query);
    if (internal) {
      const segments = (_b = internal.path) == null ? void 0 : _b.segments;
      if (Array.isArray(segments)) {
        out.queryPath = segments.join("/").slice(0, 200);
      } else if (typeof ((_c = internal.path) == null ? void 0 : _c.canonicalString) === "function") {
        out.queryPath = internal.path.canonicalString().slice(0, 200);
      }
      const filters = internal.filters || internal.explicitOrderBy || [];
      if (Array.isArray(filters) && filters.length > 0) {
        out.queryFilters = filters.slice(0, 8).map((f) => {
          var _a2, _b2, _c2, _d, _e;
          try {
            const field = ((_b2 = (_a2 = f.field) == null ? void 0 : _a2.canonicalString) == null ? void 0 : _b2.call(_a2)) || ((_d = (_c2 = f.field) == null ? void 0 : _c2.segments) == null ? void 0 : _d.join(".")) || "?";
            const op = ((_e = f.op) == null ? void 0 : _e._opStr) || f.op || "?";
            return `${field} ${op} ?`;
          } catch (e) {
            return "?";
          }
        });
      }
    }
  } catch (e) {
  }
  return Object.keys(out).length > 0 ? out : null;
}
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
      if (details.queryDescription) ctx.queryDescription = String(details.queryDescription).slice(0, 200);
      if (details.queryRef) {
        const described = describeQueryRef(details.queryRef);
        if (described) Object.assign(ctx, described);
      }
      if (error.code === "invalid-argument" && details.data) {
        try {
          const keys = Object.keys(details.data);
          const undefinedKeys = keys.filter((k) => details.data[k] === void 0);
          ctx.writeFields = keys.slice(0, 20);
          if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
        } catch (e) {
        }
      }
      if (error.code === "permission-denied") {
        ctx.action_hint = permissionDeniedActionHint(ctx.documentPath, ctx.queryPath, ctx.queryDescription);
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
function bbWrapWrites(firestoreFns) {
  if (typeof window === "undefined") return firestoreFns != null ? firestoreFns : {};
  const out = {};
  const writeOps = ["addDoc", "setDoc", "updateDoc", "deleteDoc"];
  for (const op of writeOps) {
    const original = firestoreFns == null ? void 0 : firestoreFns[op];
    if (typeof original !== "function") continue;
    out[op] = function(refOrQuery, ...args) {
      var _a, _b, _c;
      const path = (refOrQuery == null ? void 0 : refOrQuery.path) || ((_c = (_b = (_a = refOrQuery == null ? void 0 : refOrQuery._key) == null ? void 0 : _a.path) == null ? void 0 : _b.canonicalString) == null ? void 0 : _c.call(_b)) || null;
      let result;
      try {
        result = original(refOrQuery, ...args);
      } catch (syncErr) {
        try {
          blackbox_default._addBreadcrumb("firebase", {
            action: op,
            status: "error",
            path,
            code: (syncErr == null ? void 0 : syncErr.code) || null
          });
          blackbox_default._recordError({
            message: `Firestore ${op} failed (sync): ${(syncErr == null ? void 0 : syncErr.message) || (syncErr == null ? void 0 : syncErr.code) || syncErr}`,
            stack: (syncErr == null ? void 0 : syncErr.stack) || "",
            source: "firebase",
            context: { code: syncErr == null ? void 0 : syncErr.code, operation: op, documentPath: path }
          });
        } catch (e) {
        }
        throw syncErr;
      }
      if (result && typeof result.then === "function") {
        result.then(
          () => {
            try {
              blackbox_default._addBreadcrumb("firebase", { action: op, status: "success", path });
            } catch (e) {
            }
          },
          (err) => {
            try {
              blackbox_default._addBreadcrumb("firebase", {
                action: op,
                status: "error",
                path,
                code: (err == null ? void 0 : err.code) || null
              });
              const ctx = {
                code: err == null ? void 0 : err.code,
                operation: op,
                documentPath: path
              };
              if ((err == null ? void 0 : err.code) === "invalid-argument" && (op === "setDoc" || op === "updateDoc" || op === "addDoc")) {
                try {
                  const data = op === "addDoc" ? args[0] : args[0];
                  if (data && typeof data === "object") {
                    const keys = Object.keys(data);
                    ctx.writeFields = keys.slice(0, 20);
                    const undefinedKeys = keys.filter((k) => data[k] === void 0);
                    if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
                  }
                } catch (e) {
                }
              }
              if ((err == null ? void 0 : err.code) === "permission-denied") {
                ctx.action_hint = permissionDeniedActionHint(path, null, null);
              }
              blackbox_default._recordError({
                message: `Firestore ${op} failed: ${(err == null ? void 0 : err.message) || (err == null ? void 0 : err.code) || err}`,
                stack: (err == null ? void 0 : err.stack) || "",
                source: "firebase",
                context: ctx
              });
            } catch (e) {
            }
          }
        );
      }
      return result;
    };
  }
  return out;
}
async function bbOnSnapshot(queryRef, onNext, onError, opts = {}) {
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
        var _a, _b;
        try {
          const ctx = { code: error.code, message: error.message };
          if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
          try {
            const internal = (queryRef == null ? void 0 : queryRef._query) || ((_a = queryRef == null ? void 0 : queryRef._delegate) == null ? void 0 : _a._query);
            if (internal) {
              const segments = (_b = internal.path) == null ? void 0 : _b.segments;
              if (Array.isArray(segments)) {
                ctx.queryPath = segments.join("/").slice(0, 200);
              }
              const filters = internal.filters;
              if (Array.isArray(filters) && filters.length > 0) {
                ctx.queryFilters = filters.slice(0, 8).map((f) => {
                  var _a2, _b2, _c, _d, _e;
                  try {
                    const field = ((_b2 = (_a2 = f.field) == null ? void 0 : _a2.canonicalString) == null ? void 0 : _b2.call(_a2)) || ((_d = (_c = f.field) == null ? void 0 : _c.segments) == null ? void 0 : _d.join(".")) || "?";
                    const op = ((_e = f.op) == null ? void 0 : _e._opStr) || f.op || "?";
                    return `${field} ${op} ?`;
                  } catch (e) {
                    return "?";
                  }
                });
              }
            } else if (typeof (queryRef == null ? void 0 : queryRef.path) === "string") {
              ctx.queryPath = queryRef.path.slice(0, 200);
            }
          } catch (e) {
          }
          if (error.code === "permission-denied") {
            ctx.action_hint = permissionDeniedActionHint(null, ctx.queryPath, ctx.queryDescription);
          }
          blackbox_default._recordError({
            message: `Firestore listener error: ${error.message || error.code}`,
            stack: error.stack || "",
            source: "firebase_listener",
            context: ctx
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
  bbWrapWrites,
  bbOnSnapshot
};
