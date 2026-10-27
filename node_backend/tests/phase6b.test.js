/**
 * phase6b.test.js
 * ----------------
 * Automated test suite for Phase 6B: Live Dashboard and Building Management Frontend Integration.
 * 
 * Verifies:
 * 1. Live Energy Telemetry contract matching dashboard.js (/api/energy/live).
 * 2. Dashboard Server-Side Rendering (SSR) & Persistence across refreshes.
 * 3. Building Management CRUD integration with MongoDB:
 *    - Create building with validation & CSRF
 *    - Update building with validation & CSRF
 *    - Core facility protection safeguards (CEE, EIE, etc.)
 *    - Safe deletion preview and execution
 *    - Demonstration cleanup (/delete-simulated)
 * 4. Role-based access control (RBAC):
 *    - Administrator privileges
 *    - Strict Viewer restrictions (HTTP 403)
 * 5. Dynamic simulator telemetry inclusion for newly created campus buildings.
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
const { initBuildings } = require('../init_db');
const { runSimulationCycle } = require('../simulator');

function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 6B: Live Dashboard & Building Management Frontend Integration', () => {
  let server;
  let baseUrl;

  const adminCredentials = {
    full_name: 'Phase6B Administrator',
    email: 'phase6b.admin@eng.ruh.ac.lk',
    password: 'AdminPasswordPhase6B!',
    role: 'Administrator'
  };

  const viewerCredentials = {
    full_name: 'Phase6B Viewer',
    email: 'phase6b.viewer@eng.ruh.ac.lk',
    password: 'ViewerPasswordPhase6B!',
    role: 'Viewer'
  };

  let adminCookie = '';
  let adminCsrfToken = '';
  let viewerCookie = '';
  let viewerCsrfToken = '';

  before(async () => {
    await connectDB(process.env.MONGODB_URI);

    // Initialize the 6 core campus buildings
    await initBuildings({ silent: true });

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

    // Authenticate Admin to obtain session cookie & CSRF token
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

    // Run one initial simulation cycle so readings are available
    await runSimulationCycle({ silent: true });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState === 1) {
      // Clean up test buildings created during testing
      await Building.deleteMany({
        code: { $in: ['LIB_P6B', 'ROBOTICS', 'TEST_CLEANUP', 'DEMO_DEL'] }
      });
      await User.deleteMany({
        email: { $in: [adminCredentials.email, viewerCredentials.email] }
      });
      await disconnectDB();
    }

    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });

  // --------------------------------------------------------------------------
  // 1. Live Telemetry API Contract for dashboard.js
  // --------------------------------------------------------------------------
  describe('1. Live Telemetry API Contract (/api/energy/live)', () => {
    it('1.1 should reject unauthenticated request with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/energy/live`, {
        headers: { Accept: 'application/json' }
      });
      assert.strictEqual(res.status, 401);
    });

    it('1.2 should return live telemetry payload matching dashboard.js contract', async () => {
      const res = await fetch(`${baseUrl}/api/energy/live`, {
        headers: { Cookie: adminCookie, Accept: 'application/json' }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();

      assert.strictEqual(body.status, 'success');
      assert.strictEqual(body.data_source, 'SIMULATED');
      assert.ok(Array.isArray(body.data), 'body.data must be an array');
      assert.ok(body.data.length >= 6, 'Must include at least 6 core buildings');

      // Verify every reading contains the properties dashboard.js uses
      const r = body.data[0];
      assert.ok(r.building_id, 'Must contain building_id');
      assert.ok(r.building_code, 'Must contain building_code');
      assert.ok(r.building_name, 'Must contain building_name');
      assert.ok(typeof r.voltage === 'number', 'voltage must be a number');
      assert.ok(typeof r.current === 'number', 'current must be a number');
      assert.ok(typeof r.active_power_kw === 'number', 'active_power_kw must be a number');
      assert.ok(typeof r.apparent_power_kva === 'number', 'apparent_power_kva must be a number');
      assert.ok(typeof r.reactive_power_kvar === 'number', 'reactive_power_kvar must be a number');
      assert.ok(typeof r.power_factor === 'number', 'power_factor must be a number');
      assert.ok(typeof r.frequency === 'number', 'frequency must be a number');
      assert.ok(typeof r.energy_kwh === 'number', 'energy_kwh must be a number');
      assert.ok(r.timestamp, 'timestamp must be present');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Dashboard Server-Side Rendering & Persistence
  // --------------------------------------------------------------------------
  describe('2. Dashboard SSR & Role-Based UI Controls (/dashboard)', () => {
    it('2.1 should render dashboard with all core campus building cards', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();

      // Check all 6 core building codes appear in DOM
      const coreCodes = ['CEE', 'EIE', 'MME', 'MENA', 'ADMIN', 'AUDI'];
      for (const code of coreCodes) {
        assert.ok(html.includes(code), `Dashboard HTML must contain building code ${code}`);
      }

      // Check CSRF meta tag
      assert.ok(html.includes('meta name="csrf-token"'), 'CSRF token meta tag must be present in HTML');
      assert.ok(html.includes('id="telemetryGrid"'), 'Telemetry grid container must be present');
      assert.ok(html.includes('activePowerLineChart'), 'Line chart canvas must be present');
      assert.ok(html.includes('activePowerBarChart'), 'Bar chart canvas must be present');
    });

    it('2.2 Administrator dashboard must include Manage Buildings action button and modal', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('openManageBuildingsBtn'), 'Admin dashboard must include openManageBuildingsBtn');
      assert.ok(html.includes('id="manageBuildingsModal"'), 'Admin dashboard must include manageBuildingsModal');
      assert.ok(html.includes('id="addBuildingForm"'), 'Admin dashboard must include addBuildingForm');
    });

    it('2.3 Viewer dashboard must NOT include Manage Buildings button or admin modal', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(!html.includes('openManageBuildingsBtn'), 'Viewer must not see Manage Buildings button');
      assert.ok(!html.includes('id="manageBuildingsModal"'), 'Viewer must not receive manageBuildingsModal markup');
      assert.ok(html.includes('role-viewer'), 'Viewer role badge must be rendered');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Building Creation & Persistence (POST /api/buildings/create)
  // --------------------------------------------------------------------------
  describe('3. Building Creation (POST /api/buildings/create)', () => {
    it('3.1 should reject unauthenticated creation with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'LIB_P6B', name: 'Faculty Library Phase 6B', rated_power_kw: 60.0 })
      });
      assert.strictEqual(res.status, 401);
    });

    it('3.2 should strictly reject Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({ code: 'LIB_P6B', name: 'Faculty Library Phase 6B', rated_power_kw: 60.0 })
      });
      assert.strictEqual(res.status, 403);
    });

    it('3.3 should reject creation without CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({ code: 'LIB_P6B', name: 'Faculty Library Phase 6B', rated_power_kw: 60.0 })
      });
      assert.strictEqual(res.status, 403);
    });

    it('3.4 should reject invalid inputs with HTTP 400', async () => {
      // Empty code
      const resEmpty = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ code: '', name: 'Test Library', rated_power_kw: 50.0 })
      });
      assert.strictEqual(resEmpty.status, 400);

      // Non-positive rated power
      const resPower = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ code: 'INV_PWR', name: 'Invalid Power', rated_power_kw: -5.0 })
      });
      assert.strictEqual(resPower.status, 400);
    });

    it('3.5 should allow Administrator to create building and verify persistence in MongoDB and HTML', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: '  lib_p6b  ',
          name: 'Faculty Library Phase 6B',
          description: 'University of Ruhuna Engineering Library Complex',
          rated_power_kw: 60.0
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data.code, 'LIB_P6B');

      // 1. Verify in MongoDB directly
      const saved = await Building.findOne({ code: 'LIB_P6B' });
      assert.ok(saved, 'Building must exist in MongoDB');
      assert.strictEqual(saved.name, 'Faculty Library Phase 6B');
      assert.strictEqual(saved.rated_power_kw, 60.0);
      assert.strictEqual(saved.is_core, false);

      // 2. Verify persistence on page refresh (GET /dashboard)
      const dashRes = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(dashRes.status, 200);
      const dashHtml = await dashRes.text();
      assert.ok(dashHtml.includes('LIB_P6B'), 'Newly created building code must appear in refreshed dashboard HTML');
      assert.ok(dashHtml.includes('Faculty Library Phase 6B'), 'Newly created building name must appear in refreshed dashboard HTML');
    });

    it('3.6 should reject duplicate building code with HTTP 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'LIB_P6B',
          name: 'Another Duplicate Library',
          rated_power_kw: 40.0
        })
      });
      assert.strictEqual(res.status, 409);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Building Update & Persistence (POST /api/buildings/:id/update)
  // --------------------------------------------------------------------------
  describe('4. Building Update (POST /api/buildings/:id/update)', () => {
    let createdBldgId;

    before(async () => {
      const bldg = await Building.findOne({ code: 'LIB_P6B' });
      assert.ok(bldg);
      createdBldgId = bldg._id.toString();
    });

    it('4.1 should reject unauthenticated update with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${createdBldgId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Library', rated_power_kw: 75.0 })
      });
      assert.strictEqual(res.status, 401);
    });

    it('4.2 should reject update by Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${createdBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({ name: 'Updated Library', rated_power_kw: 75.0 })
      });
      assert.strictEqual(res.status, 403);
    });

    it('4.3 should return HTTP 404 for non-existent building ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/buildings/${fakeId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ name: 'Does Not Exist', rated_power_kw: 50.0 })
      });
      assert.strictEqual(res.status, 404);
    });

    it('4.4 should reject code conflict with another existing building with HTTP 409', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${createdBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'CEE', // conflicts with core CEE
          name: 'Renamed Library',
          rated_power_kw: 60.0
        })
      });
      assert.strictEqual(res.status, 409);
    });

    it('4.5 should allow Administrator to update building and verify persistence in MongoDB and HTML', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${createdBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'LIB_P6B',
          name: 'Advanced Faculty Library & Media Center',
          rated_power_kw: 85.0
        })
      });
      assert.strictEqual(res.status, 200);

      // Verify in MongoDB
      const updated = await Building.findById(createdBldgId);
      assert.strictEqual(updated.name, 'Advanced Faculty Library & Media Center');
      assert.strictEqual(updated.rated_power_kw, 85.0);

      // Verify persistence on GET /dashboard
      const dashRes = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(dashRes.status, 200);
      const dashHtml = await dashRes.text();
      assert.ok(dashHtml.includes('Advanced Faculty Library &amp; Media Center') || dashHtml.includes('Advanced Faculty Library & Media Center'));
      assert.ok(dashHtml.includes('85 kW') || dashHtml.includes('85.0 kW'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Building Deletion Safeguards & Execution (POST /api/buildings/:id/delete)
  // --------------------------------------------------------------------------
  describe('5. Building Deletion Safeguards (GET /delete-preview & POST /delete)', () => {
    let coreBldg;
    let customBldg;

    before(async () => {
      coreBldg = await Building.findOne({ code: 'CEE' });
      customBldg = await Building.findOne({ code: 'LIB_P6B' });
    });

    it('5.1 delete-preview for core campus building must return can_delete: false', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${coreBldg._id}/delete-preview`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.preview.can_delete, false);
      assert.ok(data.preview.rejection_reason.includes('protected'));
    });

    it('5.2 POST /delete on core campus building must be rejected with HTTP 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${coreBldg._id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.ok(data.message.includes('Core buildings are protected'));
    });

    it('5.3 POST /delete by Viewer role must be rejected with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete`, {
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

    it('5.4 delete-preview for building without dependencies must return can_delete: true', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete-preview`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.preview.can_delete, true);
    });

    it('5.5 Administrator safely deletes eligible building and verifies removal from dashboard HTML', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 200);

      // Verify removed from MongoDB
      const found = await Building.findById(customBldg._id);
      assert.strictEqual(found, null);

      // Verify removed from dashboard view
      const dashRes = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(dashRes.status, 200);
      const dashHtml = await dashRes.text();
      assert.ok(!dashHtml.includes('LIB_P6B'), 'Deleted building code must no longer appear in dashboard HTML');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Demonstration Facility Removal (POST /api/buildings/:id/delete-simulated)
  // --------------------------------------------------------------------------
  describe('6. Demonstration Facility Cleanup (/api/buildings/:id/delete-simulated)', () => {
    let demoBldg;

    before(async () => {
      demoBldg = await Building.create({
        code: 'DEMO_DEL',
        name: 'Demonstration Cleanup Complex',
        rated_power_kw: 50.0,
        is_core: false
      });

      // Insert simulated readings for this demonstration facility
      await EnergyReading.create({
        building_id: demoBldg._id,
        building_code: 'DEMO_DEL',
        building_name: demoBldg.name,
        timestamp: new Date(),
        voltage: 400.0,
        current: 50.0,
        active_power_kw: 30.0,
        apparent_power_kva: 34.6,
        reactive_power_kvar: 17.2,
        power_factor: 0.88,
        frequency: 50.0,
        energy_kwh: 120.0,
        is_simulated: true
      });
    });

    it('6.1 should reject delete-simulated on core building with HTTP 403', async () => {
      const coreBldg = await Building.findOne({ code: 'EIE' });
      const res = await fetch(`${baseUrl}/api/buildings/${coreBldg._id}/delete-simulated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ confirm_code: 'EIE' })
      });
      assert.strictEqual(res.status, 403);
    });

    it('6.2 should reject mismatched confirmation code with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${demoBldg._id}/delete-simulated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ confirm_code: 'WRONG_CODE' })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.message.includes('does not match'));
    });

    it('6.3 should safely delete demonstration building and purge its simulated readings with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${demoBldg._id}/delete-simulated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({ confirm_code: 'DEMO_DEL' })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.details.deleted_readings >= 1, 'Should delete at least 1 simulated reading');

      // Verify building is removed
      const found = await Building.findById(demoBldg._id);
      assert.strictEqual(found, null);

      // Verify simulated readings are purged
      const readings = await EnergyReading.find({ building_code: 'DEMO_DEL' });
      assert.strictEqual(readings.length, 0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Simulator Inclusion for Newly Added Buildings
  // --------------------------------------------------------------------------
  describe('7. Simulator Inclusion for Newly Added Buildings', () => {
    let roboticsBldg;

    before(async () => {
      roboticsBldg = await Building.create({
        code: 'ROBOTICS',
        name: 'Robotics and Automation Lab',
        rated_power_kw: 65.0,
        is_core: false
      });
    });

    after(async () => {
      if (roboticsBldg && roboticsBldg._id) {
        await EnergyReading.deleteMany({ building_id: roboticsBldg._id });
        await Building.deleteOne({ _id: roboticsBldg._id });
      }
    });

    it('7.1 should dynamically generate telemetry for newly created building on next cycle', async () => {
      // Run simulator cycle
      const readings = await runSimulationCycle({ verbose: false });
      assert.ok(Array.isArray(readings) && readings.length >= 7, 'Cycle should include core buildings + ROBOTICS');

      // Verify reading saved in MongoDB for ROBOTICS
      const reading = await EnergyReading.findOne({ building_code: 'ROBOTICS' }).sort({ timestamp: -1 });
      assert.ok(reading, 'Telemetry reading must be saved for ROBOTICS');
      assert.strictEqual(reading.is_simulated, true);
      assert.ok(reading.active_power_kw > 0);

      // Verify GET /api/energy/live immediately returns the new building
      const liveRes = await fetch(`${baseUrl}/api/energy/live`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(liveRes.status, 200);
      const liveData = await liveRes.json();
      const roboticsLive = liveData.data.find((d) => d.building_code === 'ROBOTICS');
      assert.ok(roboticsLive, 'Live telemetry must contain ROBOTICS building');
      assert.strictEqual(roboticsLive.building_name, 'Robotics and Automation Lab');
      assert.ok(roboticsLive.active_power_kw > 0);
    });
  });
});
