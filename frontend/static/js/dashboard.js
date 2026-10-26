/**
 * dashboard.js
 * ------------
 * Phase 4: Live Energy Monitoring Dashboard Client-Side Logic
 * Faculty of Engineering, University of Ruhuna
 *
 * - Fetches /api/energy/live every 5 seconds
 * - Updates Campus Overview KPIs
 * - Dynamically renders & updates Building Telemetry Cards for ALL buildings returned by API
 * - Maintains real-time Line Chart (latest 30 samples) and Bar Chart using Chart.js
 * - Handles API connectivity and error states gracefully
 * - No synthetic/random values generated in frontend
 */

// Global state
let activePowerLineChart = null;
let activePowerBarChart = null;
const MAX_CHART_SAMPLES = 30; // Latest 30 frontend samples
let pollIntervalId = null;
let lastSeenTimestamp = null;

// Palette for Faculty Buildings (Known base mappings + dynamic generation for any new building)
const KNOWN_BUILDING_COLORS = {
  "CEE":   { stroke: "#38bdf8", fill: "rgba(56, 189, 248, 0.1)" },  // Cyan
  "EIE":   { stroke: "#818cf8", fill: "rgba(129, 140, 248, 0.1)" }, // Indigo
  "MME":   { stroke: "#f59e0b", fill: "rgba(245, 158, 11, 0.1)" },  // Amber/Gold
  "MENA":  { stroke: "#2dd4bf", fill: "rgba(45, 212, 191, 0.1)" },  // Teal
  "ADMIN": { stroke: "#fb7185", fill: "rgba(251, 113, 133, 0.1)" }, // Rose
  "AUDI":  { stroke: "#c084fc", fill: "rgba(192, 132, 252, 0.1)" }, // Purple
  "LIB":   { stroke: "#34d399", fill: "rgba(52, 211, 153, 0.1)" },  // Emerald
  "ARCH":  { stroke: "#f472b6", fill: "rgba(244, 114, 182, 0.1)" }, // Pink
  "LAB":   { stroke: "#06b6d4", fill: "rgba(6, 182, 212, 0.1)" }    // Sky
};

const DYNAMIC_PALETTE = [
  "#38bdf8", "#818cf8", "#f59e0b", "#2dd4bf", "#fb7185", "#c084fc",
  "#34d399", "#f472b6", "#a78bfa", "#fbbf24", "#4ade80", "#06b6d4"
];

function getBuildingColor(code, index = 0) {
  if (KNOWN_BUILDING_COLORS[code]) {
    return KNOWN_BUILDING_COLORS[code];
  }
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = code.charCodeAt(i) + ((hash << 5) - hash);
  }
  const stroke = DYNAMIC_PALETTE[Math.abs(hash + index) % DYNAMIC_PALETTE.length];
  return {
    stroke: stroke,
    fill: stroke.replace("#", "rgba(").concat(", 0.1)") // fallback
  };
}

function getExistingBuildingCodes() {
  const cards = document.querySelectorAll("#telemetryGrid .bldg-card");
  if (cards && cards.length > 0) {
    return Array.from(cards)
      .map(c => c.getAttribute("data-building-code") || c.id.replace("card_", ""))
      .filter(Boolean);
  }
  return ["CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"];
}

document.addEventListener("DOMContentLoaded", () => {
  initCharts();
  fetchLiveEnergy();
  // Poll every 5 seconds
  pollIntervalId = setInterval(fetchLiveEnergy, 5000);
});

/**
 * Initialize Chart.js Line and Bar charts with dark-theme styling
 */
