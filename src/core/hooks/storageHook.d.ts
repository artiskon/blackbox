/**
 * Wrap a fetch against object storage (Cloudflare R2 / S3 / GCS) so the
 * resulting breadcrumb and any failure are tagged `source: 'storage'`
 * instead of the generic `source: 'network'`.
 *
 * Filter for storage-specific failures with `bb-check --source=storage`.
 *
 * @param input  URL string or Request — passed straight to fetch()
 * @param init   standard fetch RequestInit
 * @param details optional metadata that surfaces in the breadcrumb / error context:
 *                description (e.g. 'upload avatar'), bucket, key
 */
export declare function bbR2Fetch(
  input: string | Request | URL,
  init?: RequestInit,
  details?: {
    description?: string;
    bucket?: string;
    key?: string;
  }
): Promise<Response>;
