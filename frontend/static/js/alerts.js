/**
 * alerts.js
 * ---------
 * Phase 6: Electrical Alerts & Abnormal Condition Client-Side Controller
 * Faculty of Engineering, University of Ruhuna
 *
 * Handles:
 * - Real-time polling and fetching of /api/alerts with query filters.
 * - Summary counter updates (Active Critical, Active Warnings, Total Active, Cleared).
 * - Rendering responsive alerts table with severity badges and status indicators.
 * - Administrator acknowledgment action via POST /api/alerts/<id>/acknowledge.
 * - Live update interval with user-friendly timestamps.
 */

// Human-readable labels and threshold formatters for each alert type
const ALERT_TYPE_META = {
  "LOW_POWER_FACTOR": {
    label: "Low Power Factor",
    icon: "⚡",
    unit: "",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(3) : "--"} (Target: &ge; ${Number(thresh).toFixed(3)})`
  },
  "LOW_VOLTAGE": {
    label: "Undervoltage",
    icon: "📉",
    unit: "V",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(1) : "--"} V (Limit: &lt; ${Number(thresh).toFixed(1)} V)`
  },
  "HIGH_VOLTAGE": {
    label: "Overvoltage",
    icon: "📈",
    unit: "V",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(1) : "--"} V (Limit: &gt; ${Number(thresh).toFixed(1)} V)`
  },
  "HIGH_FREQUENCY": {
    label: "High Frequency",
    icon: "⚡",
    unit: "Hz",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(2) : "--"} Hz (Limit: &gt; ${Number(thresh).toFixed(2)} Hz)`
  },
  "LOW_FREQUENCY": {
    label: "Low Frequency",
    icon: "⚡",
    unit: "Hz",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(2) : "--"} Hz (Limit: &lt; ${Number(thresh).toFixed(2)} Hz)`
  },
  "HIGH_LOAD": {
    label: "High Load (>90%)",
    icon: "⚠️",
    unit: "kW",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(1) : "--"} kW (Limit: &gt; ${Number(thresh).toFixed(1)} kW)`
  },
  "OVERLOAD": {
    label: "Feeder Overload (>100%)",
    icon: "🚨",
    unit: "kW",
    formatObserved: (val, thresh) => `${val !== null ? Number(val).toFixed(1) : "--"} kW (Capacity: ${Number(thresh).toFixed(1)} kW)`
  },
  "SENSOR_OFFLINE": {
    label: "Sensor Offline",
    icon: "📡",
    unit: "s",
    formatObserved: (val, thresh) => `${val !== null ? Math.round(Number(val)) : "--"}s (Limit: &gt; ${Math.round(Number(thresh))}s)`
  }
};

let pollInterval = null;
let currentRole = "Viewer";

document.addEventListener("DOMContentLoaded", () => {
  // Detect role from DOM badge
  const roleEl = document.getElementById("userRoleBadge");
  if (roleEl && roleEl.dataset.role) {
    currentRole = roleEl.dataset.role;
  }

  // Setup refresh button
  const refreshBtn = document.getElementById("btnRefreshAlerts");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadAlerts(true);
    });
  }

  // Setup filter reset button
  const resetBtn = document.getElementById("btnFilterReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      document.getElementById("filterBuilding").value = "all";
      document.getElementById("filterSeverity").value = "all";
      document.getElementById("filterStatus").value = "active";
      document.getElementById("filterStart").value = "";
      document.getElementById("filterEnd").value = "";
      loadAlerts();
    });
  }

  // Filter change auto-trigger
  ["filterBuilding", "filterSeverity", "filterStatus"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => loadAlerts());
    }
  });

  // Initial load
  loadAlerts();

  // Periodic polling every 5 seconds
  pollInterval = setInterval(() => {
    loadAlerts(false);
  }, 5000);
});

/**
 * Fetch and render alerts from backend SQLite REST API
 */
async function loadAlerts(showLoadingNotice = false) {
  const bldgId = document.getElementById("filterBuilding")?.value || "all";
  const severity = document.getElementById("filterSeverity")?.value || "all";
  const status = document.getElementById("filterStatus")?.value || "active";
  const start = document.getElementById("filterStart")?.value || "";
  const end = document.getElementById("filterEnd")?.value || "";

  const params = new URLSearchParams();
  if (bldgId !== "all") params.append("building_id", bldgId);
  if (severity !== "all") params.append("severity", severity);
  if (status !== "all") params.append("status", status);
  if (start) params.append("start", start);
  if (end) params.append("end", end);
  params.append("limit", "150");

  const url = `/api/alerts?${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from alerts API`);
    }

    const payload = await res.json();
    if (payload.status !== "success") {
      throw new Error(payload.message || "Failed to load alerts");
    }

    // 1. Update KPI Summary Counters
    updateSummaryKPIs(payload.summary || {});

    // 2. Render alerts data table
    renderAlertsTable(payload.data || []);

    // 3. Update top nav badge
    updateNavAlertBadge(payload.summary?.active_total || 0);

    // 4. Update last updated time
    const lastUpdateEl = document.getElementById("alertLastUpdated");
    if (lastUpdateEl) {
      const now = new Date();
      lastUpdateEl.textContent = `Last synchronized: ${now.toLocaleTimeString()}`;
    }

  } catch (err) {
    console.error("[Alerts] Error:", err);
    showFeedback(`Failed to update alerts: ${err.message}`, "danger");
  }
}

/**
 * Update the 4 KPI summary cards
 */
function updateSummaryKPIs(summary) {
  setText("kpiActiveCritical", summary.active_critical ?? 0);
  setText("kpiActiveWarnings", summary.active_warnings ?? 0);
  setText("kpiTotalActive", summary.active_total ?? 0);
  setText("kpiClearedTotal", summary.cleared_total ?? 0);
}

