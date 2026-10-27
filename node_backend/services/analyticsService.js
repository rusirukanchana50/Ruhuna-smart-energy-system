/**
 * analyticsService.js
 * -------------------
 * Electrical energy analytics, cost calculations, efficiency ratings,
 * and comprehensive engineering report generation for Ruhuna Smart Energy System.
 * Queries MongoDB exclusively and supports MongoDB 3.4.
 */

const mongoose = require('mongoose');
const Building = require('../models/Building');
const EnergyReading = require('../models/EnergyReading');
const Alert = require('../models/Alert');
const Tariff = require('../models/Tariff');
const FacultySetting = require('../models/FacultySetting');

/**
 * Formats a Date object to "YYYY-MM-DD HH:MM:SS".
 */
function formatTimestamp(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

/**
 * Parses timestamp string or Date object safely.
 */
function parseTimestampStr(val) {
  if (!val) return new Date();
  if (val instanceof Date) return val;
  const str = String(val).trim();
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Normalizes query string boundary timestamps into "YYYY-MM-DD HH:MM:SS".
 */
function normalizeTimestamp(val, isEnd = false) {
  if (!val || typeof val !== 'string' || !val.trim()) return null;
  const str = val.trim();
  if (str.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return isEnd ? `${str} 23:59:59` : `${str} 00:00:00`;
  }
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T'));
  if (isNaN(d.getTime())) return null;
  return formatTimestamp(d);
}

/**
 * Returns date adjusted to Asia/Colombo (UTC+05:30).
 */
function getColomboDateTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (5.5 * 3600000));
}

/**
 * Evaluates whether a timestamp falls outside faculty operating hours.
 * Uses Sri Lanka local time (Asia/Colombo, UTC+05:30).
 * Standard operating hours: Weekdays Monday (0) to Friday (4) between 08:00 and 17:00.
 * Weekends (Saturday 5, Sunday 6) and non-working hours are 100% after-hours.
 */
function isTimestampAfterHours(ts, settings = {}) {
  const d = parseTimestampStr(ts);
  const colombo = getColomboDateTime(d);

  const opDaysStr = settings.operating_days || '0,1,2,3,4';
  const opDays = opDaysStr.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !isNaN(x));

  const startStr = settings.operating_hours_start || '08:00';
  const endStr = settings.operating_hours_end || '17:00';

  let sh = 8, sm = 0, eh = 17, em = 0;
  try {
    const sParts = startStr.split(':');
    sh = parseInt(sParts[0], 10);
    sm = parseInt(sParts[1], 10);
    const eParts = endStr.split(':');
    eh = parseInt(eParts[0], 10);
    em = parseInt(eParts[1], 10);
  } catch (err) {}

  // Colombo weekday: Sunday is 0 in JS getDay(), so Monday=0..Sunday=6:
  const day = colombo.getDay();
  const weekday = (day + 6) % 7; // Monday=0, Sunday=6

  if (!opDays.includes(weekday)) {
    return true; // Weekend / non-operating day
  }

  const timeMinutes = colombo.getHours() * 60 + colombo.getMinutes();
  const startMinutes = sh * 60 + sm;
  const endMinutes = eh * 60 + em;

  if (timeMinutes < startMinutes || timeMinutes >= endMinutes) {
    return true; // Before 08:00 or after 17:00
  }

  return false;
}

/**
 * Retrieves the currently active demonstration tariff model from MongoDB.
 */
async function getActiveTariff() {
  let tariff = await Tariff.findOne({ active: true }).sort({ id: -1 }).lean();
  if (!tariff) {
    tariff = await Tariff.create({
      id: 1,
      name: 'Demonstration Institutional Tariff (Estimated Non-Official Model)',
      energy_rate_lkr_per_kwh: 38.50,
      demand_rate_lkr_per_kw: 1450.00,
      fixed_charge_lkr: 3000.00,
      effective_from: new Date('2026-01-01T00:00:00Z'),
      active: true
    });
    tariff = tariff.toJSON();
  }
  return tariff;
}

/**
 * Retrieves all configured tariffs from MongoDB.
 */
async function getAllTariffs() {
  return await Tariff.find({}).sort({ id: -1 }).lean();
}

/**
 * Updates demonstration tariff rates in MongoDB.
 */
async function updateTariffConfiguration(tariffId, name, energyRate, demandRate, fixedCharge) {
  const query = !isNaN(Number(tariffId)) ? { id: Number(tariffId) } : { _id: tariffId };
  const tariff = await Tariff.findOne(query);
  if (!tariff) return null;

  if (name !== undefined) tariff.name = String(name).trim();
  if (energyRate !== undefined) tariff.energy_rate_lkr_per_kwh = Number(energyRate);
  if (demandRate !== undefined) tariff.demand_rate_lkr_per_kw = Number(demandRate);
  if (fixedCharge !== undefined) tariff.fixed_charge_lkr = Number(fixedCharge);

  await tariff.save();
  return tariff;
}

/**
 * Retrieves faculty operational configuration settings.
 */
async function getFacultySettings() {
  const defaults = {
    operating_hours_start: '08:00',
    operating_hours_end: '17:00',
    operating_days: '0,1,2,3,4',
    tariff_billing_days_norm: '30'
  };

  const docs = await FacultySetting.find({}).lean();
  for (const doc of docs) {
    defaults[doc.setting_key] = doc.setting_value;
  }
  return defaults;
}

/**
 * Updates or inserts a faculty configuration setting.
 */
async function updateFacultySetting(settingKey, settingValue, description = '') {
  let setting = await FacultySetting.findOne({ setting_key: settingKey });
  if (!setting) {
    setting = await FacultySetting.create({
      setting_key: settingKey,
      setting_value: String(settingValue).trim(),
      description: description || `Setting for ${settingKey}`
    });
  } else {
    setting.setting_value = String(settingValue).trim();
    if (description) setting.description = description;
    await setting.save();
  }
  return setting;
}

/**
 * Resolves a building identifier (ObjectId string, building code, or 1-based index) to a Building document.
 */
