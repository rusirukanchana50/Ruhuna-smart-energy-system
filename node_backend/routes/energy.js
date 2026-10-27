/**
 * routes/energy.js
 * ----------------
 * Express router handling live and historical energy monitoring telemetry,
 * analytics, cost estimation, and efficiency ratings for Ruhuna Smart Energy System.
 * 
 * Endpoints:
 * - GET /api/energy/live                 : Retrieves latest 3-phase readings and active alerts for campus buildings.
 * - GET /api/energy/history              : Stored readings filtered by building and timestamps.
 * - GET /api/energy/analytics            : Computes electrical analytics (kWh, load factor, powers, PF, V, F).
 * - GET /api/energy/cost                 : Demonstration tariff cost estimation (energy, demand, fixed charges).
 * - GET /api/energy/efficiency           : Power factor, load factor, after-hours usage, efficiency score.
 * - GET /api/energy/efficiency/comparison: Multi-building comparative efficiency metrics and rankings.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Building = require('../models/Building');
const EnergyReading = require('../models/EnergyReading');
const Alert = require('../models/Alert');
const { requireAuth } = require('../middleware/auth');
const {
  formatTimestamp,
  getFilteredEnergyHistory,
  getEnergyAnalytics,
  getCostAndEfficiencyAnalytics
} = require('../services/analyticsService');

/**
 * Validates building_id query parameter.
 * Returns true if valid (integer string, ObjectId, building code, or 'all').
 */
function isValidBuildingParam(val) {
  if (val === undefined || val === null) return false;
  const s = String(val).trim();
  if (!s) return false;
  const lower = s.toLowerCase();
  if (lower === 'all' || lower === 'none') return true;
  if (/^\d+$/.test(s)) return true;
  if (mongoose.Types.ObjectId.isValid(s) && s.length === 24) return true;
  if (/^[A-Za-z0-9_-]{2,20}$/.test(s)) return true;
  return false;
}

/**
 * GET /api/energy/live
 * Protected endpoint: Retrieves the latest three-phase reading for all buildings from MongoDB.
 * Formatted to match dashboard.js expectations.
 */
router.get('/api/energy/live', requireAuth, async (req, res) => {
  try {
    const buildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });

    // Fetch all active alerts once to map to buildings
    const activeAlertDocs = await Alert.find({ is_active: true }).lean();
    const buildingAlertsMap = {};
    for (const a of activeAlertDocs) {
      const bId = a.building_id ? a.building_id.toString() : '';
      if (!buildingAlertsMap[bId]) {
        buildingAlertsMap[bId] = [];
      }
      buildingAlertsMap[bId].push({
        severity: a.severity,
        alert_type: a.alert_type,
        message: a.message
      });
    }

    const readings = [];
    let latestTimestamp = null;

    for (const b of buildings) {
      const bId = b._id.toString();
      const latestReading = await EnergyReading.findOne({
        $or: [{ building_id: b._id }, { building_code: b.code }]
      }).sort({ timestamp: -1, _id: -1 }).lean();

      if (latestReading && latestReading.timestamp) {
        if (!latestTimestamp || new Date(latestReading.timestamp) > new Date(latestTimestamp)) {
          latestTimestamp = latestReading.timestamp;
        }
      }

      const activeList = buildingAlertsMap[bId] || [];
      let activeSeverity = null;
      if (activeList.some((a) => a.severity === 'CRITICAL')) {
        activeSeverity = 'CRITICAL';
      } else if (activeList.some((a) => a.severity === 'WARNING')) {
        activeSeverity = 'WARNING';
      } else if (activeList.some((a) => a.severity === 'INFO')) {
        activeSeverity = 'INFO';
      }

      readings.push({
        building_id: bId,
        building_name: b.name,
        building_code: b.code,
        description: b.description || '',
        rated_power_kw: b.rated_power_kw || 50.0,
        reading_id: latestReading ? latestReading._id.toString() : null,
        timestamp: latestReading ? formatTimestamp(latestReading.timestamp) : null,
        voltage: latestReading ? latestReading.voltage : 0,
        current: latestReading ? latestReading.current : 0,
        power_factor: latestReading ? latestReading.power_factor : 0,
        frequency: latestReading ? latestReading.frequency : 0,
        apparent_power_kva: latestReading ? latestReading.apparent_power_kva : 0,
        active_power_kw: latestReading ? latestReading.active_power_kw : 0,
        reactive_power_kvar: latestReading ? latestReading.reactive_power_kvar : 0,
        energy_kwh: latestReading ? latestReading.energy_kwh : 0,
        is_simulated: latestReading ? (latestReading.is_simulated ? 1 : 0) : 1,
        active_alerts_count: activeList.length,
        active_alerts: activeList,
        active_severity: activeSeverity
      });
    }

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      timestamp: latestTimestamp ? formatTimestamp(latestTimestamp) : null,
      count: readings.length,
      data: readings
    });
  } catch (err) {
    console.error('[Energy API] Live energy fetch error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve live energy telemetry: ' + err.message
    });
  }
});

