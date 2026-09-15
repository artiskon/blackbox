import {
  blackbox_default
} from "./chunk-A3IAWLS3.js";
import {
  __spreadValues,
  extractTopAppFrame
} from "./chunk-3QPKAOHJ.js";

// src/core/hooks/firebaseHook.js
function isPlainObject(v) {
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function leafType(v) {
  var _a;
  if (v && typeof v === "object" && !isPlainObject(v)) return ((_a = v.constructor) == null ? void 0 : _a.name) || "object";
  return typeof v;
}
function summarizePayload(data, maxDepth = 4, maxKeys = 200) {
  const out = { firstUndefinedPath: null, payloadShape: null };
  if (!data || typeof data !== "object") return out;
  let visited = 0;
  const seen = /* @__PURE__ */ new WeakSet();
  const shape = {};
  function walk(value, path, depth, shapeNode) {
    if (visited >= maxKeys) return;
    if (value === void 0) {
      if (!out.firstUndefinedPath) out.firstUndefinedPath = path || "<root>";
      return;
    }
    if (value === null) return;
    if (!Array.isArray(value) && !isPlainObject(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (depth >= maxDepth) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (visited >= maxKeys) return;
        visited++;
        const child = value[i];
        const childPath = `${path}[${i}]`;
        if (child === void 0) {
          if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
        } else if (child && typeof child === "object" && depth < maxDepth - 1) {
          walk(child, childPath, depth + 1, null);
        }
      }
      return;
    }
    for (const k of Object.keys(value)) {
      if (visited >= maxKeys) return;
      visited++;
      const child = value[k];
      const childPath = path ? `${path}.${k}` : k;
      if (depth === 0 && shapeNode) {
        if (child === void 0) shapeNode[k] = "undefined";
        else if (child === null) shapeNode[k] = "null";
        else if (Array.isArray(child)) shapeNode[k] = `array[${child.length}]`;
        else if (isPlainObject(child)) {
          shapeNode[k] = {};
          for (const k2 of Object.keys(child).slice(0, 12)) {
            const v2 = child[k2];
            if (v2 === void 0) shapeNode[k][k2] = "undefined";
            else if (v2 === null) shapeNode[k][k2] = "null";
            else if (Array.isArray(v2)) shapeNode[k][k2] = `array[${v2.length}]`;
            else shapeNode[k][k2] = leafType(v2);
          }
        } else {
          shapeNode[k] = leafType(child);
        }
      }
      if (child === void 0) {
        if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
      } else if (child && typeof child === "object") {
        walk(child, childPath, depth + 1, null);
      }
    }
  }
  walk(data, "", 0, shape);
  if (Object.keys(shape).length > 0) out.payloadShape = shape;
  return out;
}
function permissionDeniedActionHint(documentPath, queryPath, queryDescription) {
  const target = documentPath || queryPath || "the rejected path";
  const desc = queryDescription ? ` (${queryDescription})` : "";
  return `Open firestore.rules and verify a matching match{} block grants the requesting user access to ${target}${desc}. Check the user's auth state and any role/uid fields the rule reads.`;
}
function onCollection(path) {
  if (typeof path !== "string") return "";
  if (path.startsWith("**/")) return ` on ${path.slice(0, 120)}`;
  const segs = path.split("/").filter(Boolean);
  if (segs.length % 2 === 0) segs.pop();
  if (segs.length === 0) return "";
  return ` on ${segs.map((s, i) => i % 2 ? ":id" : s).join("/").slice(0, 120)}`;
}
function describeQueryRef(queryRef) {
  var _a, _b;
  if (!queryRef) return null;
  const out = {};
  try {
    const internal = queryRef._query || ((_a = queryRef._delegate) == null ? void 0 : _a._query);
    if (internal) {
      if (internal.collectionGroup) {
        out.queryPath = `**/${internal.collectionGroup}`.slice(0, 200);
      } else if (typeof ((_b = internal.path) == null ? void 0 : _b.canonicalString) === "function") {
        out.queryPath = internal.path.canonicalString().slice(0, 200);
      }
      const filters = internal.filters;
      if (Array.isArray(filters) && filters.length > 0) {
        out.queryFilters = filters.slice(0, 8).map((f) => describeFilter(f).slice(0, 200));
      }
    } else if (typeof queryRef.path === "string") {
      out.queryPath = queryRef.path.slice(0, 200);
    }
  } catch (e) {
  }
  return Object.keys(out).length > 0 ? out : null;
}
function describeFilter(f) {
  var _a, _b, _c, _d, _e;
  try {
    if (Array.isArray(f == null ? void 0 : f.filters)) return `(${f.filters.map(describeFilter).join(` ${f.op} `)})`;
    const field = ((_b = (_a = f.field) == null ? void 0 : _a.canonicalString) == null ? void 0 : _b.call(_a)) || ((_d = (_c = f.field) == null ? void 0 : _c.segments) == null ? void 0 : _d.join(".")) || "?";
    const op = ((_e = f.op) == null ? void 0 : _e._opStr) || f.op || "?";
    return `${field} ${op} ?`;
  } catch (e) {
    return "?";
  }
}
async function bbFirestoreOp(operationName, promise, details = {}) {
  const callerStack = (() => {
    try {
      return new Error().stack || "";
    } catch (e) {
      return "";
    }
  })();
  try {
    const result = await (typeof promise === "function" ? promise() : promise);
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
          const summary = summarizePayload(details.data);
          if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
          if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
        } catch (e) {
        }
      }
      if (error.code === "permission-denied") {
        ctx.action_hint = permissionDeniedActionHint(ctx.documentPath, ctx.queryPath, ctx.queryDescription);
      }
      try {
        const frame = extractTopAppFrame(callerStack);
        if (frame) ctx.callerFrame = frame.slice(0, 200);
      } catch (e) {
      }
      blackbox_default._recordError({
        message: `Firestore ${operationName} failed${onCollection(ctx.queryPath || ctx.documentPath)}: ${error.message || error.code}`,
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
  const out = __spreadValues({}, firestoreFns);
  const writeOps = ["addDoc", "setDoc", "updateDoc", "deleteDoc"];
  for (const op of writeOps) {
    const original = firestoreFns == null ? void 0 : firestoreFns[op];
    if (typeof original !== "function") continue;
    out[op] = function(refOrQuery, ...args) {
      var _a, _b, _c;
      const path = (refOrQuery == null ? void 0 : refOrQuery.path) || ((_c = (_b = (_a = refOrQuery == null ? void 0 : refOrQuery._key) == null ? void 0 : _a.path) == null ? void 0 : _b.canonicalString) == null ? void 0 : _c.call(_b)) || null;
      const callerStack = (() => {
        try {
          return new Error().stack || "";
        } catch (e) {
          return "";
        }
      })();
      const callerFrame = (() => {
        try {
          return extractTopAppFrame(callerStack).slice(0, 200) || null;
        } catch (e) {
          return null;
        }
      })();
      const writeData = op === "addDoc" || op === "setDoc" || op === "updateDoc" ? args[0] : null;
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
          const syncCtx = { code: (syncErr == null ? void 0 : syncErr.code) || null, operation: op, documentPath: path };
          if (callerFrame) syncCtx.callerFrame = callerFrame;
          if ((syncErr == null ? void 0 : syncErr.code) === "invalid-argument" && writeData && typeof writeData === "object") {
            try {
              const keys = Object.keys(writeData);
              syncCtx.writeFields = keys.slice(0, 20);
              const undefinedKeys = keys.filter((k) => writeData[k] === void 0);
              if (undefinedKeys.length > 0) syncCtx.undefinedFields = undefinedKeys;
              const summary = summarizePayload(writeData);
              if (summary.firstUndefinedPath) syncCtx.firstUndefinedPath = summary.firstUndefinedPath;
              if (summary.payloadShape) syncCtx.payloadShape = summary.payloadShape;
            } catch (e) {
            }
          }
          blackbox_default._recordError({
            message: `Firestore ${op} failed (sync)${onCollection(path)}: ${(syncErr == null ? void 0 : syncErr.message) || (syncErr == null ? void 0 : syncErr.code) || syncErr}`,
            stack: (syncErr == null ? void 0 : syncErr.stack) || "",
            source: "firebase",
            context: syncCtx
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
                code: (err == null ? void 0 : err.code) || null,
                operation: op,
                documentPath: path
              };
              if ((err == null ? void 0 : err.code) === "invalid-argument" && writeData && typeof writeData === "object") {
                try {
                  const keys = Object.keys(writeData);
                  ctx.writeFields = keys.slice(0, 20);
                  const undefinedKeys = keys.filter((k) => writeData[k] === void 0);
                  if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
                  const summary = summarizePayload(writeData);
                  if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
                  if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
                } catch (e) {
                }
              }
              if ((err == null ? void 0 : err.code) === "permission-denied") {
                ctx.action_hint = permissionDeniedActionHint(path, null, null);
              }
              if (callerFrame) ctx.callerFrame = callerFrame;
              blackbox_default._recordError({
                message: `Firestore ${op} failed${onCollection(path)}: ${(err == null ? void 0 : err.message) || (err == null ? void 0 : err.code) || err}`,
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
  var _a;
  try {
    const onSnapshot = ((_a = blackbox_default._getConfig().firestoreFns) == null ? void 0 : _a.onSnapshot) || (await import("firebase/firestore")).onSnapshot;
    return onSnapshot(
      queryRef,
      (snapshot) => {
        var _a2;
        try {
          blackbox_default._addBreadcrumb("firebase", {
            action: "snapshot_received",
            docs: snapshot.size,
            fromCache: ((_a2 = snapshot.metadata) == null ? void 0 : _a2.fromCache) || false
          });
        } catch (e) {
        }
        onNext(snapshot);
      },
      (error) => {
        try {
          const ctx = { code: error.code, message: error.message };
          if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
          Object.assign(ctx, describeQueryRef(queryRef) || {});
          if (error.code === "permission-denied") {
            ctx.action_hint = permissionDeniedActionHint(null, ctx.queryPath, ctx.queryDescription);
          }
          blackbox_default._recordError({
            message: `Firestore listener error${onCollection(ctx.queryPath)}: ${error.message || error.code}`,
            stack: error.stack || "",
            source: "firebase_listener",
            context: ctx
          });
        } catch (e) {
        }
        if (onError) onError(error);
      }
    );
  } catch (e) {
    try {
      const ctx = { code: e == null ? void 0 : e.code };
      if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
      const described = describeQueryRef(queryRef);
      if (described) Object.assign(ctx, described);
      blackbox_default._recordError({
        message: `bbOnSnapshot could not attach listener${onCollection(described == null ? void 0 : described.queryPath)}: ${(e == null ? void 0 : e.message) || e}`,
        stack: (e == null ? void 0 : e.stack) || "",
        source: "firebase_listener",
        context: ctx
      });
    } catch (e2) {
    }
    if (onError) onError(e);
  }
}

export {
  bbFirestoreOp,
  bbTrackAuth,
  bbWrapWrites,
  bbOnSnapshot
};
