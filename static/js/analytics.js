/**
 * analytics.js
 * ------------
 * Phase 5: Historical Energy Analytics Client-Side Controller
 * Faculty of Engineering, University of Ruhuna
 *
 * Handles:
 * - Time window presets (1h, today, 24h, 7d)
 * - Fetching /api/energy/analytics and /api/energy/history
 * - Rendering 5 single-building KPIs and 8 operational parameter metrics
 * - Rendering 4 time-series graphs (P vs t, Energy vs t, PF vs t, V vs t)
 * - Rendering 6-building comparison mode (Bar charts & data table)
 */

// Global Chart Instances
let chartP = null;
let chartE = null;
let chartPF = null;
let chartV = null;

let chartCompE = null;
let chartCompPeak = null;
let chartCompPf = null;

// Palette for Buildings
const BUILDING_COLORS = {
  "CEE":  "#38bdf8",
  "EIE":  "#818cf8",
  "MME":  "#f59e0b",
  "MENA": "#2dd4bf",
  "ADMIN":"#fb7185",
  "AUDI": "#c084fc"
};

document.addEventListener("DOMContentLoaded", () => {
  setupPresets();
  setPreset("24h");
  triggerAnalytics();
});

/**
 * Configure quick preset buttons (1h, today, 24h, 7d)
 */
function setupPresets() {
  const presetBtns = document.querySelectorAll(".preset-btn");
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setPreset(btn.dataset.preset);
      triggerAnalytics();
    });
  });

  // Re-trigger on building change
  const bldgSelect = document.getElementById("filterBuilding");
  if (bldgSelect) {
    bldgSelect.addEventListener("change", () => {
      triggerAnalytics();
    });
  }
}

/**
 * Calculate and set datetime-local input values for a preset
 */
function setPreset(preset) {
  const now = new Date();
  let start = new Date();

  if (preset === "1h") {
    start = new Date(now.getTime() - (60 * 60 * 1000));
  } else if (preset === "today") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (preset === "24h") {
    start = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  } else if (preset === "7d") {
    start = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  }

  const formatForInput = (d) => {
    const pad = (n) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };

  const startInput = document.getElementById("filterStart");
  const endInput = document.getElementById("filterEnd");

  if (startInput) startInput.value = formatForInput(start);
  if (endInput) endInput.value = formatForInput(now);
}

/**
 * Trigger Analytics request based on current filter values
 */
async function triggerAnalytics() {
  const bldgId = document.getElementById("filterBuilding").value;
  const start = document.getElementById("filterStart").value;
  const end = document.getElementById("filterEnd").value;
  const alertEl = document.getElementById("analyticsAlert");
  const singleView = document.getElementById("singleBuildingView");
  const compView = document.getElementById("comparisonView");

  if (alertEl) alertEl.style.display = "none";

  try {
    if (bldgId === "all") {
      // Comparison Mode across all registered campus facilities
      singleView.style.display = "none";
      compView.style.display = "block";
      await loadComparisonAnalytics(start, end);
    } else {
      // Single Facility Mode
      compView.style.display = "none";
      singleView.style.display = "block";
      await loadSingleBuildingAnalytics(bldgId, start, end);
    }
  } catch (err) {
    console.error("[Analytics] Error:", err);
    if (alertEl) {
      alertEl.textContent = `Analytics Error: ${err.message}`;
      alertEl.style.display = "flex";
    }
  }
}

/**
 * Load analytics for all registered campus facilities (Comparison Mode)
 */