/**
 * Update top navigation badge
 */
function updateNavAlertBadge(activeCount) {
  const badge = document.getElementById("navAlertBadge");
  if (!badge) return;
  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

/**
 * Render alerts table rows
 */
function renderAlertsTable(alerts) {
  const tbody = document.getElementById("alertsTableBody");
  const countEl = document.getElementById("alertsRowCount");
  if (countEl) countEl.textContent = alerts.length;

  if (!tbody) return;

  if (alerts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 3rem 1rem;">
          <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">✅</div>
          <div style="font-size: 1rem; color: #fff; font-weight: 500;">No Alerts Matching Filter</div>
          <p style="font-size: 0.85rem; color: var(--text-dim); margin-top: 0.25rem;">
            All monitored electrical parameters are operating within standard safety limits.
          </p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = "";

  alerts.forEach(alert => {
    const tr = document.createElement("tr");
    tr.id = `alert-row-${alert.id}`;
    if (alert.is_active) {
      tr.classList.add(alert.severity === "CRITICAL" ? "row-critical-active" : "row-warning-active");
    }

    const meta = ALERT_TYPE_META[alert.alert_type] || {
      label: alert.alert_type.replace(/_/g, " "),
      icon: "⚡",
      formatObserved: (val, thresh) => `${val !== null ? val : "--"} / ${thresh !== null ? thresh : "--"}`
    };

    const observedStr = meta.formatObserved(alert.measured_value, alert.threshold_value);

    // Severity Badge
    const sevBadge = `<span class="alert-severity-badge severity-${alert.severity.toLowerCase()}">${alert.severity}</span>`;

    // Condition Status
    let statusBadge = "";
    if (alert.is_active) {
      statusBadge = `
        <span class="condition-badge condition-active" title="Condition is currently abnormal">
          <span class="pulse-dot-alert"></span> Active
        </span>
      `;
    } else {
      const clearTime = alert.cleared_at ? formatTimeShort(alert.cleared_at) : "";
      statusBadge = `
        <span class="condition-badge condition-cleared" title="Cleared at ${alert.cleared_at || ''}">
          ✓ Cleared <small style="display: block; font-size: 0.65rem; color: var(--text-dim);">${clearTime}</small>
        </span>
      `;
    }

    // Acknowledgment column
    let ackHtml = "";
    if (alert.acknowledged) {
      const ackTime = alert.acknowledged_at ? formatTimeShort(alert.acknowledged_at) : "";
      ackHtml = `
        <div class="ack-status-box" title="Acknowledged by ${alert.acknowledged_by || 'Admin'} at ${alert.acknowledged_at || ''}">
          <span class="ack-check">✓</span>
          <span class="ack-info">
            <strong>${escapeHtml(alert.acknowledged_by || 'Admin')}</strong>
            <small>${ackTime}</small>
          </span>
        </div>
      `;
    } else {
      if (currentRole === "Administrator") {
        ackHtml = `
          <button type="button" class="btn btn-ack" onclick="acknowledgeAlert(${alert.id})">
            Acknowledge
          </button>
        `;
      } else {
        ackHtml = `
          <span class="ack-pending-viewer" title="Only administrators can acknowledge alerts">
            Pending Admin Ack
          </span>
        `;
      }
    }

    tr.innerHTML = `
      <td style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-dim); white-space: nowrap;">
        ${formatTimestamp(alert.timestamp)}
      </td>
      <td>
        <span class="badge badge-code" style="margin-right: 0.35rem;">${alert.building_code}</span>
        <span style="font-size: 0.85rem; font-weight: 500;">${alert.building_name}</span>
      </td>
      <td>
        <div style="font-weight: 600; color: #fff; font-size: 0.9rem; display: flex; align-items: center; gap: 0.4rem;">
          <span>${meta.icon}</span>
          <span>${meta.label}</span>
        </div>
      </td>
      <td>${sevBadge}</td>
      <td style="font-family: var(--font-mono); font-size: 0.85rem; color: #fbbf24;">
        ${observedStr}
      </td>
      <td style="font-size: 0.82rem; color: #cbd5e1; max-width: 320px; line-height: 1.35;">
        ${escapeHtml(alert.message)}
      </td>
      <td>${statusBadge}</td>
      <td style="text-align: center;">${ackHtml}</td>
    `;

    tbody.appendChild(tr);
  });
}

/**
 * Handle Administrator Acknowledgment
 */
async function acknowledgeAlert(alertId) {
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';

  try {
    const res = await fetch(`/api/alerts/${alertId}/acknowledge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken
      },
      body: JSON.stringify({ csrf_token: csrfToken })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || `HTTP ${res.status}`);
    }

    showFeedback(data.message || "Alert acknowledged successfully.", "success");
    // Refresh alerts table immediately
    loadAlerts(false);

  } catch (err) {
    console.error("[Alerts] Acknowledge error:", err);
    showFeedback(`Failed to acknowledge alert: ${err.message}`, "danger");
  }
}

/**
 * User feedback notification
 */
function showFeedback(message, type = "success") {
  const el = document.getElementById("alertsFeedbackAlert");
  if (!el) return;
  el.textContent = message;
  el.className = `alert alert-${type}`;
  el.style.display = "flex";

  setTimeout(() => {
    el.style.display = "none";
  }, 4000);
}

/**
 * Helpers
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatTimestamp(tsStr) {
  if (!tsStr) return "--";
  const s = String(tsStr).replace("T", " ");
  return s.length > 19 ? s.substring(0, 19) : s;
}

function formatTimeShort(tsStr) {
  if (!tsStr) return "";
  const s = String(tsStr).replace("T", " ");
  return s.length > 10 ? s.substring(11, 16) : s;
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
