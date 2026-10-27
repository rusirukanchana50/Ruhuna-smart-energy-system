/**
 * phase4.test.js
 * --------------
 * Automated test suite for Phase 4:
 * 1. Balanced Three-Phase Electrical Formulas & Power Calculations
 * 2. Incremental Energy Integration & Sensor Downtime Safeguards
 * 3. MongoDB Telemetry Storage & is_simulated Flagging
 * 4. Dynamic Building Inclusion (new buildings automatically receive measurements)
 * 5. Preservation of Real/Historical Readings
 * 6. Electrical Alert Engine:
 *    - Undervoltage / Overvoltage Detection & Auto-Clearing
 *    - Low Power Factor Detection & Auto-Clearing
 *    - High Load & Feeder Overload Escalation / De-escalation
 *    - Frequency Anomaly Detection
 *    - Telemetry Sensor Offline Detection & Auto-Clearing
 *    - Duplicate Active Alert Suppression
 * 7. Live Energy API (GET /api/energy/live) Contract Parity
 * 8. Alerts API (GET /api/alerts) & Administrator Acknowledgment (POST /api/alerts/:id/acknowledge)
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
const { initBuildings } = require('../init_db');
const app = require('../app');
const {
  calculateElectricalParameters,
  calculateCumulativeEnergy,
  getDiurnalLoadFactor,
  generateSingleReading,
  runSimulationCycle
} = require('../simulator');
const {
  triggerAlert,
  clearAlert,
  evaluateElectricalAlerts,
  checkSensorOfflineAlerts,
  getAlertsSummary,
  acknowledgeAlert
} = require('../services/alertEngine');

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 4: JavaScript Three-Phase Energy Simulator & Alert Engine Test Suite', () => {
  let server;
  let baseUrl;

  let adminCookie;
  let adminCsrfToken;

  let viewerCookie;
  let viewerCsrfToken;

  const adminCredentials = {
    email: 'admin.phase4@eng.ruh.ac.lk',
    password: 'AdminPassword2026!',
    full_name: 'Administrator User',
    role: 'Administrator'
  };

  const viewerCredentials = {
    email: 'viewer.phase4@eng.ruh.ac.lk',
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
      Alert.deleteMany({})
    ]);

    // Ensure Mongoose indexes
    await Promise.all([
      Building.init(),
      User.init(),
      EnergyReading.init(),
      Alert.init()
    ]);

    // Seed 6 core buildings
    await initBuildings({ silent: true });

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
      body: JSON.stringify({ email: adminCredentials.email, password: adminCredentials.password })
    });
    adminCookie = extractCookie(adminLoginRes);
    const adminData = await adminLoginRes.json();
    adminCsrfToken = adminData.csrf_token;

    // Viewer login
    const viewerLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: viewerCredentials.email, password: viewerCredentials.password })
    });
    viewerCookie = extractCookie(viewerLoginRes);
    const viewerData = await viewerLoginRes.json();
    viewerCsrfToken = viewerData.csrf_token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        Building.deleteMany({ is_core: { $ne: true } }),
        User.deleteMany({ email: { $in: [adminCredentials.email, viewerCredentials.email] } }),
        EnergyReading.deleteMany({}),
        Alert.deleteMany({})
      ]);
      await disconnectDB();
    }

    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });

  // ==========================================================================
  // 1. Electrical Formulas & Calculations
  // ==========================================================================
  describe('1. Electrical Formulas & Calculations', () => {
    it('should correctly calculate balanced three-phase powers S(kVA), P(kW), Q(kVAr)', () => {
      // 400 V, 50 A, 0.90 PF
      // S = sqrt(3) * 400 * 50 / 1000 = 34.641 kVA
      // P = 34.641 * 0.90 = 31.176 kW
      // sin_phi = sqrt(1 - 0.90^2) = sqrt(0.19) = 0.43588989
      // Q = 34.641 * 0.43589 = 15.10 kVAr
      const { apparent_power_kva, active_power_kw, reactive_power_kvar } =
        calculateElectricalParameters(400.0, 50.0, 0.90);

      assert.strictEqual(apparent_power_kva, 34.64);
      assert.strictEqual(active_power_kw, 31.18);
      assert.strictEqual(reactive_power_kvar, 15.1);
    });

    it('should handle unity power factor (PF = 1.0) with zero reactive power', () => {
      const { apparent_power_kva, active_power_kw, reactive_power_kvar } =
        calculateElectricalParameters(400.0, 100.0, 1.0);

      assert.strictEqual(apparent_power_kva, 69.28);
      assert.strictEqual(active_power_kw, 69.28);
      assert.strictEqual(reactive_power_kvar, 0);
    });

    it('should calculate diurnal load factor within allowable operating limits (0.10 to 1.05)', () => {
      // Daytime peak test (12:00)
      const noon = new Date('2026-10-26T12:00:00');
      const noonFactor = getDiurnalLoadFactor(noon);
      assert.ok(noonFactor >= 0.70 && noonFactor <= 1.05, `Noon factor ${noonFactor} should be in peak range`);

      // Night quiet hours test (02:00)
      const night = new Date('2026-10-26T02:00:00');
      const nightFactor = getDiurnalLoadFactor(night);
      assert.ok(nightFactor >= 0.10 && nightFactor <= 0.30, `Night factor ${nightFactor} should be in quiet range`);
    });

    it('should calculate cumulative energy integrating actual elapsed time', async () => {
      const bldg = await Building.findOne({ code: 'CEE' });
      assert.ok(bldg);

      // Clean readings for test
      await EnergyReading.deleteMany({ building_id: bldg._id });

      const t0 = new Date('2026-10-26T10:00:00Z');
      const baseEnergy = 2400.0;
      // First reading: credits 15-second interval at 30 kW
      // delta = 30 * (15/3600) = 0.125 kWh -> 2400.125
      const e1 = await calculateCumulativeEnergy(bldg._id, 30.0, t0, baseEnergy);
      assert.strictEqual(e1, 2400.125);

      await EnergyReading.create({
        building_id: bldg._id,
        building_code: bldg.code,
        timestamp: t0,
        voltage: 400,
        current: 50,
        power_factor: 0.9,
        frequency: 50,
        apparent_power_kva: 34.64,
        active_power_kw: 30.0,
        reactive_power_kvar: 15.1,
        energy_kwh: e1,
        is_simulated: true
      });

      // Second reading 20 seconds later at 30 kW
      // delta = 30 * (20/3600) = 0.1667 kWh -> 2400.125 + 0.1667 = 2400.2917
      const t1 = new Date(t0.getTime() + 20 * 1000);
      const e2 = await calculateCumulativeEnergy(bldg._id, 30.0, t1, baseEnergy);
      assert.strictEqual(e2, 2400.2917);
    });

    it('should protect against unrealistic energy accumulation during downtime (> 60s gap)', async () => {
      const bldg = await Building.findOne({ code: 'CEE' });
      const last = await EnergyReading.findOne({ building_id: bldg._id }).sort({ timestamp: -1 });

      // Simulate sensor offline for 2 hours (7200 seconds)
      const tAfterDowntime = new Date(new Date(last.timestamp).getTime() + 7200 * 1000);

      // When gap > 60s, it credits only standard 15s interval (30 kW * 15/3600 = 0.125 kWh)
      const eAfterDowntime = await calculateCumulativeEnergy(bldg._id, 30.0, tAfterDowntime, 2400.0);
      assert.strictEqual(eAfterDowntime, Math.round((last.energy_kwh + 0.125) * 10000) / 10000);
    });
  });

  // ==========================================================================
  // 2. Simulation Cycle & Dynamic Inclusion
  // ==========================================================================
  describe('2. Simulation Cycle & Dynamic Inclusion', () => {
    it('should generate telemetry for all campus buildings and mark is_simulated = true', async () => {
      await EnergyReading.deleteMany({});
      const generated = await runSimulationCycle({ verbose: false });

      assert.strictEqual(generated.length >= 6, true, 'Must generate telemetry for at least 6 core buildings');
      for (const r of generated) {
        assert.strictEqual(r.is_simulated, true, 'All generated readings must be marked is_simulated = true');
        assert.ok(r.voltage >= 390 && r.voltage <= 410, `Voltage ${r.voltage} should be near 400V nominal`);
        assert.ok(r.frequency >= 49.5 && r.frequency <= 50.5, `Frequency ${r.frequency} should be near 50Hz`);
        assert.ok(r.power_factor >= 0.80 && r.power_factor <= 1.0, `PF ${r.power_factor} should be within valid bounds`);
      }

      const countInDb = await EnergyReading.countDocuments({});
      assert.strictEqual(countInDb, generated.length);
    });

    it('should dynamically include newly added buildings on subsequent cycles', async () => {
      // Add a 7th building
      const newBldg = await Building.create({
        code: 'RESEARCH_LAB',
        name: 'Advanced Renewable Research Facility',
        rated_power_kw: 65.0,
        is_core: false
      });

      const nextCycle = await runSimulationCycle({ verbose: false });
      const researchReading = nextCycle.find((r) => r.building_code === 'RESEARCH_LAB');

      assert.ok(researchReading, 'New building must automatically receive simulated readings');
      assert.strictEqual(researchReading.building_name, 'Advanced Renewable Research Facility');
      assert.strictEqual(researchReading.is_simulated, true);

      // Clean up test building
      await Building.deleteOne({ _id: newBldg._id });
      await EnergyReading.deleteMany({ building_id: newBldg._id });
    });

    it('should NEVER delete or overwrite real telemetry readings (is_simulated = false)', async () => {
      const bldg = await Building.findOne({ code: 'EIE' });
      const realReading = await EnergyReading.create({
        building_id: bldg._id,
        building_code: bldg.code,
        building_name: bldg.name,
        timestamp: new Date('2026-01-01T00:00:00Z'),
        voltage: 400.5,
        current: 40.0,
        power_factor: 0.95,
        frequency: 50.0,
        apparent_power_kva: 27.71,
        active_power_kw: 26.32,
        reactive_power_kvar: 8.65,
        energy_kwh: 50000.0,
        is_simulated: false // Real reading
      });

      // Run simulation cycle
      await runSimulationCycle({ verbose: false });

      // Verify real reading is completely preserved
      const retrieved = await EnergyReading.findById(realReading._id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.is_simulated, false);
      assert.strictEqual(retrieved.energy_kwh, 50000.0);

      await EnergyReading.deleteOne({ _id: realReading._id });
    });
  });

  // ==========================================================================
  // 3. Electrical Alert Engine & Anomaly Testing
  // ==========================================================================
  describe('3. Electrical Alert Engine & Anomaly Testing', () => {
    let testBldg;

    before(async () => {
      testBldg = await Building.findOne({ code: 'ADMIN' });
      await Alert.deleteMany({ building_id: testBldg._id });
    });

    it('should detect Undervoltage anomaly (< 380V) and trigger CRITICAL alert', async () => {
      await generateSingleReading(testBldg, new Date(), 'LOW_VOLTAGE');

      const alert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'LOW_VOLTAGE',
        is_active: true
      });
      assert.ok(alert, 'LOW_VOLTAGE alert must be active');
      assert.strictEqual(alert.severity, 'CRITICAL');
      assert.ok(alert.measured_value < 380.0);
    });

    it('should SUPPRESS duplicate active alerts for ongoing abnormal conditions', async () => {
      const initialAlertsCount = await Alert.countDocuments({
        building_id: testBldg._id,
        alert_type: 'LOW_VOLTAGE',
        is_active: true
      });
      assert.strictEqual(initialAlertsCount, 1);

      // Run another reading cycle with LOW_VOLTAGE
      await generateSingleReading(testBldg, new Date(), 'LOW_VOLTAGE');

      const countAfterRepeat = await Alert.countDocuments({
        building_id: testBldg._id,
        alert_type: 'LOW_VOLTAGE',
        is_active: true
      });
      assert.strictEqual(countAfterRepeat, 1, 'Duplicate active alert must NOT be created');
    });

    it('should AUTO-CLEAR active alert when voltage returns to normal range', async () => {
      // Normal reading (no anomaly)
      await generateSingleReading(testBldg, new Date(), null);

      const activeAlert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'LOW_VOLTAGE',
        is_active: true
      });
      assert.strictEqual(activeAlert, null, 'Active alert should be cleared');

      const clearedAlert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'LOW_VOLTAGE',
        is_active: false
      });
      assert.ok(clearedAlert, 'Cleared alert record should be retained in history');
      assert.ok(clearedAlert.cleared_at instanceof Date, 'cleared_at must be populated');
    });

    it('should detect Low Power Factor anomaly (< 0.85) and trigger WARNING alert', async () => {
      await generateSingleReading(testBldg, new Date(), 'LOW_PF');

      const alert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'LOW_POWER_FACTOR',
        is_active: true
      });
      assert.ok(alert);
      assert.strictEqual(alert.severity, 'WARNING');
      assert.strictEqual(alert.measured_value, 0.812);

      // Return to normal
      await generateSingleReading(testBldg, new Date(), null);
      const cleared = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'LOW_POWER_FACTOR',
        is_active: true
      });
      assert.strictEqual(cleared, null);
    });

    it('should detect High Load (>90%) and Feeder Overload (>100%) with proper escalation', async () => {
      // 1. High Load (95% rated power)
      await generateSingleReading(testBldg, new Date(), 'HIGH_LOAD');
      const hlAlert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'HIGH_LOAD',
        is_active: true
      });
      assert.ok(hlAlert, 'HIGH_LOAD alert must be active');
      assert.strictEqual(hlAlert.severity, 'WARNING');

      // 2. Overload (115% rated power) -> Escalates to OVERLOAD, clears HIGH_LOAD
      await generateSingleReading(testBldg, new Date(), 'OVERLOAD');
      const olAlert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'OVERLOAD',
        is_active: true
      });
      assert.ok(olAlert, 'OVERLOAD alert must be active');
      assert.strictEqual(olAlert.severity, 'CRITICAL');

      const hlCleared = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'HIGH_LOAD',
        is_active: true
      });
      assert.strictEqual(hlCleared, null, 'HIGH_LOAD should be cleared when escalated to OVERLOAD');

      // 3. Return to normal load -> clears OVERLOAD
      await generateSingleReading(testBldg, new Date(), null);
      const olCleared = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'OVERLOAD',
        is_active: true
      });
      assert.strictEqual(olCleared, null);
    });

    it('should detect silent sensors and clear SENSOR_OFFLINE alert when reading arrives', async () => {
      // Force offline check with 0 second threshold
      const offlineCount = await checkSensorOfflineAlerts(0.0);
      assert.ok(offlineCount > 0, 'Should flag buildings as offline');

      const offlineAlert = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'SENSOR_OFFLINE',
        is_active: true
      });
      assert.ok(offlineAlert, 'SENSOR_OFFLINE alert should be active');

      // Normal reading arrives -> automatically clears SENSOR_OFFLINE
      await generateSingleReading(testBldg, new Date(), null);
      const clearedOffline = await Alert.findOne({
        building_id: testBldg._id,
        alert_type: 'SENSOR_OFFLINE',
        is_active: true
      });
      assert.strictEqual(clearedOffline, null, 'SENSOR_OFFLINE must auto-clear upon telemetry arrival');
    });
  });

  // ==========================================================================
  // 4. API Endpoints
  // ==========================================================================
  describe('4. Telemetry & Alerts API Endpoints', () => {
    it('GET /api/energy/live should reject unauthenticated requests with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/energy/live`);
      assert.strictEqual(res.status, 401);
    });

    it('GET /api/energy/live should return live readings matching dashboard.js contract', async () => {
      const res = await fetch(`${baseUrl}/api/energy/live`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data_source, 'SIMULATED');
      assert.strictEqual(typeof data.count, 'number');
      assert.ok(Array.isArray(data.data));

      const ceeReading = data.data.find((b) => b.building_code === 'CEE');
      assert.ok(ceeReading);
      assert.ok(ceeReading.building_id);
      assert.ok(ceeReading.building_name);
      assert.ok(ceeReading.reading_id);
      assert.strictEqual(typeof ceeReading.active_power_kw, 'number');
      assert.strictEqual(typeof ceeReading.active_alerts_count, 'number');
    });

    it('GET /api/alerts should reject unauthenticated requests with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/alerts`);
      assert.strictEqual(res.status, 401);
    });

    it('GET /api/alerts should return alerts and summary matching alerts.js contract', async () => {
      const res = await fetch(`${baseUrl}/api/alerts`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data_source, 'SIMULATED');
      assert.ok(data.summary, 'Must return summary KPIs');
      assert.strictEqual(typeof data.summary.active_total, 'number');
      assert.strictEqual(typeof data.summary.active_warnings, 'number');
      assert.strictEqual(typeof data.summary.active_critical, 'number');
      assert.strictEqual(typeof data.summary.cleared_total, 'number');
      assert.ok(Array.isArray(data.data));
    });

    it('POST /api/alerts/:id/acknowledge should reject unauthenticated request with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/1/acknowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 401);
    });

    it('POST /api/alerts/:id/acknowledge should strictly reject Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/1/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
    });

    it('POST /api/alerts/:id/acknowledge should reject Administrator without CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/1/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
    });

    it('POST /api/alerts/:id/acknowledge should return HTTP 404 for non-existent alert', async () => {
      const res = await fetch(`${baseUrl}/api/alerts/999999/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 404);
    });

    it('POST /api/alerts/:id/acknowledge should allow Administrator to acknowledge alert with HTTP 200', async () => {
      const bldg = await Building.findOne({ code: 'ADMIN' });
      // Create a test alert
      const testAlert = await triggerAlert(
        bldg,
        'HIGH_FREQUENCY',
        'WARNING',
        50.8,
        50.5,
        'High frequency test alert',
        new Date()
      );

      const targetId = testAlert.id || testAlert._id.toString();

      const res = await fetch(`${baseUrl}/api/alerts/${targetId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({})
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.message.includes('successfully acknowledged'));
      assert.strictEqual(data.alert.acknowledged, 1);
      assert.strictEqual(data.alert.acknowledged_by, adminCredentials.full_name);

      // Verify persistence in MongoDB directly
      const verified = await Alert.findById(testAlert._id);
      assert.strictEqual(verified.acknowledged, true);
      assert.strictEqual(verified.acknowledged_by, adminCredentials.full_name);
      assert.ok(verified.acknowledged_at instanceof Date);
    });
  });
});