async function loadComparisonAnalytics(start, end) {
  const url = `/api/energy/analytics?building_id=all&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from analytics endpoint`);

  const json = await res.json();
  if (json.status !== "success") throw new Error(json.message || "Failed to load analytics");

  const campus = json.campus_summary || {};
  const comp = json.comparison || [];

  // Update Campus Summary KPIs
  setText("compTotalEnergy", (campus.total_energy_kwh || 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  setText("compPeakPower", (campus.peak_active_power_kw || 0).toFixed(1));
  setText("compAvgPower", (campus.avg_active_power_kw || 0).toFixed(1));
  setText("compAvgPf", (campus.avg_power_factor || 0).toFixed(3));
  setText("compLoadFactor", (campus.load_factor || 0).toFixed(2));
  setText("compLoadFactorPct", `(${((campus.load_factor || 0) * 100).toFixed(1)}%)`);

  // Render 3 Comparison Charts
  renderComparisonCharts(comp);

  // Render Table
  renderComparisonTable(comp);
}

/**
 * Render comparison bar charts
 */
function renderComparisonCharts(comp) {
  const labels = comp.map(c => c.building_code);
  const colors = comp.map(c => BUILDING_COLORS[c.building_code] || "#38bdf8");

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        titleColor: "#f8fafc",
        borderColor: "rgba(255, 255, 255, 0.1)",
        borderWidth: 1
      }
    },
    scales: {
      x: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "#94a3b8" } },
      y: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "#94a3b8" }, beginAtZero: true }
    }
  };

  // 1. Energy by Building
  if (chartCompE) chartCompE.destroy();
  const ctxE = document.getElementById("chartCompEnergy");
  if (ctxE) {
    chartCompE = new Chart(ctxE, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: comp.map(c => c.total_energy_kwh),
          backgroundColor: colors,
          borderRadius: 6
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: { ...commonOptions.scales.y, title: { display: true, text: "Energy (kWh)", color: "#94a3b8" } }
        }
      }
    });
  }

  // 2. Peak Demand by Building
  if (chartCompPeak) chartCompPeak.destroy();
  const ctxPeak = document.getElementById("chartCompPeak");
  if (ctxPeak) {
    chartCompPeak = new Chart(ctxPeak, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: comp.map(c => c.peak_active_power_kw),
          backgroundColor: colors,
          borderRadius: 6
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: { ...commonOptions.scales.y, title: { display: true, text: "Peak Demand (kW)", color: "#94a3b8" } }
        }
      }
    });
  }

  // 3. Average PF by Building
  if (chartCompPf) chartCompPf.destroy();
  const ctxPf = document.getElementById("chartCompPf");
  if (ctxPf) {
    chartCompPf = new Chart(ctxPf, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [{
          data: comp.map(c => c.avg_power_factor),
          backgroundColor: colors,
          borderRadius: 6
        }]
      },
      options: {
        ...commonOptions,
        scales: {
          ...commonOptions.scales,
          y: {
            ...commonOptions.scales.y,
            min: 0.70,
            max: 1.0,
            title: { display: true, text: "Average Power Factor", color: "#94a3b8" }
          }
        }
      }
    });
  }
}

/**
 * Render comparison data table
 */
