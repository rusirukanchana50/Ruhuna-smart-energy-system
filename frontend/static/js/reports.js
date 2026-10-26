/**
 * reports.js
 * ----------
 * Client-Side Controller for Phase 8: Reports, Export and System Integration
 * Faculty of Engineering, University of Ruhuna
 *
 * Handles:
 * - Reporting preset periods: Today, Last 24 Hours, Last 7 Days, This Month
 * - Fetching full 16-parameter summary report via /api/reports/summary
 * - Displaying comprehensive KPI cards, engineering observations, and campus breakdown table
 * - Triggering printable PDF audit report popup via /reports/printable
 * - Downloading raw CSV telemetry files via /api/reports/export/csv
 * - Administrator demonstration tariff updates via /api/config/tariff
 */

document.addEventListener("DOMContentLoaded", () => {
  setupReportPresets();
  setReportPreset("24h");
  triggerGenerateReport();
});

/**
 * Configure preset period buttons (today, 24h, 7d, month)
 */
function setupReportPresets() {
  const presetBtns = document.querySelectorAll("#reportPresets .preset-btn");
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      setReportPreset(btn.dataset.preset);
      triggerGenerateReport();
    });
  });

  const bldgSelect = document.getElementById("reportBuilding");
  if (bldgSelect) {
    bldgSelect.addEventListener("change", () => {
      triggerGenerateReport();
    });
  }
}

/**
 * Calculate and set datetime-local input values for presets
 */
function setReportPreset(preset) {
  const now = new Date();
  let start = new Date();

  if (preset === "today") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  } else if (preset === "24h") {
    start = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  } else if (preset === "7d") {
    start = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  } else if (preset === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
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

  const startInput = document.getElementById("reportStart");
  const endInput = document.getElementById("reportEnd");

  if (startInput) startInput.value = formatForInput(start);
  if (endInput) endInput.value = formatForInput(now);
}

/**
 * Format numbers with comma grouping and fixed decimals
 * Returns '--' if val is null, undefined, or NaN, ensuring missing metrics are not disguised as 0.00
 */
function formatNum(val, dec = 2, fallback = "--") {
  if (val === null || val === undefined || isNaN(val)) return fallback;
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec
  });
}

/**
 * Generate Summary Report API request
 */
