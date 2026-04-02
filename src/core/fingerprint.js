/**
 * Generates a short hash to group identical errors together.
 * Returns both the fingerprint and the raw inputs used to produce it.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_RE = /\/\d+(?=\/|$)/g;
const HASH_SEGMENT_RE = /\/[a-zA-Z0-9]{15,}(?=\/|$)/g; // long hash-like path segments
const FILE_WITH_HASH_RE = /\/[^/]*_[a-f0-9]{6,}\.[a-z]{2,4}$/i; // file_abc123.jpg
const SKIP_FRAMES_RE = /node_modules|webpack|blackbox|__webpack|hot-update|\(native\)|<anonymous>/i;

// Firestore doc ID pattern: collection/docId where docId is 20-char alphanumeric
const FIRESTORE_DOC_PATH_RE = /\b([a-zA-Z_][a-zA-Z0-9_-]*)\/([\w]{16,28})\b/g;

// ISO timestamps in messages
const ISO_TIMESTAMP_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ+-]*/g;

// Chunk/bundle filenames that change across deploys
const CHUNK_FILENAME_RE = /chunk-[a-zA-Z0-9]{6,}\.(m?js)/g;
const BUNDLE_HASH_RE = /\b[a-f0-9]{8,}\.bundle\.(m?js)/g;

function stripQueryParams(path) {
  if (!path) return '';
  try {
    const qIndex = path.indexOf('?');
    if (qIndex === -1) return path;
    const hashIndex = path.indexOf('#');
    if (hashIndex !== -1 && hashIndex < qIndex) return path;
    const base = path.substring(0, qIndex);
    const hash = hashIndex > qIndex ? path.substring(hashIndex) : '';
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
  normalized = normalized.replace(HASH_SEGMENT_RE, '/:hash');
  return normalized;
}

// Normalize URLs embedded in error messages for fingerprinting
// e.g., "Resource failed to load: img - https://cdn.example.com/path/abc123/file.jpg"
// → "Resource failed to load: img - cdn.example.com/path/:hash/*"
function normalizeMessageUrls(message) {
  if (!message) return message;
  return message.replace(/https?:\/\/[^\s"']+/g, (url) => {
    try {
      const u = new URL(url);
      let path = u.pathname;
      path = path.replace(UUID_RE, ':id');
      path = path.replace(NUMERIC_ID_RE, '/:num');
      path = path.replace(HASH_SEGMENT_RE, '/:hash');
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
  let normalized = message.slice(0, 100);

  // Normalize embedded URLs
  normalized = normalizeMessageUrls(normalized);

  // Replace Firestore document paths: "catalogItems/XkgAOIE34NXD5vNMG7ud" → "catalogItems/:docId"
  normalized = normalized.replace(FIRESTORE_DOC_PATH_RE, '$1/:docId');

  // Replace ISO timestamps
  normalized = normalized.replace(ISO_TIMESTAMP_RE, ':timestamp');

  // Replace UUIDs in message text
  normalized = normalized.replace(UUID_RE, ':id');

  return normalized;
}

function extractTopAppFrame(stack) {
  if (!stack) return '';
  const lines = stack.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and the error message line
    if (!trimmed || !trimmed.includes('at ')) continue;
    // Skip framework/bundler/blackbox frames
    if (SKIP_FRAMES_RE.test(trimmed)) continue;
    // Normalize chunk filenames that change across deploys
    let normalized = trimmed;
    normalized = normalized.replace(CHUNK_FILENAME_RE, 'chunk-:hash.$1');
    normalized = normalized.replace(BUNDLE_HASH_RE, ':hash.bundle.$1');
    return normalized;
  }
  return '';
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

export function generateFingerprint(message, source, path, stack) {
  const truncatedMessage = normalizeMessage(message);
  const normalizedPath = normalizePath(path);
  const topFrame = extractTopAppFrame(stack);

  const input = `${truncatedMessage}|${source || ''}|${normalizedPath}|${topFrame}`;
  const fingerprint = hashString(input);

  return {
    fingerprint,
    groupingInputs: {
      message: truncatedMessage,
      source: source || '',
      normalizedPath,
      topFrame
    }
  };
}
