/** Wrap a Firestore operation to track it in breadcrumbs.
 *  Pass `details.queryRef` to auto-extract queryPath + queryFilters on errors,
 *  or `details.queryDescription` as a human-readable fallback.
 *
 *  Recorded error context includes:
 *    - `code`, `operation`, `documentPath`, `queryPath`, `queryFilters`
 *    - `callerFrame` — first non-framework JS frame from the call site
 *    - on `permission-denied`: `action_hint` pointing at firestore.rules
 *    - on `invalid-argument` (when `details.data` is provided): `writeFields`,
 *      `undefinedFields`, `firstUndefinedPath` (dotted/indexed path of the
 *      first undefined value, e.g. `sections[5].subtitle`), and `payloadShape`
 *      (top 2 levels, types only)
 */
export declare function bbFirestoreOp<T>(
  operationName: string,
  promise: Promise<T>,
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
 */
export declare function bbOnSnapshot(
  query: any,
  onNext: (snapshot: any) => void,
  onError?: (error: any) => void,
  opts?: { description?: string }
): Promise<(() => void) | undefined>;

/** Auto-instrument Firestore write functions so silent permission-denied
 *  rejections become BB errors even when the caller doesn't .catch() the
 *  promise. Returns wrapped versions of the passed-in functions.
 *
 *  Recorded error context includes:
 *    - `code`, `operation`, `documentPath`
 *    - `callerFrame` — first non-framework JS frame from the wrapped call site
 *    - on `permission-denied`: `action_hint` pointing at firestore.rules
 *    - on `invalid-argument`: `writeFields`, `undefinedFields`,
 *      `firstUndefinedPath` (dotted/indexed path of the first undefined value,
 *      e.g. `sections[5].subtitle`), and `payloadShape` (top 2 levels, types only)
 */
export declare function bbWrapWrites<T extends Record<string, Function>>(firestoreFns: T): T;
