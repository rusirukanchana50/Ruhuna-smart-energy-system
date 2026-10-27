/**
 * routes/reports.js
 * -----------------
 * Express router handling comprehensive energy reports, CSV telemetry export,
 * and Administrator tariff rate configuration.
 * 
 * Endpoints:
 * - GET  /api/reports/summary    : Full 16-metric campus energy audit report.
 * - GET  /api/reports/export/csv : Streams historical readings CSV with simulated data labeling.
 * - POST /api/config/tariff      : Allows Administrators to update demonstration tariff rates (protected by CSRF).
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  formatTimestamp,
  getFilteredEnergyHistory,
  getComprehensiveEnergyReport,
  getActiveTariff,
  updateTariffConfiguration
} = require('../services/analyticsService');

/**
 * Validates building_id query parameter.
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
 * Validates tariff rates according to electrical and CEB demonstration billing rules.
 */
function validateTariffRates(energyRateInput, demandRateInput, fixedChargeInput, nameInput = '') {
  let cleanName = String(nameInput || '').trim();
  if (!cleanName) {
    cleanName = 'Demonstration Institutional Tariff (Estimated Non-Official Model)';
  } else if (cleanName.length < 3 || cleanName.length > 100) {
    throw new Error('Tariff name must be between 3 and 100 characters.');
  }

  const energyRate = Number(energyRateInput);
  if (isNaN(energyRate) || !isFinite(energyRate) || energyRate <= 0.0) {
    throw new Error('Energy rate must be a positive number greater than 0 LKR/kWh.');
  }
  if (energyRate > 1000.0) {
    throw new Error('Energy rate exceeds realistic CEB institutional maximum of 1,000 LKR/kWh.');
  }

  const demandRate = Number(demandRateInput);
  if (isNaN(demandRate) || !isFinite(demandRate) || demandRate < 0.0) {
    throw new Error('Demand rate must be a non-negative number (>= 0 LKR/kW).');
  }
  if (demandRate > 50000.0) {
    throw new Error('Demand rate exceeds realistic CEB maximum of 50,000 LKR/kW.');
  }

  const fixedCharge = Number(fixedChargeInput);
  if (isNaN(fixedCharge) || !isFinite(fixedCharge) || fixedCharge < 0.0) {
    throw new Error('Monthly fixed charge must be a non-negative number (>= 0 LKR).');
  }
  if (fixedCharge > 100000.0) {
    throw new Error('Monthly fixed charge exceeds realistic maximum of 100,000 LKR.');
  }

  return {
    name: cleanName,
    energyRate: Math.round(energyRate * 100) / 100,
    demandRate: Math.round(demandRate * 100) / 100,
    fixedCharge: Math.round(fixedCharge * 100) / 100
  };
}

/**
 * Escapes CSV field text to conform with RFC 4180.
 */
