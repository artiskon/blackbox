/** Wrap a Firestore operation to track it in breadcrumbs */
export declare function bbFirestoreOp<T>(operationName: string, promise: Promise<T>, details?: { path?: string; data?: Record<string, unknown> }): Promise<T>;

/** Track Firebase Auth state changes in breadcrumbs */
export declare function bbTrackAuth(auth: any): Promise<(() => void) | undefined>;

/** Wrap onSnapshot to track real-time listeners in breadcrumbs */
export declare function bbOnSnapshot(query: any, onNext: (snapshot: any) => void, onError?: (error: any) => void): Promise<(() => void) | undefined>;
