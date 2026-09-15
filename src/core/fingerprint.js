/**
 * Generates a short hash to group identical errors together.
 * Returns both the fingerprint and the raw inputs used to produce it.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;
const HASH_SEGMENT_RE = /\/([A-Za-z0-9_-]{15,})(?=\/|$)/g; // long path segments, replaced only if isIdLike
const FILE_WITH_HASH_RE = /\/[^/]*_[a-f0-9]{6,}\.[a-z]{2,4}$/i; // file_abc123.jpg
// Frames we treat as "framework noise" when extracting a top app frame.
// IMPORTANT: do NOT match a bare `webpack` token. In Next.js dev mode, every
// frame (including app code) carries the `webpack-internal:///` prefix —
// matching `webpack` here would skip ALL frames and leave callerFrame empty.
// Framework code under that prefix is still caught by the `node_modules`
// alternation; webpack runtime is caught by `__webpack`.
const SKIP_FRAMES_RE = /node_modules|blackbox|__webpack|hot-update|\(native\)|<anonymous>|bbHandleError|console\.wrapped|at wrapped \(|^wrapped@|consoleHook|errorHook|networkHook/i;

// Frames that indicate framework/vendor code with no app responsibility.
// If EVERY frame in a stack matches this, the error is "internal" — likely a
// framework warning re-thrown as an error or a vendor library issue, not
// something the app developer can fix. Hidden by default in bb-check / panel.
//
// Pattern coverage:
//   react-dom* / react/cjs           — React internals
//   next/dist / next/router / chunk-*  — Next.js compiled output
//   webpack-internal / __webpack_require__ — webpack runtime
//   /_next/static/chunks/...         — Next.js bundled chunks (any name)
//   12345-abc...js                    — Next.js minified bundle hash
//                                       (e.g. 64888-f1bd84ac51e4faa1.js)
//   pdfjs-dist / firebase/* / @grpc/  — common vendor libs
//   <anonymous>, (native)             — V8 synthetic frames
const INTERNAL_ONLY_FRAMES_RE = /react-dom[-_/]|react\/cjs\/|next\/dist\/|next\/router|next-server|webpack-internal|__webpack_require__|\/_next\/static\/|\/\d{3,5}-[a-f0-9]{8,}\.(m?js)|pdfjs-dist\/|firebase\/|@firebase\/|@grpc\/|grpc-web|hot-update|chunk-[a-zA-Z0-9]+\.(m?js)|node_modules_.*\._\.(m?js)|<anonymous>|\(native\)/i;

// Firestore doc ID pattern: collection/docId, docId replaced only if isIdLike
const FIRESTORE_DOC_PATH_RE = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\/([\w-]{16,28})(?![\w-])/g;

// ISO timestamps in messages
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+-]*/g;

// Chunk/bundle filenames that change across deploys
const CHUNK_FILENAME_RE = /chunk-[a-zA-Z0-9]{6,}\.(m?js)/g;
const BUNDLE_HASH_RE = /\b[a-f0-9]{8,}\.bundle\.(m?js)/g;
// Turbopack module filenames (hex or base36 with ~/-): _e190d1e5._.js,
// app_page_tsx_0~3a212._.js, node_modules_next_dist_compiled_2ce9398a._.js
const TURBOPACK_MODULE_RE = /_[0-9a-z~.-]{5,}\._\.(m?js)/gi;
// name-<hash>.js: Vite/Rollup 8-char base64url (index-DiwrgTda.js) or webpack/Next
// hex (page-1a2b3c4d5e6f7a8b.js). Callback requires a digit or uppercase so
// kebab filenames (my-settings.js) keep their identity.
const DASH_HASH_RE = /-([A-Za-z0-9_-]{8}|[a-f0-9]{9,})\.(m?js)/g;
// Bare hash filenames (Next Turbopack prod): /_next/static/chunks/0a1b2c3d4e5f6a7b.js
const BARE_HASH_FILE_RE = /\/[a-f0-9]{16,}\.(m?js)/g;
// V8 frames (trimmed "at ...") and Firefox/Safari frames ("fn@url:line:col",
// "global code@url:line:col"). The V8 "Error: <message>" line matches neither.
const STACK_FRAME_RE = /^at\s|@.*:\d+(?::\d+)?\)?$/;