function renderComparisonTable(comp) {
  const tbody = document.getElementById("comparisonTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  comp.forEach(c => {
    const tr = document.createElement("tr");
    const { label, cls } = getPfStatus(c.avg_power_factor);

    tr.innerHTML = `
      <td><span class="badge badge-code">${c.building_code}</span></td>
      <td style="font-weight: 500;">${c.building_name}</td>
      <td style="font-family: var(--font-mono); font-weight: 600; color: #fbbf24;">${(c.total_energy_kwh || 0).toFixed(2)} kWh</td>
      <td style="font-family: var(--font-mono);">${(c.peak_active_power_kw || 0).toFixed(1)} kW</td>
      <td style="font-family: var(--font-mono);">${(c.avg_active_power_kw || 0).toFixed(1)} kW</td>
      <td><span class="pf-badge ${cls}">${c.avg_power_factor.toFixed(3)} (${label})</span></td>
      <td style="font-family: var(--font-mono);">${(c.load_factor || 0).toFixed(2)} <span style="color: var(--text-dim);">(${c.load_factor_pct || 0}%)</span></td>
      <td style="color: var(--text-dim);">${c.readings_count}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * Load analytics and time-series for a single selected building
 */
async function loadSingleBuildingAnalytics(buildingId, start, end) {
  // 1. Fetch Analytics Calculation
  const analyticsUrl = `/api/energy/analytics?building_id=${buildingId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const aRes = await fetch(analyticsUrl);
  if (!aRes.ok) throw new Error(`HTTP ${aRes.status} from analytics endpoint`);
  const aJson = await aRes.json();
  const a = aJson.analytics || {};

  // 2. Fetch Time Series History Data for Charts
  const historyUrl = `/api/energy/history?building_id=${buildingId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=1500`;
  const hRes = await fetch(historyUrl);
  if (!hRes.ok) throw new Error(`HTTP ${hRes.status} from history endpoint`);
  const hJson = await hRes.json();
  const history = hJson.data || [];

  // Populate Key KPIs
  setText("kpiEnergyKwh", (a.total_energy_kwh || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  setText("kpiPeakDemandKw", (a.peak_active_power_kw || 0).toFixed(1));
  setText("kpiAvgDemandKw", (a.avg_active_power_kw || 0).toFixed(1));
  setText("kpiAvgPfSingle", (a.avg_power_factor || 0).toFixed(3));
  setText("kpiMinPfSingle", (a.min_power_factor || 0).toFixed(3));
  setText("kpiLoadFactorSingle", (a.load_factor || 0).toFixed(2));
  setText("kpiLoadFactorPctSingle", `(${a.load_factor_pct || 0}%)`);

  // PF Badge
  const pfBadge = document.getElementById("kpiSinglePfBadge");
  if (pfBadge) {
    const { label, cls } = getPfStatus(a.avg_power_factor);
    pfBadge.className = `pf-badge ${cls}`;
    pfBadge.textContent = label;
  }

  // Populate Secondary Parameters
  setText("paramMinP", (a.min_active_power_kw || 0).toFixed(1));
  setText("paramAvgS", (a.avg_apparent_power_kva || 0).toFixed(1));
  setText("paramAvgQ", (a.avg_reactive_power_kvar || 0).toFixed(1));
  setText("paramAvgV", (a.avg_voltage || 0).toFixed(1));
  setText("paramMinV", (a.min_voltage || 0).toFixed(1));
  setText("paramMaxV", (a.max_voltage || 0).toFixed(1));
  setText("paramAvgI", (a.avg_current || 0).toFixed(1));
  setText("paramAvgF", (a.avg_frequency || 0).toFixed(2));
  setText("paramCount", a.readings_count || 0);

  // Render 4 Time Series Charts
  renderSingleBuildingCharts(aJson.building_code || "GEN", history);
}

/**
 * Render 4 time-series graphs for single facility
 */
function renderSingleBuildingCharts(code, history) {
  const color = BUILDING_COLORS[code] || "#38bdf8";

  // Prepare timestamps labels (format HH:MM or MM-DD HH:MM)
  const labels = history.map(r => {
    const ts = r.timestamp || "";
    return ts.length > 10 ? ts.substring(5, 16) : ts;
  });

  const commonLineOptions = (yTitle) => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        titleColor: "#f8fafc",
        borderColor: "rgba(255, 255, 255, 0.1)",
        borderWidth: 1
      }
    },
    scales: {
      x: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "#94a3b8", maxTicksLimit: 12 } },
      y: { grid: { color: "rgba(255, 255, 255, 0.05)" }, ticks: { color: "#94a3b8" }, title: { display: true, text: yTitle, color: "#94a3b8" } }
    }
  });

  // 1. Active Power vs Time
  if (chartP) chartP.destroy();
  const ctxP = document.getElementById("chartActivePowerTime");
  if (ctxP) {
    chartP = new Chart(ctxP, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Active Power (kW)",
          data: history.map(r => r.active_power_kw),
          borderColor: color,
          backgroundColor: `${color}18`,
          borderWidth: 2,
          pointRadius: history.length > 50 ? 0 : 2,
          tension: 0.3
        }]
      },
      options: commonLineOptions("kW")
    });
  }

  // 2. Accumulated Energy vs Time
  if (chartE) chartE.destroy();
  const ctxE = document.getElementById("chartEnergyTime");
  if (ctxE) {
    chartE = new Chart(ctxE, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Accumulated Energy (kWh)",
          data: history.map(r => r.energy_kwh),
          borderColor: "#fbbf24",
          backgroundColor: "rgba(245, 158, 11, 0.1)",
          borderWidth: 2,
          pointRadius: history.length > 50 ? 0 : 2,
          tension: 0.2
        }]
      },
      options: commonLineOptions("kWh")
    });
  }

  // 3. Power Factor vs Time
  if (chartPF) chartPF.destroy();
  const ctxPF = document.getElementById("chartPfTime");
  if (ctxPF) {
    chartPF = new Chart(ctxPF, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Power Factor",
          data: history.map(r => r.power_factor),
          borderColor: "#34d399",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderWidth: 2,
          pointRadius: history.length > 50 ? 0 : 2,
          tension: 0.3
        }]
      },
      options: {
        ...commonLineOptions("PF"),
        scales: {
          ...commonLineOptions("PF").scales,
          y: { ...commonLineOptions("PF").scales.y, min: 0.70, max: 1.0 }
        }
      }
    });
  }

  // 4. Voltage vs Time
  if (chartV) chartV.destroy();
  const ctxV = document.getElementById("chartVoltageTime");
  if (ctxV) {
    chartV = new Chart(ctxV, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Line Voltage (V)",
          data: history.map(r => r.voltage),
          borderColor: "#60a5fa",
          backgroundColor: "rgba(96, 165, 250, 0.1)",
          borderWidth: 2,
          pointRadius: history.length > 50 ? 0 : 2,
          tension: 0.3
        }]
      },
      options: {
        ...commonLineOptions("Volts"),
        scales: {
          ...commonLineOptions("Volts").scales,
          y: { ...commonLineOptions("Volts").scales.y, min: 380, max: 420 }
        }
      }
    });
  }
}

/**
 * Determine status label and CSS class based on Power Factor
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
 * Helper to safely set element textContent
 */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