async function resolveBuilding(buildingId, allBuildings = null) {
  if (buildingId === undefined || buildingId === null) return null;
  const bStr = String(buildingId).trim();
  if (!bStr || bStr.toLowerCase() === 'all' || bStr.toLowerCase() === 'none') return null;

  const buildings = allBuildings || await Building.find({}).sort({ createdAt: 1, _id: 1 });
  let found = buildings.find(
    (b) => b._id.toString() === bStr || b.code === bStr.toUpperCase() || (b.name && b.name.toLowerCase() === bStr.toLowerCase())
  );

  if (!found && /^\d+$/.test(bStr)) {
    const idx = parseInt(bStr, 10) - 1;
    if (idx >= 0 && idx < buildings.length) {
      found = buildings[idx];
    }
  }
  return found;
}

/**
 * Retrieves stored energy readings filtered by building, start timestamp, and end timestamp.
 */
async function getFilteredEnergyHistory(buildingId, start, end, limit = 2000, orderAsc = true) {
  const query = {};

  if (buildingId !== undefined && buildingId !== null && String(buildingId).trim().toLowerCase() !== 'all') {
    const bldg = await resolveBuilding(buildingId);
    if (bldg) {
      query.$or = [{ building_id: bldg._id }, { building_code: bldg.code }];
    } else {
      const bStr = String(buildingId).trim();
      if (mongoose.Types.ObjectId.isValid(bStr) && bStr.length === 24) {
        query.building_id = mongoose.Types.ObjectId(bStr);
      } else {
        query.building_code = bStr.toUpperCase();
      }
    }
  }

  const normStart = normalizeTimestamp(start, false);
  const normEnd = normalizeTimestamp(end, true);

  if (normStart || normEnd) {
    query.timestamp = {};
    if (normStart) query.timestamp.$gte = new Date(normStart);
    if (normEnd) query.timestamp.$lte = new Date(normEnd);
  }

  const sortOrder = orderAsc ? 1 : -1;
  const maxLimit = Math.min(Math.max(1, parseInt(limit, 10) || 500), 5000);

  const docs = await EnergyReading.find(query)
    .sort({ timestamp: sortOrder, _id: sortOrder })
    .limit(maxLimit)
    .lean();

  return docs.map((r) => ({
    id: r._id.toString(),
    _id: r._id.toString(),
    building_id: r.building_id ? r.building_id.toString() : '',
    building_code: r.building_code || 'GEN',
    building_name: r.building_name || 'General',
    timestamp: formatTimestamp(r.timestamp),
    voltage: r.voltage,
    current: r.current,
    power_factor: r.power_factor,
    frequency: r.frequency,
    apparent_power_kva: r.apparent_power_kva,
    active_power_kw: r.active_power_kw,
    reactive_power_kvar: r.reactive_power_kvar,
    energy_kwh: r.energy_kwh,
    is_simulated: r.is_simulated ? 1 : 0
  }));
}

/**
 * Calculates detailed electrical analytics for a chronological list of readings:
 * - Total energy consumed (kWh) with missing-sensor gap protection
 * - Average, peak, and minimum active power (kW)
 * - Load factor = Average Active Power / Peak Active Power (bounded in [0.0, 1.0])
 * - Voltage, Frequency, Power Factor stats
 */
function calculateBuildingAnalytics(readings) {
  if (!readings || readings.length === 0) {
    return {
      readings_count: 0,
      total_energy_kwh: 0.0,
      avg_active_power_kw: 0.0,
      peak_active_power_kw: 0.0,
      min_active_power_kw: 0.0,
      avg_apparent_power_kva: null,
      avg_reactive_power_kvar: null,
      avg_power_factor: null,
      min_power_factor: null,
      avg_voltage: null,
      min_voltage: null,
      max_voltage: null,
      avg_current: null,
      avg_frequency: null,
      load_factor: 0.0,
      load_factor_pct: 0.0
    };
  }

  const n = readings.length;
  const activePowers = readings.map((r) => Number(r.active_power_kw) || 0);
  const apparentPowers = readings.map((r) => Number(r.apparent_power_kva) || 0);
  const reactivePowers = readings.map((r) => Number(r.reactive_power_kvar) || 0);
  const powerFactors = readings.map((r) => Number(r.power_factor) || 0);
  const voltages = readings.map((r) => Number(r.voltage) || 0);
  const currents = readings.map((r) => Number(r.current) || 0);
  const frequencies = readings.map((r) => Number(r.frequency) || 0);

  const avgP = activePowers.reduce((a, b) => a + b, 0) / n;
  const peakP = Math.max(...activePowers);
  const minP = Math.min(...activePowers);

  const avgS = apparentPowers.reduce((a, b) => a + b, 0) / n;
  const avgQ = reactivePowers.reduce((a, b) => a + b, 0) / n;

  const avgPf = powerFactors.reduce((a, b) => a + b, 0) / n;
  const minPf = Math.min(...powerFactors);

  const avgV = voltages.reduce((a, b) => a + b, 0) / n;
  const minV = Math.min(...voltages);
  const maxV = Math.max(...voltages);

  const avgI = currents.reduce((a, b) => a + b, 0) / n;
  const avgF = frequencies.reduce((a, b) => a + b, 0) / n;

  // Load Factor = Average Active Power / Peak Active Power
  let loadFactor = peakP > 0 ? avgP / peakP : 0.0;
  loadFactor = Math.max(0.0, Math.min(1.0, loadFactor));

  // Incremental energy integration with missing data gap handling
  let totalEnergyKwh = 0.0;
  if (n === 1) {
    totalEnergyKwh = activePowers[0] * (15.0 / 3600.0);
  } else {
    for (let i = 1; i < n; i++) {
      const tPrev = parseTimestampStr(readings[i - 1].timestamp);
      const tCurr = parseTimestampStr(readings[i].timestamp);
      const deltaS = (tCurr.getTime() - tPrev.getTime()) / 1000.0;
      const pAvg = (activePowers[i - 1] + activePowers[i]) / 2.0;

      let dt = 15.0;
      if (deltaS > 0 && deltaS <= 60.0) {
        dt = deltaS;
      }
      totalEnergyKwh += pAvg * (dt / 3600.0);
    }
  }

  return {
    readings_count: n,
    total_energy_kwh: Math.round(totalEnergyKwh * 1000) / 1000,
    avg_active_power_kw: Math.round(avgP * 100) / 100,
    peak_active_power_kw: Math.round(peakP * 100) / 100,
    min_active_power_kw: Math.round(minP * 100) / 100,
    avg_apparent_power_kva: Math.round(avgS * 100) / 100,
    avg_reactive_power_kvar: Math.round(avgQ * 100) / 100,
    avg_power_factor: Math.round(avgPf * 1000) / 1000,
    min_power_factor: Math.round(minPf * 1000) / 1000,
    avg_voltage: Math.round(avgV * 10) / 10,
    min_voltage: Math.round(minV * 10) / 10,
    max_voltage: Math.round(maxV * 10) / 10,
    avg_current: Math.round(avgI * 10) / 10,
    avg_frequency: Math.round(avgF * 100) / 100,
    load_factor: Math.round(loadFactor * 1000) / 1000,
    load_factor_pct: Math.round(loadFactor * 1000) / 10
  };
}

