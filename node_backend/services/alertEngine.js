/**
 * alertEngine.js
 * --------------
 * Electrical alert detection and tracking engine for Ruhuna Smart Energy System.
 * Evaluates real-time 3-phase measurements against electrical engineering safety limits:
 * - Low Power Factor (< 0.85)
 * - Undervoltage (< 380 V) & Overvoltage (> 420 V)
 * - Frequency anomalies (< 49.5 Hz or > 50.5 Hz)
 * - Feeder High Load (> 90% rated power) & Overload (> 100% rated power)
 * - Offline sensor monitoring (> 60s silence)
 * 
 * Enforces:
 * - Duplicate suppression: Prevents duplicate active alerts for ongoing conditions.
 * - Auto-clearing: Marks alerts cleared when measurements return to safe limits.
 * - Persistent storage in MongoDB collection 'alerts'.
 */

const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const Building = require('../models/Building');
const EnergyReading = require('../models/EnergyReading');

// Configurable electrical safety thresholds
const ELECTRICAL_THRESHOLDS = {
  PF_LOW: parseFloat(process.env.THRESHOLD_PF_LOW || '0.85'),
  VOLTAGE_MIN: parseFloat(process.env.THRESHOLD_VOLTAGE_MIN || '380.0'),
  VOLTAGE_MAX: parseFloat(process.env.THRESHOLD_VOLTAGE_MAX || '420.0'),
  FREQ_MIN: parseFloat(process.env.THRESHOLD_FREQ_MIN || '49.5'),
  FREQ_MAX: parseFloat(process.env.THRESHOLD_FREQ_MAX || '50.5'),
  HIGH_LOAD_RATIO: parseFloat(process.env.THRESHOLD_HIGH_LOAD_RATIO || '0.90'),
  SENSOR_OFFLINE_SECONDS: parseFloat(process.env.THRESHOLD_SENSOR_OFFLINE || '60.0')
};

/**
 * Generates the next sequential integer ID for alerts.
 * Ensures 100% backward compatibility with client onclick handlers (e.g. acknowledgeAlert(1)).
 */
async function getNextAlertId() {
  const last = await Alert.findOne({}, { id: 1 }).sort({ id: -1 }).lean();
  if (last && typeof last.id === 'number') {
    return last.id + 1;
  }
  return 1;
}

/**
 * Triggers a new electrical alert if no active alert for (building, alert_type) already exists.
 * Duplicate suppression ensures repeated simulator cycles do not spam duplicate records.
 */
async function triggerAlert(building, alertType, severity, measuredValue, thresholdValue, message, timestamp) {
  const bldgId = building._id || building.id;
  const bldgCode = building.code ? String(building.code).trim().toUpperCase() : '';
  const bldgName = building.name || '';

  // 1. Check if an active alert already exists for this building & alert type
  const existing = await Alert.findOne({
    building_id: bldgId,
    alert_type: alertType,
    is_active: true
  });

  if (existing) {
    return existing; // Already actively tracked; suppress duplicate insertion
  }

  // 2. Assign sequential integer ID and save
  const nextId = await getNextAlertId();
  const alertTime = timestamp ? (timestamp instanceof Date ? timestamp : new Date(timestamp)) : new Date();

  const newAlert = await Alert.create({
    id: nextId,
    building_id: bldgId,
    building_code: bldgCode,
    building_name: bldgName,
    alert_type: alertType,
    severity: severity,
    measured_value: measuredValue,
    threshold_value: thresholdValue,
    message: message,
    timestamp: alertTime,
    is_active: true,
    cleared_at: null,
    acknowledged: false,
    acknowledged_by: null,
    acknowledged_at: null
  });

  return newAlert;
}

/**
 * Clears active alerts of a specific alert_type when measurements return to safe operational limits.
 */
async function clearAlert(buildingId, alertType) {
  const bldgId = buildingId._id || buildingId;
  const now = new Date();

  const result = await Alert.updateMany(
    {
      building_id: bldgId,
      alert_type: alertType,
      is_active: true
    },
    {
      $set: {
        is_active: false,
        cleared_at: now
      }
    }
  );

  return result.nModified !== undefined ? result.nModified : result.modifiedCount || 0;
}

/**
 * Evaluates a 3-phase telemetry reading against electrical engineering safety limits.
 */
