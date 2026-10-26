/**
 * cost_efficiency.js
 * ------------------
 * Client-Side Controller for Phase 7: Energy Cost and Efficiency Analysis
 * Faculty of Engineering, University of Ruhuna
 *
 * Handles:
 * - Filter controls: Building selection, start/end dates, preset windows (1h, today, 24h, 7d)
 * - Fetching authenticated endpoints: /api/energy/cost, /api/energy/efficiency, and /api/energy/efficiency/comparison
 * - Rendering 6 Primary KPI cards (Energy Used, Estimated Cost, Peak Demand, Load Factor, Average PF, After-Hours Energy)
 * - Rendering the 3-part demonstration tariff cost breakdown strip
 * - Rendering 4 Chart.js bar graphs (Energy by Building, Cost by Building, Peak Demand, After-Hours Energy)
 * - Rendering departmental efficiency rankings and evidence-based engineering observations
 */

// Global Chart instances
let chartCEnergy = null;
let chartCCost = null;
let chartCPeak = null;
let chartCAfter = null;

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
  setupCostPresets();
  setCostPreset("24h");
  triggerCostEfficiency();
});

/**
 * Configure preset period buttons (1h, today, 24h, 7d)
 */
function setupCostPresets() {
  const presetBtns = document.querySelectorAll("#costPresets .preset-btn");
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setCostPreset(btn.dataset.preset);
      triggerCostEfficiency();
    });
  });

  const bldgSelect = document.getElementById("filterBuilding");
  if (bldgSelect) {
    bldgSelect.addEventListener("change", () => {
      triggerCostEfficiency();
    });
  }
}

/**
 * Set datetime-local input values for quick presets
 */