async function triggerGenerateReport() {
  const bldgVal = document.getElementById("reportBuilding") ? document.getElementById("reportBuilding").value : "all";
  const startVal = document.getElementById("reportStart") ? document.getElementById("reportStart").value : "";
  const endVal = document.getElementById("reportEnd") ? document.getElementById("reportEnd").value : "";

  const alertBox = document.getElementById("reportAlert");
  const loadingState = document.getElementById("reportLoadingState");
  const contentArea = document.getElementById("reportContentArea");
  const btn = document.getElementById("btnGenerateReport");

  if (alertBox) alertBox.style.display = "none";
  if (loadingState) loadingState.style.display = "block";
  if (contentArea) contentArea.style.opacity = "0.5";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="pulse-dot"></span> Generating...`;
  }

  try {
    const url = `/api/reports/summary?building_id=${encodeURIComponent(bldgVal)}&start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;
    const res = await fetch(url, { credentials: "include" });

    if (!res.ok) {
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      throw new Error(`Report generation failed: ${res.statusText}`);
    }

    const data = await res.json();
    const report = data.report || {};

    renderReportView(report);

  } catch (err) {
    console.error("Report generation error:", err);
    if (alertBox) {
      alertBox.textContent = `Error compiling energy report: ${err.message}`;
      alertBox.style.display = "block";
    }
  } finally {
    if (loadingState) loadingState.style.display = "none";
    if (contentArea) contentArea.style.opacity = "1";
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
          <polyline points="17 6 23 6 23 12"></polyline>
        </svg>
        Generate
      `;
    }
  }
}

/**
 * Render the full 16-parameter energy summary report view
 */
function renderReportView(report) {
  const m = report.metrics || {};
  const isCampus = (report.mode === "campus_summary");

  // Metadata headers
  const bldgCountStr = (report.building_breakdown && report.building_breakdown.length)
    ? `${report.building_breakdown.length} BUILDINGS`
    : "ALL REGISTERED FACILITIES";
  document.getElementById("repScopeTag").textContent = isCampus ? `CAMPUS SUMMARY (${bldgCountStr})` : `FACILITY: [${report.building_code}]`;
  document.getElementById("repDisplayTitle").textContent = report.report_title || "Electrical Energy Audit Report";
  document.getElementById("repMetaPeriod").textContent = `${report.reporting_period.start || '--'} to ${report.reporting_period.end || '--'}`;
  document.getElementById("repMetaDuration").textContent = `${report.reporting_period.duration_days || 0} Day(s)`;
  document.getElementById("repMetaGenerated").textContent = report.generated_at || new Date().toLocaleString();

  // 16 Primary Metrics
  document.getElementById("repTotalKwh").textContent = formatNum(m.total_energy_kwh, 2);
  document.getElementById("repTotalCost").textContent = formatNum(m.estimated_electricity_cost_lkr, 2);
  document.getElementById("repAvgPower").textContent = formatNum(m.avg_active_power_kw, 2);
  document.getElementById("repPeakDemand").textContent = formatNum(m.peak_demand_kw, 1);

  document.getElementById("repLoadFactor").textContent = formatNum(m.load_factor, 2);
  document.getElementById("repLoadFactorPct").textContent = (m.load_factor_pct !== null && m.load_factor_pct !== undefined)
    ? `(${formatNum(m.load_factor_pct, 1)}%)`
    : "";

  const avgPfEl = document.getElementById("repAvgPf");
  if (m.avg_power_factor !== null && m.avg_power_factor !== undefined) {
    avgPfEl.textContent = formatNum(m.avg_power_factor, 3);
    if (m.avg_power_factor < 0.85) {
      avgPfEl.style.color = "#ef4444";
      document.getElementById("repPfComplianceSub").textContent = "Non-compliant (Below 0.85 threshold)";
    } else {
      avgPfEl.style.color = "var(--energy-teal)";
      document.getElementById("repPfComplianceSub").textContent = "Compliant with CEB threshold (>= 0.85)";
    }
  } else {
    avgPfEl.textContent = "--";
    document.getElementById("repPfComplianceSub").textContent = "No data recorded";
  }

  const minPfVal = (m.min_power_factor !== null && m.min_power_factor !== undefined) 
    ? m.min_power_factor 
    : m.avg_power_factor;
  document.getElementById("repMinPf").textContent = formatNum(minPfVal, 3);

  document.getElementById("repAvgS").textContent = formatNum(m.avg_apparent_power_kva, 1);
  document.getElementById("repAvgQ").textContent = formatNum(m.avg_reactive_power_kvar, 1);

  document.getElementById("repAfterHours").textContent = formatNum(m.after_hours_kwh, 2);
  document.getElementById("repAfterHoursPct").textContent = (m.after_hours_pct !== null && m.after_hours_pct !== undefined)
    ? `(${formatNum(m.after_hours_pct, 1)}% of total)`
    : "";

  if (m.min_voltage !== null && m.min_voltage !== undefined && m.max_voltage !== null && m.max_voltage !== undefined) {
    document.getElementById("repVoltRange").textContent = `${formatNum(m.min_voltage, 0)}V - ${formatNum(m.max_voltage, 0)}V`;
  } else {
    document.getElementById("repVoltRange").textContent = "--";
  }

  if (m.avg_voltage !== null && m.avg_voltage !== undefined) {
    document.getElementById("repAvgVolt").textContent = `Avg: ${formatNum(m.avg_voltage, 1)} V`;
  } else {
    document.getElementById("repAvgVolt").textContent = "Avg: --";
  }

  document.getElementById("repAvgFreq").textContent = formatNum(m.avg_frequency, 2);
  document.getElementById("repWarnAlerts").textContent = (m.warning_alerts_count !== null && m.warning_alerts_count !== undefined) ? m.warning_alerts_count : 0;
  document.getElementById("repCritAlerts").textContent = (m.critical_alerts_count !== null && m.critical_alerts_count !== undefined) ? m.critical_alerts_count : 0;

  // Observations
  const obsList = document.getElementById("repObservationsList");
  obsList.innerHTML = "";
  const obs = report.engineering_observations || [];
  if (obs.length === 0) {
    obsList.innerHTML = `<div class="obs-item"><span class="obs-bullet">&bull;</span><span>All monitored electrical parameters are within standard operating thresholds.</span></div>`;
  } else {
    obs.forEach(item => {
      const row = document.createElement("div");
      row.className = "obs-item";
      row.innerHTML = `<span class="obs-bullet">&bull;</span><span>${item}</span>`;
      obsList.appendChild(row);
    });
  }

  // Status Badge
  const statusBadge = document.getElementById("repStatusBadge");
  const perfStatus = report.performance_status || (m.avg_power_factor >= 0.85 ? "OPTIMAL" : "NEEDS_ATTENTION");
  statusBadge.textContent = perfStatus.replace("_", " ");
  statusBadge.className = "obs-badge";
  if (perfStatus === "OPTIMAL") statusBadge.classList.add("status-optimal");
  else if (perfStatus === "ACCEPTABLE") statusBadge.classList.add("status-acceptable");
  else if (perfStatus === "NEEDS_ATTENTION") statusBadge.classList.add("status-attention");
  else statusBadge.classList.add("status-inefficient");

  // Campus Breakdown Table
  const breakdownSec = document.getElementById("campusBreakdownSection");
  const breakdownBody = document.getElementById("campusBreakdownTableBody");
  if (isCampus && report.building_breakdown) {
    breakdownSec.style.display = "block";
    breakdownBody.innerHTML = "";
    report.building_breakdown.forEach(b => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${b.building_code}</strong></td>
        <td>${b.building_name}</td>
        <td>${formatNum(b.total_kwh, 2)}</td>
        <td style="color: #10b981; font-weight: 600;">LKR ${formatNum(b.estimated_cost_lkr, 2)}</td>
        <td>${formatNum(b.peak_demand_kw, 1)}</td>
        <td>${formatNum(b.load_factor, 2)} <small style="color: var(--text-dim);">(${formatNum(b.load_factor_pct, 1)}%)</small></td>
        <td style="color: ${b.avg_power_factor < 0.85 ? '#ef4444' : 'inherit'}; font-weight: ${b.avg_power_factor < 0.85 ? '700' : 'normal'};">${formatNum(b.avg_power_factor, 3)}</td>
        <td>${formatNum(b.after_hours_kwh, 2)} <small style="color: var(--text-dim);">(${formatNum(b.after_hours_pct, 1)}%)</small></td>
      `;
      breakdownBody.appendChild(tr);
    });
  } else {
    breakdownSec.style.display = "none";
  }
}