/**
 * Calculates electricity cost using the demonstration institutional two-part tariff model.
 */
function calculateBuildingCost(totalEnergyKwh, peakDemandKw, durationSeconds = 86400, tariff = null) {
  const energyRate = tariff ? Number(tariff.energy_rate_lkr_per_kwh) : 38.50;
  const demandRate = tariff ? Number(tariff.demand_rate_lkr_per_kw) : 1450.00;
  const fixedCharge = tariff ? Number(tariff.fixed_charge_lkr) : 3000.00;

  const periodDays = Math.max(durationSeconds / 86400.0, 0.001);
  const periodScalingFraction = periodDays / 30.0;

  // 1. Energy Charge: active kWh * rate
  const energyChargeLkr = totalEnergyKwh * energyRate;

  // 2. Demand Charge: peak kW * demand rate * fraction
  const demandChargeLkr = peakDemandKw * demandRate * periodScalingFraction;

  // 3. Fixed Charge: monthly fixed charge * fraction
  const applicableFixedChargeLkr = fixedCharge * periodScalingFraction;

  const totalCostLkr = energyChargeLkr + demandChargeLkr + applicableFixedChargeLkr;

  return {
    tariff_name: tariff ? tariff.name : 'Demonstration Institutional Tariff',
    tariff_rates: {
      energy_rate_lkr_per_kwh: Math.round(energyRate * 100) / 100,
      demand_rate_lkr_per_kw: Math.round(demandRate * 100) / 100,
      monthly_fixed_charge_lkr: Math.round(fixedCharge * 100) / 100
    },
    period_days: Math.round(periodDays * 100) / 100,
    energy_consumed_kwh: Math.round(totalEnergyKwh * 1000) / 1000,
    peak_demand_kw: Math.round(peakDemandKw * 100) / 100,
    estimated_energy_charge_lkr: Math.round(energyChargeLkr * 100) / 100,
    estimated_demand_charge_lkr: Math.round(demandChargeLkr * 100) / 100,
    estimated_fixed_charge_lkr: Math.round(applicableFixedChargeLkr * 100) / 100,
    estimated_total_cost_lkr: Math.round(totalCostLkr * 100) / 100,
    is_estimate: true,
    disclaimer: 'Cost estimates use a configurable demonstration tariff model and are not an official CEB bill.'
  };
}

/**
 * Computes electrical efficiency metrics, after-hours usage, and engineering observations.
 */