// Trailing numeric identifiers in messages: "failure #5", "error (3)".
// Numbers in the HTTP status range (100-599) are kept on purpose:
// "Request failed (401)" and "(500)" are different failures.
const TRAILING_NUMBER_RE = /\s*[#(](\d+)\)?\s*$/;

/**
 * True when a path segment / doc ID looks like a generated ID rather than a
 * word. Plain alphanumeric: needs a digit, or exactly 20/28 chars (Firestore
 * auto-ID / Firebase UID, which can lack digits). With `_` or `-` (nanoid,
 * cus_..., user_...): needs a digit plus mixed case, or a 6+ digit run, so
 * kebab slugs and camelCase names (createCheckoutSession) are left alone.
 */
export function isIdLike(seg) {
  const hasDigit = /\d/.test(seg);
  if (/^[A-Za-z0-9]+$/.test(seg)) return hasDigit || seg.length === 20 || seg.length === 28;
  return (hasDigit && /[a-z]/.test(seg) && /[A-Z]/.test(seg)) || /\d{6,}/.test(seg);
}

function replaceHashSegments(path) {
  return path.replace(HASH_SEGMENT_RE, (m, seg) => (isIdLike(seg) ? '/:hash' : m));
}

// Same rule as blackbox.js _sanitizeHash/_stripQueryParams: keep hash routes
// ('#/route', '#section'), cut a query inside the hash ('#/reset?token=x' →
// '#/reset'), and drop key=value fragments ('#access_token=...') entirely.
function stripQueryParams(path) {
  if (!path) return '';
  try {
    const hashIndex = path.indexOf('#');
    let base = hashIndex === -1 ? path : path.substring(0, hashIndex);
    let hash = hashIndex === -1 ? '' : path.substring(hashIndex);
    const qIndex = base.indexOf('?');
    if (qIndex !== -1) base = base.substring(0, qIndex);
    const hashQIndex = hash.indexOf('?');
    if (hashQIndex !== -1) hash = hash.substring(0, hashQIndex);
    if (hash.includes('=')) hash = '';
    return base + hash;
  } catch {
    return path;
  }
}

function normalizePath(path) {
  let normalized = stripQueryParams(path || '');
  // Replace UUIDs with :id
  normalized = normalized.replace(UUID_RE, ':id');
  // Replace numeric path segments with :num
  normalized = normalized.replace(NUMERIC_ID_RE, '/:num');
  // Replace long hash-like segments (R2/S3 keys, Firestore doc IDs)
  normalized = replaceHashSegments(normalized);
  return normalized;
}

// Cloudflare image-resize / image-delivery transform prefix.
// e.g. /cdn-cgi/image/width=400,quality=80/path/abc.jpg
//   → /path/abc.jpg (the transform params are presentation, not identity)
const CDN_CGI_PREFIX_RE = /^\/cdn-cgi\/(?:image|imagedelivery)\/[^/]+/;

// Normalize URLs embedded in error messages for fingerprinting
// e.g., "Resource failed to load: img - https://cdn.example.com/path/abc123/file.jpg"
// → "Resource failed to load: img - cdn.example.com/path/:hash/*"
function normalizeMessageUrls(message) {
  if (!message) return message;
  return message.replace(/https?:\/\/[^\s"']+/g, (url) => {
    try {
      const u = new URL(url);
      let path = u.pathname;
      // Strip CF transform prefix BEFORE other normalization so width=400 vs
      // width=600 variants of the same source URL fingerprint identically.
      path = path.replace(CDN_CGI_PREFIX_RE, '');
      path = path.replace(UUID_RE, ':id');
      path = path.replace(NUMERIC_ID_RE, '/:num');
      path = replaceHashSegments(path);
      // Collapse the filename for CDN URLs (the specific file doesn't matter for grouping)
      path = path.replace(/\/[^/]+\.[a-z]{2,5}$/i, '/*');
      return u.hostname + path;
    } catch {
      return url;
    }
  });
}

/**
 * Normalize dynamic content in error messages for stable fingerprinting.
 * Strips Firestore doc IDs, timestamps, and other variable data.
 */
function normalizeMessage(message) {
  if (!message) return '';
  // Normalize BEFORE truncating: cutting first leaves partial UUIDs / URLs
  // that the replacements below no longer match (ADR-0008). The 1000-char
  // pre-slice only bounds regex cost.
  let normalized = message.slice(0, 1000);

  // Normalize embedded URLs
  normalized = normalizeMessageUrls(normalized);

  // Replace Firestore document paths: "catalogItems/XkgAOIE34NXD5vNMG7ud" → "catalogItems/:docId"
  normalized = normalized.replace(FIRESTORE_DOC_PATH_RE, (m, coll, id) => (isIdLike(id) ? `${coll}/:docId` : m));

  // Replace ISO timestamps
  normalized = normalized.replace(ISO_TIMESTAMP_RE, ':timestamp');

  // Replace UUIDs in message text
  normalized = normalized.replace(UUID_RE, ':id');

  // Strip trailing numeric identifiers (#5, #12, etc.), keeping HTTP statuses
  normalized = normalized.replace(TRAILING_NUMBER_RE, (m, n) => (+n >= 100 && +n <= 599 ? m : ''));

  return normalized.slice(0, 200);
}

// Returns the raw first app frame (line:col and origin intact) — it is also
// surfaced as context.callerFrame (ADR-0016), where line numbers matter.
// Fingerprinting normalizes it separately via normalizeFrameForFingerprint.
export function extractTopAppFrame(stack) {
  if (!stack) return '';
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and the error message line
    if (!trimmed || !STACK_FRAME_RE.test(trimmed)) continue;
    // Skip framework/bundler/blackbox frames
    if (SKIP_FRAMES_RE.test(trimmed)) continue;
    return trimmed;
  }
  return '';
}