function setCostPreset(preset) {
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
 * Format numbers with comma grouping and fixed decimals
 */
function formatNum(val, dec = 2) {
  if (val === null || val === undefined || isNaN(val)) return "0.00";
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

/**
 * Main Evaluation Dispatcher
 */
async function triggerCostEfficiency() {
  const bldgVal = document.getElementById("filterBuilding") ? document.getElementById("filterBuilding").value : "all";
  const startVal = document.getElementById("filterStart") ? document.getElementById("filterStart").value : "";
  const endVal = document.getElementById("filterEnd") ? document.getElementById("filterEnd").value : "";

  const alertBox = document.getElementById("costAlert");
  if (alertBox) alertBox.style.display = "none";

  const btn = document.getElementById("btnAnalyzeCost");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Evaluating...`;
  }

  try {
    // 1. Always fetch comparison analytics to render graphs and the 6-building ranking table
    const compUrl = `/api/energy/efficiency/comparison?start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;
    const compRes = await fetch(compUrl, { credentials: "include" });
    if (!compRes.ok) {
      if (compRes.status === 401) {
        window.location.href = "/login";
        return;
      }
      throw new Error(`Comparison API error: ${compRes.statusText}`);
    }
    const compData = await compRes.json();

    // 2. If a specific building is selected, fetch single building efficiency & cost
    let singleEffData = null;
    let singleCostData = null;

    if (bldgVal !== "all") {
      const effUrl = `/api/energy/efficiency?building_id=${encodeURIComponent(bldgVal)}&start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;
      const costUrl = `/api/energy/cost?building_id=${encodeURIComponent(bldgVal)}&start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;

      const [effRes, costRes] = await Promise.all([
        fetch(effUrl, { credentials: "include" }),
        fetch(costUrl, { credentials: "include" })
      ]);

      if (effRes.ok) singleEffData = await effRes.json();
      if (costRes.ok) singleCostData = await costRes.json();
    }

    // 3. Render Views
    renderKpiCards(bldgVal, compData, singleEffData, singleCostData);
    renderCostBreakdown(bldgVal, compData, singleCostData);
    renderObservations(bldgVal, compData, singleEffData);
    renderComparisonCharts(compData);
    renderEfficiencyTable(compData);

  } catch (err) {
    console.error("Cost & Efficiency analysis error:", err);
    if (alertBox) {
      alertBox.textContent = `Error evaluating energy cost & efficiency: ${err.message}`;
      alertBox.style.display = "block";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
          <polyline points="17 6 23 6 23 12"></polyline>
        </svg>
        Evaluate
      `;
    }
  }
}

/**
 * Render the 6 Primary KPI Cards
 */
function renderKpiCards(bldgVal, compData, singleEff, singleCost) {
  const isSingle = (bldgVal !== "all" && singleEff && singleCost);
  const cs = compData.campus_summary || {};

  // Energy Consumed
  const energyKwh = isSingle ? singleEff.total_energy_kwh : (cs.total_kwh || 0.0);
  document.getElementById("kpiEnergyConsumed").textContent = formatNum(energyKwh, 2);
  document.getElementById("kpiEnergySubtext").textContent = isSingle
    ? `Calculated for [${singleEff.building_code}]`
    : `Campus total across all registered campus facilities`;

  // Estimated Cost
  const costLkr = isSingle ? singleCost.estimated_total_cost_lkr : (cs.estimated_cost_lkr || 0.0);
  document.getElementById("kpiEstimatedCost").textContent = formatNum(costLkr, 2);

  // Peak Demand
  const peakKw = isSingle ? singleEff.peak_demand_kw : (cs.peak_demand_kw || 0.0);
  document.getElementById("kpiPeakDemand").textContent = formatNum(peakKw, 1);
  const demCharge = isSingle ? singleCost.estimated_demand_charge_lkr : (cs.estimated_demand_charge_lkr || 0.0);
  document.getElementById("kpiDemandChargeSub").textContent = `Demand charge: LKR ${formatNum(demCharge, 0)}`;

  // Load Factor
  const lf = isSingle ? singleEff.load_factor : (cs.load_factor || 0.0);
  const lfPct = isSingle ? singleEff.load_factor_pct : (cs.load_factor_pct || 0.0);
  document.getElementById("kpiLoadFactor").textContent = formatNum(lf, 2);
  document.getElementById("kpiLoadFactorPct").textContent = `(${formatNum(lfPct, 1)}%)`;

  // Average Power Factor
  const avgPf = isSingle ? singleEff.average_power_factor : (cs.avg_power_factor || 0.0);
  const pfEl = document.getElementById("kpiAvgPf");
  pfEl.textContent = formatNum(avgPf, 3);
  if (avgPf < 0.85) {
    pfEl.style.color = "#ef4444";
    document.getElementById("kpiPfStatusSub").textContent = "Sub-optimal (CEB penalty threshold < 0.85)";
  } else {
    pfEl.style.color = "var(--energy-cyan)";
    document.getElementById("kpiPfStatusSub").textContent = "Compliant with CEB threshold (>= 0.85)";
  }

  // After-Hours Energy
  const ahKwh = isSingle ? singleEff.after_hours_kwh : (cs.after_hours_kwh || 0.0);
  const ahPct = isSingle ? singleEff.after_hours_pct : (cs.after_hours_pct || 0.0);
  document.getElementById("kpiAfterHoursKwh").textContent = formatNum(ahKwh, 2);
  document.getElementById("kpiAfterHoursPct").textContent = `(${formatNum(ahPct, 1)}% of total)`;
}

/**
 * Render the 3-part demonstration tariff cost breakdown strip
 */
function renderCostBreakdown(bldgVal, compData, singleCost) {
  const isSingle = (bldgVal !== "all" && singleCost);
  const cs = compData.campus_summary || {};

  const eCharge = isSingle ? singleCost.estimated_energy_charge_lkr : (cs.estimated_energy_charge_lkr || 0.0);
  const dCharge = isSingle ? singleCost.estimated_demand_charge_lkr : (cs.estimated_demand_charge_lkr || 0.0);
  const fCharge = isSingle ? singleCost.estimated_fixed_charge_lkr : (cs.estimated_fixed_charge_lkr || 0.0);
  const totalCost = isSingle ? singleCost.estimated_total_cost_lkr : (cs.estimated_cost_lkr || 0.0);

  document.getElementById("breakdownEnergyCharge").textContent = `LKR ${formatNum(eCharge, 2)}`;
  document.getElementById("breakdownDemandCharge").textContent = `LKR ${formatNum(dCharge, 2)}`;
  document.getElementById("breakdownFixedCharge").textContent = `LKR ${formatNum(fCharge, 2)}`;
  document.getElementById("breakdownTotalCost").textContent = `LKR ${formatNum(totalCost, 2)}`;
}

/**
 * Render Engineering Observations and Baseline Analysis
 */
function renderObservations(bldgVal, compData, singleEff) {
  const isSingle = (bldgVal !== "all" && singleEff);
  const listEl = document.getElementById("observationsList");
  const badgeEl = document.getElementById("performanceStatusBadge");
  listEl.innerHTML = "";

  let observations = [];
  let status = "OPTIMAL";

  if (isSingle) {
    observations = singleEff.engineering_observations || [];
    status = singleEff.energy_performance_status || "OPTIMAL";

    // Append baseline note if available
    if (singleEff.baseline_comparison) {
      const b = singleEff.baseline_comparison;
      observations.push(
        `Long-term historical baseline: Evaluated against ${b.baseline_samples_count.toLocaleString()} stored telemetry records (Lifetime Mean: ${b.lifetime_avg_power_kw} kW, Peak: ${b.lifetime_peak_power_kw} kW, PF: ${b.lifetime_avg_pf}).`
      );
    }
  } else {
    // Campus-wide observations synthesis
    const comp = compData.comparison || [];
    const cs = compData.campus_summary || {};

    if (cs.avg_power_factor < 0.85) {
      observations.push(`Campus-wide mean power factor (${formatNum(cs.avg_power_factor, 3)}) is below the recommended 0.85 threshold, indicating potential capacitive compensation deficiency.`);
    }
    if (cs.after_hours_pct > 30.0) {
      observations.push(`High campus-wide after-hours energy proportion: ${formatNum(cs.after_hours_kwh, 2)} kWh (${formatNum(cs.after_hours_pct, 1)}%) recorded outside faculty standard operating hours.`);
    }

    // High peak contributor
    const highestPeakBldg = comp.reduce((prev, curr) => (curr.peak_demand_kw > prev.peak_demand_kw) ? curr : prev, comp[0] || {});
    if (highestPeakBldg && highestPeakBldg.peak_demand_kw > 0) {
      observations.push(`Highest facility peak demand recorded at ${highestPeakBldg.building_name} (${highestPeakBldg.peak_demand_kw} kW), which represents the primary driver for maximum demand billing.`);
    }

    if (observations.length === 0) {
      observations.push("All registered campus facilities are currently operating within baseline electrical efficiency parameters.");
    }

    status = (cs.avg_power_factor >= 0.88 && cs.load_factor >= 0.50) ? "OPTIMAL" : (cs.avg_power_factor < 0.85 ? "NEEDS_ATTENTION" : "ACCEPTABLE");
  }

  // Update Status Badge
  badgeEl.textContent = status.replace("_", " ");
  badgeEl.className = "obs-badge";
  if (status === "OPTIMAL") badgeEl.classList.add("status-optimal");
  else if (status === "ACCEPTABLE") badgeEl.classList.add("status-acceptable");
  else if (status === "NEEDS_ATTENTION") badgeEl.classList.add("status-attention");
  else badgeEl.classList.add("status-inefficient");

  // Invalidate and render list
  observations.forEach(obs => {
    const p = document.createElement("div");
    p.className = "obs-item";
    p.innerHTML = `<span class="obs-bullet">&bull;</span><span>${obs}</span>`;
    listEl.appendChild(p);
  });
}

/**
 * Render the 4 Comparison Bar Charts
 */
function renderComparisonCharts(compData) {
  const comparison = compData.comparison || [];
  if (comparison.length === 0) return;

  const labels = comparison.map(c => c.building_code);
  const colors = comparison.map(c => BUILDING_COLORS[c.building_code] || "#38bdf8");

  // 1. Energy by Building (kWh)
  const energyData = comparison.map(c => c.total_kwh);
  renderBarChart(
    "chartCostEnergy",
    chartCEnergy,
    labels,
    energyData,
    "Energy (kWh)",
    colors,
    (inst) => { chartCEnergy = inst; }
  );

  // 2. Estimated Cost by Building (LKR)
  const costData = comparison.map(c => c.estimated_cost_lkr);
  renderBarChart(
    "chartCostTotal",
    chartCCost,
    labels,
    costData,
    "Estimated Cost (LKR)",
    "#10b981",
    (inst) => { chartCCost = inst; }
  );

  // 3. Peak Demand Comparison (kW)
  const peakData = comparison.map(c => c.peak_demand_kw);
  renderBarChart(
    "chartCostPeak",
    chartCPeak,
    labels,
    peakData,
    "Peak Demand (kW)",
    "#f43f5e",
    (inst) => { chartCPeak = inst; }
  );

  // 4. After-Hours Energy Comparison (kWh)
  const afterData = comparison.map(c => c.after_hours_kwh);
  renderBarChart(
    "chartCostAfterHours",
    chartCAfter,
    labels,
    afterData,
    "After-Hours Energy (kWh)",
    "#fb923c",
    (inst) => { chartCAfter = inst; }
  );
}

/**
 * Generic Bar Chart Helper
 */
function renderBarChart(canvasId, currentChart, labels, data, datasetLabel, barColors, setChart) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  if (currentChart) {
    currentChart.destroy();
  }

  const newChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: datasetLabel,
        data: data,
        backgroundColor: barColors,
        borderColor: Array.isArray(barColors) ? barColors.map(c => c) : barColors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f8fafc",
          bodyColor: "#94a3b8",
          borderColor: "rgba(255, 255, 255, 0.1)",
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { family: "Outfit", size: 12 } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.05)" },
          ticks: { color: "#94a3b8", font: { family: "JetBrains Mono", size: 11 } },
          beginAtZero: true
        }
      }
    }
  });

  setChart(newChart);
}

/**
 * Render the Campus Facilities Comparative Ranking & Efficiency Table
 */
function renderEfficiencyTable(compData) {
  const ranked = compData.ranked_comparison || [];
  const tbody = document.getElementById("efficiencyTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (ranked.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted);">No comparison data available for the selected period.</td></tr>`;
    return;
  }

  ranked.forEach(row => {
    const tr = document.createElement("tr");

    // Rank styling
    let rankBadge = `<span class="rank-badge rank-other">#${row.efficiency_rank}</span>`;
    if (row.efficiency_rank === 1) rankBadge = `<span class="rank-badge rank-gold">&#9733; #1</span>`;
    else if (row.efficiency_rank === 2) rankBadge = `<span class="rank-badge rank-silver">#2</span>`;
    else if (row.efficiency_rank === 3) rankBadge = `<span class="rank-badge rank-bronze">#3</span>`;

    // Status styling
    let statusClass = "status-optimal";
    if (row.performance_status === "ACCEPTABLE") statusClass = "status-acceptable";
    else if (row.performance_status === "NEEDS_ATTENTION") statusClass = "status-attention";
    else if (row.performance_status === "INEFFICIENT") statusClass = "status-inefficient";

    tr.innerHTML = `
      <td>${rankBadge}</td>
      <td><strong>${row.building_code}</strong></td>
      <td>${row.building_name}</td>
      <td>${formatNum(row.total_kwh, 2)}</td>
      <td style="color: #10b981; font-weight: 600;">LKR ${formatNum(row.estimated_cost_lkr, 2)}</td>
      <td>${formatNum(row.peak_demand_kw, 1)}</td>
      <td>${formatNum(row.load_factor, 2)} <small style="color: var(--text-dim);">(${formatNum(row.load_factor_pct, 1)}%)</small></td>
      <td style="color: ${row.avg_power_factor < 0.85 ? '#ef4444' : 'inherit'}; font-weight: ${row.avg_power_factor < 0.85 ? '700' : 'normal'};">
        ${formatNum(row.avg_power_factor, 3)}
      </td>
      <td>${formatNum(row.after_hours_kwh, 2)} <small style="color: var(--text-dim);">(${formatNum(row.after_hours_pct, 1)}%)</small></td>
      <td><strong style="color: var(--energy-cyan);">${formatNum(row.efficiency_score, 1)}</strong>/100</td>
      <td><span class="obs-badge ${statusClass}" style="padding: 0.2rem 0.5rem; font-size: 0.7rem;">${(row.performance_status || "OPTIMAL").replace("_", " ")}</span></td>
    `;
    tbody.appendChild(tr);
  });
}
