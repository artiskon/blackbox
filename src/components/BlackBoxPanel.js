'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import blackbox from '../core/blackbox.js';

function timeAgo(isoString) {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 10000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function sourceColor(source) {
  if (!source) return '#ef4444';
  if (source === 'network') return '#f59e0b';
  if (source === 'firebase' || source === 'firebase_listener') return '#3b82f6';
  if (source === 'storage') return '#0ea5e9';
  if (source === 'console.error') return '#8b5cf6';
  if (source === 'resource_load') return '#f97316';
  return '#ef4444';
}

function verdictColor(verdict) {
  if (verdict === 'HEALTHY') return '#22c55e';
  if (verdict === 'WARNING') return '#f59e0b';
  return '#ef4444';
}

// M7: Human-readable breadcrumb type labels
const breadcrumbLabel = {
  click: 'Click',
  navigation: 'Navigate',
  network: 'Network',
  error: 'Error',
  console: 'Console',
  'console.error': 'Console',
  'console.warn': 'Warning',
  form: 'Form',
  resource: 'Resource',
  system: 'System',
  custom: 'Custom',
  suspicious_silence: 'Silence',
};

function bcTypeLabel(type) {
  return breadcrumbLabel[type] || type;
}

// Middle-truncate a URL so both the host and the unique tail (asset id,
// query suffix) survive in a width-limited cell. End-truncation buried the
// most-discriminating part of CDN URLs in two debug sessions; this fix
// keeps "https://m.host" + "...AbC123XyZ" visible.
function shortenUrl(url, max = 60) {
  if (!url || url.length <= max) return url;
  const keepHead = Math.max(20, Math.floor(max * 0.55));
  const keepTail = Math.max(10, max - keepHead - 1);
  return url.slice(0, keepHead) + '…' + url.slice(-keepTail);
}

function bcSummary(bc) {
  if (bc.type === 'click') return `${bc.tag || 'element'}${bc.id ? '#' + bc.id : ''} "${(bc.text || '').slice(0, 25)}"`;
  if (bc.type === 'navigation') return `${bc.from || '?'} → ${bc.to || '?'}`;
  if (bc.type === 'network') return `${bc.method || 'GET'} ${shortenUrl(bc.url || '')} ${bc.status || ''}`;
  if (bc.type === 'error') return (bc.message || '').slice(0, 40);
  return bc.action || bc.message || bc.url || bc.to || bc.tag || '';
}

function errorToJSON(err) {
  return JSON.stringify(err, null, 2);
}

function errorToMarkdown(err) {
  let md = `# ${err.source || 'Error'}: ${(err.message || 'Unknown error').slice(0, 100)}\n\n`;
  if (err.metadata?.timestamp) {
    md += `**Time:** ${new Date(err.metadata.timestamp).toLocaleString()}\n\n`;
  }
  if (err.metadata?.url) {
    md += `**URL:** ${err.metadata.url}\n\n`;
  }
  if (err.stack) {
    md += `## Stack Trace\n\n\`\`\`\n${err.stack}\n\`\`\`\n\n`;
  }
  if (err.breadcrumbs && err.breadcrumbs.length > 0) {
    md += `## Breadcrumbs\n\n`;
    err.breadcrumbs.forEach(bc => {
      md += `- **${bcTypeLabel(bc.type)}**: ${bcSummary(bc)}\n`;
    });
  }
  return md;
}

const BREADCRUMB_FILTER_TYPES = ['click', 'network', 'error', 'navigation', 'performance', 'custom'];

const tabStyle = (active, hovered) => ({
  padding: '6px 12px', cursor: 'pointer', fontSize: '11px', fontWeight: active ? 'bold' : 'normal',
  color: active ? 'white' : hovered ? '#ccc' : '#888',
  borderTop: 'none', borderLeft: 'none', borderRight: 'none',
  borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
  background: hovered && !active ? 'rgba(255,255,255,0.05)' : 'transparent',
  transition: 'color 0.15s, background 0.15s',
});
const sectionTitle = { fontSize: '10px', color: '#888', textTransform: 'uppercase', padding: '8px 14px 4px', letterSpacing: '0.5px' };
const loadBtn = { background: '#6366f1', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 };
const dangerBtn = { background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 };
const cancelBtn = { background: 'transparent', color: '#999', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '8px 16px', cursor: 'pointer', fontSize: '12px' };
const statBox = () => ({ textAlign: 'center', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', flex: 1 });
const copyBtnStyle = { background: 'rgba(255,255,255,0.1)', color: '#ccc', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '10px', fontWeight: 600 };
const filterChipStyle = (active) => ({
  padding: '2px 8px', fontSize: '10px', borderRadius: '10px', cursor: 'pointer', border: 'none',
  background: active ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.08)',
  color: active ? '#a5b4fc' : '#777',
  transition: 'background 0.15s, color 0.15s',
});
const searchInputStyle = {
  width: '100%', boxSizing: 'border-box', padding: '6px 10px', fontSize: '11px',
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px', color: '#ccc', outline: 'none',
};

function BlackBoxPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [tab, setTab] = useState('live');
  const [hoveredTab, setHoveredTab] = useState(null);
  const [errorCount, setErrorCount] = useState(0);
  const [errors, setErrors] = useState([]);
  const [silences, setSilences] = useState([]);
  const [expandedError, setExpandedError] = useState(null);

  const [historyErrors, setHistoryErrors] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [expandedHistory, setExpandedHistory] = useState(null);

  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const [timeline, setTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [timelineMinutes, setTimelineMinutes] = useState(10);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearSessionFeedback, setClearSessionFeedback] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  // Feature 2D states
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedStacks, setExpandedStacks] = useState(new Set());
  // Launcher pulse on new error
  const [pulseKey, setPulseKey] = useState(0);
  const prevUniqueCountRef = useRef(0);
  const [activeFilters, setActiveFilters] = useState(new Set(BREADCRUMB_FILTER_TYPES));
  const [reportCopied, setReportCopied] = useState(false);
  const [reportEmpty, setReportEmpty] = useState(false);
  const [reportText, setReportText] = useState(null);
  const [copiedErrorKey, setCopiedErrorKey] = useState(null);
  const [showInternal, setShowInternal] = useState(false);

  const isConnected = blackbox.isConnectedToFirestore();

  async function copyFullReport() {
    // Nothing to copy if session is empty
    const hasErrors = errors.length > 0;
    const hasSilences = silences.length > 0;
    const hasBreadcrumbs = (blackbox.getBreadcrumbs?.() || []).some(c => c.type !== 'system');
    const hasHistory = historyLoaded && historyErrors.length > 0;
    if (!hasErrors && !hasSilences && !hasBreadcrumbs && !hasHistory) {
      setReportEmpty(true);
      setTimeout(() => setReportEmpty(false), 1500);
      return;
    }

    const config = blackbox._getConfig();

    // -- Helpers for compact output --
    function cleanStack(stack) {
      if (!stack) return undefined;
      const skipPatterns = [
        /bbHandleError/,
        /at wrapped \(/,
        /console\.wrapped/,
        /consoleHook\.|errorHook\.|networkHook\./,
        /node_modules_@artiskon_blackbox/,
        /node_modules_.*\._\.js/,  // Turbopack minified module chunks
        /node_modules_.*chunks.*\.js/,  // webpack chunks
        /pdfjs-dist_build_pdf/,  // pdfjs noise
        /^\s*at BaseExceptionClosure/,  // pdfjs exception internals
      ];
      const lines = stack.split('\n').filter(l => !skipPatterns.some(p => p.test(l)));
      return lines.slice(0, 5).map(l =>
        l.replace(/https?:\/\/[^/]+\/_next\/static\/chunks\//, '')
         .replace(/https?:\/\/[^/]+\//, '/')
      ).join('\n');
    }
    function stripNulls(obj) {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined) continue;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
      }
      return out;
    }
    function compactBreadcrumb(bc) {
      const out = { type: bc.type, time: bc.timestamp };
      if (bc.type === 'click') {
        out.el = `${bc.tag || 'element'}${bc.id ? '#' + bc.id : ''}${bc.dataBb ? '[data-bb=' + bc.dataBb + ']' : ''}`;
        if (bc.text) out.text = bc.text.slice(0, 30);
      } else if (bc.type === 'navigation') {
        out.from = bc.from; out.to = bc.to;
      } else if (bc.type === 'network') {
        out.req = `${bc.method || 'GET'} ${shortenUrl(bc.url || '', 80)} → ${bc.status || '?'}`;
        if (bc.duration) out.ms = bc.duration;
      } else if (bc.type === 'error') {
        // Bumped from 60 → 200 chars and middle-truncate any URL in the
        // message so the host AND unique tail survive (a 60-char slice was
        // chopping resource_load messages mid-host: "...img - https://m.host.exam").
        const raw = (bc.message || '').slice(0, 200);
        out.msg = raw.replace(/https?:\/\/\S+/g, u => shortenUrl(u, 80));
        if (bc.source) out.source = bc.source;
      } else if (bc.type === 'suspicious_silence') {
        const el = bc.clickedElement;
        out.el = el ? `${el.tag || '?'}${el.dataBb ? '[data-bb=' + el.dataBb + ']' : ''} "${(el.text || '').slice(0, 20)}"` : '?';
      } else if (bc.type === 'custom') {
        out.action = bc.action;
      } else {
        out.action = bc.action || bc.message || '';
      }
      if (bc.repeatCount > 1) out.repeat = bc.repeatCount;
      return out;
    }

    // -- Deduplicate errors --
    // Group by source+message, but also merge cross-source duplicates when
    // they're plausibly the same incident wrapped at multiple try/catch
    // layers. Three matching strategies, weakest to strongest:
    //   1. Exact-equality after stripping "Uncaught ErrorType:" prefix
    //   2. Prefix containment (one's first 40 chars inside the other)
    //   3. Tail containment (one's last 80 chars inside the other) — catches
    //      cascades where each layer prepends its own prefix:
    //         "Save failed: Function updateDoc() called with invalid data..."
    //         "Error updating proposal: Function updateDoc() called with invalid data..."
    //         "Firestore updateDoc failed: Function updateDoc() called with invalid data..."
    //      Prefix matching can't link these; the shared suffix can.
    // Time window widened from 50ms → 250ms because rethrows that bubble
    // through 2-3 service-layer try/catches can take 100ms+ on a slow render
    // tick before reaching the bottom-most console.error.
    function stripUncaught(m) {
      return (m || '').replace(/^Uncaught\s+\w+:\s*/, '');
    }
    function tailMatch(a, b, n = 80) {
      if (!a || !b) return false;
      const ta = a.slice(-n);
      const tb = b.slice(-n);
      if (ta.length < 30 || tb.length < 30) return false;
      return a.includes(tb) || b.includes(ta);
    }
    const grouped = new Map();
    for (const err of [...errors].reverse()) {
      const msg = (err.message || '').slice(0, 200);
      const msgNorm = stripUncaught(msg);
      const ts = err.metadata?.timestamp || '';
      const key = `${err.source}:${msg.slice(0, 80)}`;
      // Cross-source dedup: same incident wrapped in different layers.
      let merged = false;
      if (ts) {
        const tsMs = new Date(ts).getTime();
        for (const [, existing] of grouped) {
          const existingNorm = stripUncaught((existing.message || '').slice(0, 200));
          const matched = (
            msgNorm === existingNorm ||
            msgNorm.includes(existingNorm.slice(0, 40)) ||
            existingNorm.includes(msgNorm.slice(0, 40)) ||
            tailMatch(msgNorm, existingNorm)
          );
          if (matched) {
            const existingTs = new Date(existing.timestamp || 0).getTime();
            if (Math.abs(tsMs - existingTs) < 250) {
              existing.count++;
              existing.sources = existing.sources || [existing.source];
              if (!existing.sources.includes(err.source)) existing.sources.push(err.source);
              merged = true;
              break;
            }
          }
        }
      }
      if (merged) continue;
      if (grouped.has(key)) {
        grouped.get(key).count++;
        continue;
      }
      const entry = stripNulls({
        message: err.message,
        source: err.source,
        // Surface the in-memory fingerprint so consumers can `bb-ack <fp>`
        // straight from the exported report without re-running bb-check.
        fingerprint: err._fingerprint || undefined,
        stack: cleanStack(err.stack),
        path: err.path || err.url,
        timestamp: err.metadata?.timestamp,
        count: 1,
        ...(err._stormCount ? { storm: true, stormCount: err._stormCount } : {}),
      });
      if (err.context && Object.keys(err.context).length > 0) {
        // Strip underscore-prefixed ephemeral keys (per ADR-0021 — _rawUrl,
        // _rawSrc etc.). They're for in-process diagnostic matchers only;
        // the report goes to AI agents and shouldn't leak signed-URL tokens.
        const ctx = {};
        for (const [k, v] of Object.entries(err.context)) {
          if (k.startsWith('_')) continue;
          ctx[k] = v;
        }
        // Keep responseBody and requestBody — they're often the single highest-
        // signal field for same-origin API errors (e.g. {error: 'URL not allowed'}
        // from an allowlist check tells you the cause instantly). Truncate to
        // keep the report compact.
        if (typeof ctx.responseBody === 'string' && ctx.responseBody.length > 400) {
          ctx.responseBody = ctx.responseBody.slice(0, 400) + '…';
        }
        if (typeof ctx.requestBody === 'string' && ctx.requestBody.length > 400) {
          ctx.requestBody = ctx.requestBody.slice(0, 400) + '…';
        }
        if (err.source === 'network') {
          delete ctx.status;
          delete ctx.method;
          delete ctx.url;
        }
        if (Object.keys(ctx).length > 0) entry.context = ctx;
      }
      if (err.firedAs && Array.isArray(err.firedAs) && err.firedAs.length > 1) {
        entry.firedAs = err.firedAs;
      }
      grouped.set(key, entry);
    }

    // -- Compact silences --
    const compactSilences = silences.map(s => {
      const el = s.clickedElement;
      return {
        element: el ? `${el.tag || '?'}${el.id ? '#' + el.id : ''}${el.dataBb ? '[data-bb=' + el.dataBb + ']' : ''} "${(el.text || '').slice(0, 30)}"` : '?',
        timestamp: s.timestamp,
        waitedMs: s.waitedMs,
      };
    });

    // -- Build report --
    const report = stripNulls({
      _type: 'BlackBox Diagnostic Report',
      _version: '1.9.5',
      _generatedAt: new Date().toISOString(),
      _instructions: 'Errors are deduplicated (count = occurrences). Cross-channel cascade dedup merges firebase-wrapper + console.error rethrows of the same incident — sources[] lists the channels it fired on. session.uniqueIncidents is the post-dedup distinct-incident count; session.errorCount is the raw record count. Each error carries fingerprint for direct `bb-ack <fp>`. For source:firebase invalid-argument errors, context.firstUndefinedPath gives the dotted/indexed path within the document (e.g. sections[5].subtitle); context.payloadShape sketches the top 2 levels; context.callerFrame is the app frame that called the wrapped write. Breadcrumbs are the single chronological trail. Silences are buttons clicked with no followup. History is persisted errors grouped by fingerprint. Health is a 24h summary. Errors with internal:true had a stack of only framework frames. urlReachability on resource_load tells you DNS vs CORS vs HTTP failure. session.buildSha identifies the build that produced this report.',
      session: stripNulls({
        id: blackbox.getSessionId(),
        errorCount,
        // Post-cascade-dedup count of distinct incidents. `errorCount` is
        // the raw record count (3 try/catch layers wrapping one throw = 3);
        // `uniqueIncidents` collapses cascades to the actual user-visible
        // bug count. At a glance the session header now answers "how many
        // problems happened" instead of "how many records did we write".
        uniqueIncidents: grouped.size,
        environment: config.environment,
        nodeEnv: config.nodeEnv,
        buildSha: config.buildSha,
        tags: config.tags,
        user: config.user,
        firestoreConnected: isConnected,
      }),
      errors: [...grouped.values()],
      silences: compactSilences.length > 0 ? compactSilences : undefined,
      breadcrumbs: (blackbox.getBreadcrumbs ? blackbox.getBreadcrumbs() : []).map(compactBreadcrumb),
    });

    if (historyLoaded && historyErrors.length > 0) {
      // Group by normalized message+source instead of raw fingerprint
      // so old errors with fragmented fingerprints still merge correctly
      function normalizeHistoryKey(msg, source) {
        let m = (msg || '').slice(0, 100).toLowerCase();
        // Strip trailing numbers (#5, #12)
        m = m.replace(/\s*[#(]\d+[)]?\s*$/, '');
        // Normalize URLs
        m = m.replace(/https?:\/\/[^\s"']+/g, '<url>');
        // Normalize Firestore doc paths
        m = m.replace(/\b([a-zA-Z_]\w*)\/([\w]{16,28})\b/g, '$1/:docId');
        return `${source}:${m}`;
      }
      const hGroups = new Map();
      for (const err of historyErrors) {
        const key = normalizeHistoryKey(err.message, err.source);
        if (!hGroups.has(key)) hGroups.set(key, { message: err.message, source: err.source, occurrences: 0, lastSeen: err.lastSeen });
        const g = hGroups.get(key);
        g.occurrences += (err.occurrences || 1);
        if (err.lastSeen > g.lastSeen) { g.lastSeen = err.lastSeen; g.message = err.message; }
      }
      report.history = [...hGroups.values()];
    }
    if (health) {
      report.health = stripNulls({
        verdict: health.verdict,
        uniqueErrors: health.uniqueErrors,
        totalOccurrences: health.totalOccurrences,
        systemicCount: health.systemicCount,
        bySource: health.bySource,
      });
    }
    const text = JSON.stringify(report, null, 2);
    const copied = await copyToClipboard(text);
    if (copied) {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } else {
      // Both clipboard methods blocked — show selectable text overlay
      setReportText(text);
    }
  }

  const refresh = useCallback(() => {
    setErrorCount(blackbox.getErrorCount());
    setErrors(blackbox.getRecentErrors(20));
    setSilences(blackbox.getSuspiciousSilences());
  }, []);

  useEffect(() => {
    refresh();
    const unsub = blackbox.onUpdate(refresh);
    return unsub;
  }, [refresh]);

  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Inject pulse keyframes once. CSS @keyframes can't live in inline style props.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById('bb-launcher-keyframes')) return;
    const style = document.createElement('style');
    style.id = 'bb-launcher-keyframes';
    style.textContent = '@keyframes bb-pulse-ring{0%{transform:scale(1);opacity:0.7}100%{transform:scale(2.6);opacity:0}}';
    document.head.appendChild(style);
  }, []);

  async function loadHistory() {
    setHistoryLoading(true);
    const result = await blackbox.queryPersistedErrors(50);
    setHistoryErrors(result.errors || []);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  }

  async function loadHealth() {
    setHealthLoading(true);
    const result = await blackbox.queryHealth();
    setHealth(result);
    setHealthLoading(false);
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    const result = await blackbox.queryTimeline(timelineMinutes);
    setTimeline(result.events || []);
    setTimelineLoaded(true);
    setTimelineLoading(false);
  }

  function handleClearSession() {
    blackbox.clearErrors();
    setExpandedError(null);
    setClearSessionFeedback(true);
    setTimeout(() => setClearSessionFeedback(false), 2000);
  }

  async function handleClearPersisted() {
    setClearing(true);
    const result = await blackbox.clearPersistedErrors();
    setClearing(false);
    setShowClearConfirm(false);
    if (result.success) {
      setHistoryErrors([]);
      setHistoryLoaded(false);
      setHealth(null);
      setTimeline([]);
      setTimelineLoaded(false);
      setDeleteSuccess(true);
      setTimeout(() => setDeleteSuccess(false), 3000);
    }
  }

  function toggleStack(key) {
    setExpandedStacks(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleFilter(type) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function matchesSearch(err) {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const msg = (err.message || '').toLowerCase();
    const src = (err.source || '').toLowerCase();
    const path = (err.metadata?.url || err.metadata?.path || err.path || '').toLowerCase();
    return msg.includes(q) || src.includes(q) || path.includes(q);
  }

  function copyToClipboard(text) {
    // Try modern API first, fall back to execCommand for iframes
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }

  async function copyAsJSON(err, key) {
    const ok = await copyToClipboard(errorToJSON(err));
    if (ok) {
      setCopiedErrorKey(key + ':json');
      setTimeout(() => setCopiedErrorKey(null), 1500);
    }
  }

  async function copyAsMarkdown(err, key) {
    const ok = await copyToClipboard(errorToMarkdown(err));
    if (ok) {
      setCopiedErrorKey(key + ':md');
      setTimeout(() => setCopiedErrorKey(null), 1500);
    }
  }

  const hasSilences = silences.length > 0;
  // Badge shows unique error count (deduplicated by source+message)
  const uniqueKeys = new Set(errors.map(e => `${e.source}:${(e.message || '').slice(0, 80)}`));
  const uniqueCount = uniqueKeys.size;
  let badgeBg = '#22c55e';
  if (uniqueCount >= 6) badgeBg = '#ef4444';
  else if (uniqueCount >= 1) badgeBg = '#f59e0b';

  const badgeText = uniqueCount > 99 ? '99+' : String(uniqueCount);
  const idle = uniqueCount === 0;

  // Pulse a single ripple whenever the unique count increases.
  useEffect(() => {
    if (uniqueCount > prevUniqueCountRef.current) {
      setPulseKey(k => k + 1);
    }
    prevUniqueCountRef.current = uniqueCount;
  }, [uniqueCount]);

  if (!isOpen) {
    const size = idle ? 8 : 22;
    const borderRadius = idle ? '50%' : '3px';
    return (
      <div
        data-bb-panel
        onClick={() => setIsOpen(true)}
        title={idle ? 'BlackBox: no errors' : `BlackBox: ${badgeText} error${uniqueCount === 1 ? '' : 's'} — click to open`}
        style={{
          position: 'fixed', bottom: 0, left: 0, zIndex: 99999,
          width: `${size}px`, height: `${size}px`, borderRadius,
          background: badgeBg, color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: idle ? 'none' : '0 1px 4px rgba(0,0,0,0.4)',
          fontFamily: 'system-ui, sans-serif', userSelect: 'none', lineHeight: 1,
          transition: 'width 180ms ease, height 180ms ease, border-radius 180ms ease',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {!idle && (
          <span style={{ fontSize: uniqueCount > 99 ? '9px' : '12px', fontWeight: 'bold' }}>{badgeText}</span>
        )}
        {pulseKey > 0 && !idle && (
          <div
            key={pulseKey}
            style={{
              position: 'absolute', inset: 0, borderRadius: 'inherit',
              border: `2px solid ${badgeBg}`, pointerEvents: 'none',
              animation: 'bb-pulse-ring 800ms ease-out forwards',
              transformOrigin: 'center',
            }}
          />
        )}
        {hasSilences && !idle && (
          <div style={{ position: 'absolute', top: '-3px', right: '-3px', width: '7px', height: '7px', borderRadius: '50%', background: '#facc15', border: '1px solid white' }} />
        )}
      </div>
    );
  }

  // m7: Responsive width
  const panelWidth = typeof window !== 'undefined' && window.innerWidth < 480 ? 'calc(100vw - 16px)' : '400px';

  const panelStyle = isExpanded
    ? {
        position: 'fixed', top: '16px', right: '16px', bottom: '16px', left: '16px', zIndex: 99999,
        maxWidth: 'none', maxHeight: 'none',
        background: 'rgba(26, 26, 46, 0.97)', borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)', color: '#e0e0e0',
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        fontSize: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }
    : {
        position: 'fixed', bottom: '16px', right: '8px', zIndex: 99999,
        width: panelWidth, maxWidth: '400px', maxHeight: 'min(520px, calc(100vh - 32px))',
        background: 'rgba(26, 26, 46, 0.97)', borderRadius: '12px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)', color: '#e0e0e0',
        fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
        fontSize: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      };

  // Helper to render expanded error detail (copy buttons, stack toggle, breadcrumb filter chips)
  function renderErrorDetail(err, keyPrefix) {
    const stackKey = keyPrefix;
    const stackVisible = expandedStacks.has(stackKey);
    const allBreadcrumbs = err.breadcrumbs || [];
    const filteredBreadcrumbs = allBreadcrumbs.filter(bc => activeFilters.has(bc.type) || !BREADCRUMB_FILTER_TYPES.includes(bc.type));
    const last5 = filteredBreadcrumbs.slice(-5);

    return (
      <div style={{ padding: '6px 14px 10px 24px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {/* Copy buttons */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
          <button onClick={(e) => { e.stopPropagation(); copyAsJSON(err, keyPrefix); }} style={copyBtnStyle}>{copiedErrorKey === keyPrefix + ':json' ? '✓ Copied' : '📋 Copy JSON'}</button>
          <button onClick={(e) => { e.stopPropagation(); copyAsMarkdown(err, keyPrefix); }} style={copyBtnStyle}>{copiedErrorKey === keyPrefix + ':md' ? '✓ Copied' : '📋 Copy MD'}</button>
        </div>

        {/* Collapsible stack trace */}
        {err.stack && (
          <div style={{ marginBottom: '6px' }}>
            <div
              onClick={(e) => { e.stopPropagation(); toggleStack(stackKey); }}
              style={{ cursor: 'pointer', fontSize: '11px', color: '#a5b4fc', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span>{stackVisible ? '▼' : '▶'}</span>
              <span>Stack</span>
            </div>
            {stackVisible && (
              <pre style={{
                fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
                fontSize: '10px', color: '#bbb', background: 'rgba(0,0,0,0.4)',
                borderRadius: '6px', padding: '8px', marginTop: '4px',
                overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {err.stack}
              </pre>
            )}
          </div>
        )}

        {/* Breadcrumb filter chips */}
        {allBreadcrumbs.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
              {BREADCRUMB_FILTER_TYPES.map(type => (
                <button
                  key={type}
                  onClick={(e) => { e.stopPropagation(); toggleFilter(type); }}
                  style={filterChipStyle(activeFilters.has(type))}
                >
                  {bcTypeLabel(type)}
                </button>
              ))}
            </div>
            <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>Last {last5.length} steps before error:</div>
            {last5.map((bc, j) => (
              <div key={j} style={{ fontSize: '11px', color: '#aaa', padding: '2px 0', display: 'flex', gap: '6px' }}>
                <span style={{ color: '#666', flexShrink: 0, width: '70px' }}>{bcTypeLabel(bc.type)}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bcSummary(bc)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  function passesInternalFilter(err) {
    if (showInternal) return true;
    return !(err.internal === true || err._internal === true);
  }
  const filteredLiveErrors = [...errors].reverse().filter(matchesSearch).filter(passesInternalFilter);
  const filteredHistoryErrors = historyErrors.filter(matchesSearch).filter(passesInternalFilter);
  const hiddenInternalCount =
    [...errors].filter(e => e.internal === true || e._internal === true).length +
    historyErrors.filter(e => e.internal === true).length;

  return (
    <>
      {/* Backdrop when expanded */}
      {isExpanded && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          background: 'rgba(0, 0, 0, 0.5)',
        }} onClick={() => setIsExpanded(false)} />
      )}

      <div data-bb-panel style={panelStyle}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, gap: '8px' }}>
          {searchOpen ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                ref={el => el && el.focus()}
                type="text"
                placeholder="Search errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }}
                style={{ ...searchInputStyle, margin: 0 }}
              />
              <span onClick={() => { setSearchOpen(false); setSearchQuery(''); }} style={{ cursor: 'pointer', fontSize: '14px', color: '#999', padding: '4px', flexShrink: 0 }}>✕</span>
            </div>
          ) : (
            <>
              <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'white' }}>BlackBox</span>
              <span style={{ fontSize: '10px', color: '#666' }}>
                {isConnected ? 'DB connected' : 'Local only'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                {/* Search toggle */}
                <span onClick={() => setSearchOpen(true)} title="Search errors" style={{ cursor: 'pointer', fontSize: '13px', color: '#999', padding: '4px 8px', borderRadius: '4px', transition: 'color 0.15s' }}>
                  🔍
                </span>
                {/* Copy full report */}
                <span onClick={copyFullReport} title="Copy full diagnostic report as JSON" style={{ cursor: 'pointer', fontSize: '13px', color: reportCopied ? '#22c55e' : reportEmpty ? '#f59e0b' : '#999', padding: '4px 8px', borderRadius: '4px', transition: 'color 0.15s' }}>
                  {reportCopied ? '✓' : reportEmpty ? '∅' : '📋'}
                </span>
                {/* Expand/collapse toggle */}
                <span onClick={() => setIsExpanded(prev => !prev)} style={{ cursor: 'pointer', fontSize: '16px', color: '#999', padding: '4px 8px', borderRadius: '4px' }}>
                  {isExpanded ? '⤡' : '⤢'}
                </span>
                {/* Close button */}
                <span onClick={() => { setIsOpen(false); setIsExpanded(false); }} style={{ cursor: 'pointer', fontSize: '16px', color: '#999', padding: '4px 8px', marginRight: '-8px', borderRadius: '4px' }}>✕</span>
              </div>
            </>
          )}
        </div>

        {/* Tabs — m2: hover states */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, padding: '0 6px' }}>
          {['live', 'history', 'health'].map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                if (t === 'history' && !historyLoaded) loadHistory();
                if (t === 'health' && !health) loadHealth();
              }}
              onMouseEnter={() => setHoveredTab(t)}
              onMouseLeave={() => setHoveredTab(null)}
              style={tabStyle(tab === t, hoveredTab === t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {hiddenInternalCount > 0 && (tab === 'live' || tab === 'history') && (
          <div style={{ padding: '4px 14px', fontSize: '10px', color: '#888', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span>{hiddenInternalCount} framework-internal error{hiddenInternalCount !== 1 ? 's' : ''} hidden</span>
            <button onClick={() => setShowInternal(s => !s)} style={filterChipStyle(showInternal)}>
              {showInternal ? 'Hide' : 'Show'}
            </button>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'live' && (
            <div>
              {filteredLiveErrors.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#22c55e' }}>
                  {errors.length === 0 ? 'No errors captured' : 'No matching errors'}
                </div>
              ) : filteredLiveErrors.map((err, i) => {
                const errKey = `${err._fingerprint || 'fp'}:${err.metadata?.timestamp || ''}:${i}`;
                const isExp = expandedError === errKey;
                return (
                  <div key={errKey}>
                    <div onClick={() => setExpandedError(isExp ? null : errKey)} style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', background: isExp ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: sourceColor(err.source), color: 'white', fontWeight: 'bold', textTransform: 'uppercase', flexShrink: 0 }}>{err.source || 'error'}</span>
                        <span style={{ fontSize: '10px', opacity: 0.4, marginLeft: 'auto', flexShrink: 0 }}>{timeAgo(err.metadata?.timestamp)}</span>
                      </div>
                      <div style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(err.message || '').slice(0, 80)}</div>
                    </div>
                    {isExp && renderErrorDetail(err, `live-${i}`)}
                  </div>
                );
              })}
              {/* m5: Suspicious silences with explanation */}
              {hasSilences && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', padding: '8px 14px' }}>
                  <div style={{ color: '#facc15', fontSize: '11px', fontWeight: 'bold', marginBottom: '2px' }}>Unresponsive clicks detected</div>
                  <div style={{ color: '#888', fontSize: '10px', marginBottom: '6px' }}>
                    These buttons/links were clicked but nothing happened — they may be broken or missing handlers.
                  </div>
                  {silences.slice(0, 5).map((s, i) => (
                    <div key={i} style={{ fontSize: '11px', color: '#aaa', padding: '2px 0' }}>
                      {s.clickedElement?.tag || 'element'}{s.clickedElement?.id ? `#${s.clickedElement.id}` : ''}{s.clickedElement?.text ? ` "${s.clickedElement.text.slice(0, 20)}"` : ''}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div>
              {/* M1: Human-readable not-connected message */}
              {!isConnected ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#888' }}>
                  <div style={{ marginBottom: '8px' }}>No database connected</div>
                  <div style={{ fontSize: '11px', color: '#666' }}>Error history is only available when BlackBox is set up with a database. Errors are still being tracked in this session.</div>
                </div>
              ) : historyLoading ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#888' }}>Loading...</div>
              ) : (
                <>
                  {/* m6: Timeline minutes selector */}
                  <div style={{ padding: '8px 14px', display: 'flex', gap: '8px', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <button onClick={loadHistory} style={{ ...loadBtn, padding: '4px 12px', fontSize: '11px' }}>Refresh</button>
                    <button onClick={loadTimeline} style={{ ...loadBtn, padding: '4px 12px', fontSize: '11px', background: '#8b5cf6' }}>
                      {timelineLoading ? 'Loading...' : 'Timeline'}
                    </button>
                    <select
                      value={timelineMinutes}
                      onChange={(e) => setTimelineMinutes(Number(e.target.value))}
                      style={{
                        background: 'rgba(255,255,255,0.1)', color: '#ccc', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '4px', padding: '3px 4px', fontSize: '10px', cursor: 'pointer',
                      }}
                    >
                      <option value={5}>5m</option>
                      <option value={10}>10m</option>
                      <option value={30}>30m</option>
                      <option value={60}>1h</option>
                    </select>
                  </div>


                  {/* Delete success feedback — M5 */}
                  {deleteSuccess && (
                    <div style={{ padding: '8px 14px', textAlign: 'center', color: '#22c55e', fontSize: '11px', background: 'rgba(34,197,94,0.1)' }}>
                      All saved errors deleted successfully.
                    </div>
                  )}

                  {filteredHistoryErrors.length === 0 && !timelineLoaded && timeline.length === 0 ? (
                    <div style={{ padding: '24px 14px', textAlign: 'center', color: '#22c55e' }}>
                      {historyErrors.length === 0 ? 'No saved errors' : 'No matching errors'}
                    </div>
                  ) : (
                    <>
                      {filteredHistoryErrors.length > 0 && (
                        <>
                          <div style={sectionTitle}>Saved Errors ({filteredHistoryErrors.length})</div>
                          {filteredHistoryErrors.map((err, i) => {
                            const isExp = expandedHistory === i;
                            return (
                              <div key={i}>
                                <div onClick={() => setExpandedHistory(isExp ? null : i)} style={{ padding: '8px 14px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', background: isExp ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: sourceColor(err.source), color: 'white', fontWeight: 'bold', textTransform: 'uppercase', flexShrink: 0 }}>{err.source || 'error'}</span>
                                    {(err.occurrences || 1) > 1 && <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.15)', color: '#ccc', flexShrink: 0 }}>x{err.occurrences}</span>}
                                    <span style={{ fontSize: '10px', opacity: 0.4, marginLeft: 'auto', flexShrink: 0 }}>{timeAgo(err.lastSeen)}</span>
                                  </div>
                                  <div style={{ color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(err.message || '').slice(0, 80)}</div>
                                </div>
                                {isExp && renderErrorDetail(err, `history-${i}`)}
                              </div>
                            );
                          })}
                        </>
                      )}
                      {/* m4: Timeline with cap indicator */}
                      {timeline.length > 0 && (
                        <>
                          <div style={sectionTitle}>
                            Timeline ({timeline.length} events{timeline.length > 30 ? ' — showing last 30' : ''})
                          </div>
                          {timeline.slice(-30).map((ev, i) => (
                            <div key={i} style={{ padding: '4px 14px', display: 'flex', gap: '8px', fontSize: '11px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                              <span style={{ color: '#555', flexShrink: 0, width: '55px' }}>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                              <span style={{ color: '#777', flexShrink: 0, width: '65px' }}>{bcTypeLabel(ev.type)}</span>
                              <span style={{ color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bcSummary(ev)}</span>
                            </div>
                          ))}
                        </>
                      )}
                      {/* M6: Timeline empty state after load */}
                      {timelineLoaded && timeline.length === 0 && (
                        <div style={{ padding: '12px 14px', textAlign: 'center', color: '#888', fontSize: '11px' }}>
                          No activity recorded in the last {timelineMinutes} minutes.
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === 'health' && (
            <div style={{ padding: '12px 14px' }}>
              {/* M1: Human-readable not-connected message */}
              {!isConnected ? (
                <div style={{ textAlign: 'center', color: '#888', padding: '12px 0' }}>
                  <div style={{ marginBottom: '8px' }}>No database connected</div>
                  <div style={{ fontSize: '11px', color: '#666' }}>Health data requires a database connection. Errors are still tracked locally.</div>
                </div>
              ) : healthLoading ? (
                <div style={{ textAlign: 'center', color: '#888', padding: '24px 0' }}>Loading...</div>
              ) : !health ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <button onClick={loadHealth} style={loadBtn}>Check Health</button>
                </div>
              ) : (
                <>
                  <div style={{ textAlign: 'center', padding: '16px 0', marginBottom: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: verdictColor(health.verdict) }}>{health.verdict}</div>
                    <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>Last 24 hours</div>
                  </div>
                  {/* M3: "Systemic" → "Repeated 10+" */}
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <div style={statBox()}><div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ccc' }}>{health.uniqueErrors}</div><div style={{ fontSize: '10px', color: '#888' }}>Unique</div></div>
                    <div style={statBox()}><div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ccc' }}>{health.totalOccurrences}</div><div style={{ fontSize: '10px', color: '#888' }}>Total</div></div>
                    <div style={statBox()}><div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ccc' }}>{health.systemicCount}</div><div style={{ fontSize: '10px', color: '#888' }}>Repeated 10+</div></div>
                  </div>
                  {health.bySource && Object.keys(health.bySource).length > 0 && (
                    <>
                      <div style={sectionTitle}>By Source</div>
                      {Object.entries(health.bySource).map(([src, count]) => (
                        <div key={src} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 14px', fontSize: '11px' }}>
                          <span style={{ color: sourceColor(src) }}>{src}</span>
                          <span style={{ color: '#888' }}>{count}</span>
                        </div>
                      ))}
                    </>
                  )}
                  {health.topErrors && health.topErrors.length > 0 && (
                    <>
                      <div style={{ ...sectionTitle, marginTop: '8px' }}>Top Errors</div>
                      {health.topErrors.map((err, i) => (
                        <div key={i} style={{ padding: '6px 14px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px' }}>
                            <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', background: sourceColor(err.source), color: 'white', fontWeight: 'bold', textTransform: 'uppercase' }}>{err.source}</span>
                            <span style={{ fontSize: '10px', color: '#888', marginLeft: 'auto' }}>x{err.occurrences}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(err.message || '').slice(0, 70)}</div>
                        </div>
                      ))}
                    </>
                  )}
                  <div style={{ textAlign: 'center', marginTop: '12px' }}>
                    <button onClick={loadHealth} style={{ ...loadBtn, padding: '4px 12px', fontSize: '11px' }}>Refresh</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
          <span style={{ fontSize: '11px', opacity: 0.6 }}>
            {tab === 'live' ? `${uniqueCount} error${uniqueCount !== 1 ? 's' : ''} this session` : tab === 'history' ? `${historyErrors.length} saved` : health ? health.verdict : 'Health'}
          </span>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {/* M4: Clear session with feedback */}
            {tab === 'live' && (
              clearSessionFeedback ? (
                <span style={{ fontSize: '11px', color: '#22c55e', padding: '2px 8px' }}>Cleared!</span>
              ) : (
                <span onClick={handleClearSession} style={{ cursor: 'pointer', fontSize: '11px', color: '#999', padding: '2px 8px', borderRadius: '3px', border: '1px solid rgba(255,255,255,0.15)' }}>Clear Session</span>
              )
            )}
            {/* M5: Delete All always visible when connected */}
            {tab === 'history' && isConnected && (
              <span onClick={() => setShowClearConfirm(true)} style={{ cursor: 'pointer', fontSize: '11px', color: '#ef4444', padding: '2px 8px', borderRadius: '3px', border: '1px solid rgba(239,68,68,0.3)' }}>Delete All</span>
            )}
          </div>
        </div>

        {showClearConfirm && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: '12px', padding: '24px', gap: '16px' }}>
            <div style={{ fontSize: '14px', color: 'white', fontWeight: 'bold', textAlign: 'center' }}>Delete all saved errors?</div>
            <div style={{ fontSize: '12px', color: '#999', textAlign: 'center' }}>This permanently removes all error data from the database. This cannot be undone.</div>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button onClick={() => setShowClearConfirm(false)} style={cancelBtn}>Cancel</button>
              <button onClick={handleClearPersisted} disabled={clearing} style={dangerBtn}>{clearing ? 'Deleting...' : 'Yes, Delete All'}</button>
            </div>
          </div>
        )}
        {reportText && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', borderRadius: '12px', padding: '12px', gap: '8px', zIndex: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#ccc', fontWeight: 'bold' }}>Select All + Copy (Ctrl+A, Ctrl+C)</span>
              <span onClick={() => setReportText(null)} style={{ cursor: 'pointer', color: '#999', fontSize: '16px', padding: '2px 6px' }}>✕</span>
            </div>
            <textarea
              readOnly
              value={reportText}
              onFocus={(e) => e.target.select()}
              style={{
                flex: 1, width: '100%', background: '#111', color: '#9fef00', border: '1px solid #333',
                borderRadius: '6px', padding: '8px', fontSize: '10px', fontFamily: 'monospace',
                resize: 'none', outline: 'none',
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

// C2: No production guard — panel visibility controlled by `enabled` flag in blackbox.init()
export default function BlackBoxPanelWrapper() {
  return <BlackBoxPanel />;
}
