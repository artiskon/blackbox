/** Wrap a Firestore operation to track it in breadcrumbs.
 *  Pass `details.queryRef` to auto-extract queryPath + queryFilters on errors,
 *  or `details.queryDescription` as a human-readable fallback.
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
 *  promise. Pass an object whose keys are the imported write functions; get
 *  back wrapped versions to use throughout the app.
 */
export declare function bbWrapWrites<T extends Record<string, Function>>(firestoreFns: T): T;
