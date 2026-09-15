import blackbox from '../blackbox.js';
import { extractTopAppFrame } from '../fingerprint.js';

// Firestore's own plain-object rule (the SDK's isPlainObject).
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

// payloadShape label for a non-array value: class name for SDK objects
// (e.g. 'DocumentReference'), typeof otherwise.
function leafType(v) {
  if (v && typeof v === 'object' && !isPlainObject(v)) return v.constructor?.name || 'object';
  return typeof v;
}

/**
 * Walk a Firestore write payload to find the first `undefined` value and
 * map a 2-level shape of the keys.
 *
 * Firestore's own error tells you the document ID but not the field path
 * within the document; the SDK walks the object internally, finds the
 * undefined, throws, and discards the path. This walker reproduces enough
 * of that traversal to surface the exact dotted path (e.g.
 * `sections[5].subtitle`) plus a top-2-level shape so the agent can jump
 * straight to the bug instead of grepping for the call site.
 *
 * Bounded to keep cost per-error tiny:
 * - depth 4 (the Firestore SDK enforces a 100-level cap; 4 captures the
 *   real-world cases without chasing pathological structures)
 * - 200 keys total visited (bail early on huge payloads)
 * - cycle-safe via a WeakSet
 * - only walks arrays and plain objects, same rule as the SDK's own
 *   isPlainObject. DocumentReference, Timestamp, FieldValue sentinels etc.
 *   are leaves; walking into a DocumentReference reaches the Firestore
 *   instance, whose internals have undefined fields and produced bogus
 *   paths like `author.firestore._settings.credentials` (ADR-0022).
 */
function summarizePayload(data, maxDepth = 4, maxKeys = 200) {
  const out = { firstUndefinedPath: null, payloadShape: null };
  if (!data || typeof data !== 'object') return out;
  let visited = 0;
  const seen = new WeakSet();
  const shape = {};

  function walk(value, path, depth, shapeNode) {
    if (visited >= maxKeys) return;
    if (value === undefined) {
      if (!out.firstUndefinedPath) out.firstUndefinedPath = path || '<root>';
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
        if (child === undefined) {
          if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
        } else if (child && typeof child === 'object' && depth < maxDepth - 1) {
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
        if (child === undefined) shapeNode[k] = 'undefined';
        else if (child === null) shapeNode[k] = 'null';
        else if (Array.isArray(child)) shapeNode[k] = `array[${child.length}]`;
        else if (isPlainObject(child)) {
          shapeNode[k] = {};
          for (const k2 of Object.keys(child).slice(0, 12)) {
            const v2 = child[k2];
            if (v2 === undefined) shapeNode[k][k2] = 'undefined';
            else if (v2 === null) shapeNode[k][k2] = 'null';
            else if (Array.isArray(v2)) shapeNode[k][k2] = `array[${v2.length}]`;
            else shapeNode[k][k2] = leafType(v2);
          }
        } else {
          shapeNode[k] = leafType(child);
        }
      }
      if (child === undefined) {
        if (!out.firstUndefinedPath) out.firstUndefinedPath = childPath;
      } else if (child && typeof child === 'object') {
        walk(child, childPath, depth + 1, null);
      }
    }
  }

  walk(data, '', 0, shape);
  if (Object.keys(shape).length > 0) out.payloadShape = shape;
  return out;
}

// When a Firebase error is permission-denied, attach a generic action_hint
// that tells the dev WHERE to look — the rules file plus the rejected path.
// Mirrors the existing Firestore-index URL pattern that consumers praised
// as the gold standard. Caller passes the inferred path/queryDescription.
function permissionDeniedActionHint(documentPath, queryPath, queryDescription) {
  const target = documentPath || queryPath || 'the rejected path';
  const desc = queryDescription ? ` (${queryDescription})` : '';
  return `Open firestore.rules and verify a matching match{} block grants the requesting user access to ${target}${desc}. Check the user's auth state and any role/uid fields the rule reads.`;
}

// ` on <collection>` for the recorded message, or '' when no path is known.
// SDK messages like "Missing or insufficient permissions." never name the
// collection and the SDK stack has no app frames, so without this, denials on
// `invoices` and `clients` from one page share a fingerprint (and the 200ms
// message-keyed dedup drops the second). Doc IDs become `:id` and a trailing
// doc ID is dropped, so custom/slug IDs can't fragment fingerprints:
// 'users/abc/projects/xyz' → 'users/:id/projects'. Inserted BEFORE the colon
// so ADR-0023's tail-substring cascade dedup still matches. Collection-group
// paths keep their prefix: '**/posts' → ' on **/posts'.
function onCollection(path) {
  if (typeof path !== 'string') return '';
  if (path.startsWith('**/')) return ` on ${path.slice(0, 120)}`;
  const segs = path.split('/').filter(Boolean);
  if (segs.length % 2 === 0) segs.pop();
  if (segs.length === 0) return '';
  return ` on ${segs.map((s, i) => (i % 2 ? ':id' : s)).join('/').slice(0, 120)}`;
}