async function evaluateElectricalAlerts(building, reading, timestamp) {
  const bldgId = building._id || building.id;
  const ratedKw = Number(building.rated_power_kw) || 50.0;

  const v = Number(reading.voltage || 400.0);
  const pf = Number(reading.power_factor || 0.90);
  const f = Number(reading.frequency || 50.0);
  const p = Number(reading.active_power_kw || 0.0);
  const loadPct = ratedKw > 0 ? (p / ratedKw) * 100.0 : 0.0;

  const thPfLow = ELECTRICAL_THRESHOLDS.PF_LOW;
  const thVMin = ELECTRICAL_THRESHOLDS.VOLTAGE_MIN;
  const thVMax = ELECTRICAL_THRESHOLDS.VOLTAGE_MAX;
  const thFMax = ELECTRICAL_THRESHOLDS.FREQ_MAX;
  const thFMin = ELECTRICAL_THRESHOLDS.FREQ_MIN;
  const thHighLoad = ELECTRICAL_THRESHOLDS.HIGH_LOAD_RATIO;

  // Telemetry arrived: automatically clear any active SENSOR_OFFLINE alert
  await clearAlert(bldgId, 'SENSOR_OFFLINE');

  // 1. LOW POWER FACTOR: PF < 0.85
  if (pf < thPfLow) {
    const msg = `Low Power Factor detected: ${pf.toFixed(3)} (Threshold: < ${thPfLow.toFixed(3)}). Poor phase displacement efficiency increases distribution losses and risk of utility surcharge.`;
    await triggerAlert(building, 'LOW_POWER_FACTOR', 'WARNING', Math.round(pf * 1000) / 1000, thPfLow, msg, timestamp);
  } else {
    await clearAlert(bldgId, 'LOW_POWER_FACTOR');
  }

  // 2. LOW VOLTAGE: Line voltage < 380 V (Nominal 400V -5%)
  if (v < thVMin) {
    const msg = `Severe Undervoltage condition: ${v.toFixed(1)} V (Threshold: < ${thVMin.toFixed(1)} V, -5% of 400V nominal). High risk of motor stalling, excessive current draw, and thermal overload.`;
    await triggerAlert(building, 'LOW_VOLTAGE', 'CRITICAL', Math.round(v * 10) / 10, thVMin, msg, timestamp);
  } else {
    await clearAlert(bldgId, 'LOW_VOLTAGE');
  }

  // 3. HIGH VOLTAGE: Line voltage > 420 V (Nominal 400V +5%)
  if (v > thVMax) {
    const msg = `Overvoltage condition: ${v.toFixed(1)} V (Threshold: > ${thVMax.toFixed(1)} V, +5% of 400V nominal). High risk of insulation breakdown, dielectric stress, and electronic power supply failure.`;
    await triggerAlert(building, 'HIGH_VOLTAGE', 'CRITICAL', Math.round(v * 10) / 10, thVMax, msg, timestamp);
  } else {
    await clearAlert(bldgId, 'HIGH_VOLTAGE');
  }

  // 4. HIGH FREQUENCY: Frequency > 50.5 Hz (+1% of 50 Hz nominal)
  if (f > thFMax) {
    const msg = `High grid frequency: ${f.toFixed(2)} Hz (Threshold: > ${thFMax.toFixed(2)} Hz, +1% of 50 Hz nominal). Grid generation surplus; inductive motor rotational speeds accelerated.`;
    await triggerAlert(building, 'HIGH_FREQUENCY', 'WARNING', Math.round(f * 100) / 100, thFMax, msg, timestamp);
  } else {
    await clearAlert(bldgId, 'HIGH_FREQUENCY');
  }

  // 5. LOW FREQUENCY: Frequency < 49.5 Hz (-1% of 50 Hz nominal)
  if (f < thFMin) {
    const msg = `Low grid frequency: ${f.toFixed(2)} Hz (Threshold: < ${thFMin.toFixed(2)} Hz, -1% of 50 Hz nominal). Generation deficit; risk of under-frequency load shedding (UFLS).`;
    await triggerAlert(building, 'LOW_FREQUENCY', 'WARNING', Math.round(f * 100) / 100, thFMin, msg, timestamp);
  } else {
    await clearAlert(bldgId, 'LOW_FREQUENCY');
  }

  // 6 & 7. HIGH LOAD (>90% rated power) & OVERLOAD (>100% rated power)
  if (p > ratedKw) {
    const msg = `Feeder Overload Detected: ${p.toFixed(1)} kW exceeds 100% of rated capacity (${ratedKw.toFixed(1)} kW at ${loadPct.toFixed(1)}%). High risk of protective switchgear tripping and transformer overheating.`;
    await triggerAlert(building, 'OVERLOAD', 'CRITICAL', Math.round(p * 100) / 100, Math.round(ratedKw * 100) / 100, msg, timestamp);
    await clearAlert(bldgId, 'HIGH_LOAD');
  } else if (p > thHighLoad * ratedKw) {
    const msg = `High Electrical Demand: ${p.toFixed(1)} kW (${loadPct.toFixed(1)}% of ${ratedKw.toFixed(1)} kW rated capacity). Substation feeder approaching maximum thermal safety margin.`;
    await triggerAlert(building, 'HIGH_LOAD', 'WARNING', Math.round(p * 100) / 100, Math.round(thHighLoad * ratedKw * 100) / 100, msg, timestamp);
    await clearAlert(bldgId, 'OVERLOAD');
  } else {
    await clearAlert(bldgId, 'HIGH_LOAD');
    await clearAlert(bldgId, 'OVERLOAD');
  }
}