async function calculateBuildingEfficiency(readings, buildingInfo = null, settings = null) {
  const currentSettings = settings || (await getFacultySettings());

  if (!readings || readings.length === 0) {
    return {
      readings_count: 0,
      total_energy_kwh: 0.0,
      avg_demand_kw: 0.0,
      peak_demand_kw: 0.0,
      load_factor: 0.0,
      load_factor_pct: 0.0,
      avg_power_factor: 0.0,
      low_pf_duration_minutes: 0.0,
      low_pf_readings_count: 0,
      after_hours_kwh: 0.0,
      after_hours_pct: 0.0,
      operating_hours_kwh: 0.0,
      performance_status: 'NO_DATA',
      efficiency_score: 0.0,
      engineering_observations: ['No electrical readings recorded for the selected period.'],
      baseline_comparison: null
    };
  }

  const n = readings.length;
  const activePowers = readings.map((r) => Number(r.active_power_kw) || 0);
  const powerFactors = readings.map((r) => Number(r.power_factor) || 0);

  const avgP = activePowers.reduce((a, b) => a + b, 0) / n;
  const peakP = Math.max(...activePowers);
  const avgPf = powerFactors.reduce((a, b) => a + b, 0) / n;
  let loadFactor = peakP > 0 ? avgP / peakP : 0.0;
  loadFactor = Math.max(0.0, Math.min(1.0, loadFactor));

  let totalEnergyKwh = 0.0;
  let afterHoursKwh = 0.0;
  let lowPfSeconds = 0.0;
  let lowPfReadings = 0;

  if (n === 1) {
    const t0 = parseTimestampStr(readings[0].timestamp);
    const dt = 15.0;
    const eStep = activePowers[0] * (dt / 3600.0);
    totalEnergyKwh = eStep;
    if (isTimestampAfterHours(t0, currentSettings)) {
      afterHoursKwh = eStep;
    }
    if (powerFactors[0] < 0.85) {
      lowPfSeconds = dt;
      lowPfReadings = 1;
    }
  } else {
    for (let i = 1; i < n; i++) {
      const tPrev = parseTimestampStr(readings[i - 1].timestamp);
      const tCurr = parseTimestampStr(readings[i].timestamp);
      const deltaS = (tCurr.getTime() - tPrev.getTime()) / 1000.0;
      const pAvg = (activePowers[i - 1] + activePowers[i]) / 2.0;
      const pfAvg = (powerFactors[i - 1] + powerFactors[i]) / 2.0;

      let dt = 15.0;
      if (deltaS > 0 && deltaS <= 60.0) {
        dt = deltaS;
      }

      const deltaKwh = pAvg * (dt / 3600.0);
      totalEnergyKwh += deltaKwh;

      const midTs = new Date(tPrev.getTime() + (tCurr.getTime() - tPrev.getTime()) / 2);
      if (isTimestampAfterHours(midTs, currentSettings)) {
        afterHoursKwh += deltaKwh;
      }

      if (pfAvg < 0.85) {
        lowPfSeconds += dt;
        lowPfReadings++;
      }
    }
  }

  const operatingHoursKwh = Math.max(0.0, totalEnergyKwh - afterHoursKwh);
  const afterHoursPct = totalEnergyKwh > 0 ? (afterHoursKwh / totalEnergyKwh) * 100.0 : 0.0;
  const lowPfMinutes = lowPfSeconds / 60.0;

  // Baseline comparison
  let baselineStats = null;
  const bId = buildingInfo ? buildingInfo._id || buildingInfo.id : (readings[0].building_id || null);
  if (bId) {
    baselineStats = await getBuildingHistoricalBaseline(bId);
  }

  // Factual engineering observations
  const observations = [];
  if (loadFactor < 0.40 && peakP > 0) {
    observations.push(
      `Low load factor detected (${loadFactor.toFixed(2)}). Peak demand (${peakP.toFixed(1)} kW) is significantly higher than average consumption (${avgP.toFixed(1)} kW), indicating high demand surges with low utilization.`
    );
  }

  if (avgPf < 0.85) {
    observations.push(
      `Poor average power factor (${avgPf.toFixed(3)}) below CEB threshold (0.85). Low-PF duration observed for ${lowPfMinutes.toFixed(1)} minutes (${lowPfReadings} cycles), indicating inductive motor loading.`
    );
  } else if (lowPfMinutes > 10.0) {
    observations.push(
      `Intermittent low power factor observed: PF fell below 0.85 for ${lowPfMinutes.toFixed(1)} minutes during the monitored window.`
    );
  }

  if (afterHoursPct > 35.0) {
    observations.push(
      `High after-hours energy proportion: ${afterHoursKwh.toFixed(2)} kWh (${afterHoursPct.toFixed(1)}% of total) was consumed outside faculty standard operating hours (08:00 - 17:00 / Weekends).`
    );
  } else if (afterHoursKwh > 0) {
    observations.push(
      `After-hours energy consumed: ${afterHoursKwh.toFixed(2)} kWh (${afterHoursPct.toFixed(1)}% of total) outside operating hours.`
    );
  }

  const ratedPower = buildingInfo ? Number(buildingInfo.rated_power_kw) || 50.0 : 50.0;
  if (peakP > 0.90 * ratedPower) {
    observations.push(
      `High peak active power demand: Peak reached ${peakP.toFixed(1)} kW (${((peakP / ratedPower) * 100.0).toFixed(1)}% of configured capacity ${ratedPower.toFixed(1)} kW).`
    );
  }

  if (baselineStats && baselineStats.lifetime_avg_power_kw > 0) {
    const baseAvgP = baselineStats.lifetime_avg_power_kw;
    const pDiffPct = ((avgP - baseAvgP) / baseAvgP) * 100.0;
    if (pDiffPct > 15.0) {
      observations.push(
        `Elevated demand relative to historical baseline: Average power is +${pDiffPct.toFixed(1)}% higher than this building's long-term historical mean (${baseAvgP.toFixed(1)} kW).`
      );
    } else if (pDiffPct < -15.0) {
      observations.push(
        `Reduced demand relative to historical baseline: Average power is ${pDiffPct.toFixed(1)}% lower than this building's long-term historical mean (${baseAvgP.toFixed(1)} kW).`
      );
    }
  }

  if (observations.length === 0) {
    observations.push('Electrical operating parameters are within standard engineering thresholds.');
  }

  // Energy efficiency score calculation (0 - 100)
  const lfScore = Math.min(loadFactor / 0.70, 1.0) * 35.0;
  const pfScore = (Math.max(avgPf - 0.70, 0.0) / 0.25) * 35.0;
  const ahScore = Math.max(0.0, 1.0 - (afterHoursPct / 50.0)) * 30.0;
  const efficiencyScore = Math.round(Math.min(Math.max(lfScore + pfScore + ahScore, 10.0), 100.0) * 10) / 10;

  let performanceStatus = 'ACCEPTABLE';
  if (efficiencyScore >= 80.0) {
    performanceStatus = 'OPTIMAL';
  } else if (efficiencyScore >= 60.0) {
    performanceStatus = 'ACCEPTABLE';
  } else if (efficiencyScore >= 40.0) {
    performanceStatus = 'NEEDS_ATTENTION';
  } else {
    performanceStatus = 'INEFFICIENT';
  }

  return {
    readings_count: n,
    total_energy_kwh: Math.round(totalEnergyKwh * 1000) / 1000,
    avg_demand_kw: Math.round(avgP * 100) / 100,
    peak_demand_kw: Math.round(peakP * 100) / 100,
    load_factor: Math.round(loadFactor * 1000) / 1000,
    load_factor_pct: Math.round(loadFactor * 1000) / 10,
    avg_power_factor: Math.round(avgPf * 1000) / 1000,
    low_pf_duration_minutes: Math.round(lowPfMinutes * 10) / 10,
    low_pf_readings_count: lowPfReadings,
    after_hours_kwh: Math.round(afterHoursKwh * 1000) / 1000,
    after_hours_pct: Math.round(afterHoursPct * 10) / 10,
    operating_hours_kwh: Math.round(operatingHoursKwh * 1000) / 1000,
    efficiency_score: efficiencyScore,
    performance_status: performanceStatus,
    engineering_observations: observations,
    baseline_comparison: baselineStats
  };
}

/**
 * Computes a building's historical baseline from all prior stored readings in MongoDB.
 */
async function getBuildingHistoricalBaseline(buildingId) {
  const query = {};
  if (mongoose.Types.ObjectId.isValid(buildingId)) {
    query.building_id = mongoose.Types.ObjectId(buildingId);
  } else {
    query.building_code = String(buildingId).trim().toUpperCase();
  }

  const readings = await EnergyReading.find(query, { active_power_kw: 1, power_factor: 1, voltage: 1 }).lean();
  if (!readings || readings.length === 0) return null;

  const total = readings.length;
  const avgP = readings.reduce((a, b) => a + (Number(b.active_power_kw) || 0), 0) / total;
  const peakP = Math.max(...readings.map((r) => Number(r.active_power_kw) || 0));
  const avgPf = readings.reduce((a, b) => a + (Number(b.power_factor) || 0), 0) / total;
  const avgV = readings.reduce((a, b) => a + (Number(b.voltage) || 0), 0) / total;

  return {
    building_id: buildingId.toString(),
    baseline_samples_count: total,
    lifetime_avg_power_kw: Math.round(avgP * 100) / 100,
    lifetime_peak_power_kw: Math.round(peakP * 100) / 100,
    lifetime_avg_pf: Math.round(avgPf * 1000) / 1000,
    lifetime_avg_voltage: Math.round(avgV * 10) / 10
  };
}