function escapeCsvField(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * GET /api/reports/summary
 * Protected endpoint: Returns full energy summary report JSON.
 * Contains all 16 required electrical, financial, alert and efficiency parameters.
 */
router.get('/api/reports/summary', requireAuth, async (req, res) => {
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

    const report = await getComprehensiveEnergyReport(rawBldgId, start, end);

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      report
    });
  } catch (err) {
    console.error('[Reports API] Summary error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * GET /api/reports/export/csv
 * Protected endpoint: Generates and streams a CSV export file containing detailed historical
 * energy telemetry records from MongoDB with complete 3-phase electrical parameters.
 */
router.get('/api/reports/export/csv', requireAuth, async (req, res) => {
  try {
    const rawBldgId = req.query.building_id || 'all';
    const start = req.query.start || null;
    const end = req.query.end || null;

    const readings = await getFilteredEnergyHistory(
      rawBldgId,
      start,
      end,
      5000,
      true
    );

    // Build CSV content
    const headers = [
      'Reading ID',
      'Building ID',
      'Building Code',
      'Building Name',
      'Timestamp',
      'Line Voltage (V)',
      'Line Current (A)',
      'Power Factor',
      'Frequency (Hz)',
      'Apparent Power (kVA)',
      'Active Power (kW)',
      'Reactive Power (kVAr)',
      'Cumulative Energy (kWh)',
      'Data Source'
    ];

    const lines = [headers.join(',')];

    for (const r of readings) {
      const row = [
        escapeCsvField(r.id || r._id),
        escapeCsvField(r.building_id),
        escapeCsvField(r.building_code || 'GEN'),
        escapeCsvField(r.building_name || 'General'),
        escapeCsvField(r.timestamp),
        r.voltage !== null && r.voltage !== undefined ? r.voltage : '',
        r.current !== null && r.current !== undefined ? r.current : '',
        r.power_factor !== null && r.power_factor !== undefined ? r.power_factor : '',
        r.frequency !== null && r.frequency !== undefined ? r.frequency : '',
        r.apparent_power_kva !== null && r.apparent_power_kva !== undefined ? r.apparent_power_kva : '',
        r.active_power_kw !== null && r.active_power_kw !== undefined ? r.active_power_kw : '',
        r.reactive_power_kvar !== null && r.reactive_power_kvar !== undefined ? r.reactive_power_kvar : '',
        r.energy_kwh !== null && r.energy_kwh !== undefined ? r.energy_kwh : '',
        'SIMULATED'
      ];
      lines.push(row.join(','));
    }

    const csvContent = lines.join('\r\n') + '\r\n';
    const filename = `ruhuna_energy_telemetry_${rawBldgId}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('[Reports API] CSV Export error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

/**
 * POST /api/config/tariff
 * Protected endpoint: Allows ONLY Administrator users to update demonstration tariff rates.
 * Viewer users receive HTTP 403 Forbidden.
 */
router.post('/api/config/tariff', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = req.body || {};
    const rawTariffId = data.tariff_id !== undefined ? data.tariff_id : 1;

    let tariffId = 1;
    if (typeof rawTariffId === 'string' && /^\d+$/.test(rawTariffId)) {
      tariffId = parseInt(rawTariffId, 10);
    } else if (typeof rawTariffId === 'number') {
      tariffId = rawTariffId;
    } else if (rawTariffId) {
      tariffId = rawTariffId;
    }

    const activeTariff = await getActiveTariff();
    const existingName = activeTariff ? activeTariff.name : 'Demonstration Institutional Tariff';
    const existingEnergy = activeTariff ? activeTariff.energy_rate_lkr_per_kwh : 38.50;
    const existingDemand = activeTariff ? activeTariff.demand_rate_lkr_per_kw : 1450.00;
    const existingFixed = activeTariff ? activeTariff.fixed_charge_lkr : 3000.00;

    const nameInput = data.name !== undefined ? data.name : existingName;
    const energyInput = data.energy_rate_lkr_per_kwh !== undefined ? data.energy_rate_lkr_per_kwh : existingEnergy;
    const demandInput = data.demand_rate_lkr_per_kw !== undefined ? data.demand_rate_lkr_per_kw : existingDemand;
    const fixedInput = data.fixed_charge_lkr !== undefined ? data.fixed_charge_lkr : existingFixed;

    let validated;
    try {
      validated = validateTariffRates(energyInput, demandInput, fixedInput, nameInput);
    } catch (ve) {
      return res.status(400).json({
        status: 'error',
        message: ve.message
      });
    }

    const updated = await updateTariffConfiguration(
      tariffId,
      validated.name,
      validated.energyRate,
      validated.demandRate,
      validated.fixedCharge
    );

    if (!updated) {
      return res.status(400).json({
        status: 'error',
        message: `Tariff #${tariffId} could not be updated.`
      });
    }

    return res.status(200).json({
      status: 'success',
      message: `Tariff #${tariffId} updated successfully.`,
      updated_rates: {
        name: validated.name,
        energy_rate_lkr_per_kwh: validated.energyRate,
        demand_rate_lkr_per_kw: validated.demandRate,
        fixed_charge_lkr: validated.fixedCharge
      }
    });
  } catch (err) {
    console.error('[Reports API] Tariff update error:', err);
    return res.status(500).json({
      status: 'error',
      message: err.message
    });
  }
});

module.exports = router;
