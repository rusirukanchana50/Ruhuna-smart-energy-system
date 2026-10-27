/**
 * phase3b.test.js
 * ---------------
 * Automated test suite for Phase 3B: Complete MongoDB-backed Building CRUD
 * 
 * Tests:
 * 1. READ:
 *    - GET /api/buildings listing all buildings
 *    - Requires authenticated session (401 when unauthenticated)
 *    - Matches frontend expected JSON format
 * 
 * 2. CREATE:
 *    - POST /api/buildings/create
 *    - RBAC: requires Administrator role (403 for Viewer, 401 for unauthenticated)
 *    - CSRF protection: requires valid CSRF token (403 without token)
 *    - Input validation: code, name, positive rated_power_kw (400)
 *    - Code normalization: uppercase trimming
 *    - Duplicate code & name rejection (409 Conflict)
 *    - Persistent MongoDB storage
 * 
 * 3. UPDATE:
 *    - POST /api/buildings/:id/update
 *    - RBAC: Administrator only (403 for Viewer)
 *    - Missing building handling (404)
 *    - Input validation: name, rated power, optional code (400)
 *    - Duplicate conflict detection excluding self (409)
 *    - Persistent MongoDB update
 * 
 * 4. DELETE PREVIEW:
 *    - GET /api/buildings/:id/delete-preview
 *    - RBAC: Administrator only (403 for Viewer)
 *    - Missing building handling (404)
 *    - Safeguards: flags core buildings with can_delete = false
 *    - Counts related dependent telemetry / alerts
 * 
 * 5. DELETE:
 *    - POST /api/buildings/:id/delete
 *    - RBAC: Administrator only (403 for Viewer)
 *    - CSRF token validation
 *    - Missing building handling (404)
 *    - Core building protection: strictly rejects deletion of core buildings (409 Conflict)
 *    - Dependency safeguard: rejects deletion when dependent readings/alerts exist (409 Conflict)
 *    - Safe deletion: successfully deletes eligible building with zero dependencies
 *    - Persistence verification: document deleted from MongoDB
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
const { initBuildings } = require('../init_db');
const app = require('../app');

// Helper to extract session cookie from response headers
function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 3B: MongoDB-Backed Building CRUD Test Suite', () => {
  let server;
  let baseUrl;

  let adminCookie;
  let adminCsrfToken;

  let viewerCookie;
  let viewerCsrfToken;

  const adminCredentials = {
    email: 'admin.phase3b@eng.ruh.ac.lk',
    password: 'AdminPassword2026!',
    full_name: 'Administrator User',
    role: 'Administrator'
  };

  const viewerCredentials = {
    email: 'viewer.phase3b@eng.ruh.ac.lk',
    password: 'ViewerPassword2026!',
    full_name: 'Guest Viewer User',
    role: 'Viewer'
  };

  before(async () => {
    await connectDB(process.env.MONGODB_URI);

    // Initialize clean collections in isolated test DB
    await Building.deleteMany({});
    await User.deleteMany({
      email: { $in: [adminCredentials.email, viewerCredentials.email] }
    });
    await Building.init();
    await User.init();

    // Seed the 6 core campus buildings
    await initBuildings({ silent: true });

    // Seed Admin and Viewer users
    await User.create(adminCredentials);
    await User.create(viewerCredentials);

    // Start ephemeral HTTP server
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // Login as Administrator
    const adminLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: adminCredentials.email,
        password: adminCredentials.password
      })
    });
    assert.strictEqual(adminLoginRes.status, 200, 'Admin login failed in before() hook');
    adminCookie = extractCookie(adminLoginRes);
    const adminData = await adminLoginRes.json();
    adminCsrfToken = adminData.csrf_token;

    // Login as Viewer
    const viewerLoginRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: viewerCredentials.email,
        password: viewerCredentials.password
      })
    });
    assert.strictEqual(viewerLoginRes.status, 200, 'Viewer login failed in before() hook');
    viewerCookie = extractCookie(viewerLoginRes);
    const viewerData = await viewerLoginRes.json();
    viewerCsrfToken = viewerData.csrf_token;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (mongoose.connection.readyState === 1) {
      await User.deleteMany({
        email: { $in: [adminCredentials.email, viewerCredentials.email] }
      });
      await Building.deleteMany({ is_core: { $ne: true } });
      await disconnectDB();
    }

    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });

  // ==========================================================================
  // 1. READ: GET /api/buildings
  // ==========================================================================
  describe('1. READ - GET /api/buildings', () => {
    it('should reject unauthenticated request with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('should allow authenticated users (Viewer or Admin) to list all buildings with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/buildings`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(typeof data.count, 'number');
      assert.strictEqual(data.count >= 6, true, 'Should include at least the 6 core buildings');
      assert.strictEqual(Array.isArray(data.data), true);
    });

    it('should return buildings matching frontend expected schema', async () => {
      const res = await fetch(`${baseUrl}/api/buildings`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();

      const bldg = data.data.find((b) => b.code === 'CEE');
      assert.ok(bldg, 'Core building CEE must be present');
      assert.ok(bldg.id, 'Building must have id');
      assert.strictEqual(bldg.code, 'CEE');
      assert.strictEqual(bldg.name, 'Civil and Environmental Engineering');
      assert.strictEqual(typeof bldg.rated_power_kw, 'number');
      assert.strictEqual(bldg.is_core, true);
    });
  });

  // ==========================================================================
  // 2. CREATE: POST /api/buildings/create
  // ==========================================================================
  describe('2. CREATE - POST /api/buildings/create', () => {
    it('should reject unauthenticated creation with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: 'TEST1',
          name: 'Test Building 1',
          rated_power_kw: 45.0
        })
      });
      assert.strictEqual(res.status, 401);
    });

    it('should reject creation by Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({
          code: 'TEST2',
          name: 'Test Building 2',
          rated_power_kw: 45.0
        })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('should reject creation without valid CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({
          code: 'TEST3',
          name: 'Test Building 3',
          rated_power_kw: 45.0
        })
      });
      assert.strictEqual(res.status, 403);
    });

    it('should reject invalid input: missing or empty fields with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: '',
          name: '',
          rated_power_kw: 50
        })
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('should reject invalid building code format (special characters) with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'INVALID@CODE!',
          name: 'Invalid Code Building',
          rated_power_kw: 50
        })
      });
      assert.strictEqual(res.status, 400);
    });

    it('should reject invalid rated power (negative, zero, or > 10,000 kW) with HTTP 400', async () => {
      const resZero = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'ZERO',
          name: 'Zero Power Building',
          rated_power_kw: 0
        })
      });
      assert.strictEqual(resZero.status, 400);

      const resExcess = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'EXCESS',
          name: 'Excess Power Building',
          rated_power_kw: 15000
        })
      });
      assert.strictEqual(resExcess.status, 400);
    });

    it('should allow Administrator to create building and normalize code to uppercase with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: '  lab_iot  ',
          name: 'Smart IoT Research Facility',
          description: 'Advanced Embedded Systems and IoT Testbed',
          rated_power_kw: 45.5
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.id, 'Response must include created building ID');
      assert.strictEqual(data.data.code, 'LAB_IOT', 'Building code must be trimmed and uppercase');
      assert.strictEqual(data.data.rated_power_kw, 45.5);

      // Verify persistent storage in MongoDB
      const saved = await Building.findById(data.id);
      assert.ok(saved, 'Building must be saved persistently in MongoDB');
      assert.strictEqual(saved.code, 'LAB_IOT');
      assert.strictEqual(saved.name, 'Smart IoT Research Facility');
      assert.strictEqual(saved.is_core, false);
    });

    it('should reject duplicate building code with HTTP 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'LAB_IOT',
          name: 'Another IoT Facility',
          rated_power_kw: 30.0
        })
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('already exists'), 'Message should indicate code already exists');
    });

    it('should reject duplicate building name with HTTP 409 Conflict', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'NEW_CODE',
          name: 'Smart IoT Research Facility',
          rated_power_kw: 30.0
        })
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('already exists'), 'Message should indicate name already exists');
    });
  });

  // ==========================================================================
  // 3. UPDATE: POST /api/buildings/:id/update
  // ==========================================================================
  describe('3. UPDATE - POST /api/buildings/:id/update', () => {
    let testBldgId;

    before(async () => {
      const bldg = await Building.findOne({ code: 'LAB_IOT' });
      assert.ok(bldg);
      testBldgId = bldg._id.toString();
    });

    it('should reject unauthenticated update with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${testBldgId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated Facility',
          rated_power_kw: 55.0
        })
      });
      assert.strictEqual(res.status, 401);
    });

    it('should reject update by Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${testBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: viewerCookie,
          'X-CSRF-Token': viewerCsrfToken
        },
        body: JSON.stringify({
          name: 'Updated Facility',
          rated_power_kw: 55.0
        })
      });
      assert.strictEqual(res.status, 403);
    });

    it('should return HTTP 404 when updating non-existent building ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/buildings/${fakeId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          name: 'Non Existent Facility',
          rated_power_kw: 50.0
        })
      });
      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('should reject invalid input values with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${testBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          name: 'A', // too short (< 2 chars)
          rated_power_kw: -10
        })
      });
      assert.strictEqual(res.status, 400);
    });

    it('should reject code conflict with another building with HTTP 409', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${testBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'CEE', // conflicts with existing core building CEE
          name: 'Renamed Facility',
          rated_power_kw: 50.0
        })
      });
      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.ok(data.message.includes('already in use'));
    });

    it('should allow Administrator to update building and retain its own code with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${testBldgId}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
          'X-CSRF-Token': adminCsrfToken
        },
        body: JSON.stringify({
          code: 'LAB_IOT', // retaining same code
          name: 'Advanced IoT & AI Computing Facility',
          description: 'Updated high-performance facility',
          rated_power_kw: 75.0
        })
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.data.name, 'Advanced IoT & AI Computing Facility');
      assert.strictEqual(data.data.rated_power_kw, 75.0);

      // Verify persistence in MongoDB directly
      const updated = await Building.findById(testBldgId);
      assert.strictEqual(updated.name, 'Advanced IoT & AI Computing Facility');
      assert.strictEqual(updated.rated_power_kw, 75.0);
    });
  });

  // ==========================================================================
  // 4. DELETE PREVIEW: GET /api/buildings/:id/delete-preview
  // ==========================================================================
  describe('4. DELETE PREVIEW - GET /api/buildings/:id/delete-preview', () => {
    let coreBldg;
    let customBldg;

    before(async () => {
      coreBldg = await Building.findOne({ code: 'CEE' });
      customBldg = await Building.findOne({ code: 'LAB_IOT' });
    });

    it('should reject unauthenticated request with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete-preview`);
      assert.strictEqual(res.status, 401);
    });

    it('should reject Viewer role with HTTP 403 Forbidden', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete-preview`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 403);
    });

    it('should return HTTP 404 for non-existent building ID', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/buildings/${fakeId}/delete-preview`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 404);
    });

    it('should return can_delete = false for core campus building', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${coreBldg._id}/delete-preview`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.preview.is_core, true);
      assert.strictEqual(data.preview.can_delete, false);
      assert.ok(data.preview.rejection_reason.includes('protected'));
    });

    it('should return can_delete = true for demonstration building without dependencies', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete-preview`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.preview.is_core, false);
      assert.strictEqual(data.preview.total_dependencies, 0);
      assert.strictEqual(data.preview.can_delete, true);
      assert.strictEqual(data.preview.rejection_reason, null);
    });

    it('should return can_delete = false when building has dependent readings in MongoDB', async () => {
      // Simulate existing reading in energy_readings collection
      const readingsCol = mongoose.connection.db.collection('energy_readings');
      await readingsCol.insertOne({
        building_id: customBldg._id,
        is_simulated: 1,
        active_power_kw: 22.5,
        timestamp: new Date()
      });

      try {
        const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete-preview`, {
          headers: { Cookie: adminCookie }
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.status, 'success');
        assert.strictEqual(data.preview.total_readings, 1);
        assert.strictEqual(data.preview.total_dependencies, 1);
        assert.strictEqual(data.preview.can_delete, false);
        assert.ok(data.preview.rejection_reason.includes('Historical electrical data must be preserved'));
      } finally {
        await readingsCol.deleteMany({ building_id: customBldg._id });
      }
    });
  });

  // ==========================================================================
  // 5. DELETE: POST /api/buildings/:id/delete
  // ==========================================================================
  describe('5. DELETE - POST /api/buildings/:id/delete', () => {
    let coreBldg;
    let customBldg;

    before(async () => {
      coreBldg = await Building.findOne({ code: 'EIE' });
      customBldg = await Building.findOne({ code: 'LAB_IOT' });
    });

    it('should reject unauthenticated delete with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 401);
    });

    it('should reject delete by Viewer role with HTTP 403 Forbidden', async () => {
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

    it('should reject delete without valid CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie
        },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 403);
    });

    it('should return HTTP 404 when deleting non-existent building', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await fetch(`${baseUrl}/api/buildings/${fakeId}/delete`, {
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

    it('should strictly protect core campus buildings and reject deletion with HTTP 409 Conflict', async () => {
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
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('Core buildings are protected'));

      // Verify core building still exists in MongoDB
      const checkCore = await Building.findById(coreBldg._id);
      assert.ok(checkCore, 'Core building must NOT be deleted from MongoDB');
    });

    it('should reject deletion when building has dependent records (readings/alerts) with HTTP 409 Conflict', async () => {
      // Simulate dependent alert record
      const alertsCol = mongoose.connection.db.collection('alerts');
      await alertsCol.insertOne({
        building_id: customBldg._id,
        alert_type: 'HIGH_LOAD',
        severity: 'WARNING',
        timestamp: new Date()
      });

      try {
        const res = await fetch(`${baseUrl}/api/buildings/${customBldg._id}/delete`, {
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
        assert.strictEqual(data.status, 'error');
        assert.ok(data.message.includes('Historical electrical data must be preserved'));

        // Verify building was not deleted
        const stillExists = await Building.findById(customBldg._id);
        assert.ok(stillExists, 'Building with dependencies must NOT be deleted');
      } finally {
        await alertsCol.deleteMany({ building_id: customBldg._id });
      }
    });

    it('should allow Administrator to safely delete non-core building without dependencies with HTTP 200', async () => {
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
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.ok(data.message.includes('successfully deleted'));

      // Verify permanent deletion in MongoDB
      const deletedCheck = await Building.findById(customBldg._id);
      assert.strictEqual(deletedCheck, null, 'Deleted building must no longer exist in MongoDB');
    });
  });
});
