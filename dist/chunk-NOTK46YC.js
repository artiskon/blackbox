'use client';
import {
  blackbox_default
} from "./chunk-TOYJMXGI.js";
import {
  __spreadProps,
  __spreadValues
} from "./chunk-QHIKVRM4.js";

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
  if (source === "firebase") return "#3b82f6";
  if (source === "console.error") return "#8b5cf6";
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
function bcSummary(bc) {
  if (bc.type === "click") return `${bc.tag || "element"}${bc.id ? "#" + bc.id : ""} "${(bc.text || "").slice(0, 25)}"`;
  if (bc.type === "navigation") return `${bc.from || "?"} \u2192 ${bc.to || "?"}`;
  if (bc.type === "network") return `${bc.method || "GET"} ${bc.url || ""} ${bc.status || ""}`;
  if (bc.type === "error") return (bc.message || "").slice(0, 40);
  return bc.action || bc.message || bc.url || bc.to || bc.tag || "";
}
var tabStyle = (active, hovered) => ({
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: active ? "bold" : "normal",
  color: active ? "white" : hovered ? "#ccc" : "#888",
  borderBottom: active ? "2px solid #6366f1" : "2px solid transparent",
  background: hovered && !active ? "rgba(255,255,255,0.05)" : "transparent",
  border: "none",
  borderBottomStyle: "solid",
  transition: "color 0.15s, background 0.15s"
});
var sectionTitle = { fontSize: "10px", color: "#888", textTransform: "uppercase", padding: "8px 14px 4px", letterSpacing: "0.5px" };
var loadBtn = { background: "#6366f1", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px", fontWeight: 600 };
var dangerBtn = { background: "#ef4444", color: "white", border: "none", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px", fontWeight: 600 };
var cancelBtn = { background: "transparent", color: "#999", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px", padding: "8px 16px", cursor: "pointer", fontSize: "12px" };
var statBox = () => ({ textAlign: "center", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", flex: 1 });
function BlackBoxPanel() {
  const [isOpen, setIsOpen] = useState(false);
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
  const isConnected = blackbox_default.isConnectedToFirestore();
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
    await blackbox_default.clearPersistedErrors();
    setClearing(false);
    setShowClearConfirm(false);
    setHistoryErrors([]);
    setHistoryLoaded(false);
    setHealth(null);
    setTimeline([]);
    setTimelineLoaded(false);
    setDeleteSuccess(true);
    setTimeout(() => setDeleteSuccess(false), 3e3);
  }
  const hasSilences = silences.length > 0;
  let badgeBg = "#22c55e";
  if (errorCount >= 6) badgeBg = "#ef4444";
  else if (errorCount >= 1) badgeBg = "#f59e0b";
  const badgeText = errorCount > 99 ? "99+" : String(errorCount);
  if (!isOpen) {
    return /* @__PURE__ */ jsxs("div", { onClick: () => setIsOpen(true), style: {
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
  return /* @__PURE__ */ jsxs("div", { style: {
    position: "fixed",
    bottom: "16px",
    right: "8px",
    zIndex: 99999,
    width: panelWidth,
    maxWidth: "400px",
    maxHeight: "520px",
    background: "rgba(26, 26, 46, 0.97)",
    borderRadius: "12px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    color: "#e0e0e0",
    fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
    fontSize: "12px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  }, children: [
    /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }, children: [
      /* @__PURE__ */ jsx("span", { style: { fontWeight: "bold", fontSize: "13px", color: "white" }, children: "BlackBox" }),
      /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", color: "#666" }, children: isConnected ? "DB connected" : "Local only" }),
      /* @__PURE__ */ jsx("span", { onClick: () => setIsOpen(false), style: { cursor: "pointer", fontSize: "16px", color: "#999", padding: "4px 8px", marginRight: "-8px", borderRadius: "4px" }, children: "\u2715" })
    ] }),
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
    /* @__PURE__ */ jsxs("div", { style: { flex: 1, overflowY: "auto", minHeight: 0 }, children: [
      tab === "live" && /* @__PURE__ */ jsxs("div", { children: [
        [...errors].reverse().length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px 14px", textAlign: "center", color: "#22c55e" }, children: "No errors captured" }) : [...errors].reverse().map((err, i) => {
          var _a;
          const isExpanded = expandedError === i;
          const last5 = (err.breadcrumbs || []).slice(-5);
          return /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("div", { onClick: () => setExpandedError(isExpanded ? null : i), style: { padding: "8px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)", background: isExpanded ? "rgba(255,255,255,0.05)" : "transparent" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }, children: [
                /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: sourceColor(err.source), color: "white", fontWeight: "bold", textTransform: "uppercase", flexShrink: 0 }, children: err.source || "error" }),
                /* @__PURE__ */ jsx("span", { style: { fontSize: "10px", opacity: 0.4, marginLeft: "auto", flexShrink: 0 }, children: timeAgo((_a = err.metadata) == null ? void 0 : _a.timestamp) })
              ] }),
              /* @__PURE__ */ jsx("div", { style: { color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: (err.message || "").slice(0, 80) })
            ] }),
            isExpanded && last5.length > 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "6px 14px 10px 24px", background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [
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
          ] }, i);
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
        historyErrors.length === 0 && !timelineLoaded && timeline.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px 14px", textAlign: "center", color: "#22c55e" }, children: "No saved errors" }) : /* @__PURE__ */ jsxs(Fragment, { children: [
          historyErrors.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsxs("div", { style: sectionTitle, children: [
              "Saved Errors (",
              historyErrors.length,
              ")"
            ] }),
            historyErrors.map((err, i) => {
              const isExp = expandedHistory === i;
              const last5 = (err.breadcrumbs || []).slice(-5);
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
                isExp && last5.length > 0 && /* @__PURE__ */ jsxs("div", { style: { padding: "6px 14px 10px 24px", background: "rgba(0,0,0,0.2)", borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [
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
      /* @__PURE__ */ jsx("span", { style: { fontSize: "11px", opacity: 0.6 }, children: tab === "live" ? `${errorCount} error${errorCount !== 1 ? "s" : ""} this session` : tab === "history" ? `${historyErrors.length} saved` : health ? health.verdict : "Health" }),
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
  BlackBoxPanelWrapper,
  BlackBoxProvider_default
};