/**
 * Computes synchronized campus-wide electrical parameters across simultaneous readings.
 */
async function getCampusSynchronizedMetrics(start, end) {
  const normStart = normalizeTimestamp(start, false);
  const normEnd = normalizeTimestamp(end, true);

  const query = {};
  if (normStart || normEnd) {
    query.timestamp = {};
    if (normStart) query.timestamp.$gte = new Date(normStart);
    if (normEnd) query.timestamp.$lte = new Date(normEnd);
  }

  const readings = await EnergyReading.find(query).sort({ timestamp: 1 }).lean();
  if (!readings || readings.length === 0) {
    return {
      samples_count: 0,
      avg_active_power_kw: 0.0,
      peak_active_power_kw: 0.0,
      load_factor: 0.0,
      load_factor_pct: 0.0,
      avg_apparent_power_kva: null,
      avg_reactive_power_kvar: null,
      avg_power_factor: null,
      min_power_factor: null,
      avg_voltage: null,
      min_voltage: null,
      max_voltage: null,
      avg_frequency: null
    };
  }

  // Group readings by timestamp (using ISO string or formatted second)
  const timestampGroups = {};
  for (const r of readings) {
    const tKey = r.timestamp instanceof Date ? r.timestamp.toISOString() : String(r.timestamp);
    if (!timestampGroups[tKey]) {
      timestampGroups[tKey] = {
        total_p: 0,
        total_q: 0,
        voltages: [],
        frequencies: [],
        pfs: []
      };
    }
    timestampGroups[tKey].total_p += Number(r.active_power_kw) || 0;
    timestampGroups[tKey].total_q += Number(r.reactive_power_kvar) || 0;
    if (r.voltage !== undefined) timestampGroups[tKey].voltages.push(Number(r.voltage));
    if (r.frequency !== undefined) timestampGroups[tKey].frequencies.push(Number(r.frequency));
    if (r.power_factor !== undefined) timestampGroups[tKey].pfs.push(Number(r.power_factor));
  }

  const groupKeys = Object.keys(timestampGroups);
  const m = groupKeys.length;

  const totalPList = groupKeys.map((k) => timestampGroups[k].total_p);
  const totalQList = groupKeys.map((k) => timestampGroups[k].total_q);

  const peakP = Math.max(...totalPList);
  const avgP = totalPList.reduce((a, b) => a + b, 0) / m;
  const avgQ = totalQList.reduce((a, b) => a + b, 0) / m;

  const avgS = Math.sqrt(Math.max(0, avgP ** 2 + avgQ ** 2));
  const avgPf = avgS > 0 ? avgP / avgS : 0.0;

  const allPfs = readings.map((r) => Number(r.power_factor)).filter((x) => !isNaN(x));
  const minPf = allPfs.length > 0 ? Math.min(...allPfs) : avgPf;

  let loadFactor = peakP > 0 ? avgP / peakP : 0.0;
  loadFactor = Math.max(0.0, Math.min(1.0, loadFactor));

  const allV = readings.map((r) => Number(r.voltage)).filter((x) => !isNaN(x));
  const avgV = allV.length > 0 ? allV.reduce((a, b) => a + b, 0) / allV.length : 400.0;
  const minV = allV.length > 0 ? Math.min(...allV) : 395.0;
  const maxV = allV.length > 0 ? Math.max(...allV) : 405.0;

  const allF = readings.map((r) => Number(r.frequency)).filter((x) => !isNaN(x));
  const avgF = allF.length > 0 ? allF.reduce((a, b) => a + b, 0) / allF.length : 50.0;

  return {
    samples_count: m,
    avg_active_power_kw: Math.round(avgP * 100) / 100,
    peak_active_power_kw: Math.round(peakP * 100) / 100,
    load_factor: Math.round(loadFactor * 1000) / 1000,
    load_factor_pct: Math.round(loadFactor * 1000) / 10,
    avg_apparent_power_kva: Math.round(avgS * 100) / 100,
    avg_reactive_power_kvar: Math.round(avgQ * 100) / 100,
    avg_power_factor: Math.round(avgPf * 1000) / 1000,
    min_power_factor: Math.round(minPf * 1000) / 1000,
    avg_voltage: Math.round(avgV * 10) / 10,
    min_voltage: Math.round(minV * 10) / 10,
    max_voltage: Math.round(maxV * 10) / 10,
    avg_frequency: Math.round(avgF * 100) / 100
  };
}

/**
 * Computes electrical analytics for a specific building or multi-building comparison.
 */