/**
 * Best-effort introspection of a Firestore Query / CollectionReference.
 * Reads the SDK's internal `_query` / `_path` shapes — these are stable in
 * the JS SDK across v9+. Returns an object the caller can spread into the
 * error context. Failures are silent: the calling code falls back to the
 * caller-supplied description.
 *
 * The single biggest investigative win for permission-denied errors is
 * knowing WHICH collection and WHICH filters Firestore rejected. Without
 * this the user has to grep the error message for the calling service file,
 * read the function, and reconstruct the query themselves.
 */
function describeQueryRef(queryRef) {
  if (!queryRef) return null;
  const out = {};
  try {
    // Query / CollectionReference: `_query.path` is a BasePath that shares
    // its parent's segments array (offset/len), so `.parent` refs would join
    // extra segments; canonicalString() slices correctly. Collection-group
    // queries have an empty path and carry the collection id separately.
    const internal = queryRef._query || queryRef._delegate?._query;
    if (internal) {
      if (internal.collectionGroup) {
        out.queryPath = `**/${internal.collectionGroup}`.slice(0, 200);
      } else if (typeof internal.path?.canonicalString === 'function') {
        out.queryPath = internal.path.canonicalString().slice(0, 200);
      }
      // Filters: where(field, op, value) tuples are stored as filters[].
      const filters = internal.filters;
      if (Array.isArray(filters) && filters.length > 0) {
        out.queryFilters = filters.slice(0, 8).map(f => describeFilter(f).slice(0, 200));
      }
    } else if (typeof queryRef.path === 'string') {
      // DocumentReference: no `_query`, but has `path`
      out.queryPath = queryRef.path.slice(0, 200);
    }
  } catch { /* ignore — internal SDK shape isn't guaranteed */ }
  return Object.keys(out).length > 0 ? out : null;
}

// `field op ?` for a where() filter; or()/and() CompositeFilters recurse into
// `(a == ? or b == ?)`. Don't capture filter values — they may carry user data.
function describeFilter(f) {
  try {
    if (Array.isArray(f?.filters)) return `(${f.filters.map(describeFilter).join(` ${f.op} `)})`;
    const field = f.field?.canonicalString?.() || f.field?.segments?.join('.') || '?';
    const op = f.op?._opStr || f.op || '?';
    return `${field} ${op} ?`;
  } catch { return '?'; }
}

/**
 * Wraps a Firestore operation promise with error tracking.
 * @param {string} operationName - e.g., 'getDoc', 'setDoc', 'updateDoc', 'deleteDoc', 'getDocs'
 * @param {Promise|Function} promise - the Firestore operation promise, or a
 *   function returning it. For writes pass the function form
 *   (`() => setDoc(ref, data)`) or use bbWrapWrites: the SDK throws
 *   invalid-argument synchronously, before a promise exists, so a finished
 *   promise argument can never capture it.
 * @param {object} [details] - optional details:
 *   { path: 'collection/docId', data: {...}, queryRef, queryDescription }
 *   - queryRef: the Query/CollectionReference for getDocs/onSnapshot — auto-extracts path+filters
 *   - queryDescription: human-readable fallback when the queryRef can't be introspected
 */