/**
 * Checks all campus buildings for missing sensor readings (> threshold_seconds).
 * Triggers SENSOR_OFFLINE alert if sensor is silent.
 */
async function checkSensorOfflineAlerts(thresholdSeconds) {
  const limitSeconds = thresholdSeconds !== undefined ? Number(thresholdSeconds) : ELECTRICAL_THRESHOLDS.SENSOR_OFFLINE_SECONDS;
  const buildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });
  const now = new Date();
  let offlineCount = 0;

  for (const b of buildings) {
    const latestReading = await EnergyReading.findOne({
      $or: [{ building_id: b._id }, { building_code: b.code }]
    }).sort({ timestamp: -1, _id: -1 });

    if (!latestReading || !latestReading.timestamp) {
      continue;
    }

    const elapsedSeconds = (now.getTime() - new Date(latestReading.timestamp).getTime()) / 1000.0;

    if (elapsedSeconds > limitSeconds) {
      const msg = `Telemetry Sensor Offline: No data received from [${b.code}] ${b.name} for ${Math.round(elapsedSeconds)}s (Threshold: > ${Math.round(limitSeconds)}s). Substation meter communication disrupted.`;
      await triggerAlert(b, 'SENSOR_OFFLINE', 'WARNING', Math.round(elapsedSeconds * 10) / 10, limitSeconds, msg, now);
      offlineCount++;
    }
  }

  return offlineCount;
}

/**
 * Computes summary counters for active warnings, criticals, and building breakdown.
 */
async function getAlertsSummary() {
  const [activeTotal, activeWarnings, activeCritical, activeInfo, clearedTotal, totalAllTime] = await Promise.all([
    Alert.countDocuments({ is_active: true }),
    Alert.countDocuments({ is_active: true, severity: 'WARNING' }),
    Alert.countDocuments({ is_active: true, severity: 'CRITICAL' }),
    Alert.countDocuments({ is_active: true, severity: 'INFO' }),
    Alert.countDocuments({ is_active: false }),
    Alert.countDocuments({})
  ]);

  // Aggregate active alerts by building
  const activeAlerts = await Alert.find({ is_active: true }, { building_id: 1, severity: 1 }).lean();
  const byBuilding = {};

  for (const a of activeAlerts) {
    const bId = a.building_id ? a.building_id.toString() : 'unknown';
    if (!byBuilding[bId]) {
      byBuilding[bId] = {
        active_count: 0,
        critical_count: 0,
        warning_count: 0
      };
    }
    byBuilding[bId].active_count++;
    if (a.severity === 'CRITICAL') byBuilding[bId].critical_count++;
    if (a.severity === 'WARNING') byBuilding[bId].warning_count++;
  }

  return {
    active_total: activeTotal,
    active_warnings: activeWarnings,
    active_critical: activeCritical,
    active_info: activeInfo,
    cleared_total: clearedTotal,
    total_all_time: totalAllTime,
    by_building: byBuilding
  };
}

/**
 * Acknowledges an alert by an Administrator user.
 */
async function acknowledgeAlert(alertId, userName) {
  const query = {};
  if (!isNaN(Number(alertId))) {
    query.$or = [{ id: Number(alertId) }];
    if (mongoose.Types.ObjectId.isValid(alertId)) {
      query.$or.push({ _id: alertId });
    }
  } else if (mongoose.Types.ObjectId.isValid(alertId)) {
    query._id = alertId;
  } else {
    return null;
  }

  const alert = await Alert.findOne(query);
  if (!alert) {
    return null;
  }

  alert.acknowledged = true;
  alert.acknowledged_by = userName || 'Faculty Administrator';
  alert.acknowledged_at = new Date();
  await alert.save();

  return alert;
}

module.exports = {
  ELECTRICAL_THRESHOLDS,
  getNextAlertId,
  triggerAlert,
  clearAlert,
  evaluateElectricalAlerts,
  checkSensorOfflineAlerts,
  getAlertsSummary,
  acknowledgeAlert
};