async function getEnergyAnalytics(buildingId = 'all', start = null, end = null) {
  const allBuildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });

  // Single building mode
  if (buildingId && String(buildingId).trim().toLowerCase() !== 'all') {
    const bStr = String(buildingId).trim();
    const selectedBldg = await resolveBuilding(buildingId, allBuildings);

    const targetId = selectedBldg ? selectedBldg._id : bStr;
    const readings = await getFilteredEnergyHistory(targetId, start, end, 5000, true);
    const stats = calculateBuildingAnalytics(readings);

    return {
      mode: 'single',
      building_id: selectedBldg ? selectedBldg._id.toString() : bStr,
      building_code: selectedBldg ? selectedBldg.code : (bStr.toUpperCase()),
      building_name: selectedBldg ? selectedBldg.name : 'Unknown',
      start: normalizeTimestamp(start),
      end: normalizeTimestamp(end, true),
      analytics: stats
    };
  }

  // Multi-building campus comparison mode
  const comparison = [];
  let campusTotalEnergy = 0.0;
  const campusActivePowers = [];
  const campusPfs = [];

  for (const b of allBuildings) {
    const bReadings = await getFilteredEnergyHistory(b._id, start, end, 5000, true);
    const bStats = calculateBuildingAnalytics(bReadings);

    comparison.push({
      building_id: b._id.toString(),
      building_code: b.code,
      building_name: b.name,
      total_energy_kwh: bStats.total_energy_kwh,
      peak_active_power_kw: bStats.peak_active_power_kw,
      avg_active_power_kw: bStats.avg_active_power_kw,
      avg_power_factor: bStats.avg_power_factor,
      load_factor: bStats.load_factor,
      load_factor_pct: bStats.load_factor_pct,
      readings_count: bStats.readings_count
    });

    campusTotalEnergy += bStats.total_energy_kwh;
    if (bStats.readings_count > 0) {
      campusActivePowers.push(bStats.avg_active_power_kw);
      if (bStats.avg_power_factor !== null) {
        campusPfs.push(bStats.avg_power_factor);
      }
    }
  }

  const campusAvgPower = campusActivePowers.length > 0 ? campusActivePowers.reduce((a, b) => a + b, 0) : 0.0;
  const campusAvgPf = campusPfs.length > 0 ? campusPfs.reduce((a, b) => a + b, 0) / campusPfs.length : 0.0;
  const campusPeakPower = comparison.length > 0 ? Math.max(...comparison.map((c) => c.peak_active_power_kw)) : 0.0;
  const sumPeakPowers = comparison.reduce((a, b) => a + b.peak_active_power_kw, 0);
  const campusLoadFactor = sumPeakPowers > 0 ? campusAvgPower / sumPeakPowers : 0.0;

  return {
    mode: 'comparison',
    start: normalizeTimestamp(start),
    end: normalizeTimestamp(end, true),
    campus_summary: {
      total_energy_kwh: Math.round(campusTotalEnergy * 1000) / 1000,
      avg_active_power_kw: Math.round(campusAvgPower * 100) / 100,
      peak_active_power_kw: Math.round(campusPeakPower * 100) / 100,
      avg_power_factor: Math.round(campusAvgPf * 1000) / 1000,
      load_factor: Math.round(campusLoadFactor * 1000) / 1000,
      load_factor_pct: Math.round(campusLoadFactor * 1000) / 10,
      building_count: allBuildings.length
    },
    comparison
  };
}

/**
 * Unified cost and efficiency analytics service.
 */
async function getCostAndEfficiencyAnalytics(buildingId = 'all', start = null, end = null) {
  const allBuildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });
  const tariff = await getActiveTariff();
  const settings = await getFacultySettings();

  const normStart = normalizeTimestamp(start, false);
  const normEnd = normalizeTimestamp(end, true);

  let durationSeconds = 86400.0;
  if (normStart && normEnd) {
    const tS = new Date(normStart).getTime();
    const tE = new Date(normEnd).getTime();
    if (tE > tS) {
      durationSeconds = (tE - tS) / 1000.0;
    }
  }

  // Single building mode
  if (buildingId && String(buildingId).trim().toLowerCase() !== 'all') {
    const bStr = String(buildingId).trim();
    const selectedBldg = await resolveBuilding(buildingId, allBuildings);

    const targetId = selectedBldg ? selectedBldg._id : bStr;
    const readings = await getFilteredEnergyHistory(targetId, start, end, 5000, true);

    const eff = await calculateBuildingEfficiency(readings, selectedBldg, settings);
    const cost = calculateBuildingCost(eff.total_energy_kwh, eff.peak_demand_kw, durationSeconds, tariff);

    return {
      mode: 'single',
      building_id: selectedBldg ? selectedBldg._id.toString() : bStr,
      building_code: selectedBldg ? selectedBldg.code : (bStr.toUpperCase()),
      building_name: selectedBldg ? selectedBldg.name : 'Unknown',
      rated_power_kw: selectedBldg ? Number(selectedBldg.rated_power_kw) || 50.0 : 50.0,
      start: normStart,
      end: normEnd,
      cost,
      efficiency: eff,
      tariff
    };
  }

  // Campus comparison mode
  const comparison = [];
  let campusTotalKwh = 0.0;
  let campusAfterHoursKwh = 0.0;
  let campusTotalCost = 0.0;
  let campusEnergyCharges = 0.0;
  let campusDemandCharges = 0.0;
  let campusFixedCharges = 0.0;

  for (const b of allBuildings) {
    const bReadings = await getFilteredEnergyHistory(b._id, start, end, 5000, true);
    const bEff = await calculateBuildingEfficiency(bReadings, b, settings);
    const bCost = calculateBuildingCost(bEff.total_energy_kwh, bEff.peak_demand_kw, durationSeconds, tariff);

    comparison.push({
      building_id: b._id.toString(),
      building_code: b.code,
      building_name: b.name,
      rated_power_kw: Number(b.rated_power_kw) || 50.0,
      total_kwh: bEff.total_energy_kwh,
      estimated_cost_lkr: bCost.estimated_total_cost_lkr,
      energy_charge_lkr: bCost.estimated_energy_charge_lkr,
      demand_charge_lkr: bCost.estimated_demand_charge_lkr,
      peak_demand_kw: bEff.peak_demand_kw,
      avg_demand_kw: bEff.avg_demand_kw,
      load_factor: bEff.load_factor,
      load_factor_pct: bEff.load_factor_pct,
      avg_power_factor: bEff.avg_power_factor,
      after_hours_kwh: bEff.after_hours_kwh,
      after_hours_pct: bEff.after_hours_pct,
      efficiency_score: bEff.efficiency_score,
      performance_status: bEff.performance_status,
      readings_count: bEff.readings_count,
      engineering_observations: bEff.engineering_observations
    });

    campusTotalKwh += bEff.total_energy_kwh;
    campusAfterHoursKwh += bEff.after_hours_kwh;
    campusTotalCost += bCost.estimated_total_cost_lkr;
    campusEnergyCharges += bCost.estimated_energy_charge_lkr;
    campusDemandCharges += bCost.estimated_demand_charge_lkr;
    campusFixedCharges += bCost.estimated_fixed_charge_lkr;
  }

  // Rank buildings by efficiency score descending
  const rankedComparison = [...comparison].sort((a, b) => b.efficiency_score - a.efficiency_score);
  rankedComparison.forEach((item, idx) => {
    item.efficiency_rank = idx + 1;
  });

  const syncMetrics = await getCampusSynchronizedMetrics(start, end);
  const campusAfterHoursPct = campusTotalKwh > 0 ? (campusAfterHoursKwh / campusTotalKwh) * 100.0 : 0.0;

  return {
    mode: 'comparison',
    start: normStart,
    end: normEnd,
    tariff,
    campus_summary: {
      total_kwh: Math.round(campusTotalKwh * 1000) / 1000,
      estimated_cost_lkr: Math.round(campusTotalCost * 100) / 100,
      estimated_energy_charge_lkr: Math.round(campusEnergyCharges * 100) / 100,
      estimated_demand_charge_lkr: Math.round(campusDemandCharges * 100) / 100,
      estimated_fixed_charge_lkr: Math.round(campusFixedCharges * 100) / 100,
      peak_demand_kw: syncMetrics.peak_active_power_kw,
      avg_demand_kw: syncMetrics.avg_active_power_kw,
      avg_apparent_power_kva: syncMetrics.avg_apparent_power_kva,
      avg_reactive_power_kvar: syncMetrics.avg_reactive_power_kvar,
      load_factor: syncMetrics.load_factor,
      load_factor_pct: syncMetrics.load_factor_pct,
      avg_power_factor: syncMetrics.avg_power_factor,
      min_power_factor: syncMetrics.min_power_factor,
      avg_voltage: syncMetrics.avg_voltage,
      min_voltage: syncMetrics.min_voltage,
      max_voltage: syncMetrics.max_voltage,
      avg_frequency: syncMetrics.avg_frequency,
      after_hours_kwh: Math.round(campusAfterHoursKwh * 1000) / 1000,
      after_hours_pct: Math.round(campusAfterHoursPct * 10) / 10,
      building_count: allBuildings.length,
      is_estimate: true,
      disclaimer: 'Cost estimates use a configurable demonstration tariff model and are not an official CEB bill.'
    },
    comparison,
    ranked_comparison: rankedComparison
  };
}

