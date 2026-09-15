/** Wrap a Firestore operation to track it in breadcrumbs.
 *  Pass `details.queryRef` to auto-extract queryPath + queryFilters on errors,
 *  or `details.queryDescription` as a human-readable fallback.
 *
 *  `promise` may be the operation's promise or a function returning it. For
 *  writes, pass the function form (`() => setDoc(ref, data)`) or use
 *  bbWrapWrites: the SDK throws invalid-argument synchronously, before a
 *  promise exists, so a finished promise can never capture it.
 *
 *  The recorded message names the collection (doc IDs as `:id`), e.g.
 *  `Firestore getDocs failed on users/:id/projects: Missing or insufficient permissions.`,
 *  so failures on different collections never share a fingerprint.
 *
 *  Recorded error context includes:
 *    - `code`, `operation`, `documentPath`, `queryPath`, `queryFilters`
 *      (collection-group queries give `queryPath: '**\/posts'`; or()/and()
 *      filters give `(a == ? or b == ?)`)
 *    - `callerFrame` — first non-framework JS frame from the call site
 *    - on `permission-denied`: `action_hint` pointing at firestore.rules
 *    - on `invalid-argument` (when `details.data` is provided): `writeFields`,
 *      `undefinedFields`, `firstUndefinedPath` (dotted/indexed path of the
 *      first undefined value, e.g. `sections[5].subtitle`), and `payloadShape`
 *      (top 2 levels, types only; SDK objects show their class name, e.g.
 *      `DocumentReference`)
 */
export declare function bbFirestoreOp<T>(
  operationName: string,
  promise: Promise<T> | (() => Promise<T>),
  details?: {
    path?: string;
    data?: Record<string, unknown>;
    queryRef?: any;
    queryDescription?: string;
  }
): Promise<T>;

/** Track Firebase Auth state changes in breadcrumbs */
export declare function bbTrackAuth(auth: any): Promise<(() => void) | undefined>;

/** Wrap onSnapshot to track real-time listeners in breadcrumbs.
 *  Pass `opts.description` to attach a human-readable label that surfaces in
 *  the error context when the listener emits permission-denied.
 *
 *  Uses `init({ firestoreFns: { onSnapshot } })` when provided, falling back
 *  to BlackBox's own `firebase/firestore` import (pass it to avoid a second
 *  SDK copy in submodule/path installs). If the listener cannot attach, a
 *  `firebase_listener` error is recorded, `onError` is called, and the
 *  promise resolves to undefined. Throws inside `onNext`/`onError` are not
 *  caught, so they surface as normal uncaught errors.
 */
export declare function bbOnSnapshot(
  query: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void,
  opts?: { description?: string }
): Promise<(() => void) | undefined>;

/** Auto-instrument Firestore write functions so silent permission-denied
 *  rejections become BB errors even when the caller doesn't .catch() the
 *  promise. Returns the passed-in object with addDoc/setDoc/updateDoc/deleteDoc
 *  wrapped; any other keys (getDoc, writeBatch, ...) pass through unchanged.
 *
 *  Recorded error context includes:
 *    - `code`, `operation`, `documentPath`
 *    - `callerFrame` — first non-framework JS frame from the wrapped call site
 *    - on `permission-denied`: `action_hint` pointing at firestore.rules
 *    - on `invalid-argument`: `writeFields`, `undefinedFields`,
 *      `firstUndefinedPath` (dotted/indexed path of the first undefined value,
 *      e.g. `sections[5].subtitle`), and `payloadShape` (top 2 levels, types
 *      only; SDK objects show their class name, e.g. `DocumentReference`)
 *
 *  Recorded messages name the collection, e.g.
 *  `Firestore deleteDoc failed on proposals: Missing or insufficient permissions.`
 */
export declare function bbWrapWrites<T extends Record<string, Function>>(firestoreFns: T): T;