export async function bbFirestoreOp(operationName, promise, details = {}) {
  // Capture the caller's stack BEFORE the await — once the promise resolves
  // we're back on the microtask queue and `new Error().stack` no longer has
  // the app frame that invoked us. Cheap on the success path (string lives
  // on a local until GC); the only cost paid on every call.
  const callerStack = (() => { try { return new Error().stack || ''; } catch { return ''; } })();
  try {
    const result = await (typeof promise === 'function' ? promise() : promise);
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
      if (details.queryDescription) ctx.queryDescription = String(details.queryDescription).slice(0, 200);
      if (details.queryRef) {
        const described = describeQueryRef(details.queryRef);
        if (described) Object.assign(ctx, described);
      }
      // Include sanitized write payload for invalid-argument errors
      if (error.code === 'invalid-argument' && details.data) {
        try {
          const keys = Object.keys(details.data);
          const undefinedKeys = keys.filter(k => details.data[k] === undefined);
          ctx.writeFields = keys.slice(0, 20);
          if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
          const summary = summarizePayload(details.data);
          if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
          if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
        } catch { /* ignore */ }
      }
      if (error.code === 'permission-denied') {
        ctx.action_hint = permissionDeniedActionHint(ctx.documentPath, ctx.queryPath, ctx.queryDescription);
      }
      try {
        const frame = extractTopAppFrame(callerStack);
        if (frame) ctx.callerFrame = frame.slice(0, 200);
      } catch { /* ignore */ }
      blackbox._recordError({
        message: `Firestore ${operationName} failed${onCollection(ctx.queryPath || ctx.documentPath)}: ${error.message || error.code}`,
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

/**
 * @param {*} queryRef - Firestore Query, CollectionReference, or DocumentReference
 * @param {*} onNext - success callback
 * @param {*} onError - failure callback
 * @param {object} [opts] - { description: 'agency prompts where ownerOnly==false' }
 *   Passed-through description is the fallback when SDK introspection fails.
 */
/**
 * Auto-instrument Firestore write functions so silent permission-denied
 * (and other rejections) become BB errors + breadcrumbs even when the
 * caller doesn't .catch() the promise.
 *
 * The motivating bug: a delete handler called `deleteDoc(ref)` without a
 * .catch. The rule rejected it. The Firestore JS SDK rejects the promise
 * but the caller swallowed it; the snapshot listener re-emitted the row
 * unchanged. From BB's point of view, nothing happened — the user clicked
 * "delete," items came back, no error, no clue. Auto-instrumentation
 * solves it: every write goes through this wrapper, which records the
 * rejection regardless of whether the caller handles it.
 *
 * Usage (replaces direct imports of write fns):
 *
 *   import { addDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
 *   import { bbWrapWrites } from '@artiskon/blackbox';
 *
 *   const wrapped = bbWrapWrites({ addDoc, setDoc, updateDoc, deleteDoc });
 *   // use wrapped.addDoc / wrapped.deleteDoc throughout the app
 *
 * The wrappers preserve the underlying functions' return values and rethrow
 * errors verbatim — they never alter call shape, only observe.
 */
export function bbWrapWrites(firestoreFns) {
  // Server-side passthrough. The wrapper only emits BB breadcrumbs on the
  // client (the singleton's hooks are never armed on the server), so on
  // SSR the wrapped fns would be no-op-with-overhead. Returning the input
  // object unchanged lets consumers call bbWrapWrites once at module top
  // from a file imported by both client components and route handlers
  // without needing a typeof window guard at the call site.
  if (typeof window === 'undefined') return firestoreFns ?? {};

  // Start from a copy so non-write keys (getDoc, writeBatch, ...) survive on
  // the client too, matching the server passthrough and the `T` return type.
  const out = { ...firestoreFns };
  const writeOps =['addDoc', 'setDoc', 'updateDoc', 'deleteDoc'];
  for (const op of writeOps) {
    const original = firestoreFns?.[op];
    if (typeof original !== 'function') continue;
    out[op] = function (refOrQuery, ...args) {
      const path = refOrQuery?.path || refOrQuery?._key?.path?.canonicalString?.() || null;
      // Capture the caller's stack synchronously, BEFORE invoking the SDK.
      // Once we're inside `original(...)` or its returned promise, the stack
      // is the SDK's own; the app frame is gone.
      const callerStack = (() => { try { return new Error().stack || ''; } catch { return ''; } })();
      const callerFrame = (() => { try { return extractTopAppFrame(callerStack).slice(0, 200) || null; } catch { return null; } })();
      // Pre-compute payload summary so the async error handler doesn't need
      // to walk the args from scratch. Cheap; bounded; only meaningful for
      // writes that actually pass data.
      const writeData = (op === 'addDoc' || op === 'setDoc' || op === 'updateDoc') ? args[0] : null;
      let result;
      try {
        result = original(refOrQuery, ...args);
      } catch (syncErr) {
        // Some Firestore variants throw synchronously on bad args.
        try {
          blackbox._addBreadcrumb('firebase', {
            action: op,
            status: 'error',
            path,
            code: syncErr?.code || null,
          });
          const syncCtx = { code: syncErr?.code || null, operation: op, documentPath: path };
          if (callerFrame) syncCtx.callerFrame = callerFrame;
          if (syncErr?.code === 'invalid-argument' && writeData && typeof writeData === 'object') {
            try {
              const keys = Object.keys(writeData);
              syncCtx.writeFields = keys.slice(0, 20);
              const undefinedKeys = keys.filter(k => writeData[k] === undefined);
              if (undefinedKeys.length > 0) syncCtx.undefinedFields = undefinedKeys;
              const summary = summarizePayload(writeData);
              if (summary.firstUndefinedPath) syncCtx.firstUndefinedPath = summary.firstUndefinedPath;
              if (summary.payloadShape) syncCtx.payloadShape = summary.payloadShape;
            } catch { /* ignore */ }
          }
          blackbox._recordError({
            message: `Firestore ${op} failed (sync)${onCollection(path)}: ${syncErr?.message || syncErr?.code || syncErr}`,
            stack: syncErr?.stack || '',
            source: 'firebase',
            context: syncCtx
          });
        } catch { /* ignore */ }
        throw syncErr;
      }
      // Most writes return a Promise. Tap it for rejection without
      // affecting the caller's chain.
      if (result && typeof result.then === 'function') {
        result.then(
          () => {
            try {
              blackbox._addBreadcrumb('firebase', { action: op, status: 'success', path });
            } catch { /* ignore */ }
          },
          (err) => {
            try {
              blackbox._addBreadcrumb('firebase', {
                action: op,
                status: 'error',
                path,
                code: err?.code || null,
              });
              const ctx = {
                code: err?.code || null,
                operation: op,
                documentPath: path,
              };
              // For invalid-argument, include sanitized field names of the
              // write payload (writes pass data as 2nd arg for setDoc/updateDoc,
              // or no data for deleteDoc).
              if (err?.code === 'invalid-argument' && writeData && typeof writeData === 'object') {
                try {
                  const keys = Object.keys(writeData);
                  ctx.writeFields = keys.slice(0, 20);
                  const undefinedKeys = keys.filter(k => writeData[k] === undefined);
                  if (undefinedKeys.length > 0) ctx.undefinedFields = undefinedKeys;
                  const summary = summarizePayload(writeData);
                  if (summary.firstUndefinedPath) ctx.firstUndefinedPath = summary.firstUndefinedPath;
                  if (summary.payloadShape) ctx.payloadShape = summary.payloadShape;
                } catch { /* ignore */ }
              }
              if (err?.code === 'permission-denied') {
                ctx.action_hint = permissionDeniedActionHint(path, null, null);
              }
              if (callerFrame) ctx.callerFrame = callerFrame;
              blackbox._recordError({
                message: `Firestore ${op} failed${onCollection(path)}: ${err?.message || err?.code || err}`,
                stack: err?.stack || '',
                source: 'firebase',
                context: ctx
              });
            } catch { /* ignore */ }
          }
        );
      }
      return result;
    };
  }
  return out;
}

export async function bbOnSnapshot(queryRef, onNext, onError, opts = {}) {
  try {
    // Prefer the host app's SDK (init({ firestoreFns: { onSnapshot } })), same
    // as persistence.js. BB's own `import('firebase/firestore')` resolves from
    // BB's install location; in submodule/path installs that is a second SDK
    // copy that rejects the app's query ("Did you pass a reference from a
    // different Firestore SDK?").
    const onSnapshot = blackbox._getConfig().firestoreFns?.onSnapshot
      || (await import('firebase/firestore')).onSnapshot;
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
        // App callbacks are NOT wrapped: the SDK already runs each event in
        // its own setTimeout, so a throw reaches window.onerror (and the
        // errorHook) exactly as with plain onSnapshot. Catching here hid
        // data-mapping bugs in snapshot handlers.
        onNext(snapshot);
      },
      (error) => {
        try {
          const ctx = { code: error.code, message: error.message };
          if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
          Object.assign(ctx, describeQueryRef(queryRef) || {});
          if (error.code === 'permission-denied') {
            ctx.action_hint = permissionDeniedActionHint(null, ctx.queryPath, ctx.queryDescription);
          }
          blackbox._recordError({
            message: `Firestore listener error${onCollection(ctx.queryPath)}: ${error.message || error.code}`,
            stack: error.stack || '',
            source: 'firebase_listener',
            context: ctx
          });
        } catch { /* ignore */ }
        if (onError) onError(error);
      }
    );
  } catch (e) {
    // Attaching failed (SDK copy mismatch, null query, firebase missing): the
    // listener never runs, so record it and hand it to onError instead of a
    // console.warn that the '[BlackBox]' filter keeps out of the error log.
    try {
      const ctx = { code: e?.code };
      if (opts.description) ctx.queryDescription = String(opts.description).slice(0, 200);
      const described = describeQueryRef(queryRef);
      if (described) Object.assign(ctx, described);
      blackbox._recordError({
        message: `bbOnSnapshot could not attach listener${onCollection(described?.queryPath)}: ${e?.message || e}`,
        stack: e?.stack || '',
        source: 'firebase_listener',
        context: ctx
      });
    } catch { /* ignore */ }
    if (onError) onError(e);
  }
}