/**
 * Generates comprehensive energy audit summary report containing all 16 metrics.
 */
async function getComprehensiveEnergyReport(buildingId = 'all', start = null, end = null) {
  const allBuildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });
  const tariff = await getActiveTariff();
  const settings = await getFacultySettings();

  const normStart = normalizeTimestamp(start, false);
  const normEnd = normalizeTimestamp(end, true);

  let durationSeconds = 86400.0;
  if (normStart && normEnd) {
    const tS = new Date(normStart).getTime();
    const tE = new Date(normEnd).getTime();
    if (tE > tS) {
      durationSeconds = (tE - tS) / 1000.0;
    }
  }

  // Case 1: Single Building Report
  if (buildingId && String(buildingId).trim().toLowerCase() !== 'all') {
    const bStr = String(buildingId).trim();
    const selectedBldg = await resolveBuilding(buildingId, allBuildings);

    const targetId = selectedBldg ? selectedBldg._id : bStr;
    const readings = await getFilteredEnergyHistory(targetId, start, end, 5000, true);

    const analytics = calculateBuildingAnalytics(readings);
    const efficiency = await calculateBuildingEfficiency(readings, selectedBldg, settings);
    const cost = calculateBuildingCost(efficiency.total_energy_kwh, efficiency.peak_demand_kw, durationSeconds, tariff);

    // Count alerts in period
    const alertQuery = {
      $or: [{ building_id: selectedBldg ? selectedBldg._id : targetId }, { building_code: selectedBldg ? selectedBldg.code : '' }]
    };
    if (normStart || normEnd) {
      alertQuery.timestamp = {};
      if (normStart) alertQuery.timestamp.$gte = new Date(normStart);
      if (normEnd) alertQuery.timestamp.$lte = new Date(normEnd);
    }

    const [warningCount, criticalCount, totalAlertsCount, recentAlerts] = await Promise.all([
      Alert.countDocuments({ ...alertQuery, severity: 'WARNING' }),
      Alert.countDocuments({ ...alertQuery, severity: 'CRITICAL' }),
      Alert.countDocuments(alertQuery),
      Alert.find(alertQuery).sort({ timestamp: -1 }).limit(10).lean()
    ]);

    return {
      mode: 'single',
      report_title: `Electrical Energy Audit & Performance Report - ${selectedBldg ? selectedBldg.name : 'Facility'}`,
      generated_at: formatTimestamp(new Date()),
      building_id: selectedBldg ? selectedBldg._id.toString() : bStr,
      building_code: selectedBldg ? selectedBldg.code : 'GEN',
      building_name: selectedBldg ? selectedBldg.name : 'Unknown Facility',
      rated_power_kw: selectedBldg ? Number(selectedBldg.rated_power_kw) || 50.0 : 50.0,
      reporting_period: {
        start: normStart,
        end: normEnd,
        duration_days: Math.round((durationSeconds / 86400.0) * 100) / 100
      },
      metrics: {
        total_energy_kwh: efficiency.total_energy_kwh,
        avg_active_power_kw: analytics.avg_active_power_kw,
        peak_demand_kw: efficiency.peak_demand_kw,
        min_active_power_kw: analytics.min_active_power_kw,
        avg_apparent_power_kva: analytics.avg_apparent_power_kva,
        avg_reactive_power_kvar: analytics.avg_reactive_power_kvar,
        avg_power_factor: efficiency.avg_power_factor,
        min_power_factor: analytics.min_power_factor,
        load_factor: efficiency.load_factor,
        load_factor_pct: efficiency.load_factor_pct,
        avg_voltage: analytics.avg_voltage,
        min_voltage: analytics.min_voltage,
        max_voltage: analytics.max_voltage,
        avg_frequency: analytics.avg_frequency,
        after_hours_kwh: efficiency.after_hours_kwh,
        after_hours_pct: efficiency.after_hours_pct,
        operating_hours_kwh: efficiency.operating_hours_kwh,
        estimated_electricity_cost_lkr: cost.estimated_total_cost_lkr,
        estimated_energy_charge_lkr: cost.estimated_energy_charge_lkr,
        estimated_demand_charge_lkr: cost.estimated_demand_charge_lkr,
        estimated_fixed_charge_lkr: cost.estimated_fixed_charge_lkr,
        warning_alerts_count: warningCount,
        critical_alerts_count: criticalCount,
        total_alerts_count: totalAlertsCount,
        readings_count: readings.length
      },
      efficiency_score: efficiency.efficiency_score,
      performance_status: efficiency.performance_status,
      engineering_observations: efficiency.engineering_observations,
      important_alerts: recentAlerts.map((a) => ({
        ...a,
        id: a.id || a._id.toString(),
        timestamp: formatTimestamp(a.timestamp)
      })),
      tariff,
      is_simulated: true,
      simulation_note: 'Measurements used in this prototype are simulated.',
      disclaimer: 'Cost estimates use a configurable demonstration tariff model and are not an official CEB bill.'
    };
  }

  // Case 2: Campus-Wide Report
  const costEffRes = await getCostAndEfficiencyAnalytics('all', start, end);
  const campusSum = costEffRes.campus_summary;
  const comparison = costEffRes.comparison;
  const rankedComparison = costEffRes.ranked_comparison;

  const campusAlertQuery = {};
  if (normStart || normEnd) {
    campusAlertQuery.timestamp = {};
    if (normStart) campusAlertQuery.timestamp.$gte = new Date(normStart);
    if (normEnd) campusAlertQuery.timestamp.$lte = new Date(normEnd);
  }

  const [campusWarnings, campusCritical, totalCampusAlerts, recentCampusAlerts] = await Promise.all([
    Alert.countDocuments({ ...campusAlertQuery, severity: 'WARNING' }),
    Alert.countDocuments({ ...campusAlertQuery, severity: 'CRITICAL' }),
    Alert.countDocuments(campusAlertQuery),
    Alert.find(campusAlertQuery).sort({ timestamp: -1 }).limit(15).lean()
  ]);

  const campusObservations = [];
  if (campusSum.avg_power_factor !== null && campusSum.avg_power_factor < 0.85) {
    campusObservations.push(
      `Poor campus-wide average power factor (${campusSum.avg_power_factor.toFixed(3)}) below CEB statutory minimum (0.85). Reactive current compensation recommended.`
    );
  }
  if (campusSum.after_hours_pct !== null && campusSum.after_hours_pct > 25.0) {
    campusObservations.push(
      `Significant campus after-hours energy usage: ${campusSum.after_hours_kwh.toFixed(2)} kWh (${campusSum.after_hours_pct.toFixed(1)}% of campus consumption) occurred outside faculty operational hours.`
    );
  }
  const highestPeakB = comparison.length > 0 ? [...comparison].sort((a, b) => b.peak_demand_kw - a.peak_demand_kw)[0] : null;
  if (highestPeakB && highestPeakB.peak_demand_kw > 0) {
    campusObservations.push(
      `High peak active demand contributor: ${highestPeakB.building_name} reached ${highestPeakB.peak_demand_kw.toFixed(1)} kW individual peak demand, driving facility demand charges.`
    );
  }
  if (campusSum.peak_demand_kw > 0 && campusSum.load_factor_pct !== null) {
    campusObservations.push(
      `Coincident campus peak demand reached ${campusSum.peak_demand_kw.toFixed(1)} kW with an overall campus load factor of ${campusSum.load_factor_pct.toFixed(1)}%.`
    );
  }
  if (campusCritical > 0) {
    campusObservations.push(
      `Voltage/Overload abnormality events: ${campusCritical} critical electrical alerts were triggered across faculty complexes during this reporting period.`
    );
  }
  if (campusObservations.length === 0) {
    campusObservations.push('All engineering facilities operated within standard electrical tolerances during the reporting period.');
  }

  return {
    mode: 'campus_summary',
    report_title: 'Faculty of Engineering Campus-Wide Smart Energy Audit Report',
    generated_at: formatTimestamp(new Date()),
    building_id: 'all',
    building_code: 'ALL',
    building_name: 'Faculty of Engineering (All Buildings)',
    reporting_period: {
      start: normStart,
      end: normEnd,
      duration_days: Math.round((durationSeconds / 86400.0) * 100) / 100
    },
    metrics: {
      total_energy_kwh: campusSum.total_kwh,
      avg_active_power_kw: campusSum.avg_demand_kw,
      peak_demand_kw: campusSum.peak_demand_kw,
      min_active_power_kw: 0.0,
      avg_apparent_power_kva: campusSum.avg_apparent_power_kva,
      avg_reactive_power_kvar: campusSum.avg_reactive_power_kvar,
      avg_power_factor: campusSum.avg_power_factor,
      min_power_factor: campusSum.min_power_factor,
      load_factor: campusSum.load_factor,
      load_factor_pct: campusSum.load_factor_pct,
      avg_voltage: campusSum.avg_voltage,
      min_voltage: campusSum.min_voltage,
      max_voltage: campusSum.max_voltage,
      avg_frequency: campusSum.avg_frequency,
      after_hours_kwh: campusSum.after_hours_kwh,
      after_hours_pct: campusSum.after_hours_pct,
      operating_hours_kwh: Math.max(0, campusSum.total_kwh - campusSum.after_hours_kwh),
      estimated_electricity_cost_lkr: campusSum.estimated_cost_lkr,
      estimated_energy_charge_lkr: campusSum.estimated_energy_charge_lkr,
      estimated_demand_charge_lkr: campusSum.estimated_demand_charge_lkr,
      estimated_fixed_charge_lkr: campusSum.estimated_fixed_charge_lkr,
      warning_alerts_count: campusWarnings,
      critical_alerts_count: campusCritical,
      total_alerts_count: totalCampusAlerts,
      building_count: allBuildings.length
    },
    campus_summary: campusSum,
    comparison,
    building_breakdown: comparison,
    ranked_comparison: rankedComparison,
    engineering_observations: campusObservations,
    important_alerts: recentCampusAlerts.map((a) => ({
      ...a,
      id: a.id || a._id.toString(),
      timestamp: formatTimestamp(a.timestamp)
    })),
    tariff,
    is_simulated: true,
    simulation_note: 'Measurements used in this prototype are simulated.',
    disclaimer: 'Cost estimates use a configurable demonstration tariff model and are not an official CEB bill.'
  };
}

module.exports = {
  formatTimestamp,
  parseTimestampStr,
  normalizeTimestamp,
  getColomboDateTime,
  isTimestampAfterHours,
  getActiveTariff,
  getAllTariffs,
  updateTariffConfiguration,
  getFacultySettings,
  updateFacultySetting,
  resolveBuilding,
  getFilteredEnergyHistory,
  calculateBuildingAnalytics,
  calculateBuildingCost,
  calculateBuildingEfficiency,
  getBuildingHistoricalBaseline,
  getCampusSynchronizedMetrics,
  getEnergyAnalytics,
  getCostAndEfficiencyAnalytics,
  getComprehensiveEnergyReport
};
