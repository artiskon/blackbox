'use client';

import { useState, useEffect, useCallback } from 'react';
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
  if (source === 'firebase') return '#3b82f6';
  if (source === 'console.error') return '#8b5cf6';
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

function bcSummary(bc) {
  if (bc.type === 'click') return `${bc.tag || 'element'}${bc.id ? '#' + bc.id : ''} "${(bc.text || '').slice(0, 25)}"`;
  if (bc.type === 'navigation') return `${bc.from || '?'} → ${bc.to || '?'}`;
  if (bc.type === 'network') return `${bc.method || 'GET'} ${bc.url || ''} ${bc.status || ''}`;
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
  const [expandedStacks, setExpandedStacks] = useState(new Set());
  const [activeFilters, setActiveFilters] = useState(new Set(BREADCRUMB_FILTER_TYPES));
  const [reportCopied, setReportCopied] = useState(false);
  const [reportText, setReportText] = useState(null);

  const isConnected = blackbox.isConnectedToFirestore();

  async function copyFullReport() {
    const config = blackbox._getConfig();

    // -- Helpers for compact output --
    function cleanStack(stack) {
      if (!stack) return undefined;
      return stack.split('\n').slice(0, 5).map(l =>
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
        out.req = `${bc.method || 'GET'} ${bc.url || ''} → ${bc.status || '?'}`;
        if (bc.duration) out.ms = bc.duration;
      } else if (bc.type === 'error') {
        out.msg = (bc.message || '').slice(0, 60);
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
    // Group by source+message, but also merge cross-source duplicates
    // when message and timestamp match (e.g., React re-throws JS errors as console.error)
    // Strip "Uncaught ErrorType: " prefix for comparison
    function stripUncaught(m) {
      return (m || '').replace(/^Uncaught\s+\w+:\s*/, '');
    }
    const grouped = new Map();
    for (const err of [...errors].reverse()) {
      const msg = (err.message || '').slice(0, 80);
      const msgNorm = stripUncaught(msg);
      const ts = err.metadata?.timestamp || '';
      const key = `${err.source}:${msg}`;
      // Check for cross-source duplicate: same message + same timestamp (within 50ms)
      let merged = false;
      if (ts) {
        const tsMs = new Date(ts).getTime();
        for (const [, existing] of grouped) {
          const existingNorm = stripUncaught((existing.message || '').slice(0, 80));
          if (msgNorm === existingNorm || msgNorm.includes(existingNorm.slice(0, 40)) || existingNorm.includes(msgNorm.slice(0, 40))) {
            const existingTs = new Date(existing.timestamp || 0).getTime();
            if (Math.abs(tsMs - existingTs) < 50) {
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
        stack: cleanStack(err.stack),
        path: err.path || err.url,
        timestamp: err.metadata?.timestamp,
        count: 1,
      });
      if (err.context && Object.keys(err.context).length > 0) {
        const ctx = { ...err.context };
        // Remove fields already represented in message or bloated
        delete ctx.responseBody;
        delete ctx.requestBody;
        if (err.source === 'network') {
          delete ctx.status;
          delete ctx.method;
          delete ctx.url;
        }
        if (Object.keys(ctx).length > 0) entry.context = ctx;
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
      _version: '1.4.0',
      _generatedAt: new Date().toISOString(),
      _instructions: 'Errors are deduplicated (count = occurrences). Breadcrumbs are the single chronological trail of user actions for the session. Silences are buttons clicked with no followup (possible broken UI). History contains persisted errors from Firestore (grouped by fingerprint). Health is a 24h summary.',
      session: stripNulls({
        id: blackbox.getSessionId(),
        errorCount,
        environment: config.environment,
        tags: config.tags,
        user: config.user,
        firestoreConnected: isConnected,
      }),
      errors: [...grouped.values()],
      silences: compactSilences.length > 0 ? compactSilences : undefined,
      breadcrumbs: (blackbox.getBreadcrumbs ? blackbox.getBreadcrumbs() : []).map(compactBreadcrumb),
    });

    if (historyLoaded && historyErrors.length > 0) {
      const hGroups = new Map();
      for (const err of historyErrors) {
        const fp = err.fingerprint || 'unknown';
        if (!hGroups.has(fp)) hGroups.set(fp, { message: err.message, source: err.source, fingerprint: fp, occurrences: 0, lastSeen: err.lastSeen });
        const g = hGroups.get(fp);
        g.occurrences += (err.occurrences || 1);
        if (err.lastSeen > g.lastSeen) g.lastSeen = err.lastSeen;
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
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch { /* clipboard API blocked (iframe / permissions policy) */ }
    if (!copied) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        copied = true;
      } catch { /* fallback also failed */ }
    }
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
    await blackbox.clearPersistedErrors();
    setClearing(false);
    setShowClearConfirm(false);
    setHistoryErrors([]);
    setHistoryLoaded(false);
    setHealth(null);
    setTimeline([]);
    setTimelineLoaded(false);
    setDeleteSuccess(true);
    setTimeout(() => setDeleteSuccess(false), 3000);
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

  async function copyAsJSON(err) {
    try { await navigator.clipboard.writeText(errorToJSON(err)); } catch (e) { /* silent */ }
  }

  async function copyAsMarkdown(err) {
    try { await navigator.clipboard.writeText(errorToMarkdown(err)); } catch (e) { /* silent */ }
  }

  const hasSilences = silences.length > 0;
  // Badge shows unique error count (deduplicated by source+message)
  const uniqueKeys = new Set(errors.map(e => `${e.source}:${(e.message || '').slice(0, 80)}`));
  const uniqueCount = uniqueKeys.size;
  let badgeBg = '#22c55e';
  if (uniqueCount >= 6) badgeBg = '#ef4444';
  else if (uniqueCount >= 1) badgeBg = '#f59e0b';

  const badgeText = uniqueCount > 99 ? '99+' : String(uniqueCount);

  if (!isOpen) {
    return (
      <div data-bb-panel onClick={() => setIsOpen(true)} style={{
        position: 'fixed', bottom: '16px', right: '16px', zIndex: 99999,
        width: '40px', height: '40px', borderRadius: '50%',
        background: badgeBg, color: 'white',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        fontFamily: 'system-ui, sans-serif', userSelect: 'none', lineHeight: 1,
      }}>
        <span style={{ fontSize: errorCount > 99 ? '11px' : '16px', fontWeight: 'bold' }}>{badgeText}</span>
        <span style={{ fontSize: '8px', opacity: 0.9, marginTop: '1px' }}>BB</span>
        {hasSilences && (
          <div style={{ position: 'absolute', top: '-2px', right: '-2px', width: '10px', height: '10px', borderRadius: '50%', background: '#facc15', border: '2px solid white' }} />
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
        width: panelWidth, maxWidth: '400px', maxHeight: '520px',
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
          <button onClick={(e) => { e.stopPropagation(); copyAsJSON(err); }} style={copyBtnStyle}>JSON</button>
          <button onClick={(e) => { e.stopPropagation(); copyAsMarkdown(err); }} style={copyBtnStyle}>MD</button>
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

  const filteredLiveErrors = [...errors].reverse().filter(matchesSearch);
  const filteredHistoryErrors = historyErrors.filter(matchesSearch);

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
        {/* Header — M2: removed session ID */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
          <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'white' }}>BlackBox</span>
          <span style={{ fontSize: '10px', color: '#666' }}>
            {isConnected ? 'DB connected' : 'Local only'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {/* Copy full report */}
            <span onClick={copyFullReport} title="Copy full diagnostic report as JSON" style={{ cursor: 'pointer', fontSize: '13px', color: reportCopied ? '#22c55e' : '#999', padding: '4px 8px', borderRadius: '4px', transition: 'color 0.15s' }}>
              {reportCopied ? '✓' : '📋'}
            </span>
            {/* Expand/collapse toggle */}
            <span onClick={() => setIsExpanded(prev => !prev)} style={{ cursor: 'pointer', fontSize: '16px', color: '#999', padding: '4px 8px', borderRadius: '4px' }}>
              {isExpanded ? '⤡' : '⤢'}
            </span>
            {/* Close button */}
            <span onClick={() => { setIsOpen(false); setIsExpanded(false); }} style={{ cursor: 'pointer', fontSize: '16px', color: '#999', padding: '4px 8px', marginRight: '-8px', borderRadius: '4px' }}>✕</span>
          </div>
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

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {tab === 'live' && (
            <div>
              {/* Search input */}
              <div style={{ padding: '8px 14px 4px' }}>
                <input
                  type="text"
                  placeholder="Search errors..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={searchInputStyle}
                />
              </div>
              {filteredLiveErrors.length === 0 ? (
                <div style={{ padding: '24px 14px', textAlign: 'center', color: '#22c55e' }}>
                  {errors.length === 0 ? 'No errors captured' : 'No matching errors'}
                </div>
              ) : filteredLiveErrors.map((err, i) => {
                const errKey = `${err.source}:${(err.message || '').slice(0, 60)}:${err.metadata?.timestamp || i}`;
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

                  {/* Search input for history */}
                  <div style={{ padding: '8px 14px 4px' }}>
                    <input
                      type="text"
                      placeholder="Search saved errors..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={searchInputStyle}
                    />
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
            {tab === 'live' ? `${errorCount} error${errorCount !== 1 ? 's' : ''} this session` : tab === 'history' ? `${historyErrors.length} saved` : health ? health.verdict : 'Health'}
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