function initCharts() {
  const lineCtx = document.getElementById("activePowerLineChart");
  const barCtx = document.getElementById("activePowerBarChart");

  const commonGrid = {
    color: "rgba(255, 255, 255, 0.05)",
    borderColor: "rgba(255, 255, 255, 0.1)"
  };

  const commonTicks = {
    color: "#94a3b8",
    font: { family: "'Outfit', sans-serif", size: 11 }
  };

  const initialCodes = getExistingBuildingCodes();

  // 1. Line Chart: Active Power over Time (30 samples)
  if (lineCtx) {
    const initialLineDatasets = initialCodes.map((code, idx) => {
      const color = getBuildingColor(code, idx);
      return {
        label: code,
        data: [],
        borderColor: color.stroke,
        backgroundColor: color.fill,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 1
      };
    });

    activePowerLineChart = new Chart(lineCtx, {
      type: "line",
      data: {
        labels: [],
        datasets: initialLineDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { color: "#e2e8f0", boxWidth: 12, padding: 12, font: { family: "'Outfit', sans-serif", size: 12 } }
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#f8fafc",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)} kW`
            }
          }
        },
        scales: {
          x: { grid: commonGrid, ticks: commonTicks },
          y: {
            grid: commonGrid,
            ticks: {
              ...commonTicks,
              callback: (val) => `${val} kW`
            },
            title: { display: true, text: "Active Power (kW)", color: "#94a3b8", font: { size: 11 } }
          }
        }
      }
    });
  }

  // 2. Bar Chart: Current Active Power Comparison across all buildings
  if (barCtx) {
    activePowerBarChart = new Chart(barCtx, {
      type: "bar",
      data: {
        labels: initialCodes,
        datasets: [{
          label: "Active Power (kW)",
          data: new Array(initialCodes.length).fill(0),
          backgroundColor: initialCodes.map((c, i) => getBuildingColor(c, i).stroke),
          borderRadius: 6,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.95)",
            titleColor: "#f8fafc",
            bodyColor: "#cbd5e1",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${Number(ctx.raw).toFixed(2)} kW`
            }
          }
        },
        scales: {
          x: { grid: commonGrid, ticks: commonTicks },
          y: {
            grid: commonGrid,
            ticks: {
              ...commonTicks,
              callback: (val) => `${val} kW`
            },
            beginAtZero: true
          }
        }
      }
    });
  }
}

/**
 * Ensures that a building card exists in the DOM.
 * If not present (e.g. newly created building 'LIB'), it dynamically creates and appends it.
 */
function ensureBuildingCard(code, r) {
  let card = document.getElementById(`card_${code}`);
  if (!card) {
    const grid = document.getElementById("telemetryGrid");
    if (!grid) return null;

    card = document.createElement("div");
    card.className = "bldg-card";
    card.id = `card_${code}`;
    card.setAttribute("data-building-code", code);
    card.setAttribute("data-building-id", r.building_id || "");

    const bldgName = r.building_name || code;
    const bldgDesc = r.description || `Campus Building Complex &bull; Rated: ${r.rated_power_kw || 50} kW`;

    card.innerHTML = `
      <div class="bldg-card-header">
        <div class="bldg-title-wrap">
          <span class="bldg-code-badge">${escapeHtml(code)}</span>
          <div>
            <div class="bldg-name">${escapeHtml(bldgName)}</div>
            <div style="font-size: 0.72rem; color: var(--text-dim);">${escapeHtml(bldgDesc)}</div>
          </div>
        </div>
        <span id="bldg_${code}_pf_badge" class="pf-badge pf-good">Good</span>
      </div>

      <div class="metrics-grid">
        <div class="metric-item">
          <span class="metric-label">Voltage (V_L)</span>
          <span class="metric-val"><span id="bldg_${code}_v">---</span><small>V</small></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Current (I_L)</span>
          <span class="metric-val"><span id="bldg_${code}_i">---</span><small>A</small></span>
        </div>
        <div class="metric-item metric-highlight">
          <span class="metric-label">Active Power (P)</span>
          <span class="metric-val"><span id="bldg_${code}_p">---</span><small>kW</small></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Apparent (S)</span>
          <span class="metric-val"><span id="bldg_${code}_s">---</span><small>kVA</small></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Reactive (Q)</span>
          <span class="metric-val"><span id="bldg_${code}_q">---</span><small>kVAr</small></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Power Factor</span>
          <span class="metric-val"><span id="bldg_${code}_pf">---</span></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Frequency</span>
          <span class="metric-val"><span id="bldg_${code}_freq">---</span><small>Hz</small></span>
        </div>
        <div class="metric-item">
          <span class="metric-label">Energy</span>
          <span class="metric-val"><span id="bldg_${code}_kwh">---</span><small>kWh</small></span>
        </div>
      </div>

      <div class="bldg-card-footer">
        <div class="footer-time">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span id="bldg_${code}_time">Connecting...</span>
        </div>
        <span class="badge-simulated">SIMULATED</span>
      </div>
    `;

    grid.appendChild(card);
  } else {
    // If card already exists in the DOM, ensure its building ID and name are current
    if (r.building_id) {
      card.setAttribute("data-building-id", r.building_id);
    }
    const nameEl = card.querySelector(".bldg-name");
    if (nameEl && r.building_name) {
      nameEl.textContent = r.building_name;
    }
  }
  return card;
}

/**
 * Fetch live readings from Flask backend /api/energy/live
 */
async function fetchLiveEnergy() {
  try {
    const response = await fetch("/api/energy/live", {
      headers: { "Accept": "application/json" },
      credentials: "same-origin"
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Session expired
        window.location.href = "/login";
        return;
      }
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const payload = await response.json();

    if (payload.status === "success" && Array.isArray(payload.data)) {
      updateConnectionStatus(true, null);
      updateDashboard(payload.data);
    } else {
      throw new Error(payload.message || "Invalid payload format");
    }

  } catch (err) {
    console.warn("[Dashboard] Live fetch error:", err.message);
    updateConnectionStatus(false, err.message);
  }
}

/**
 * Update connection indicators
 */
function updateConnectionStatus(isOnline, errorMsg) {
  const connPill = document.getElementById("connectionStatusPill");
  const connText = document.getElementById("connectionStatusText");
  const lastUpdateText = document.getElementById("lastUpdateTimestamp");
  const errorAlert = document.getElementById("dashboardErrorAlert");
  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  if (isOnline) {
    if (connPill) {
      connPill.className = "conn-status-pill conn-online";
      connPill.innerHTML = `<span class="pulse-dot"></span><span>API Online</span>`;
    }
    if (lastUpdateText) {
      lastUpdateText.textContent = `Last update: ${timeStr}`;
    }
    if (errorAlert) {
      errorAlert.style.display = "none";
    }
  } else {
    if (connPill) {
      connPill.className = "conn-status-pill conn-offline";
      connPill.innerHTML = `<span class="pulse-dot-red"></span><span>API Offline</span>`;
    }
    if (errorAlert) {
      errorAlert.textContent = `Telemetry connection warning: ${errorMsg || "Unable to reach /api/energy/live"}. Retrying in 5 seconds...`;
      errorAlert.style.display = "flex";
    }
  }
}

/**
 * Update all DOM elements and charts with verified backend data
 */
function updateDashboard(readings) {
  if (!readings || readings.length === 0) return;

  let totalActiveKw = 0;
  let totalApparentKva = 0;
  let totalEnergyKwh = 0;
  let pfSum = 0;
  let onlineCount = 0;

  const buildingPowerMap = {};
  const allBuildingCodes = [];

  readings.forEach((r) => {
    const code = r.building_code || "GEN";
    allBuildingCodes.push(code);

    const pKw = parseFloat(r.active_power_kw) || 0;
    const sKva = parseFloat(r.apparent_power_kva) || 0;
    const qKvar = parseFloat(r.reactive_power_kvar) || 0;
    const pf = parseFloat(r.power_factor) || 0;
    const v = parseFloat(r.voltage) || 0;
    const i = parseFloat(r.current) || 0;
    const freq = parseFloat(r.frequency) || 0;
    const energy = parseFloat(r.energy_kwh) || 0;
    const timestamp = r.timestamp || "No reading yet";

    buildingPowerMap[code] = pKw;

    if (r.reading_id) {
      onlineCount++;
      totalActiveKw += pKw;
      totalApparentKva += sKva;
      totalEnergyKwh += energy;
      pfSum += pf;
    }

    // Ensure DOM card exists for every building returned in API
    ensureBuildingCard(code, r);

    // Pass active alert details to building card
    updateBuildingCard(code, {
      building_id: r.building_id,
      voltage: v,
      current: i,
      active_kw: pKw,
      apparent_kva: sKva,
      reactive_kvar: qKvar,
      pf: pf,
      frequency: freq,
      energy_kwh: energy,
      timestamp: timestamp,
      hasReading: Boolean(r.reading_id),
      active_alerts_count: r.active_alerts_count || 0,
      active_severity: r.active_severity,
      active_alerts: r.active_alerts || []
    });
  });

  // Prune cards for buildings that have been deleted from SQLite
  const existingCards = document.querySelectorAll("#telemetryGrid .bldg-card");
  existingCards.forEach((c) => {
    const cardCode = c.getAttribute("data-building-code") || c.id.replace("card_", "");
    if (cardCode && !allBuildingCodes.includes(cardCode)) {
      c.remove();
    }
  });

  // Calculate Campus Averages
  const avgPf = onlineCount > 0 ? (pfSum / onlineCount) : 0;

  // 1. Update Campus KPI Summary Cards
  setText("kpiTotalActivePower", `${totalActiveKw.toFixed(1)}`);
  setText("kpiTotalApparentPower", `${totalApparentKva.toFixed(1)}`);
  setText("kpiTotalEnergy", `${totalEnergyKwh.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`);
  setText("kpiAvgPf", `${avgPf.toFixed(3)}`);
  setText("kpiOnlineCount", `${onlineCount} / ${readings.length}`);

  // Update Campus Alert Counters from live data
  let activeCritCount = 0;
  let activeWarnCount = 0;
  readings.forEach(r => {
    if (r.active_alerts) {
      r.active_alerts.forEach(a => {
        if (a.severity === "CRITICAL") activeCritCount++;
        else if (a.severity === "WARNING") activeWarnCount++;
      });
    }
  });

  setText("counterActiveCritical", activeCritCount);
  setText("counterActiveWarnings", activeWarnCount);

  // Update top nav alert counter badge
  const navBadge = document.getElementById("navAlertBadge");
  const totalActiveAlerts = activeCritCount + activeWarnCount;
  if (navBadge) {
    if (totalActiveAlerts > 0) {
      navBadge.textContent = totalActiveAlerts;
      navBadge.style.display = "inline-flex";
    } else {
      navBadge.style.display = "none";
    }
  }

  // Update Campus PF Badge
  const avgPfBadge = document.getElementById("kpiAvgPfBadge");
  if (avgPfBadge) {
    const { label, cls } = getPfStatus(avgPf);
    avgPfBadge.className = `pf-badge ${cls}`;
    avgPfBadge.textContent = label;
  }

  // 2. Update Charts with the latest sample for all returned buildings
  const sampleTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  updateCharts(sampleTime, buildingPowerMap, allBuildingCodes);
}

/**
 * Update an individual building card's DOM metrics and active alert highlight
 */
function updateBuildingCard(code, d) {
  const prefix = `bldg_${code}_`;

  // Highlight building card if it has active abnormal conditions (Phase 6 Requirement 12)
  const card = document.getElementById(`card_${code}`);
  if (card) {
    card.classList.remove("has-alert-critical", "has-alert-warning");
    if (d.active_severity === "CRITICAL") {
      card.classList.add("has-alert-critical");
    } else if (d.active_severity === "WARNING") {
      card.classList.add("has-alert-warning");
    }

    // Active abnormal condition notice banner inside card
    let alertBanner = card.querySelector(".bldg-alert-banner");
    if (d.active_alerts_count > 0 && d.active_alerts && d.active_alerts.length > 0) {
      if (!alertBanner) {
        alertBanner = document.createElement("div");
        alertBanner.className = "bldg-alert-banner";
        const header = card.querySelector(".bldg-card-header");
        if (header) header.insertAdjacentElement("afterend", alertBanner);
      }
      const icon = d.active_severity === "CRITICAL" ? "🚨" : "⚠️";
      const sevClass = d.active_severity === "CRITICAL" ? "banner-critical" : "banner-warning";
      alertBanner.className = `bldg-alert-banner ${sevClass}`;
      const firstAlert = d.active_alerts[0];
      alertBanner.innerHTML = `
        <span class="pulse-dot-alert"></span>
        <span style="font-weight: 600;">${icon} ${d.active_severity}:</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">
          ${escapeHtml(firstAlert.alert_type.replace(/_/g, " "))}
        </span>
        <a href="/alerts?building_id=${d.building_id}" class="bldg-alert-link">Details &rarr;</a>
      `;
      alertBanner.style.display = "flex";
    } else if (alertBanner) {
      alertBanner.style.display = "none";
    }
  }

  if (!d.hasReading) {
    setText(`${prefix}v`, "---");
    setText(`${prefix}i`, "---");
    setText(`${prefix}p`, "---");
    setText(`${prefix}s`, "---");
    setText(`${prefix}q`, "---");
    setText(`${prefix}pf`, "---");
    setText(`${prefix}freq`, "---");
    setText(`${prefix}kwh`, "---");
    setText(`${prefix}time`, "Awaiting simulator data...");
    const pfBadge = document.getElementById(`${prefix}pf_badge`);
    if (pfBadge) {
      pfBadge.className = "pf-badge pf-good";
      pfBadge.textContent = "Standby";
    }
    return;
  }

  setText(`${prefix}v`, `${d.voltage.toFixed(1)}`);
  setText(`${prefix}i`, `${d.current.toFixed(1)}`);
  setText(`${prefix}p`, `${d.active_kw.toFixed(1)}`);
  setText(`${prefix}s`, `${d.apparent_kva.toFixed(1)}`);
  setText(`${prefix}q`, `${d.reactive_kvar.toFixed(1)}`);
  setText(`${prefix}pf`, `${d.pf.toFixed(3)}`);
  setText(`${prefix}freq`, `${d.frequency.toFixed(2)}`);
  setText(`${prefix}kwh`, `${d.energy_kwh.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  setText(`${prefix}time`, d.timestamp);

  // Power Factor Badge: Good (>= 0.90), Warning (0.85 - 0.899), Poor (< 0.85)
  const pfBadge = document.getElementById(`${prefix}pf_badge`);
  if (pfBadge) {
    const { label, cls } = getPfStatus(d.pf);
    pfBadge.className = `pf-badge ${cls}`;
    pfBadge.textContent = `${label} (${d.pf.toFixed(2)})`;
  }
}

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Determine status label and CSS class based on Power Factor:
 * - PF >= 0.90 -> Good
 * - PF 0.85 to 0.899 -> Warning
 * - PF < 0.85 -> Poor
 */
function getPfStatus(pf) {
  if (pf >= 0.90) {
    return { label: "Good", cls: "pf-good" };
  } else if (pf >= 0.85) {
    return { label: "Warning", cls: "pf-warning" };
  } else {
    return { label: "Poor", cls: "pf-poor" };
  }
}

/**
 * Update Chart.js instances dynamically for all buildings in current reading
 */
function updateCharts(timeLabel, buildingPowerMap, allCodes) {
  const codes = (allCodes && allCodes.length > 0) ? allCodes : Object.keys(buildingPowerMap);
  if (codes.length === 0) return;

  // 1. Line Chart Update
  if (activePowerLineChart) {
    // Prune datasets of buildings that no longer exist
    activePowerLineChart.data.datasets = activePowerLineChart.data.datasets.filter(
      ds => codes.includes(ds.label)
    );

    const labels = activePowerLineChart.data.labels;
    labels.push(timeLabel);

    // Dynamically add new building dataset if it was not in chart yet
    codes.forEach(code => {
      let ds = activePowerLineChart.data.datasets.find(d => d.label === code);
      if (!ds) {
        const color = getBuildingColor(code, activePowerLineChart.data.datasets.length);
        const pastPointsCount = Math.max(0, labels.length - 1);
        ds = {
          label: code,
          data: new Array(pastPointsCount).fill(null),
          borderColor: color.stroke,
          backgroundColor: color.fill,
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 1
        };
        activePowerLineChart.data.datasets.push(ds);
      }
    });

    // Push new values to all datasets
    activePowerLineChart.data.datasets.forEach(ds => {
      const val = buildingPowerMap[ds.label] !== undefined ? buildingPowerMap[ds.label] : 0;
      ds.data.push(val);
    });

    // Enforce 30 samples window
    if (labels.length > MAX_CHART_SAMPLES) {
      labels.shift();
      activePowerLineChart.data.datasets.forEach(ds => ds.data.shift());
    }

    activePowerLineChart.update("none"); // Smooth update without jarring re-render
  }

  // 2. Bar Chart Update: dynamically sync labels and values
  if (activePowerBarChart) {
    activePowerBarChart.data.labels = codes;
    activePowerBarChart.data.datasets[0].data = codes.map(code => buildingPowerMap[code] || 0);
    activePowerBarChart.data.datasets[0].backgroundColor = codes.map((code, idx) => getBuildingColor(code, idx).stroke);
    activePowerBarChart.update();
  }
}

/**
 * Helper to safely set element textContent
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
