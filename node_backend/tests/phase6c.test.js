/**
 * phase6c.test.js
 * ----------------
 * Automated test suite for Phase 6C:
 * Frontend integration for Analytics, Alerts, Cost & Efficiency, and Reports.
 * 
 * Verifies:
 * 1. Historical Analytics (/analytics, /api/energy/analytics, /api/energy/history)
 * 2. Electrical Alerts (/alerts, /api/alerts, /api/alerts/:id/acknowledge, RBAC & CSRF)
 * 3. Cost & Efficiency (/cost-efficiency, /api/energy/cost, /api/energy/efficiency, comparison)
 * 4. Audit Reports & CSV Export (/reports, /reports/printable, /api/reports/summary, /api/reports/export/csv)
 * 5. Demonstration Tariff Configuration (/api/config/tariff, RBAC & CSRF)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const app = require('../app');
const User = require('../models/User');
const Building = require('../models/Building');
const EnergyReading = require('../models/EnergyReading');
const Alert = require('../models/Alert');
const Tariff = require('../models/Tariff');
const { initBuildings } = require('../init_db');
const { getActiveTariff } = require('../services/analyticsService');
const { runSimulationCycle } = require('../simulator');

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 6C: Analytics, Alerts, Cost & Efficiency, and Reports Frontend Integration', () => {
  let server;
  let baseUrl;

  const adminCredentials = {
    full_name: 'Phase6C Administrator',
    email: 'phase6c.admin@eng.ruh.ac.lk',
    password: 'AdminPasswordPhase6C!',
    role: 'Administrator'
  };

  const viewerCredentials = {
    full_name: 'Phase6C Viewer',
    email: 'phase6c.viewer@eng.ruh.ac.lk',
    password: 'ViewerPasswordPhase6C!',
    role: 'Viewer'
  };

  let adminCookie = '';
  let adminCsrfToken = '';
  let viewerCookie = '';
  let viewerCsrfToken = '';

  let coreBuildings = [];
  let testAlert = null;

  before(async () => {
    try {
      await connectDB(process.env.MONGODB_URI);

      // Initialize core buildings and tariffs
      await initBuildings({ silent: true });
      await getActiveTariff();

      // Clean up test accounts
      await User.deleteMany({
        email: { $in: [adminCredentials.email, viewerCredentials.email] }
      });

      // Create test accounts
      await User.create(adminCredentials);
      await User.create(viewerCredentials);

      // Start test HTTP server
      await new Promise((resolve) => {
        server = app.listen(0, () => {
          const port = server.address().port;
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });

      // Authenticate Admin
      const adminRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      const adminData = await adminRes.json();
      adminCookie = extractCookie(adminRes);
      adminCsrfToken = adminData.csrf_token;

      // Authenticate Viewer
      const viewerRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: viewerCredentials.email,
          password: viewerCredentials.password
        })
      });
      const viewerData = await viewerRes.json();
      viewerCookie = extractCookie(viewerRes);
      viewerCsrfToken = viewerData.csrf_token;

      // Fetch core buildings
      coreBuildings = await Building.find({}).sort({ code: 1 });

      // Run simulator cycle to ensure telemetry exists
      await runSimulationCycle({ verbose: false });

      // Seed a test alert for acknowledgment testing
      const eieBldg = coreBuildings.find((b) => b.code === 'EIE') || coreBuildings[0];
      testAlert = await Alert.create({
        building_id: eieBldg._id,
        building_code: eieBldg.code,
        building_name: eieBldg.name,
        alert_type: 'LOW_POWER_FACTOR',
        severity: 'WARNING',
        measured_value: 0.812,
        threshold_value: 0.85,
        message: 'Power factor (0.812) dropped below statutory minimum threshold (0.850).',
        is_active: true,
        acknowledged: false,
        timestamp: new Date()
      });
    } catch (err) {
      console.error('[BEFORE HOOK ERROR]:', err);
      throw err;
    }
  });

  after(async () => {
    if (testAlert && testAlert._id) {
      await Alert.deleteOne({ _id: testAlert._id });
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await User.deleteMany({
      email: { $in: [adminCredentials.email, viewerCredentials.email] }
    });
    await disconnectDB();
    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });

  // --------------------------------------------------------------------------
  // 1. ANALYTICS: Historical Analytics Frontend & API Integration
  // --------------------------------------------------------------------------
  describe('1. Analytics Integration (/analytics, /api/energy/analytics, /api/energy/history)', () => {
    it('1.1 should render historical analytics page with building select and presets', async () => {
      const res = await fetch(`${baseUrl}/analytics`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Historical Energy Analytics'), 'Must have page title');
      assert.ok(html.includes('filterBuilding'), 'Must have building filter dropdown');
      assert.ok(html.includes('data-preset="24h"'), 'Must have 24h quick preset');
      assert.ok(html.includes('chartActivePowerTime'), 'Must contain active power canvas');
      assert.ok(html.includes('chartEnergyTime'), 'Must contain energy canvas');

      // Check all core campus buildings are options
      for (const b of coreBuildings) {
        assert.ok(html.includes(b.code), `Dropdown must include ${b.code}`);
      }
    });

    it('1.2 should return campus comparison analytics with summary metrics when building_id=all', async () => {
      const res = await fetch(`${baseUrl}/api/energy/analytics?building_id=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data_source, 'SIMULATED');
      assert.ok(data.campus_summary, 'Must return campus_summary object');
      assert.ok(typeof data.campus_summary.total_energy_kwh === 'number');
      assert.ok(typeof data.campus_summary.peak_active_power_kw === 'number');
      assert.ok(typeof data.campus_summary.avg_power_factor === 'number');
      assert.ok(typeof data.campus_summary.load_factor === 'number');
      assert.ok(Array.isArray(data.comparison), 'Must return comparison array for chart rendering');
      assert.ok(data.comparison.length >= 6, 'Must include at least 6 campus facilities');

      const cee = data.comparison.find((c) => c.building_code === 'CEE');
      assert.ok(cee, 'Comparison must include CEE');
      assert.ok(typeof cee.total_energy_kwh === 'number');
      assert.ok(typeof cee.load_factor === 'number');
    });

    it('1.3 should return single facility operational KPIs and secondary electrical parameters', async () => {
      const cee = coreBuildings.find((b) => b.code === 'CEE') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/api/energy/analytics?building_id=${cee._id}`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.building_code, cee.code);
      assert.ok(data.analytics, 'Must return analytics object');

      const a = data.analytics;
      assert.ok(typeof a.total_energy_kwh === 'number');
      assert.ok(typeof a.peak_active_power_kw === 'number');
      assert.ok(typeof a.avg_active_power_kw === 'number');
      assert.ok(typeof a.avg_power_factor === 'number');
      assert.ok(typeof a.load_factor === 'number');
      assert.ok(typeof a.avg_apparent_power_kva === 'number');
      assert.ok(typeof a.avg_reactive_power_kvar === 'number');
      assert.ok(typeof a.avg_voltage === 'number');
      assert.ok(typeof a.avg_frequency === 'number');
    });

    it('1.4 should return time-series history data formatted for Chart.js line charts', async () => {
      const cee = coreBuildings.find((b) => b.code === 'CEE') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/api/energy/history?building_id=${cee._id}&limit=50`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(Array.isArray(data.data), 'History data must be an array');
      assert.ok(data.data.length >= 1, 'Should have at least 1 reading');

      const r = data.data[0];
      assert.ok(r.timestamp, 'Reading must have timestamp');
      assert.ok(typeof r.active_power_kw === 'number', 'Must have active_power_kw');
      assert.ok(typeof r.energy_kwh === 'number', 'Must have energy_kwh');
      assert.ok(typeof r.power_factor === 'number', 'Must have power_factor');
      assert.ok(typeof r.voltage === 'number', 'Must have voltage');
    });

    it('1.5 should safely handle empty time ranges without NaN or fabricated values', async () => {
      const futureStart = '2099-01-01T00:00:00';
      const futureEnd = '2099-01-02T00:00:00';
      const res = await fetch(
        `${baseUrl}/api/energy/analytics?building_id=all&start=${encodeURIComponent(futureStart)}&end=${encodeURIComponent(futureEnd)}`,
        { headers: { Cookie: adminCookie } }
      );
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.campus_summary.total_energy_kwh, 0);
      assert.strictEqual(data.campus_summary.peak_active_power_kw, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 2. ALERTS: Electrical Alerts & Acknowledgment Integration
  // --------------------------------------------------------------------------
  describe('2. Alerts Integration (/alerts, /api/alerts, /api/alerts/:id/acknowledge)', () => {
    it('2.1 should render alerts page with KPI summary cards and user role tag', async () => {
      const res = await fetch(`${baseUrl}/alerts`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Electrical Alerts'), 'Must have page title');
      assert.ok(html.includes('kpiActiveCritical'), 'Must have critical counter card');
      assert.ok(html.includes('kpiActiveWarnings'), 'Must have warning counter card');
      assert.ok(html.includes('alertsTableBody'), 'Must contain alerts table body');
      assert.ok(html.includes('userRoleBadge'), 'Must have userRoleBadge element');
      assert.ok(html.includes('role-admin'), 'Must identify Admin role');
    });

    it('2.2 should return alert records with summary matching alerts.js expectations', async () => {
      const res = await fetch(`${baseUrl}/api/alerts?status=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.summary, 'Must return summary');
      assert.ok(typeof data.summary.active_total === 'number');
      assert.ok(Array.isArray(data.data), 'Data must be array of alerts');

      const found = data.data.find((a) => a.id === testAlert._id.toString() || a._id === testAlert._id.toString());
      assert.ok(found, 'Test alert must be in the list');
      assert.strictEqual(found.alert_type, 'LOW_POWER_FACTOR');
      assert.strictEqual(found.severity, 'WARNING');
    });

    it('2.3 should correctly filter alerts by severity=WARNING', async () => {
      const res = await fetch(`${baseUrl}/api/alerts?severity=WARNING`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      for (const a of data.data) {
        assert.strictEqual(a.severity, 'WARNING');
      }
    });

    it('2.4 should strictly reject Viewer role from acknowledging alerts with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${testAlert._id}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({ csrf_token: viewerCsrfToken })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.message.includes('Administrator') || data.message.includes('Forbidden'));
    });

    it('2.5 should reject alert acknowledgment without valid CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${testAlert._id}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
    });

    it('2.6 should allow Administrator with valid CSRF to acknowledge alert with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/${testAlert._id}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ csrf_token: adminCsrfToken })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');

      // Verify in MongoDB
      const updated = await Alert.findById(testAlert._id);
      assert.strictEqual(updated.acknowledged, true);
      assert.ok(updated.acknowledged_by, 'Must record acknowledging admin');
      assert.ok(updated.acknowledged_at, 'Must record acknowledgment timestamp');
    });
  });

  // --------------------------------------------------------------------------
  // 3. COST & EFFICIENCY: Financial Model & Operational Ranking
  // --------------------------------------------------------------------------
  describe('3. Cost & Efficiency Integration (/cost-efficiency, /api/energy/cost, /api/energy/efficiency)', () => {
    it('3.1 should render cost and efficiency page with disclaimer banner and KPI containers', async () => {
      const res = await fetch(`${baseUrl}/cost-efficiency`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Energy Cost &amp; Efficiency Analysis'), 'Must have page title');
      assert.ok(html.includes('Demonstration Tariff Model:'), 'Must show prominent tariff disclaimer banner');
      assert.ok(html.includes('kpiEnergyConsumed'), 'Must have energy consumed KPI element');
      assert.ok(html.includes('kpiEstimatedCost'), 'Must have estimated cost KPI element');
      assert.ok(html.includes('kpiPeakDemand'), 'Must have peak demand KPI element');
      assert.ok(html.includes('breakdownEnergyCharge'), 'Must have energy charge breakdown');
      assert.ok(html.includes('breakdownDemandCharge'), 'Must have demand charge breakdown');
      assert.ok(html.includes('breakdownFixedCharge'), 'Must have fixed charge breakdown');
      assert.ok(html.includes('chartCostEnergy'), 'Must contain cost charts');
    });

    it('3.2 should compute 3-part demonstration tariff cost breakdown for a facility', async () => {
      const mme = coreBuildings.find((b) => b.code === 'MME') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/api/energy/cost?building_id=${mme._id}`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data_source, 'SIMULATED');
      assert.ok(typeof data.energy_consumed_kwh === 'number' || typeof data.total_energy_kwh === 'number');
      assert.ok(typeof data.estimated_energy_charge_lkr === 'number');
      assert.ok(typeof data.estimated_demand_charge_lkr === 'number');
      assert.ok(typeof data.estimated_fixed_charge_lkr === 'number');
      assert.ok(typeof data.estimated_total_cost_lkr === 'number');
      assert.ok(data.disclaimer.toLowerCase().includes('demonstration tariff model'));
    });

    it('3.3 should return efficiency indicators including after-hours energy ratio', async () => {
      const mme = coreBuildings.find((b) => b.code === 'MME') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/api/energy/efficiency?building_id=${mme._id}`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(typeof data.load_factor === 'number');
      assert.ok(typeof data.average_power_factor === 'number');
      assert.ok(typeof data.after_hours_kwh === 'number');
      assert.ok(typeof data.after_hours_pct === 'number');
      assert.ok(Array.isArray(data.engineering_observations));
    });

    it('3.4 should return campus-wide comparative efficiency ranking across all facilities', async () => {
      const res = await fetch(`${baseUrl}/api/energy/efficiency/comparison`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.campus_summary);
      assert.ok(Array.isArray(data.ranked_comparison), 'Must return ranked_comparison array');
      assert.ok(data.ranked_comparison.length >= 6);
    });
  });

  // --------------------------------------------------------------------------
  // 4. REPORTS: Summary Report, CSV Export & Printable Report
  // --------------------------------------------------------------------------
  describe('4. Reports Integration (/reports, /reports/printable, /api/reports/summary, /api/reports/export/csv)', () => {
    it('4.1 should render reports center with reporting presets and export buttons', async () => {
      const res = await fetch(`${baseUrl}/reports`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Energy Audit Reports &amp; Export'), 'Must have page title');
      assert.ok(html.includes('btnExportCsv'), 'Must have CSV download button');
      assert.ok(html.includes('btnPrintReport'), 'Must have printable report button');
      assert.ok(html.includes('repTotalKwh'), 'Must have 16-metric total kWh element');
      assert.ok(html.includes('repTotalCost'), 'Must have 16-metric total cost element');
    });

    it('4.2 should return full 16-parameter campus energy audit report from GET /api/reports/summary', async () => {
      const res = await fetch(`${baseUrl}/api/reports/summary?building_id=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.report, 'Must contain report object');
      assert.strictEqual(data.report.mode, 'campus_summary');

      const m = data.report.metrics;
      assert.ok(typeof m.total_energy_kwh === 'number', 'Metric 1: total_energy_kwh');
      assert.ok(typeof m.avg_active_power_kw === 'number', 'Metric 2: avg_active_power_kw');
      assert.ok(typeof m.peak_demand_kw === 'number', 'Metric 3: peak_demand_kw');
      assert.ok(typeof m.min_active_power_kw === 'number', 'Metric 4: min_active_power_kw');
      assert.ok(typeof m.avg_apparent_power_kva === 'number', 'Metric 5: avg_apparent_power_kva');
      assert.ok(typeof m.avg_reactive_power_kvar === 'number', 'Metric 6: avg_reactive_power_kvar');
      assert.ok(typeof m.avg_power_factor === 'number', 'Metric 7: avg_power_factor');
      assert.ok(typeof m.min_power_factor === 'number', 'Metric 8: min_power_factor');
      assert.ok(typeof m.load_factor === 'number', 'Metric 9: load_factor');
      assert.ok(typeof m.avg_voltage === 'number', 'Metric 10: avg_voltage');
      assert.ok(typeof m.min_voltage === 'number', 'Metric 11: min_voltage');
      assert.ok(typeof m.max_voltage === 'number', 'Metric 12: max_voltage');
      assert.ok(typeof m.avg_frequency === 'number', 'Metric 13: avg_frequency');
      assert.ok(typeof m.after_hours_kwh === 'number', 'Metric 14: after_hours_kwh');
      assert.ok(typeof m.estimated_electricity_cost_lkr === 'number', 'Metric 15: estimated_electricity_cost_lkr');
      assert.ok(typeof m.warning_alerts_count === 'number', 'Metric 16: warning_alerts_count');

      // Check building breakdown is provided
      assert.ok(Array.isArray(data.report.building_breakdown));
      assert.ok(data.report.building_breakdown.length >= 6);
    });

    it('4.3 should return single facility audit report from GET /api/reports/summary', async () => {
      const eie = coreBuildings.find((b) => b.code === 'EIE') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/api/reports/summary?building_id=${eie._id}`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.report.mode, 'single');
      assert.strictEqual(data.report.building_code, 'EIE');
      assert.ok(data.report.metrics.total_energy_kwh >= 0);
    });

    it('4.4 should stream CSV telemetry file from GET /api/reports/export/csv with proper RFC 4180 headers', async () => {
      const res = await fetch(`${baseUrl}/api/reports/export/csv?building_id=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const contentType = res.headers.get('content-type');
      assert.ok(contentType.includes('text/csv'), 'Content-Type must be text/csv');
      const csv = await res.text();
      assert.ok(csv.includes('Reading ID'), 'CSV must include Reading ID header');
      assert.ok(csv.includes('Building Code'), 'CSV must include Building Code header');
      assert.ok(csv.includes('Power Factor'), 'CSV must include Power Factor header');
      assert.ok(csv.includes('Active Power (kW)'), 'CSV must include Active Power (kW) header');
      assert.ok(csv.includes('SIMULATED'), 'CSV must include SIMULATED data source label');
    });

    it('4.5 should render formal printable report page from GET /reports/printable?building_id=all', async () => {
      const res = await fetch(`${baseUrl}/reports/printable?building_id=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('UNIVERSITY OF RUHUNA'), 'Printable report must contain university crest header');
      assert.ok(html.includes('Faculty of Engineering'), 'Printable report must contain faculty name');
      assert.ok(html.includes('FORMAL AUDIT REPORT'), 'Printable report must indicate formal audit');
      assert.ok(html.includes('Electrical &amp; Financial Summary Indicators'), 'Must include Section 1 KPIs');
      assert.ok(html.includes('Three-Phase Electrical Operating Parameters'), 'Must include Section 2 params');
      assert.ok(html.includes('Electrical Engineering Observations &amp; Evidence'), 'Must include Section 3');
      assert.ok(html.includes('NOTICE: Measurements used in this prototype are simulated.'), 'Must show simulated notice');
      assert.ok(html.includes('not an official CEB bill'), 'Must include statutory CEB disclaimer');
    });

    it('4.6 should render formal printable report page for single facility', async () => {
      const cee = coreBuildings.find((b) => b.code === 'CEE') || coreBuildings[0];
      const res = await fetch(`${baseUrl}/reports/printable?building_id=${cee._id}`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('UNIVERSITY OF RUHUNA'));
      assert.ok(html.includes(cee.code));
    });
  });

  // --------------------------------------------------------------------------
  // 5. TARIFF CONFIGURATION: Demonstration Tariff Updates (RBAC & CSRF)
  // --------------------------------------------------------------------------
  describe('5. Demonstration Tariff Configuration (POST /api/config/tariff)', () => {
    it('5.1 should allow Administrator with valid CSRF to update demonstration tariff rates', async () => {
      const activeTariff = await Tariff.findOne({ is_active: true }) || await Tariff.findOne({});
      const updatedRates = {
        tariff_id: activeTariff.id,
        name: 'Updated CEB Demonstration Industrial Tariff I-2',
        energy_rate_lkr_per_kwh: 36.50,
        demand_rate_lkr_per_kw: 1350.00,
        fixed_charge_lkr: 4200.00
      };

      const res = await fetch(`${baseUrl}/api/config/tariff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify(updatedRates)
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.updated_rates.energy_rate_lkr_per_kwh, 36.50);
      assert.strictEqual(data.updated_rates.demand_rate_lkr_per_kw, 1350.00);

      // Verify persistence in MongoDB
      const found = await Tariff.findOne({ id: activeTariff.id });
      assert.strictEqual(found.energy_rate_lkr_per_kwh, 36.50);
    });

    it('5.2 should strictly reject Viewer role from updating tariff rates with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/config/tariff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({
          tariff_id: 1,
          name: 'Hacked Tariff',
          energy_rate_lkr_per_kwh: 1.0,
          demand_rate_lkr_per_kw: 1.0,
          fixed_charge_lkr: 1.0
        })
      });
      assert.strictEqual(res.status, 403);
    });

    it('5.3 should reject tariff update without valid CSRF token with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/config/tariff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({
          tariff_id: 1,
          name: 'No CSRF Tariff',
          energy_rate_lkr_per_kwh: 40.0,
          demand_rate_lkr_per_kw: 1500.0,
          fixed_charge_lkr: 5000.0
        })
      });
      assert.strictEqual(res.status, 403);
    });

    it('5.4 should reject out-of-bounds tariff rates with HTTP 400 Bad Request', async () => {
      const res = await fetch(`${baseUrl}/api/config/tariff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          tariff_id: 1,
          name: 'Invalid Rates Tariff',
          energy_rate_lkr_per_kwh: -50.0, // negative rate
          demand_rate_lkr_per_kw: 1000.0,
          fixed_charge_lkr: 2000.0
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes('positive number'));
    });
  });
});