/**
 * Open the formal browser printable report in a clean popup window
 */
function openPrintableReport() {
  const bldgVal = document.getElementById("reportBuilding") ? document.getElementById("reportBuilding").value : "all";
  const startVal = document.getElementById("reportStart") ? document.getElementById("reportStart").value : "";
  const endVal = document.getElementById("reportEnd") ? document.getElementById("reportEnd").value : "";

  const url = `/reports/printable?building_id=${encodeURIComponent(bldgVal)}&start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;
  window.open(url, "_blank");
}

/**
 * Stream/Download CSV export file directly from SQLite records
 */
function downloadCsvExport() {
  const bldgVal = document.getElementById("reportBuilding") ? document.getElementById("reportBuilding").value : "all";
  const startVal = document.getElementById("reportStart") ? document.getElementById("reportStart").value : "";
  const endVal = document.getElementById("reportEnd") ? document.getElementById("reportEnd").value : "";

  const url = `/api/reports/export/csv?building_id=${encodeURIComponent(bldgVal)}&start=${encodeURIComponent(startVal)}&end=${encodeURIComponent(endVal)}`;
  window.location.href = url;
}

/**
 * Administrator Only: Update Demonstration Tariff Rates via API
 */
async function updateTariffConfig() {
  const tariffId = document.getElementById("cfgTariffId") ? document.getElementById("cfgTariffId").value : 1;
  const nameInput = document.getElementById("cfgTariffName");
  const energyInput = document.getElementById("cfgEnergyRate");
  const demandInput = document.getElementById("cfgDemandRate");
  const fixedInput = document.getElementById("cfgFixedCharge");

  const name = nameInput ? nameInput.value.trim() : "";
  const rawEnergy = energyInput ? energyInput.value.trim() : "";
  const rawDemand = demandInput ? demandInput.value.trim() : "";
  const rawFixed = fixedInput ? fixedInput.value.trim() : "";

  const energyRate = parseFloat(rawEnergy);
  const demandRate = parseFloat(rawDemand);
  const fixedCharge = parseFloat(rawFixed);

  const alertBox = document.getElementById("tariffConfigAlert");
  const saveBtn = document.getElementById("btnSaveTariff");

  // Client-Side Validation
  if (!name || name.length < 3 || name.length > 100) {
    if (alertBox) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = "Validation Error: Tariff name/description is required (3 to 100 characters).";
      alertBox.style.display = "block";
    }
    return;
  }

  if (!rawEnergy || isNaN(energyRate) || !isFinite(energyRate) || energyRate <= 0 || energyRate > 1000) {
    if (alertBox) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = "Validation Error: Energy rate must be a valid positive number greater than 0 LKR/kWh (max 1,000 LKR/kWh).";
      alertBox.style.display = "block";
    }
    return;
  }

  if (!rawDemand || isNaN(demandRate) || !isFinite(demandRate) || demandRate < 0 || demandRate > 50000) {
    if (alertBox) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = "Validation Error: Demand rate must be a valid non-negative number (>= 0 LKR/kW, max 50,000 LKR/kW).";
      alertBox.style.display = "block";
    }
    return;
  }

  if (!rawFixed || isNaN(fixedCharge) || !isFinite(fixedCharge) || fixedCharge < 0 || fixedCharge > 100000) {
    if (alertBox) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = "Validation Error: Monthly fixed charge must be a valid non-negative number (>= 0 LKR, max 100,000 LKR).";
      alertBox.style.display = "block";
    }
    return;
  }

  function getCsrfToken() {
    const el = document.querySelector('meta[name="csrf-token"]');
    return el ? el.getAttribute('content') : '';
  }

  try {
    const res = await fetch("/api/config/tariff", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": getCsrfToken()
      },
      credentials: "include",
      body: JSON.stringify({
        tariff_id: tariffId,
        name: name,
        energy_rate_lkr_per_kwh: energyRate,
        demand_rate_lkr_per_kw: demandRate,
        fixed_charge_lkr: fixedCharge,
        csrf_token: getCsrfToken()
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Failed to update tariff configuration.");
    }

    if (alertBox) {
      alertBox.className = "alert alert-success";
      alertBox.textContent = `Tariff successfully updated! ${data.message || ""}`;
      alertBox.style.display = "block";
    }

    // Refresh current report with updated tariff rates
    setTimeout(() => {
      triggerGenerateReport();
    }, 1000);

  } catch (err) {
    if (alertBox) {
      alertBox.className = "alert alert-danger";
      alertBox.textContent = `Configuration Error: ${err.message}`;
      alertBox.style.display = "block";
    }
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}
