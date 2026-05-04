"use client";
import {
  blackbox_default
} from "../chunk-TC5I246H.js";
import {
  __spreadProps,
  __spreadValues
} from "../chunk-ZNKUSKNI.js";

// src/components/BlackBoxPanel.js
import { useState, useEffect, useCallback } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function timeAgo(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 1e4) return "just now";
  if (diff < 6e4) return `${Math.floor(diff / 1e3)}s ago`;
  if (diff < 36e5) return `${Math.floor(diff / 6e4)}m ago`;
  if (diff < 864e5) return `${Math.floor(diff / 36e5)}h ago`;
  return `${Math.floor(diff / 864e5)}d ago`;
}
function sourceColor(source) {
  if (!source) return "#ef4444";
  if (source === "network") return "#f59e0b";
  if (source === "firebase" || source === "firebase_listener") return "#3b82f6";
  if (source === "storage") return "#0ea5e9";
  if (source === "console.error") return "#8b5cf6";
  if (source === "resource_load") return "#f97316";
  return "#ef4444";
}
function verdictColor(verdict) {
  if (verdict === "HEALTHY") return "#22c55e";
  if (verdict === "WARNING") return "#f59e0b";
  return "#ef4444";
}
var breadcrumbLabel = {
  click: "Click",
  navigation: "Navigate",
  network: "Network",
  error: "Error",
  console: "Console",
  "console.error": "Console",
  "console.warn": "Warning",
  form: "Form",
  resource: "Resource",
  system: "System",
  custom: "Custom",
  suspicious_silence: "Silence"
};
function bcTypeLabel(type) {
  return breadcrumbLabel[type] || type;
}
function shortenUrl(url, max = 60) {
  if (!url || url.length <= max) return url;
  const keepHead = Math.max(20, Math.floor(max * 0.55));
  const keepTail = Math.max(10, max - keepHead - 1);
  return url.slice(0, keepHead) + "\u2026" + url.slice(-keepTail);
}
function bcSummary(bc) {
  if (bc.type === "click") return `${bc.tag || "element"}${bc.id ? "#" + bc.id : ""} "${(bc.text || "").slice(0, 25)}"`;
  if (bc.type === "navigation") return `${bc.from || "?"} \u2192 ${bc.to || "?"}`;
  if (bc.type === "network") return `${bc.method || "GET"} ${shortenUrl(bc.url || "")} ${bc.status || ""}`;
  if (bc.type === "error") return (bc.message || "").slice(0, 40);
  return bc.action || bc.message || bc.url || bc.to || bc.tag || "";
}
function errorToJSON(err) {
  return JSON.stringify(err, null, 2);
}
function errorToMarkdown(err) {
  var _a, _b;
  let md = `# ${err.source || "Error"}: ${(err.message || "Unknown error").slice(0, 100)}

`;
  if ((_a = err.metadata) == null ? void 0 : _a.timestamp) {
    md += `**Time:** ${new Date(err.metadata.timestamp).toLocaleString()}

`;
  }
  if ((_b = err.metadata) == null ? void 0 : _b.url) {
    md += `**URL:** ${err.metadata.url}

`;
  }
  if (err.stack) {
    md += `## Stack Trace

\`\`\`
${err.stack}
\`\`\`

`;
  }
  if (err.breadcrumbs && err.breadcrumbs.length > 0) {
    md += `## Breadcrumbs

`;
    err.breadcrumbs.forEach((bc) => {
      md += `- **${bcTypeLabel(bc.type)}**: ${bcSummary(bc)}
`;
    });
  }
  return md;
}
var BREADCRUMB_FILTER_TYPES = ["click", "network", "error", "navigation", "performance", "custom"];
var tabStyle = (active, hovered) => ({
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: active ? "bold" : "normal",
  color: active ? "white" : hovered ? "#ccc" : "#888",
  borderTop: "none",
  borderLeft: "none",
  borderRight: "none",
  borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
  background: hovered && !active ? "rgba(255,255,255,0.05)" : "transparent",
  transition: "color 0.15s, background 0.15s"
});
var sectionTitle = { fontSize: "10px", color: "#888", textTransform: "uppercase", padding: "8px 14px 4px", letterSpacing: "0.5px" };
var loadBtn = { background: "#6366f1", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px", fontWeight: 600 };
var dangerBtn = { background: "#ef4444", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px", fontWeight: 600 };
var cancelBtn = { background: "transparent", color: "#999", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px" };
var statBox = () => ({ textAlign: "center", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", flex: 1 });
var copyBtnStyle = { background: "rgba(255,255,255,0.1)", color: "#ccc", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "10px", fontWeight: 600 };
var filterChipStyle = (active) => ({
  padding: "2px 8px",
  fontSize: "10px",
  borderRadius: "10px",
  cursor: "pointer",
  border: "none",
  background: active ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.08)",
  color: active ? "#a5b4fc" : "#777",
  transition: "background 0.15s, color 0.15s"
});
var searchInputStyle = {
  width: "100%",
  boxSizing: "border-box",
  padding: "6px 10px",
  fontSize: "11px",
  background: "rgba(255,255,255,0.07)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "6px",
  color: "#ccc",
  outline: "none"
};
function BlackBoxPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [tab, setTab] = useState("live");
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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedStacks, setExpandedStacks] = useState(/* @__PURE__ */ new Set());
  const [activeFilters, setActiveFilters] = useState(new Set(BREADCRUMB_FILTER_TYPES));
  const [reportCopied, setReportCopied] = useState(false);
  const [reportEmpty, setReportEmpty] = useState(false);
  const [reportText, setReportText] = useState(null);
  const [copiedErrorKey, setCopiedErrorKey] = useState(null);
  const [showInternal, setShowInternal] = useState(false);
  const isConnected = blackbox_default.isConnectedToFirestore();
  async function copyFullReport() {
    var _a, _b, _c, _d;
    const hasErrors = errors.length > 0;
    const hasSilences2 = silences.length > 0;
    const hasBreadcrumbs = (((_b = (_a = blackbox_default).getBreadcrumbs) == null ? void 0 : _b.call(_a)) || []).some((c) => c.type !== "system");
    const hasHistory = historyLoaded && historyErrors.length > 0;
    if (!hasErrors && !hasSilences2 && !hasBreadcrumbs && !hasHistory) {
      setReportEmpty(true);
      setTimeout(() => setReportEmpty(false), 1500);
      return;
    }
    const config = blackbox_default._getConfig();
    function cleanStack(stack) {
      if (!stack) return void 0;
      const skipPatterns = [
        /bbHandleError/,
        /at wrapped \(/,
        /console\.wrapped/,
        /consoleHook\.|errorHook\.|networkHook\./,
        /node_modules_@artiskon_blackbox/,
        /node_modules_.*\._\.js/,
        // Turbopack minified module chunks
        /node_modules_.*chunks.*\.js/,
        // webpack chunks
        /pdfjs-dist_build_pdf/,
        // pdfjs noise
        /^\s*at BaseExceptionClosure/
        // pdfjs exception internals
      ];
      const lines = stack.split("\n").filter((l) => !skipPatterns.some((p) => p.test(l)));
      return lines.slice(0, 5).map(
        (l) => l.replace(/https?:\/\/[^/]+\/_next\/static\/chunks\//, "").replace(/https?:\/\/[^/]+\//, "/")
      ).join("\n");
    }
    function stripNulls(obj) {
      const out = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === void 0) continue;
        if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
      }
      return out;
    }
    function compactBreadcrumb(bc) {
      const out = { type: bc.type, time: bc.timestamp };
      if (bc.type === "click") {
        out.el = `${bc.tag || "element"}${bc.id ? "#" + bc.id : ""}${bc.dataBb ? "[data-bb=" + bc.dataBb + "]" : ""}`;
        if (bc.text) out.text = bc.text.slice(0, 30);
      } else if (bc.type === "navigation") {
        out.from = bc.from;
        out.to = bc.to;
      } else if (bc.type === "network") {
        out.req = `${bc.method || "GET"} ${shortenUrl(bc.url || "", 80)} \u2192 ${bc.status || "?"}`;
        if (bc.duration) out.ms = bc.duration;
      } else if (bc.type === "error") {
        const raw = (bc.message || "").slice(0, 200);
        out.msg = raw.replace(/https?:\/\/\S+/g, (u) => shortenUrl(u, 80));
        if (bc.source) out.source = bc.source;
      } else if (bc.type === "suspicious_silence") {
        const el = bc.clickedElement;
        out.el = el ? `${el.tag || "?"}${el.dataBb ? "[data-bb=" + el.dataBb + "]" : ""} "${(el.text || "").slice(0, 20)}"` : "?";
      } else if (bc.type === "custom") {
        out.action = bc.action;
      } else {
        out.action = bc.action || bc.message || "";
      }
      if (bc.repeatCount > 1) out.repeat = bc.repeatCount;
      return out;
    }
    function stripUncaught(m) {
      return (m || "").replace(/^Uncaught\s+\w+:\s*/, "");
    }
    const grouped = /* @__PURE__ */ new Map();
    for (const err of [...errors].reverse()) {
      const msg = (err.message || "").slice(0, 80);
      const msgNorm = stripUncaught(msg);
      const ts = ((_c = err.metadata) == null ? void 0 : _c.timestamp) || "";
      const key = `${err.source}:${msg}`;
      let merged = false;
      if (ts) {
        const tsMs = new Date(ts).getTime();
        for (const [, existing] of grouped) {
          const existingNorm = stripUncaught((existing.message || "").slice(0, 80));
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
      const entry = stripNulls(__spreadValues({
        message: err.message,
        source: err.source,
        stack: cleanStack(err.stack),
        path: err.path || err.url,
        timestamp: (_d = err.metadata) == null ? void 0 : _d.timestamp,
        count: 1
      }, err._stormCount ? { storm: true, stormCount: err._stormCount } : {}));
      if (err.context && Object.keys(err.context).length > 0) {
        const ctx = {};
        for (const [k, v] of Object.entries(err.context)) {
          if (k.startsWith("_")) continue;
          ctx[k] = v;
        }
        if (typeof ctx.responseBody === "string" && ctx.responseBody.length > 400) {
          ctx.responseBody = ctx.responseBody.slice(0, 400) + "\u2026";
        }
        if (typeof ctx.requestBody === "string" && ctx.requestBody.length > 400) {
          ctx.requestBody = ctx.requestBody.slice(0, 400) + "\u2026";
        }
        if (err.source === "network") {
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
    const compactSilences = silences.map((s) => {
      const el = s.clickedElement;
      return {
        element: el ? `${el.tag || "?"}${el.id ? "#" + el.id : ""}${el.dataBb ? "[data-bb=" + el.dataBb + "]" : ""} "${(el.text || "").slice(0, 30)}"` : "?",
        timestamp: s.timestamp,
        waitedMs: s.waitedMs
      };
    });
    const report = stripNulls({
      _type: "BlackBox Diagnostic Report",
      _version: "1.9.3",
      _generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      _instructions: "Errors are deduplicated (count = occurrences). Breadcrumbs are the single chronological trail of user actions for the session. Silences are buttons clicked with no followup (possible broken UI). History contains persisted errors from Firestore (grouped by fingerprint). Health is a 24h summary. Errors with internal:true had a stack of only framework frames \u2014 they are usually framework warnings, not app bugs. urlReachability on resource_load tells you DNS vs CORS vs HTTP failure at a glance.",
      session: stripNulls({
        id: blackbox_default.getSessionId(),
        errorCount,
        environment: config.environment,
        nodeEnv: config.nodeEnv,
        buildSha: config.buildSha,
        tags: config.tags,
        user: config.user,
        firestoreConnected: isConnected
      }),
      errors: [...grouped.values()],
      silences: compactSilences.length > 0 ? compactSilences : void 0,
      breadcrumbs: (blackbox_default.getBreadcrumbs ? blackbox_default.getBreadcrumbs() : []).map(compactBreadcrumb)
    });
    if (historyLoaded && historyErrors.length > 0) {
      let normalizeHistoryKey2 = function(msg, source) {
        let m = (msg || "").slice(0, 100).toLowerCase();
        m = m.replace(/\s*[#(]\d+[)]?\s*$/, "");
        m = m.replace(/https?:\/\/[^\s"']+/g, "<url>");
        m = m.replace(/\b([a-zA-Z_]\w*)\/([\w]{16,28})\b/g, "$1/:docId");
        return `${source}:${m}`;
      };
      var normalizeHistoryKey = normalizeHistoryKey2;
      const hGroups = /* @__PURE__ */ new Map();
      for (const err of historyErrors) {
        const key = normalizeHistoryKey2(err.message, err.source);
        if (!hGroups.has(key)) hGroups.set(key, { message: err.message, source: err.source, occurrences: 0, lastSeen: err.lastSeen });
        const g = hGroups.get(key);
        g.occurrences += err.occurrences || 1;
        if (err.lastSeen > g.lastSeen) {
          g.lastSeen = err.lastSeen;
          g.message = err.message;
        }
      }
      report.history = [...hGroups.values()];
    }
    if (health) {
      report.health = stripNulls({
        verdict: health.verdict,
        uniqueErrors: health.uniqueErrors,
        totalOccurrences: health.totalOccurrences,
        systemicCount: health.systemicCount,
        bySource: health.bySource
      });
    }
    const text = JSON.stringify(report, null, 2);
    const copied = await copyToClipboard(text);
    if (copied) {
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2e3);
    } else {
      setReportText(text);
    }
  }
  const refresh = useCallback(() => {
    setErrorCount(blackbox_default.getErrorCount());
    setErrors(blackbox_default.getRecentErrors(20));
    setSilences(blackbox_default.getSuspiciousSilences());
  }, []);
  useEffect(() => {
    refresh();
    const unsub = blackbox_default.onUpdate(refresh);
    return unsub;
  }, [refresh]);
  useEffect(() => {
    function handleKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);
  async function loadHistory() {
    setHistoryLoading(true);
    const result = await blackbox_default.queryPersistedErrors(50);
    setHistoryErrors(result.errors || []);
    setHistoryLoaded(true);
    setHistoryLoading(false);
  }
  async function loadHealth() {
    setHealthLoading(true);
    const result = await blackbox_default.queryHealth();
    setHealth(result);
    setHealthLoading(false);
  }
  async function loadTimeline() {
    setTimelineLoading(true);
    const result = await blackbox_default.queryTimeline(timelineMinutes);
    setTimeline(result.events || []);
    setTimelineLoaded(true);
    setTimelineLoading(false);
  }
  function handleClearSession() {
    blackbox_default.clearErrors();
    setExpandedError(null);
    setClearSessionFeedback(true);
    setTimeout(() => setClearSessionFeedback(false), 2e3);
  }
  async function handleClearPersisted() {
    setClearing(true);
    const result = await blackbox_default.clearPersistedErrors();
    setClearing(false);
    setShowClearConfirm(false);
    if (result.success) {
      setHistoryErrors([]);
      setHistoryLoaded(false);
      setHealth(null);
      setTimeline([]);
      setTimelineLoaded(false);
      setDeleteSuccess(true);
      setTimeout(() => setDeleteSuccess(false), 3e3);
    }
  }
  function toggleStack(key) {
    setExpandedStacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleFilter(type) {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }
  function matchesSearch(err) {
    var _a, _b;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const msg = (err.message || "").toLowerCase();
    const src = (err.source || "").toLowerCase();
    const path = (((_a = err.metadata) == null ? void 0 : _a.url) || ((_b = err.metadata) == null ? void 0 : _b.path) || err.path || "").toLowerCase();
    return msg.includes(q) || src.includes(q) || path.includes(q);
  }
  function copyToClipboard(text) {
    var _a;
    if ((_a = navigator.clipboard) == null ? void 0 : _a.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch (e) {
      return false;
    }
  }
  async function copyAsJSON(err, key) {
    const ok = await copyToClipboard(errorToJSON(err));
    if (ok) {
      setCopiedErrorKey(key + ":json");
      setTimeout(() => setCopiedErrorKey(null), 1500);
    }
  }
  async function copyAsMarkdown(err, key) {
    const ok = await copyToClipboard(errorToMarkdown(err));
    if (ok) {
      setCopiedErrorKey(key + ":md");
      setTimeout(() => setCopiedErrorKey(null), 1500);
    }
  }
  const hasSilences = silences.length > 0;
  const uniqueKeys = new Set(errors.map((e) => `${e.source}:${(e.message || "").slice(0, 80)}`));
  const uniqueCount = uniqueKeys.size;
  let badgeBg = "#22c55e";
  if (uniqueCount >= 6) badgeBg = "#ef4444";
  else if (uniqueCount >= 1) badgeBg = "#f59e0b";
  const badgeText = uniqueCount > 99 ? "99+" : String(uniqueCount);
  if (!isOpen) {
    return /* @__PURE__ */ jsxs("div", { "data-bb-panel": true, onClick: () => setIsOpen(true), style: {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: 99999,
      width: "40px",
      height: "40px",
      borderRadius: "50%",
      background: badgeBg,
      color: "white",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      fontFamily: "system-ui, sans-serif",
      userSelect: "none",
      lineHeight: 1
    }, children: [
      /* @__PURE__ */ jsx("span", { style: { fontSize: errorCount > 99 ? "11px" : "16px", fontWeight: "bold" }, children: badgeText }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: "8px", opacity: 0.9, marginTop: "1px" }, children: "BB" }),
      hasSilences && /* @__PURE__ */ jsx("div", { style: { position: "absolute", top: "-2px", right: "-2px", width: "10px", height: "10px", borderRadius: "50%", background: "#facc15", border: "2px solid white" } })
    ] });
  }
  const panelWidth = typeof window !== "undefined" && window.innerWidth < 480 ? "calc(100vw - 16px)" : "400px";
  const panelStyle = isExpanded ? {
    position: "fixed",
    top: "16px",
    right: "16px",
    bottom: "16px",
    left: "16px",
    zIndex: 99999,
    maxWidth: "none",
    maxHeight: "none",
    background: "rgba(26, 26, 46, 0.97)",
    borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    color: "#e0e0e0",
    fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
    fontSize: "12px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  } : {
    position: "fixed",
    bottom: "16px",
    right: "8px",
    zIndex: 99999,
    width: panelWidth,
    maxWidth: "400px",
    maxHeight: "min(520px, calc(100vh - 32px))",
    background: "rgba(26, 26, 46, 0.97)",
    borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    color: "#e0e0e0",
    fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
    fontSize: "12px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  };
  function renderErrorDetail(err, keyPrefix) {
    const stackKey = keyPrefix;
    const stackVisible = expandedStacks.has(stackKey);
    const allBreadcrumbs = err.breadcrumbs || [];
    const filteredBreadcrumbs = allBreadcrumbs.filter((bc) => activeFilters.has(bc.type) || !BREADCRUMB_FILTER_TYPES.includes(bc.type));
    const last5 = filteredBreadcrumbs.slice(-5);
    return /* @__PURE__ */ jsxs("div", { style: { padding: "6px 14px 10px 24px", background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "6px", marginBottom: "6px" }, children: [
        /* @__PURE__ */ jsx("button", { onClick: (e) => {
          e.stopPropagation();
          copyAsJSON(err, keyPrefix);
        }, style: copyBtnStyle, children: copiedErrorKey === keyPrefix + ":json" ? "\u2713 Copied" : "\u{1F4CB} Copy JSON" }),
        /* @__PURE__ */ jsx("button", { onClick: (e) => {
          e.stopPropagation();
          copyAsMarkdown(err, keyPrefix);
        }, style: copyBtnStyle, children: copiedErrorKey === keyPrefix + ":md" ? "\u2713 Copied" : "\u{1F4CB} Copy MD" })
      ] }),
      err.stack && /* @__PURE__ */ jsxs("div", { style: { marginBottom: "6px" }, children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            onClick: (e) => {
              e.stopPropagation();
              toggleStack(stackKey);
            },
            style: { cursor: "pointer", fontSize: "11px", color: "#a5b4fc", userSelect: "none", display: "flex", alignItems: "center", gap: "4px" },
            children: [
              /* @__PURE__ */ jsx("span", { children: stackVisible ? "\u25BC" : "\u25B6" }),
              /* @__PURE__ */ jsx("span", { children: "Stack" })
            ]
          }
        ),
        stackVisible && /* @__PURE__ */ jsx("pre", { style: {
          fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
          fontSize: "10px",
          color: "#bbb",
          background: "rgba(0,0,0,0.4)",
          borderRadius: "6px",
          padding: "8px",
          marginTop: "4px",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all"
        }, children: err.stack })
      ] }),
      allBreadcrumbs.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", marginBottom: "6px" }, children: BREADCRUMB_FILTER_TYPES.map((type) => /* @__PURE__ */ jsx(
          "button",
          {
            onClick: (e) => {
              e.stopPropagation();
              toggleFilter(type);
            },
            style: filterChipStyle(activeFilters.has(type)),
            children: bcTypeLabel(type)
          },
          type
        )) }),
        /* @__PURE__ */ jsxs("div", { style: { fontSize: "10px", color: "#888", marginBottom: "4px" }, children: [
          "Last ",
          last5.length,
          " steps before error:"
        ] }),
        last5.map((bc, j) => /* @__PURE__ */ jsxs("div", { style: { fontSize: "11px", color: "#aaa", padding: "2px 0", display: "flex", gap: "6px" }, children: [
          /* @__PURE__ */ jsx("span", { style: { color: "#666", flexShrink: 0, width: "70px" }, children: bcTypeLabel(bc.type) }),
          /* @__PURE__ */ jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: bcSummary(bc) })
        ] }, j))
      ] })
    ] });
  }
  function passesInternalFilter(err) {
    if (showInternal) return true;
    return !(err.internal === true || err._internal === true);
  }
  const filteredLiveErrors = [...errors].reverse().filter(matchesSearch).filter(passesInternalFilter);
  const filteredHistoryErrors = historyErrors.filter(matchesSearch).filter(passesInternalFilter);
  const hiddenInternalCount = [...errors].filter((e) => e.internal === true || e._internal === true).length + historyErrors.filter((e) => e.internal === true).length;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    isExpanded && /* @__PURE__ */ jsx("div", { style: {
      position: "fixed",
      inset: 0,
      zIndex: 99998,
      background: "rgba(0, 0, 0, 0.5)"
    }, onClick: () => setIsExpanded(false) }),
    /* @__PURE__ */ jsxs("div", { "data-bb-panel": true, style: panelStyle, children: [
      /* @__PURE__ */ jsx("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0, gap: "8px" }, children: searchOpen ? /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", alignItems: "center", gap: "6px" }, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            ref: (el) => el && el.focus(),
            type: "text",
            placeholder: "Search errors...",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            onKeyDown: (e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                setSearchQuery("");
              }
            },
            style: __spreadProps(__spreadValues({}, searchInputStyle), { margin: 0 })
          }
        ),
        /* @__PURE__ */ jsx("span", { onClick: () => {
          setSearchOpen(false);
          setSearchQuery("");
        }, style: { cursor: "pointer", fontSize: "14px", color: "#999", padding: "4px", flexShrink: 0 }, children: "\u2715" })
      ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { style: { fontWeight: "bold", fontSize: "13px", color: "white" }, children: "BlackBox" }),
        /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", color: "#666" }, children: isConnected ? "DB connected" : "Local only" }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "2px" }, children: [
          /* @__PURE__ */ jsx("span", { onClick: () => setSearchOpen(true), title: "Search errors", style: { cursor: "pointer", fontSize: "13px", color: "#999", padding: "4px 8px", borderRadius: "4px", transition: "color 0.15s" }, children: "\u{1F50D}" }),
          /* @__PURE__ */ jsx("span", { onClick: copyFullReport, title: "Copy full diagnostic report as JSON", style: { cursor: "pointer", fontSize: "13px", color: reportCopied ? "#22c55e" : reportEmpty ? "#f59e0b" : "#999", padding: "4px 8px", borderRadius: "4px", transition: "color 0.15s" }, children: reportCopied ? "\u2713" : reportEmpty ? "\u2205" : "\u{1F4CB}" }),
          /* @__PURE__ */ jsx("span", { onClick: () => setIsExpanded((prev) => !prev), style: { cursor: "pointer", fontSize: "16px", color: "#999", padding: "4px 8px", borderRadius: "4px" }, children: isExpanded ? "\u2921" : "\u2922" }),
          /* @__PURE__ */ jsx("span", { onClick: () => {
            setIsOpen(false);
            setIsExpanded(false);
          }, style: { cursor: "pointer", fontSize: "16px", color: "#999", padding: "4px 8px", marginRight: "-8px", borderRadius: "4px" }, children: "\u2715" })
        ] })
      ] }) }),
      /* @__PURE__ */ jsx("div", { style: { display: "flex", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0, padding: "0 6px" }, children: ["live", "history", "health"].map((t) => /* @__PURE__ */ jsx(
        "button",
        {
          onClick: () => {
            setTab(t);
            if (t === "history" && !historyLoaded) loadHistory();
            if (t === "health" && !health) loadHealth();
          },
          onMouseEnter: () => setHoveredTab(t),
          onMouseLeave: () => setHoveredTab(null),
          style: tabStyle(tab === t, hoveredTab === t),
          children: t.charAt(0).toUpperCase() + t.slice(1)
        },
        t
      )) }),
      hiddenInternalCount > 0 && (tab === "live" || tab === "history") && /* @__PURE__ */ jsxs("div", { style: { padding: "4px 14px", fontSize: "10px", color: "#888", display: "flex", alignItems: "center", gap: "8px", borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [
        /* @__PURE__ */ jsxs("span", { children: [
          hiddenInternalCount,
          " framework-internal error",
          hiddenInternalCount !== 1 ? "s" : "",
          " hidden"
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: () => setShowInternal((s) => !s), style: filterChipStyle(showInternal), children: showInternal ? "Hide" : "Show" })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { flex: 1, overflowY: "auto", minHeight: 0 }, children: [
        tab === "live" && /* @__PURE__ */ jsxs("div", { children: [
          filteredLiveErrors.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px 14px", textAlign: "center", color: "#22c55e" }, children: errors.length === 0 ? "No errors captured" : "No matching errors" }) : filteredLiveErrors.map((err, i) => {
            var _a, _b;
            const errKey = `${err._fingerprint || "fp"}:${((_a = err.metadata) == null ? void 0 : _a.timestamp) || ""}:${i}`;
            const isExp = expandedError === errKey;
            return /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsxs("div", { onClick: () => setExpandedError(isExp ? null : errKey), style: { padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", background: isExp ? "rgba(255,255,255,0.05)" : "transparent" }, children: [
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
                  /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: sourceColor(err.source), color: "white", fontWeight: "bold", textTransform: "uppercase", flexShrink: 0 }, children: err.source || "error" }),
                  /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", opacity: 0.4, marginLeft: "auto", flexShrink: 0 }, children: timeAgo((_b = err.metadata) == null ? void 0 : _b.timestamp) })
                ] }),
                /* @__PURE__ */ jsx("div", { style: { color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: (err.message || "").slice(0, 80) })
              ] }),
              isExp && renderErrorDetail(err, `live-${i}`)
            ] }, errKey);
          }),
          hasSilences && /* @__PURE__ */ jsxs("div", { style: { borderTop: "1px solid rgba(255,255,255,0.1)", padding: "8px 14px" }, children: [
            /* @__PURE__ */ jsx("div", { style: { color: "#facc15", fontSize: "11px", fontWeight: "bold", marginBottom: "2px" }, children: "Unresponsive clicks detected" }),
            /* @__PURE__ */ jsx("div", { style: { color: "#888", fontSize: "10px", marginBottom: "6px" }, children: "These buttons/links were clicked but nothing happened \u2014 they may be broken or missing handlers." }),
            silences.slice(0, 5).map((s, i) => {
              var _a, _b, _c;
              return /* @__PURE__ */ jsxs("div", { style: { fontSize: "11px", color: "#aaa", padding: "2px 0" }, children: [
                ((_a = s.clickedElement) == null ? void 0 : _a.tag) || "element",
                ((_b = s.clickedElement) == null ? void 0 : _b.id) ? `#${s.clickedElement.id}` : "",
                ((_c = s.clickedElement) == null ? void 0 : _c.text) ? ` "${s.clickedElement.text.slice(0, 20)}"` : ""
              ] }, i);
            })
          ] })
        ] }),
        tab === "history" && /* @__PURE__ */ jsx("div", { children: !isConnected ? /* @__PURE__ */ jsxs("div", { style: { padding: "24px 14px", textAlign: "center", color: "#888" }, children: [
          /* @__PURE__ */ jsx("div", { style: { marginBottom: "8px" }, children: "No database connected" }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: "11px", color: "#666" }, children: "Error history is only available when BlackBox is set up with a database. Errors are still being tracked in this session." })
        ] }) : historyLoading ? /* @__PURE__ */ jsx("div", { style: { padding: "24px 14px", textAlign: "center", color: "#888" }, children: "Loading..." }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { style: { padding: "8px 14px", display: "flex", gap: "8px", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [
            /* @__PURE__ */ jsx("button", { onClick: loadHistory, style: __spreadProps(__spreadValues({}, loadBtn), { padding: "4px 12px", fontSize: "11px" }), children: "Refresh" }),
            /* @__PURE__ */ jsx("button", { onClick: loadTimeline, style: __spreadProps(__spreadValues({}, loadBtn), { padding: "4px 12px", fontSize: "11px", background: "#8b5cf6" }), children: timelineLoading ? "Loading..." : "Timeline" }),
            /* @__PURE__ */ jsxs(
              "select",
              {
                value: timelineMinutes,
                onChange: (e) => setTimelineMinutes(Number(e.target.value)),
                style: {
                  background: "rgba(255,255,255,0.1)",
                  color: "#ccc",
                  border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "4px",
                  padding: "3px 4px",
                  fontSize: "10px",
                  cursor: "pointer"
                },
                children: [
                  /* @__PURE__ */ jsx("option", { value: 5, children: "5m" }),
                  /* @__PURE__ */ jsx("option", { value: 10, children: "10m" }),
                  /* @__PURE__ */ jsx("option", { value: 30, children: "30m" }),
                  /* @__PURE__ */ jsx("option", { value: 60, children: "1h" })
                ]
              }
            )
          ] }),
          deleteSuccess && /* @__PURE__ */ jsx("div", { style: { padding: "8px 14px", textAlign: "center", color: "#22c55e", fontSize: "11px", background: "rgba(34,197,94,0.1)" }, children: "All saved errors deleted successfully." }),
          filteredHistoryErrors.length === 0 && !timelineLoaded && timeline.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px 14px", textAlign: "center", color: "#22c55e" }, children: historyErrors.length === 0 ? "No saved errors" : "No matching errors" }) : /* @__PURE__ */ jsxs(Fragment, { children: [
            filteredHistoryErrors.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs("div", { style: sectionTitle, children: [
                "Saved Errors (",
                filteredHistoryErrors.length,
                ")"
              ] }),
              filteredHistoryErrors.map((err, i) => {
                const isExp = expandedHistory === i;
                return /* @__PURE__ */ jsxs("div", { children: [
                  /* @__PURE__ */ jsxs("div", { onClick: () => setExpandedHistory(isExp ? null : i), style: { padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", background: isExp ? "rgba(255,255,255,0.05)" : "transparent" }, children: [
                    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
                      /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: sourceColor(err.source), color: "white", fontWeight: "bold", textTransform: "uppercase", flexShrink: 0 }, children: err.source || "error" }),
                      (err.occurrences || 1) > 1 && /* @__PURE__ */ jsxs("span", { style: { fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: "rgba(255,255,255,0.15)", color: "#ccc", flexShrink: 0 }, children: [
                        "x",
                        err.occurrences
                      ] }),
                      /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", opacity: 0.4, marginLeft: "auto", flexShrink: 0 }, children: timeAgo(err.lastSeen) })
                    ] }),
                    /* @__PURE__ */ jsx("div", { style: { color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: (err.message || "").slice(0, 80) })
                  ] }),
                  isExp && renderErrorDetail(err, `history-${i}`)
                ] }, i);
              })
            ] }),
            timeline.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs("div", { style: sectionTitle, children: [
                "Timeline (",
                timeline.length,
                " events",
                timeline.length > 30 ? " \u2014 showing last 30" : "",
                ")"
              ] }),
              timeline.slice(-30).map((ev, i) => /* @__PURE__ */ jsxs("div", { style: { padding: "4px 14px", display: "flex", gap: "8px", fontSize: "11px", borderBottom: "1px solid rgba(255,255,255,0.03)" }, children: [
                /* @__PURE__ */ jsx("span", { style: { color: "#555", flexShrink: 0, width: "55px" }, children: new Date(ev.timestamp).toLocaleTimeString() }),
                /* @__PURE__ */ jsx("span", { style: { color: "#777", flexShrink: 0, width: "65px" }, children: bcTypeLabel(ev.type) }),
                /* @__PURE__ */ jsx("span", { style: { color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: bcSummary(ev) })
              ] }, i))
            ] }),
            timelineLoaded && timeline.length === 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "12px 14px", textAlign: "center", color: "#888", fontSize: "11px" }, children: [
              "No activity recorded in the last ",
              timelineMinutes,
              " minutes."
            ] })
          ] })
        ] }) }),
        tab === "health" && /* @__PURE__ */ jsx("div", { style: { padding: "12px 14px" }, children: !isConnected ? /* @__PURE__ */ jsxs("div", { style: { textAlign: "center", color: "#888", padding: "12px 0" }, children: [
          /* @__PURE__ */ jsx("div", { style: { marginBottom: "8px" }, children: "No database connected" }),
          /* @__PURE__ */ jsx("div", { style: { fontSize: "11px", color: "#666" }, children: "Health data requires a database connection. Errors are still tracked locally." })
        ] }) : healthLoading ? /* @__PURE__ */ jsx("div", { style: { textAlign: "center", color: "#888", padding: "24px 0" }, children: "Loading..." }) : !health ? /* @__PURE__ */ jsx("div", { style: { textAlign: "center", padding: "24px 0" }, children: /* @__PURE__ */ jsx("button", { onClick: loadHealth, style: loadBtn, children: "Check Health" }) }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { style: { textAlign: "center", padding: "16px 0", marginBottom: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.03)" }, children: [
            /* @__PURE__ */ jsx("div", { style: { fontSize: "24px", fontWeight: "bold", color: verdictColor(health.verdict) }, children: health.verdict }),
            /* @__PURE__ */ jsx("div", { style: { fontSize: "11px", color: "#888", marginTop: "4px" }, children: "Last 24 hours" })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "8px", marginBottom: "12px" }, children: [
            /* @__PURE__ */ jsxs("div", { style: statBox(), children: [
              /* @__PURE__ */ jsx("div", { style: { fontSize: "20px", fontWeight: "bold", color: "#ccc" }, children: health.uniqueErrors }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "#888" }, children: "Unique" })
            ] }),
            /* @__PURE__ */ jsxs("div", { style: statBox(), children: [
              /* @__PURE__ */ jsx("div", { style: { fontSize: "20px", fontWeight: "bold", color: "#ccc" }, children: health.totalOccurrences }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "#888" }, children: "Total" })
            ] }),
            /* @__PURE__ */ jsxs("div", { style: statBox(), children: [
              /* @__PURE__ */ jsx("div", { style: { fontSize: "20px", fontWeight: "bold", color: "#ccc" }, children: health.systemicCount }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "#888" }, children: "Repeated 10+" })
            ] })
          ] }),
          health.bySource && Object.keys(health.bySource).length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("div", { style: sectionTitle, children: "By Source" }),
            Object.entries(health.bySource).map(([src, count]) => /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", padding: "4px 14px", fontSize: "11px" }, children: [
              /* @__PURE__ */ jsx("span", { style: { color: sourceColor(src) }, children: src }),
              /* @__PURE__ */ jsx("span", { style: { color: "#888" }, children: count })
            ] }, src))
          ] }),
          health.topErrors && health.topErrors.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("div", { style: __spreadProps(__spreadValues({}, sectionTitle), { marginTop: "8px" }), children: "Top Errors" }),
            health.topErrors.map((err, i) => /* @__PURE__ */ jsxs("div", { style: { padding: "6px 14px", borderBottom: "1px solid rgba(255,255,255,0.03)" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "2px" }, children: [
                /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: sourceColor(err.source), color: "white", fontWeight: "bold", textTransform: "uppercase" }, children: err.source }),
                /* @__PURE__ */ jsxs("span", { style: { fontSize: "10px", color: "#888", marginLeft: "auto" }, children: [
                  "x",
                  err.occurrences
                ] })
              ] }),
              /* @__PURE__ */ jsx("div", { style: { fontSize: "11px", color: "#aaa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: (err.message || "").slice(0, 70) })
            ] }, i))
          ] }),
          /* @__PURE__ */ jsx("div", { style: { textAlign: "center", marginTop: "12px" }, children: /* @__PURE__ */ jsx("button", { onClick: loadHealth, style: __spreadProps(__spreadValues({}, loadBtn), { padding: "4px 12px", fontSize: "11px" }), children: "Refresh" }) })
        ] }) })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }, children: [
        /* @__PURE__ */ jsx("span", { style: { fontSize: "11px", opacity: 0.6 }, children: tab === "live" ? `${uniqueCount} error${uniqueCount !== 1 ? "s" : ""} this session` : tab === "history" ? `${historyErrors.length} saved` : health ? health.verdict : "Health" }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "6px", alignItems: "center" }, children: [
          tab === "live" && (clearSessionFeedback ? /* @__PURE__ */ jsx("span", { style: { fontSize: "11px", color: "#22c55e", padding: "2px 8px" }, children: "Cleared!" }) : /* @__PURE__ */ jsx("span", { onClick: handleClearSession, style: { cursor: "pointer", fontSize: "11px", color: "#999", padding: "2px 8px", borderRadius: "3px", border: "1px solid rgba(255,255,255,0.15)" }, children: "Clear Session" })),
          tab === "history" && isConnected && /* @__PURE__ */ jsx("span", { onClick: () => setShowClearConfirm(true), style: { cursor: "pointer", fontSize: "11px", color: "#ef4444", padding: "2px 8px", borderRadius: "3px", border: "1px solid rgba(239,68,68,0.3)" }, children: "Delete All" })
        ] })
      ] }),
      showClearConfirm && /* @__PURE__ */ jsxs("div", { style: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderRadius: "12px", padding: "24px", gap: "16px" }, children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: "14px", color: "white", fontWeight: "bold", textAlign: "center" }, children: "Delete all saved errors?" }),
        /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "#999", textAlign: "center" }, children: "This permanently removes all error data from the database. This cannot be undone." }),
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "12px", marginTop: "8px" }, children: [
          /* @__PURE__ */ jsx("button", { onClick: () => setShowClearConfirm(false), style: cancelBtn, children: "Cancel" }),
          /* @__PURE__ */ jsx("button", { onClick: handleClearPersisted, disabled: clearing, style: dangerBtn, children: clearing ? "Deleting..." : "Yes, Delete All" })
        ] })
      ] }),
      reportText && /* @__PURE__ */ jsxs("div", { style: { position: "absolute", inset: 0, background: "rgba(0,0,0,0.95)", display: "flex", flexDirection: "column", borderRadius: "12px", padding: "12px", gap: "8px", zIndex: 10 }, children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
          /* @__PURE__ */ jsx("span", { style: { fontSize: "12px", color: "#ccc", fontWeight: "bold" }, children: "Select All + Copy (Ctrl+A, Ctrl+C)" }),
          /* @__PURE__ */ jsx("span", { onClick: () => setReportText(null), style: { cursor: "pointer", color: "#999", fontSize: "16px", padding: "2px 6px" }, children: "\u2715" })
        ] }),
        /* @__PURE__ */ jsx(
          "textarea",
          {
            readOnly: true,
            value: reportText,
            onFocus: (e) => e.target.select(),
            style: {
              flex: 1,
              width: "100%",
              background: "#111",
              color: "#9fef00",
              border: "1px solid #333",
              borderRadius: "6px",
              padding: "8px",
              fontSize: "10px",
              fontFamily: "monospace",
              resize: "none",
              outline: "none"
            }
          }
        )
      ] })
    ] })
  ] });
}
function BlackBoxPanelWrapper() {
  return /* @__PURE__ */ jsx(BlackBoxPanel, {});
}

