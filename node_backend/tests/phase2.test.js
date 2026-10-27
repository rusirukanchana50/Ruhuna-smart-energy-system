/**
 * phase2.test.js
 * --------------
 * Focused automated test suite for Phase 2:
 * 1. MongoDB Connection
 * 2. Building Model validation, uppercase enforcement, and unique constraints
 * 3. Safe, repeatable 6-building initial seeding without duplicates
 * 4. User Model validation, role enforcement, and unique constraints
 * 5. Secure password hashing with bcrypt
 * 6. Password verification (comparePassword)
 * 7. Duplicate user email handling
 * 8. Express app health endpoint
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ruhuna_energy_test';

const { connectDB, disconnectDB } = require('../config/db');
const Building = require('../models/Building');
const User = require('../models/User');
const { initBuildings } = require('../init_db');
const { createUserAccount } = require('../create_user');
const app = require('../app');

describe('Phase 2: Project Scaffolding & Data Modeling Test Suite', () => {
  before(async () => {
    await connectDB(process.env.MONGODB_URI);
    // Clear test collections for clean run
    await Building.deleteMany({});
    await User.deleteMany({});
    // Ensure unique indexes are built in MongoDB
    await Building.init();
    await User.init();
  });

  after(async () => {
    // Clean up test database
    if (mongoose.connection.readyState === 1) {
      await Building.deleteMany({});
      await User.deleteMany({});
      await disconnectDB();
    }
    if (app.sessionStore && typeof app.sessionStore.close === 'function') {
      try {
        app.sessionStore.close();
      } catch (err) {}
    }
  });

  // --------------------------------------------------------------------------
  // 1. MongoDB Connection
  // --------------------------------------------------------------------------
  describe('1. MongoDB Connection', () => {
    it('should successfully establish connection to MongoDB', () => {
      assert.strictEqual(mongoose.connection.readyState, 1, 'MongoDB connection state should be 1 (Connected)');
      assert.ok(mongoose.connection.host, 'MongoDB host should be defined');
    });
  });

  // --------------------------------------------------------------------------
  // 2. Building Model & Validation
  // --------------------------------------------------------------------------
  describe('2. Building Model & Server-Side Validation', () => {
    it('should enforce uppercase on building code and trim whitespace', async () => {
      const bldg = await Building.create({
        name: '  Test Engineering Facility  ',
        code: '  tef  ',
        rated_power_kw: 45.0
      });

      assert.strictEqual(bldg.code, 'TEF', 'Building code should be automatically uppercased and trimmed');
      assert.strictEqual(bldg.name, 'Test Engineering Facility', 'Building name should be trimmed');
      assert.strictEqual(bldg.is_core, false, 'Default is_core should be false');
      assert.strictEqual(bldg.rated_power_kw, 45.0);

      await Building.findByIdAndDelete(bldg._id);
    });

    it('should reject creation when required fields are missing', async () => {
      await assert.rejects(
        async () => {
          await Building.create({ description: 'No code or name' });
        },
        /Building (name|code) is required/
      );
    });

    it('should reject non-positive rated power capacity', async () => {
      await assert.rejects(
        async () => {
          await Building.create({
            name: 'Invalid Power Building',
            code: 'IPB',
            rated_power_kw: -10
          });
        },
        /Rated power must be a positive number/
      );
    });

    it('should enforce unique uppercase code index and reject duplicate codes', async () => {
      const b1 = await Building.create({
        name: 'First Department',
        code: 'DEPT',
        rated_power_kw: 50.0
      });

      await assert.rejects(
        async () => {
          // Attempt duplicate code in lowercase (schema pre-save normalizes to DEPT)
          await Building.create({
            name: 'Second Department',
            code: 'dept',
            rated_power_kw: 55.0
          });
        },
        /(E11000|duplicate key)/i
      );

      await Building.findByIdAndDelete(b1._id);
    });

    it('should enforce unique name index and reject duplicate names', async () => {
      const b1 = await Building.create({
        name: 'Unique Complex',
        code: 'UC1',
        rated_power_kw: 30.0
      });

      await assert.rejects(
        async () => {
          await Building.create({
            name: 'Unique Complex',
            code: 'UC2',
            rated_power_kw: 35.0
          });
        },
        /(E11000|duplicate key)/i
      );

      await Building.findByIdAndDelete(b1._id);
    });
  });

  // --------------------------------------------------------------------------
  // 3. Repeatable Building Seeding (initBuildings)
  // --------------------------------------------------------------------------
  describe('3. Repeatable 6 Core Campus Building Initializer', () => {
    it('should create exactly the 6 original campus buildings on initial run', async () => {
      await Building.deleteMany({});
      const run1 = await initBuildings({ silent: true });

      assert.strictEqual(run1.created, 6, 'Should create 6 core buildings on first run');
      assert.strictEqual(run1.existing, 0, 'Should have 0 existing on clean setup');

      const count = await Building.countDocuments();
      assert.strictEqual(count, 6, 'Total building count should be 6');

      // Verify all 6 core codes and is_core flag
      const expectedCodes = ['CEE', 'EIE', 'MME', 'MENA', 'ADMIN', 'AUDI'];
      for (const code of expectedCodes) {
        const found = await Building.findOne({ code });
        assert.ok(found, `Building with code ${code} must exist`);
        assert.strictEqual(found.is_core, true, `Building ${code} must have is_core: true`);
      }
    });

    it('should be safe and idempotent on repeated runs without creating duplicates', async () => {
      const run2 = await initBuildings({ silent: true });

      assert.strictEqual(run2.created, 0, 'Second run should create 0 new buildings');
      assert.strictEqual(run2.existing, 6, 'Second run should detect all 6 existing buildings');

      const count = await Building.countDocuments();
      assert.strictEqual(count, 6, 'Total building count must remain exactly 6 without duplicates');
    });
  });

  // --------------------------------------------------------------------------
  // 4. User Model & Role Validation
  // --------------------------------------------------------------------------
  describe('4. User Model & Server-Side Validation', () => {
    it('should reject invalid user email formats', async () => {
      await assert.rejects(
        async () => {
          await User.create({
            full_name: 'Invalid Email User',
            email: 'not-an-email',
            password: 'validpassword123',
            role: 'Viewer'
          });
        },
        /is not a valid university email address/
      );
    });

    it('should reject unauthorized user roles', async () => {
      await assert.rejects(
        async () => {
          await User.create({
            full_name: 'Test Role User',
            email: 'role.test@eng.ruh.ac.lk',
            password: 'validpassword123',
            role: 'SuperAdmin' // Only Administrator or Viewer allowed
          });
        },
        /Role must be either 'Administrator' or 'Viewer'/
      );
    });

    it('should reject passwords shorter than 6 characters', async () => {
      await assert.rejects(
        async () => {
          await User.create({
            full_name: 'Short Password User',
            email: 'shortpass@eng.ruh.ac.lk',
            password: '12345',
            role: 'Viewer'
          });
        },
        /Password must be at least 6 characters long/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 5. Secure Password Hashing & Verification
  // --------------------------------------------------------------------------
  describe('5. Password Hashing and Verification (Bcrypt)', () => {
    it('should securely hash password before storing and verify correctly', async () => {
      const plainPassword = 'EngineeringSecure2026!';
      const user = await createUserAccount({
        full_name: 'Faculty Dean',
        email: 'dean@eng.ruh.ac.lk',
        password: plainPassword,
        role: 'Administrator'
      });

      assert.ok(user._id, 'User ID should be generated');
      assert.notStrictEqual(user.password, plainPassword, 'Password must not be stored in plain text');
      assert.ok(user.password.startsWith('$2a$') || user.password.startsWith('$2b$'), 'Password must be a valid bcrypt hash');

      // Verify comparePassword method
      const isMatch = await user.comparePassword(plainPassword);
      assert.strictEqual(isMatch, true, 'comparePassword should return true for correct password');

      const isWrongMatch = await user.comparePassword('WrongPassword123');
      assert.strictEqual(isWrongMatch, false, 'comparePassword should return false for incorrect password');
    });

    it('should update password with re-hashing when reset', async () => {
      const originalUser = await User.findOne({ email: 'dean@eng.ruh.ac.lk' });
      const oldHash = originalUser.password;

      const newPassword = 'NewDeanPassword2026!';
      const updatedUser = await createUserAccount({
        full_name: 'Faculty Dean',
        email: 'dean@eng.ruh.ac.lk',
        password: newPassword,
        role: 'Administrator'
      });

      assert.notStrictEqual(updatedUser.password, oldHash, 'Password hash must change upon reset');
      const isNewMatch = await updatedUser.comparePassword(newPassword);
      assert.strictEqual(isNewMatch, true, 'Updated password must verify successfully');

      const isOldMatch = await updatedUser.comparePassword('EngineeringSecure2026!');
      assert.strictEqual(isOldMatch, false, 'Old password should no longer match');
    });

    it('should not expose password hash in toJSON output', async () => {
      const user = await User.findOne({ email: 'dean@eng.ruh.ac.lk' });
      const json = user.toJSON();

      assert.strictEqual(json.password, undefined, 'password must be excluded from toJSON output');
      assert.strictEqual(json.email, 'dean@eng.ruh.ac.lk');
      assert.strictEqual(json.role, 'Administrator');
    });

    it('should enforce unique email index and reject duplicate accounts', async () => {
      await assert.rejects(
        async () => {
          // Attempt duplicate with uppercase email
          await User.create({
            full_name: 'Another Dean',
            email: 'DEAN@ENG.RUH.AC.LK',
            password: 'somepassword123',
            role: 'Viewer'
          });
        },
        /(E11000|duplicate key)/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // 6. Express Health Endpoint
  // --------------------------------------------------------------------------
  describe('6. Express Health & Diagnostic Endpoint', () => {
    it('should respond with status ok and connected database state', async () => {
      // Simulate request via app handler
      const req = {};
      let responseData = null;
      const res = {
        json: (data) => {
          responseData = data;
        }
      };

      // Call the health route handler
      const route = app._router.stack.find(r => r.route && r.route.path === '/api/health');
      assert.ok(route, '/api/health route must be registered');

      route.route.stack[0].handle(req, res);

      assert.ok(responseData, 'Health route should produce a JSON response');
      assert.strictEqual(responseData.status, 'ok');
      assert.strictEqual(responseData.database.connected, true);
      assert.strictEqual(responseData.database.status, 'Connected');
    });
  });
});
