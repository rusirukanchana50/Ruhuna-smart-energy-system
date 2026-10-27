/**
 * phase5.test.js
 * --------------
 * Automated test suite for Phase 5:
 * 1. Historical Analytics Calculations (kWh, Average/Peak/Min Power, Load Factor, Units)
 * 2. Load Factor Formula & Boundary Handling (Normal, Flat, Empty, Single Reading)
 * 3. Cost & Demonstration Tariff Calculations (Energy, Demand, Fixed Charges, Pro-rata scaling)
 * 4. Campus After-Hours Energy Calculations (Asia/Colombo Operating Window & Weekends)
 * 5. Multi-Building Comparison & 16-Metric Engineering Audit Report
 * 6. Historical Filters & API Contract Parity:
 *    - GET /api/energy/history
 *    - GET /api/energy/analytics (Single & Campus Comparison)
 *    - GET /api/energy/cost (Single & Campus Summary)
 *    - GET /api/energy/efficiency (Single & Campus Comparative)
 *    - GET /api/energy/efficiency/comparison
 *    - GET /api/reports/summary
 *    - GET /api/reports/export/csv
 * 7. Administrator-Only Tariff Configuration & CSRF Enforcement:
 *    - POST /api/config/tariff (Admin allowed, Viewer 403, Missing CSRF 403, Rate validation)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

// Use isolated test database
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ruhuna_energy_test';
process.env.SESSION_SECRET = 'test-suite-secure-random-secret-key-32chars';

const { connectDB, disconnectDB } = require('../config/db');
const Building = require('../models/Building');
const User = require('../models/User');
const EnergyReading = require('../models/EnergyReading');
const Alert = require('../models/Alert');
const Tariff = require('../models/Tariff');
const FacultySetting = require('../models/FacultySetting');
const { initBuildings } = require('../init_db');
const app = require('../app');
const {
  formatTimestamp,
  parseTimestampStr,
  isTimestampAfterHours,
  calculateBuildingAnalytics,
  calculateBuildingCost,
  calculateBuildingEfficiency,
  getCampusSynchronizedMetrics,
  getFilteredEnergyHistory,
  getEnergyAnalytics,
  getCostAndEfficiencyAnalytics,
  getComprehensiveEnergyReport,
  getActiveTariff,
  updateTariffConfiguration
} = require('../services/analyticsService');

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 5: Historical Analytics, Cost, Efficiency & Reports Test Suite', () => {
  let server;
  let baseUrl;

  let adminCookie;
  let adminCsrfToken;

  let viewerCookie;
  let viewerCsrfToken;

  let coreBuildings = [];
  let testReadingIds = [];

  const adminCredentials = {
    email: 'admin.phase5@eng.ruh.ac.lk',
    password: 'AdminPassword2026!',
    full_name: 'Administrator User',
    role: 'Administrator'
  };

  const viewerCredentials = {
    email: 'viewer.phase5@eng.ruh.ac.lk',
    password: 'ViewerPassword2026!',
    full_name: 'Guest Viewer User',
    role: 'Viewer'
  };

  before(async () => {
    await connectDB(process.env.MONGODB_URI);

    // Clean test collections
    await Promise.all([
      Building.deleteMany({}),
      User.deleteMany({ email: { $in: [adminCredentials.email, viewerCredentials.email] } }),
      EnergyReading.deleteMany({}),
      Alert.deleteMany({}),
      Tariff.deleteMany({}),
      FacultySetting.deleteMany({})
    ]);

    // Ensure Mongoose indexes
    await Promise.all([
      Building.init(),
      User.init(),
      EnergyReading.init(),
      Alert.init(),
      Tariff.init(),
      FacultySetting.init()
    ]);

    // Seed 6 core buildings
    await initBuildings({ silent: true });
    coreBuildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });

    // Seed users
    await User.create(adminCredentials);
    await User.create(viewerCredentials);

    // Start ephemeral server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Admin login
    const adminLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminCredentials.email,
        password: adminCredentials.password
      })
    });
    adminCookie = extractCookie(adminLoginRes);
    const adminLoginData = await adminLoginRes.json();
    adminCsrfToken = adminLoginData.csrf_token || adminLoginData.csrfToken;

    // Viewer login
    const viewerLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: viewerCredentials.email,
        password: viewerCredentials.password
      })
    });
    viewerCookie = extractCookie(viewerLoginRes);
    const viewerLoginData = await viewerLoginRes.json();
    viewerCsrfToken = viewerLoginData.csrf_token || viewerLoginData.csrfToken;

    // Seed historical telemetry readings for testing
    // Base timestamp: 2026-10-20 09:00:00 (Tuesday - Working hours)
    const baseDate = new Date('2026-10-20T09:00:00+05:30');
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');
    const eieBldg = coreBuildings.find((b) => b.code === 'EIE');

    const readingsToInsert = [];

    // Building CEE: 10 readings at 15-second intervals during operating hours
    for (let i = 0; i < 10; i++) {
      const ts = new Date(baseDate.getTime() + (i * 15000));
      readingsToInsert.push({
        building_id: ceeBldg._id,
        building_code: ceeBldg.code,
        building_name: ceeBldg.name,
        timestamp: ts,
        voltage: 400.0 + (i % 2 === 0 ? 1.5 : -1.0),
        current: 50.0 + i,
        power_factor: 0.92,
        frequency: 50.01,
        apparent_power_kva: 35.0 + i,
        active_power_kw: 30.0 + (i * 2.0), // 30 to 48 kW
        reactive_power_kvar: 12.0,
        energy_kwh: (30.0 + (i * 2.0)) * (15.0 / 3600.0),
        is_simulated: true
      });
    }

    // Building CEE: 5 readings during after-hours (2026-10-20 20:00:00 - Tuesday night)
    const afterHoursDate = new Date('2026-10-20T20:00:00+05:30');
    for (let i = 0; i < 5; i++) {
      const ts = new Date(afterHoursDate.getTime() + (i * 15000));
      readingsToInsert.push({
        building_id: ceeBldg._id,
        building_code: ceeBldg.code,
        building_name: ceeBldg.name,
        timestamp: ts,
        voltage: 401.0,
        current: 15.0,
        power_factor: 0.88,
        frequency: 50.0,
        apparent_power_kva: 11.0,
        active_power_kw: 10.0,
        reactive_power_kvar: 4.5,
        energy_kwh: 10.0 * (15.0 / 3600.0),
        is_simulated: true
      });
    }

    // Building EIE: 5 readings with low power factor (0.81 < 0.85)
    for (let i = 0; i < 5; i++) {
      const ts = new Date(baseDate.getTime() + (i * 15000));
      readingsToInsert.push({
        building_id: eieBldg._id,
        building_code: eieBldg.code,
        building_name: eieBldg.name,
        timestamp: ts,
        voltage: 398.0,
        current: 60.0,
        power_factor: 0.81,
        frequency: 49.98,
        apparent_power_kva: 45.0,
        active_power_kw: 36.45,
        reactive_power_kvar: 26.3,
        energy_kwh: 36.45 * (15.0 / 3600.0),
        is_simulated: true
      });
    }

    const inserted = await EnergyReading.insertMany(readingsToInsert);
    testReadingIds = inserted.map((d) => d._id);
  });



  // =========================================================================
  // Section 1: Electrical Calculations & Load Factor Boundary Testing
  // =========================================================================

  it('1.1 should correctly calculate electrical analytics and units (kW, kVA, kVAr, kWh)', () => {
    const sampleReadings = [
      {
        timestamp: '2026-10-20 09:00:00',
        active_power_kw: 40.0,
        apparent_power_kva: 44.0,
        reactive_power_kvar: 18.0,
        power_factor: 0.91,
        voltage: 400.0,
        current: 58.0,
        frequency: 50.0
      },
      {
        timestamp: '2026-10-20 09:00:15',
        active_power_kw: 60.0,
        apparent_power_kva: 65.0,
        reactive_power_kvar: 25.0,
        power_factor: 0.92,
        voltage: 402.0,
        current: 85.0,
        frequency: 50.02
      }
    ];

    const result = calculateBuildingAnalytics(sampleReadings);

    assert.strictEqual(result.readings_count, 2);
    assert.strictEqual(result.avg_active_power_kw, 50.0);
    assert.strictEqual(result.peak_active_power_kw, 60.0);
    assert.strictEqual(result.min_active_power_kw, 40.0);

    // Load Factor = 50.0 / 60.0 = 0.8333...
    assert.strictEqual(result.load_factor, 0.833);
    assert.strictEqual(result.load_factor_pct, 83.3);

    // Energy integration: average power 50 kW for 15s = 50 * 15 / 3600 = 0.208 kWh
    assert.strictEqual(result.total_energy_kwh, 0.208);
    assert.strictEqual(result.avg_apparent_power_kva, 54.5);
    assert.strictEqual(result.avg_reactive_power_kvar, 21.5);
    assert.strictEqual(result.avg_voltage, 401.0);
    assert.strictEqual(result.min_voltage, 400.0);
    assert.strictEqual(result.max_voltage, 402.0);
    assert.strictEqual(result.avg_frequency, 50.01);
  });

  it('1.2 should safely handle empty datasets without NaN or division by zero', () => {
    const emptyResult = calculateBuildingAnalytics([]);

    assert.strictEqual(emptyResult.readings_count, 0);
    assert.strictEqual(emptyResult.total_energy_kwh, 0.0);
    assert.strictEqual(emptyResult.avg_active_power_kw, 0.0);
    assert.strictEqual(emptyResult.peak_active_power_kw, 0.0);
    assert.strictEqual(emptyResult.load_factor, 0.0);
    assert.strictEqual(emptyResult.load_factor_pct, 0.0);
    assert.strictEqual(emptyResult.avg_voltage, null);
    assert.strictEqual(emptyResult.avg_power_factor, null);
    assert.strictEqual(emptyResult.avg_frequency, null);
  });

  it('1.3 should enforce load factor boundary [0.0, 1.0] under extreme values', () => {
    // Single reading with active power
    const singleReading = [{
      timestamp: '2026-10-20 09:00:00',
      active_power_kw: 50.0,
      apparent_power_kva: 55.0,
      reactive_power_kvar: 20.0,
      power_factor: 0.91,
      voltage: 400.0,
      current: 72.0,
      frequency: 50.0
    }];

    const singleResult = calculateBuildingAnalytics(singleReading);
    assert.strictEqual(singleResult.avg_active_power_kw, 50.0);
    assert.strictEqual(singleResult.peak_active_power_kw, 50.0);
    assert.strictEqual(singleResult.load_factor, 1.0); // 50 / 50 = 1.0
    assert.strictEqual(singleResult.load_factor_pct, 100.0);

    // Dataset with all zero power
    const zeroReading = [{
      timestamp: '2026-10-20 09:00:00',
      active_power_kw: 0.0,
      apparent_power_kva: 0.0,
      reactive_power_kvar: 0.0,
      power_factor: 0.0,
      voltage: 400.0,
      current: 0.0,
      frequency: 50.0
    }];
    const zeroResult = calculateBuildingAnalytics(zeroReading);
    assert.strictEqual(zeroResult.load_factor, 0.0);
    assert.strictEqual(zeroResult.load_factor_pct, 0.0);
  });

  it('1.4 should handle downtime gaps (>60s) properly without crediting continuous energy', () => {
    const gappedReadings = [
      {
        timestamp: '2026-10-20 09:00:00',
        active_power_kw: 40.0,
        voltage: 400.0,
        current: 58.0,
        power_factor: 0.90,
        frequency: 50.0
      },
      {
        // 2 hours later (7200 seconds gap > 60 seconds)
        timestamp: '2026-10-20 11:00:00',
        active_power_kw: 40.0,
        voltage: 400.0,
        current: 58.0,
        power_factor: 0.90,
        frequency: 50.0
      }
    ];

    const result = calculateBuildingAnalytics(gappedReadings);
    // Should NOT credit 2 hours * 40 kW = 80 kWh!
    // Instead credits standard single cycle 15s for the second reading: 40 * 15 / 3600 = 0.1667 kWh
    assert.ok(result.total_energy_kwh < 1.0, `Expected energy < 1.0 kWh due to gap handling, got ${result.total_energy_kwh}`);
    assert.strictEqual(result.total_energy_kwh, 0.167);
  });

  // =========================================================================
  // Section 2: Cost & Tariff Calculations
  // =========================================================================

  it('2.1 should calculate two-part demonstration institutional tariff accurately', () => {
    const tariff = {
      name: 'Demonstration Institutional Tariff',
      energy_rate_lkr_per_kwh: 40.0,
      demand_rate_lkr_per_kw: 1500.0,
      fixed_charge_lkr: 3000.0
    };

    // 1000 kWh consumed, peak demand 50 kW over a 30-day billing cycle (2592000s)
    const costMonth = calculateBuildingCost(1000.0, 50.0, 2592000, tariff);

    assert.strictEqual(costMonth.energy_consumed_kwh, 1000.0);
    assert.strictEqual(costMonth.estimated_energy_charge_lkr, 40000.0); // 1000 * 40
    assert.strictEqual(costMonth.peak_demand_kw, 50.0);
    assert.strictEqual(costMonth.estimated_demand_charge_lkr, 75000.0); // 50 * 1500
    assert.strictEqual(costMonth.estimated_fixed_charge_lkr, 3000.0);   // 3000 * 1.0
    assert.strictEqual(costMonth.estimated_total_cost_lkr, 118000.0);   // 40000 + 75000 + 3000
    assert.strictEqual(costMonth.is_estimate, true);
    assert.ok(costMonth.disclaimer.includes('demonstration tariff'));

    // Test pro-rated 1-day evaluation (86400s)
    const costDay = calculateBuildingCost(100.0, 50.0, 86400, tariff);
    assert.strictEqual(costDay.estimated_energy_charge_lkr, 4000.0);
    // Demand charge scaled by 1/30: 75000 / 30 = 2500.0
    assert.strictEqual(costDay.estimated_demand_charge_lkr, 2500.0);
    // Fixed charge scaled by 1/30: 3000 / 30 = 100.0
    assert.strictEqual(costDay.estimated_fixed_charge_lkr, 100.0);
    assert.strictEqual(costDay.estimated_total_cost_lkr, 6600.0);
  });

  // =========================================================================
  // Section 3: After-Hours Electricity Consumption in Asia/Colombo
  // =========================================================================

  it('3.1 should correctly identify working hours vs after-hours in Asia/Colombo time', () => {
    // Tuesday 10:30 Colombo time -> Working hours (false)
    const workingTs = '2026-10-20T10:30:00+05:30';
    assert.strictEqual(isTimestampAfterHours(workingTs), false);

    // Tuesday 17:30 Colombo time -> After hours (true)
    const eveningTs = '2026-10-20T17:30:00+05:30';
    assert.strictEqual(isTimestampAfterHours(eveningTs), true);

    // Tuesday 07:45 Colombo time -> After hours (true, before 08:00)
    const earlyTs = '2026-10-20T07:45:00+05:30';
    assert.strictEqual(isTimestampAfterHours(earlyTs), true);

    // Saturday 11:00 Colombo time -> Weekend is 100% after-hours (true)
    const weekendTs = '2026-10-24T11:00:00+05:30';
    assert.strictEqual(isTimestampAfterHours(weekendTs), true);
  });

  // =========================================================================
  // Section 4: Historical Analytics API (GET /api/energy/history & /analytics)
  // =========================================================================

  it('4.1 GET /api/energy/history should reject missing building_id with 400', async () => {
    const res = await fetch(`${baseUrl}/api/energy/history`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.status, 'error');
    assert.ok(body.message.includes('building_id'));
  });

  it('4.2 GET /api/energy/history should retrieve stored readings filtered by building and limit', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/energy/history?building_id=${ceeBldg._id}&limit=10`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data_source, 'SIMULATED');
    assert.strictEqual(body.count, 10);
    assert.ok(Array.isArray(body.data));
    assert.strictEqual(body.data.length, 10);

    const first = body.data[0];
    assert.ok(first.timestamp);
    assert.strictEqual(first.building_code, 'CEE');
    assert.ok(typeof first.active_power_kw === 'number');
    assert.ok(typeof first.voltage === 'number');
    assert.ok(typeof first.current === 'number');
    assert.strictEqual(first.is_simulated, 1);
  });

  it('4.3 GET /api/energy/history should support "all" buildings', async () => {
    const res = await fetch(`${baseUrl}/api/energy/history?building_id=all&limit=50`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.ok(body.count >= 15);
  });

  it('4.4 GET /api/energy/analytics should return single-building electrical KPIs', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/energy/analytics?building_id=${ceeBldg._id}`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.mode, 'single');
    assert.strictEqual(body.building_code, 'CEE');

    const a = body.analytics;
    assert.ok(a);
    assert.ok(a.readings_count >= 15);
    assert.ok(a.total_energy_kwh > 0);
    assert.ok(a.peak_active_power_kw >= 48.0);
    assert.ok(a.load_factor > 0 && a.load_factor <= 1.0);
    assert.ok(a.avg_power_factor >= 0.85);
    assert.ok(a.avg_voltage >= 390.0);
  });

  it('4.5 GET /api/energy/analytics should return multi-building comparison mode when building_id=all', async () => {
    const res = await fetch(`${baseUrl}/api/energy/analytics?building_id=all`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.mode, 'comparison');
    assert.ok(body.campus_summary);
    assert.ok(Array.isArray(body.comparison));
    assert.strictEqual(body.comparison.length, coreBuildings.length);

    // Campus summary KPIs
    assert.ok(typeof body.campus_summary.total_energy_kwh === 'number');
    assert.ok(typeof body.campus_summary.peak_active_power_kw === 'number');
    assert.ok(typeof body.campus_summary.load_factor === 'number');
  });

  // =========================================================================
  // Section 5: Cost & Efficiency APIs
  // =========================================================================

  it('5.1 GET /api/energy/cost should return single facility cost breakdown with estimates disclaimer', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/energy/cost?building_id=${ceeBldg._id}`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.mode, 'single');
    assert.strictEqual(body.building_code, 'CEE');
    assert.strictEqual(body.is_estimate, true);
    assert.ok(body.disclaimer.includes('demonstration tariff'));
    assert.ok(body.energy_consumed_kwh > 0);
    assert.ok(body.estimated_energy_charge_lkr > 0);
    assert.ok(body.estimated_total_cost_lkr > 0);
  });

  it('5.2 GET /api/energy/cost should return campus-wide cost summary when building_id=all', async () => {
    const res = await fetch(`${baseUrl}/api/energy/cost?building_id=all`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.mode, 'campus_summary');
    assert.strictEqual(body.is_estimate, true);
    assert.ok(Array.isArray(body.building_breakdown));
    assert.strictEqual(body.building_breakdown.length, coreBuildings.length);
  });

  it('5.3 GET /api/energy/efficiency should return single facility efficiency metrics and after-hours usage', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/energy/efficiency?building_id=${ceeBldg._id}`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.mode, 'single');
    assert.strictEqual(body.building_code, 'CEE');
    assert.ok(typeof body.load_factor === 'number');
    assert.ok(typeof body.after_hours_kwh === 'number');
    assert.ok(body.after_hours_kwh > 0, 'Expected positive after-hours consumption from seeded night readings');
    assert.ok(body.after_hours_pct > 0);
    assert.ok(body.efficiency_score >= 0 && body.efficiency_score <= 100);
    assert.ok(['OPTIMAL', 'ACCEPTABLE', 'NEEDS_ATTENTION', 'INEFFICIENT'].includes(body.energy_performance_status));
    assert.ok(Array.isArray(body.engineering_observations));
  });

  it('5.4 GET /api/energy/efficiency/comparison should return all facilities ranked by efficiency', async () => {
    const res = await fetch(`${baseUrl}/api/energy/efficiency/comparison`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.ok(body.campus_summary);
    assert.ok(Array.isArray(body.comparison));
    assert.strictEqual(body.comparison.length, coreBuildings.length);
    assert.ok(Array.isArray(body.ranked_comparison));
    assert.strictEqual(body.ranked_comparison.length, coreBuildings.length);
    assert.ok(body.disclaimer.includes('demonstration tariff'));
  });

  // =========================================================================
  // Section 6: Comprehensive Energy Audit Reports & CSV Export
  // =========================================================================

  it('6.1 GET /api/reports/summary should return complete 16-metric single building report', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/reports/summary?building_id=${ceeBldg._id}`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.data_source, 'SIMULATED');

    const rep = body.report;
    assert.strictEqual(rep.mode, 'single');
    assert.strictEqual(rep.building_code, 'CEE');
    assert.strictEqual(rep.is_simulated, true);

    const m = rep.metrics;
    assert.ok(m, 'Metrics object must be present in report');

    // Verify 16 core metrics
    assert.ok(typeof m.total_energy_kwh === 'number', '1. total_energy_kwh');
    assert.ok(typeof m.avg_active_power_kw === 'number', '2. avg_active_power_kw');
    assert.ok(typeof m.peak_demand_kw === 'number', '3. peak_demand_kw');
    assert.ok(typeof m.min_active_power_kw === 'number', '4. min_active_power_kw');
    assert.ok(typeof m.avg_apparent_power_kva === 'number', '5. avg_apparent_power_kva');
    assert.ok(typeof m.avg_reactive_power_kvar === 'number', '6. avg_reactive_power_kvar');
    assert.ok(typeof m.avg_power_factor === 'number', '7. avg_power_factor');
    assert.ok(typeof m.min_power_factor === 'number', '8. min_power_factor');
    assert.ok(typeof m.load_factor === 'number', '9. load_factor');
    assert.ok(typeof m.avg_voltage === 'number', '10. avg_voltage');
    assert.ok(typeof m.avg_frequency === 'number', '11. avg_frequency');
    assert.ok(typeof m.after_hours_kwh === 'number', '12. after_hours_kwh');
    assert.ok(typeof m.after_hours_pct === 'number', '13. after_hours_pct');
    assert.ok(typeof m.estimated_electricity_cost_lkr === 'number', '14. estimated_electricity_cost_lkr');
    assert.ok(typeof m.estimated_energy_charge_lkr === 'number', '15. estimated_energy_charge_lkr');
    assert.ok(typeof m.total_alerts_count === 'number', '16. total_alerts_count');
  });

  it('6.2 GET /api/reports/summary should return campus-wide report with building breakdown', async () => {
    const res = await fetch(`${baseUrl}/api/reports/summary?building_id=all`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.status, 'success');
    const rep = body.report;
    assert.strictEqual(rep.mode, 'campus_summary');
    assert.ok(Array.isArray(rep.building_breakdown));
    assert.strictEqual(rep.building_breakdown.length, coreBuildings.length);
    assert.ok(Array.isArray(rep.engineering_observations));
    assert.ok(rep.engineering_observations.length > 0);
  });

  it('6.3 GET /api/reports/export/csv should stream CSV with accurate headers and SIMULATED labels', async () => {
    const ceeBldg = coreBuildings.find((b) => b.code === 'CEE');

    const res = await fetch(`${baseUrl}/api/reports/export/csv?building_id=${ceeBldg._id}`, {
      headers: { Cookie: viewerCookie }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    const disp = res.headers.get('content-disposition');
    assert.ok(disp && disp.includes(`ruhuna_energy_telemetry_${ceeBldg._id}.csv`));

    const csvText = await res.text();
    const lines = csvText.trim().split('\r\n');

    // Header check
    assert.ok(lines[0].includes('Reading ID'));
    assert.ok(lines[0].includes('Building ID'));
    assert.ok(lines[0].includes('Building Code'));
    assert.ok(lines[0].includes('Data Source'));

    // Row check
    assert.ok(lines.length >= 16); // Header + at least 15 rows
    const firstRow = lines[1];
    assert.ok(firstRow.includes('CEE'));
    assert.ok(firstRow.includes('SIMULATED'));
  });

  // =========================================================================
  // Section 7: Administrator-Only Tariff Configuration & CSRF Enforcement
  // =========================================================================

  it('7.1 POST /api/config/tariff should allow Administrator with valid CSRF to update rates', async () => {
    const updatePayload = {
      tariff_id: 1,
      name: 'Updated Faculty Tariff 2026',
      energy_rate_lkr_per_kwh: 42.50,
      demand_rate_lkr_per_kw: 1600.00,
      fixed_charge_lkr: 3500.00
    };

    const res = await fetch(`${baseUrl}/api/config/tariff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': adminCsrfToken,
        Cookie: adminCookie
      },
      body: JSON.stringify(updatePayload)
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.status, 'success');
    assert.strictEqual(body.updated_rates.energy_rate_lkr_per_kwh, 42.50);
    assert.strictEqual(body.updated_rates.demand_rate_lkr_per_kw, 1600.00);
    assert.strictEqual(body.updated_rates.fixed_charge_lkr, 3500.00);

    // Verify rate was saved persistently in MongoDB
    const activeTariff = await getActiveTariff();
    assert.strictEqual(activeTariff.energy_rate_lkr_per_kwh, 42.50);
  });

  it('7.2 POST /api/config/tariff should reject Viewer user with HTTP 403 Forbidden', async () => {
    const res = await fetch(`${baseUrl}/api/config/tariff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': viewerCsrfToken,
        Cookie: viewerCookie
      },
      body: JSON.stringify({
        energy_rate_lkr_per_kwh: 50.0
      })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.status, 'error');
    assert.ok(body.message.includes('Administrator'));
  });

  it('7.3 POST /api/config/tariff should reject requests missing valid CSRF token with HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/api/config/tariff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: adminCookie // Missing X-CSRF-Token
      },
      body: JSON.stringify({
        energy_rate_lkr_per_kwh: 45.0
      })
    });

    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.strictEqual(body.status, 'error');
    assert.ok(body.message.toLowerCase().includes('csrf'));
  });

  it('7.4 POST /api/config/tariff should reject invalid or out-of-bounds rates with HTTP 400', async () => {
    // Negative energy rate
    const resNeg = await fetch(`${baseUrl}/api/config/tariff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': adminCsrfToken,
        Cookie: adminCookie
      },
      body: JSON.stringify({
        energy_rate_lkr_per_kwh: -5.0
      })
    });
    assert.strictEqual(resNeg.status, 400);
    const bodyNeg = await resNeg.json();
    assert.strictEqual(bodyNeg.status, 'error');

    // Exorbitant rate (> 1000 LKR/kWh)
    const resHigh = await fetch(`${baseUrl}/api/config/tariff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': adminCsrfToken,
        Cookie: adminCookie
      },
      body: JSON.stringify({
        energy_rate_lkr_per_kwh: 5000.0
      })
    });
    assert.strictEqual(resHigh.status, 400);
    const bodyHigh = await resHigh.json();
    assert.strictEqual(bodyHigh.status, 'error');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await disconnectDB();
    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });
});