// src/components/BlackBoxProvider.js
import { Component } from "react";
import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var isProduction = typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production";
var BlackBoxProvider = class extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, dismissed: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true, dismissed: false };
  }
  componentDidCatch(error, info) {
    if (!isProduction) {
      try {
        blackbox_default.captureError(error, {
          source: "react_boundary",
          componentStack: (info == null ? void 0 : info.componentStack) || ""
        });
      } catch (e) {
      }
    }
  }
  render() {
    if (this.state.hasError && !this.state.dismissed) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return /* @__PURE__ */ jsxs2("div", { style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        background: "#f5f5f5",
        borderRadius: "8px",
        textAlign: "center"
      }, children: [
        /* @__PURE__ */ jsx2("p", { style: { color: "#333", fontSize: "16px", margin: "0 0 8px 0" }, children: "Something went wrong." }),
        /* @__PURE__ */ jsx2("p", { style: { color: "#333", fontSize: "14px", margin: "0 0 20px 0" }, children: "The error has been recorded for debugging." }),
        /* @__PURE__ */ jsxs2("div", { style: { display: "flex", gap: "12px" }, children: [
          /* @__PURE__ */ jsx2(
            "button",
            {
              onClick: () => this.setState({ hasError: false, dismissed: false }),
              style: {
                padding: "8px 20px",
                border: "1px solid #999",
                borderRadius: "4px",
                background: "white",
                cursor: "pointer",
                fontSize: "14px"
              },
              children: "Try Again"
            }
          ),
          /* @__PURE__ */ jsx2(
            "button",
            {
              onClick: () => this.setState({ dismissed: true }),
              style: {
                padding: "8px 20px",
                border: "1px solid #999",
                borderRadius: "4px",
                background: "white",
                cursor: "pointer",
                fontSize: "14px"
              },
              children: "Dismiss"
            }
          )
        ] })
      ] });
    }
    return this.props.children;
  }
};
var BlackBoxProvider_default = BlackBoxProvider;
export {
  BlackBoxPanelWrapper as BlackBoxPanel,
  BlackBoxProvider_default as BlackBoxProvider
};