/**
 * GET /api/energy/history
 * Protected endpoint: Retrieves stored energy readings filtered by building_id,
 * start timestamp, and end timestamp.
 */
router.get('/api/energy/history', requireAuth, async (req, res) => {
  try {
    const rawBldgId = req.query.building_id;
    if (!rawBldgId) {
      return res.status(400).json({
        status: 'error',
        message: "Query parameter 'building_id' is required (e.g. ?building_id=1 or ?building_id=all)."
      });
    }

    const cleanBldg = String(rawBldgId).trim().toLowerCase();
    if (cleanBldg !== 'all' && cleanBldg !== '' && cleanBldg !== 'none') {
      if (!isValidBuildingParam(rawBldgId)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid building_id: '${rawBldgId}'. Must be an integer ID or 'all'.`
        });
      }
    }

    const start = req.query.start || null;
    const end = req.query.end || null;
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit)) limit = 500;
    limit = Math.min(Math.max(1, limit), 5000);

    const history = await getFilteredEnergyHistory(
      rawBldgId,
      start,
      end,
      limit,
      true
    );

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      building_id: /^\d+$/.test(rawBldgId) ? parseInt(rawBldgId, 10) : (rawBldgId || 'all'),
      start,
      end,
      count: history.length,
      data: history
    });
  } catch (err) {
    console.error('[Energy API] History fetch error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * GET /api/energy/analytics
 * Protected endpoint: Computes electrical analytics for the selected building (or campus-wide)
 * over the selected time period:
 *   - Total energy consumed (kWh)
 *   - Average, Peak, and Min Active Power (kW)
 *   - Load Factor = Average Active Power / Peak Active Power
 *   - Average Apparent Power (kVA), Average Reactive Power (kVAr)
 *   - Average and Min Power Factor
 *   - Voltage and Frequency statistics
 *   - Multi-building comparison metrics when building_id=all or omitted
 */
router.get('/api/energy/analytics', requireAuth, async (req, res) => {
  try {
    const rawBldgId = req.query.building_id || 'all';
    const cleanBldg = String(rawBldgId).trim().toLowerCase();
    if (cleanBldg !== 'all' && cleanBldg !== '' && cleanBldg !== 'none') {
      if (!isValidBuildingParam(rawBldgId)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid building_id: '${rawBldgId}'. Must be an integer ID or 'all'.`
        });
      }
    }

    const start = req.query.start || null;
    const end = req.query.end || null;

    const analyticsData = await getEnergyAnalytics(rawBldgId, start, end);

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      ...analyticsData
    });
  } catch (err) {
    console.error('[Energy API] Analytics error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * GET /api/energy/cost
 * Protected endpoint: Computes estimated electricity cost using a demonstration tariff model:
 *   - energy consumed (kWh)
 *   - estimated energy charge (LKR)
 *   - peak demand (kW)
 *   - estimated demand charge (LKR)
 *   - fixed charge where applicable (LKR)
 *   - estimated total cost (LKR)
 *   - tariff name
 *   - indication that the value is an estimate (disclaimer)
 */
router.get('/api/energy/cost', requireAuth, async (req, res) => {
  try {
    const rawBldgId = req.query.building_id || 'all';
    const cleanBldg = String(rawBldgId).trim().toLowerCase();
    if (cleanBldg !== 'all' && cleanBldg !== '' && cleanBldg !== 'none') {
      if (!isValidBuildingParam(rawBldgId)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid building_id: '${rawBldgId}'. Must be an integer ID or 'all'.`
        });
      }
    }

    const start = req.query.start || null;
    const end = req.query.end || null;

    const analyticsRes = await getCostAndEfficiencyAnalytics(rawBldgId, start, end);

    if (analyticsRes.mode === 'single') {
      const costData = analyticsRes.cost;
      return res.status(200).json({
        status: 'success',
        data_source: 'SIMULATED',
        mode: 'single',
        building_id: analyticsRes.building_id,
        building_code: analyticsRes.building_code,
        building_name: analyticsRes.building_name,
        start: analyticsRes.start,
        end: analyticsRes.end,
        energy_consumed_kwh: costData.energy_consumed_kwh,
        estimated_energy_charge_lkr: costData.estimated_energy_charge_lkr,
        peak_demand_kw: costData.peak_demand_kw,
        estimated_demand_charge_lkr: costData.estimated_demand_charge_lkr,
        estimated_fixed_charge_lkr: costData.estimated_fixed_charge_lkr,
        estimated_total_cost_lkr: costData.estimated_total_cost_lkr,
        tariff_name: costData.tariff_name,
        is_estimate: true,
        disclaimer: costData.disclaimer
      });
    }

    // Campus-wide multi-building cost summary
    const campusSum = analyticsRes.campus_summary;
    const tariffObj = analyticsRes.tariff || {};
    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      mode: 'campus_summary',
      start: analyticsRes.start,
      end: analyticsRes.end,
      energy_consumed_kwh: campusSum.total_kwh,
      estimated_energy_charge_lkr: campusSum.estimated_energy_charge_lkr,
      peak_demand_kw: campusSum.peak_demand_kw,
      estimated_demand_charge_lkr: campusSum.estimated_demand_charge_lkr,
      estimated_fixed_charge_lkr: campusSum.estimated_fixed_charge_lkr,
      estimated_total_cost_lkr: campusSum.estimated_cost_lkr,
      tariff_name: tariffObj.name || 'Demonstration Institutional Tariff',
      is_estimate: true,
      disclaimer: campusSum.disclaimer,
      building_breakdown: analyticsRes.comparison.map((b) => ({
        building_id: b.building_id,
        building_code: b.building_code,
        building_name: b.building_name,
        energy_consumed_kwh: b.total_kwh,
        peak_demand_kw: b.peak_demand_kw,
        estimated_cost_lkr: b.estimated_cost_lkr
      }))
    });
  } catch (err) {
    console.error('[Energy API] Cost error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * GET /api/energy/efficiency
 * Protected endpoint: Computes electrical efficiency metrics:
 *   - average demand (kW)
 *   - peak demand (kW)
 *   - load factor (and %)
 *   - average power factor
 *   - low-PF duration (minutes)
 *   - estimated after-hours consumption (kWh and %)
 *   - energy performance status (OPTIMAL, ACCEPTABLE, NEEDS_ATTENTION, INEFFICIENT)
 *   - engineering observations
 *   - baseline comparison against building's historical mean
 */
router.get('/api/energy/efficiency', requireAuth, async (req, res) => {
  try {
    const rawBldgId = req.query.building_id || 'all';
    const cleanBldg = String(rawBldgId).trim().toLowerCase();
    if (cleanBldg !== 'all' && cleanBldg !== '' && cleanBldg !== 'none') {
      if (!isValidBuildingParam(rawBldgId)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid building_id: '${rawBldgId}'. Must be an integer ID or 'all'.`
        });
      }
    }

    const start = req.query.start || null;
    const end = req.query.end || null;

    const analyticsRes = await getCostAndEfficiencyAnalytics(rawBldgId, start, end);

    if (analyticsRes.mode === 'single') {
      const eff = analyticsRes.efficiency;
      return res.status(200).json({
        status: 'success',
        data_source: 'SIMULATED',
        mode: 'single',
        building_id: analyticsRes.building_id,
        building_code: analyticsRes.building_code,
        building_name: analyticsRes.building_name,
        rated_power_kw: analyticsRes.rated_power_kw,
        start: analyticsRes.start,
        end: analyticsRes.end,
        average_demand_kw: eff.avg_demand_kw,
        peak_demand_kw: eff.peak_demand_kw,
        load_factor: eff.load_factor,
        load_factor_pct: eff.load_factor_pct,
        average_power_factor: eff.avg_power_factor,
        low_pf_duration_minutes: eff.low_pf_duration_minutes,
        low_pf_readings_count: eff.low_pf_readings_count,
        after_hours_kwh: eff.after_hours_kwh,
        after_hours_pct: eff.after_hours_pct,
        operating_hours_kwh: eff.operating_hours_kwh,
        total_energy_kwh: eff.total_energy_kwh,
        efficiency_score: eff.efficiency_score,
        energy_performance_status: eff.performance_status,
        engineering_observations: eff.engineering_observations,
        baseline_comparison: eff.baseline_comparison
      });
    }

    // Campus comparative efficiency
    const campusSum = analyticsRes.campus_summary;
    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      mode: 'campus_summary',
      start: analyticsRes.start,
      end: analyticsRes.end,
      campus_summary: campusSum,
      comparison: analyticsRes.comparison,
      ranked_comparison: analyticsRes.ranked_comparison
    });
  } catch (err) {
    console.error('[Energy API] Efficiency error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * GET /api/energy/efficiency/comparison
 * Protected endpoint: Dedicated multi-building comparison returning for each facility:
 *   - total kWh
 *   - estimated cost (LKR)
 *   - peak demand (kW)
 *   - load factor
 *   - average PF
 *   - after-hours kWh
 *   - efficiency ranking
 */
router.get('/api/energy/efficiency/comparison', requireAuth, async (req, res) => {
  try {
    const start = req.query.start || null;
    const end = req.query.end || null;

    const analyticsRes = await getCostAndEfficiencyAnalytics('all', start, end);

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      start: analyticsRes.start,
      end: analyticsRes.end,
      campus_summary: analyticsRes.campus_summary,
      comparison: analyticsRes.comparison,
      ranked_comparison: analyticsRes.ranked_comparison,
      tariff: analyticsRes.tariff,
      disclaimer: 'Cost estimates use a configurable demonstration tariff model and are not an official CEB bill.'
    });
  } catch (err) {
    console.error('[Energy API] Comparison error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

module.exports = router;