/**
 * Reduce a frame to function name + module path so the fingerprint survives
 * edits above the throw site, port changes and deploys (ADR-0019 point 3):
 * strips :line:col and scheme://host:port, replaces content hashes in chunk
 * filenames, and collapses minified 1-2 char function names to `?`.
 */
function normalizeFrameForFingerprint(frame) {
  if (!frame) return '';
  let normalized = frame;
  normalized = normalized.replace(/:\d+(?::\d+)?(?=\)?$)/, '');
  normalized = normalized.replace(/[a-z][a-z0-9+.-]*:\/\/[^/\s)]*/gi, '');
  normalized = normalized.replace(CHUNK_FILENAME_RE, 'chunk-:hash.$1');
  normalized = normalized.replace(BUNDLE_HASH_RE, ':hash.bundle.$1');
  normalized = normalized.replace(TURBOPACK_MODULE_RE, '_:hash._.$1');
  normalized = normalized.replace(DASH_HASH_RE, (m, h, ext) => (/\d|[A-Z]/.test(h) ? `-:hash.${ext}` : m));
  normalized = normalized.replace(BARE_HASH_FILE_RE, '/:hash.$1');
  normalized = normalized.replace(/^(at (?:async )?)?[\w$]{1,2}(?= \(|@)/, '$1?');
  return normalized;
}

/**
 * Simple string hash that produces an 8-char alphanumeric fingerprint.
 * Uses djb2 variant with good distribution for short strings.
 */
function hashString(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  let val = combined;
  for (let i = 0; i < 8; i++) {
    result += chars[Math.abs(val) % 36];
    val = Math.floor(val / 36);
  }
  return result;
}

/**
 * True when every "at ..." frame in the stack matches a framework/vendor
 * pattern — the error has no app code in it and is almost certainly a
 * framework-internal warning re-emitted as an error (e.g. React's invalid-key
 * warning, pdfjs-dist module init, Next router internals). The host app
 * can't fix it; hiding it by default cuts noise dramatically.
 *
 * Returns false when no app frame check can be made (no stack at all) — those
 * still need triage. Caller can also force-include via `--include-internal`.
 */
export function isStackEntirelyInternal(stack) {
  if (!stack) return false;
  const lines = stack.split('\n');
  let frameCount = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !STACK_FRAME_RE.test(trimmed)) continue;
    frameCount++;
    if (!INTERNAL_ONLY_FRAMES_RE.test(trimmed)) {
      // Found at least one frame that looks like app code — not internal.
      return false;
    }
  }
  // Need at least 2 frames before we can confidently say "all internal" —
  // a 1-frame stack from a bare `Error()` is too thin a signal.
  return frameCount >= 2;
}

export function generateFingerprint(message, source, path, stack) {
  const truncatedMessage = normalizeMessage(message);
  const normalizedPath = normalizePath(path);
  const topFrame = extractTopAppFrame(stack);

  // Resource-load errors describe a network outcome: "img - host/path/*".
  // The URL pattern is already in the message after normalization, and the
  // path the user happened to be on when it fired is metadata, not identity.
  // Same broken CDN host firing on /admin/foo and /client/bar is ONE bug.
  // (Two debugging sessions spent ~30 min collectively triaging six rows
  // that were really one issue, before this fix.) Stack is also useless:
  // resource_load synthesizes an empty stack.
  const isResourceLoad = source === 'resource_load';
  const fpPath = isResourceLoad ? '' : normalizedPath;
  const fpFrame = isResourceLoad ? '' : normalizeFrameForFingerprint(topFrame);

  const input = `${truncatedMessage}|${source || ''}|${fpPath}|${fpFrame}`;
  const fingerprint = hashString(input);

  return {
    fingerprint,
    groupingInputs: {
      message: truncatedMessage,
      source: source || '',
      normalizedPath: fpPath,
      topFrame: fpFrame
    }
  };
}
