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
