/**
 * phase3a.test.js
 * ---------------
 * Automated test suite for Phase 3A:
 * 1. POST /login credential validation and authentication
 * 2. express-session persistence with MongoDB store
 * 3. GET /api/auth/me profile retrieval and role verification
 * 4. requireAuth and requireAdmin RBAC enforcement (Viewer blocked from Admin)
 * 5. CSRF defense: missing token, invalid token, foreign origin, valid token
 * 6. POST /logout session destruction
 * 7. Prevention of sensitive data leakage (no passwords, hashes, or secrets)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

// Use isolated test database
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/ruhuna_energy_test';
process.env.SESSION_SECRET = 'test-suite-secure-random-secret-key-32chars';

const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const app = require('../app');

// Helper to extract cookie from fetch response headers
function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 3A: Authentication, Sessions & RBAC Test Suite', () => {
  let server;
  let baseUrl;

  // Test credentials
  const adminCredentials = {
    email: 'admin.phase3a@eng.ruh.ac.lk',
    password: 'AdminPassword2026!',
    full_name: 'System Admin',
    role: 'Administrator'
  };

  const viewerCredentials = {
    email: 'viewer.phase3a@eng.ruh.ac.lk',
    password: 'ViewerPassword2026!',
    full_name: 'Guest Viewer',
    role: 'Viewer'
  };

  before(async () => {
    await connectDB(process.env.MONGODB_URI);

    // Clean up test users and sessions
    await User.deleteMany({
      email: { $in: [adminCredentials.email, viewerCredentials.email] }
    });

    // Create test accounts (User pre-save hook handles bcrypt hashing)
    await User.create(adminCredentials);
    await User.create(viewerCredentials);

    // Start ephemeral HTTP server for live network/session testing
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    // Shut down test HTTP server
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    // Clean up test data and database connection
    if (mongoose.connection.readyState === 1) {
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
  // 1. POST /login - Validation & Authentication
  // --------------------------------------------------------------------------
  describe('1. POST /login - Authentication & Credentials', () => {
    it('should reject missing email or password with HTTP 400', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.strictEqual(data.message, 'Please provide both email and password.');
    });

    it('should reject non-existent email with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unknown.user@eng.ruh.ac.lk',
          password: 'SomePassword123!'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.strictEqual(data.message, 'Invalid email or password. Please try again.');
    });

    it('should reject incorrect password with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: 'IncorrectPassword999!'
        })
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.strictEqual(data.message, 'Invalid email or password. Please try again.');
    });

    it('should authenticate Administrator successfully with HTTP 200 and issue session cookie & CSRF token', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.user.email, adminCredentials.email);
      assert.strictEqual(data.user.role, 'Administrator');
      assert.ok(data.csrf_token, 'CSRF token must be returned on login');

      // Verify Set-Cookie header contains session ID
      const cookie = extractCookie(res);
      assert.ok(cookie && cookie.startsWith('connect.sid='), 'Session cookie must be issued');
    });

    it('should authenticate Viewer successfully with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: viewerCredentials.email,
          password: viewerCredentials.password
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.user.email, viewerCredentials.email);
      assert.strictEqual(data.user.role, 'Viewer');
    });
  });

  // --------------------------------------------------------------------------
  // 2. GET /api/auth/me - Session Persistence & Profile Retrieval
  // --------------------------------------------------------------------------
  describe('2. GET /api/auth/me - Session Persistence', () => {
    it('should reject unauthenticated request with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Accept: 'application/json' }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.strictEqual(data.message, 'Unauthorized access. Please log in first.');
    });

    it('should return user profile and CSRF token when session cookie is provided', async () => {
      // 1. Log in to get cookie
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      const cookie = extractCookie(loginRes);

      // 2. Access /api/auth/me using cookie
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json'
        }
      });

      assert.strictEqual(meRes.status, 200);
      const data = await meRes.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.user.email, adminCredentials.email);
      assert.strictEqual(data.user.role, 'Administrator');
      assert.strictEqual(data.user.full_name, adminCredentials.full_name);
      assert.ok(data.csrf_token, 'CSRF token should be present in profile response');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Role-Based Access Control (RBAC) - requireAuth and requireAdmin
  // --------------------------------------------------------------------------
  describe('3. Role-Based Access Control (RBAC)', () => {
    it('should block unauthenticated access to Administrator routes with HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/check`, {
        headers: { Accept: 'application/json' }
      });

      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
    });

    it('should allow Administrator to access admin-protected routes with HTTP 200', async () => {
      // Log in as Administrator
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      const cookie = extractCookie(loginRes);

      const adminRes = await fetch(`${baseUrl}/api/admin/check`, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json'
        }
      });

      assert.strictEqual(adminRes.status, 200);
      const data = await adminRes.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.user.role, 'Administrator');
    });

    it('should STRICTLY FORBID Viewer from performing Administrator actions with HTTP 403', async () => {
      // Log in as Viewer
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: viewerCredentials.email,
          password: viewerCredentials.password
        })
      });
      const cookie = extractCookie(loginRes);

      // Attempt to access admin route as Viewer
      const adminRes = await fetch(`${baseUrl}/api/admin/check`, {
        headers: {
          Cookie: cookie,
          Accept: 'application/json'
        }
      });

      assert.strictEqual(adminRes.status, 403, 'Viewer must be denied with 403 Forbidden');
      const data = await adminRes.json();
      assert.strictEqual(data.status, 'error');
      assert.strictEqual(data.message, 'Forbidden. Administrator role required.');
    });
  });

  // --------------------------------------------------------------------------
  // 4. CSRF Defense for Authenticated State-Changing Requests
  // --------------------------------------------------------------------------
  describe('4. CSRF Protection Middleware', () => {
    let adminCookie;
    let csrfToken;

    before(async () => {
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      adminCookie = extractCookie(loginRes);
      const body = await loginRes.json();
      csrfToken = body.csrf_token;
    });

    it('should reject authenticated POST without CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json'
        }
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('CSRF validation failed'));
    });

    it('should reject authenticated POST with invalid or tampered CSRF token with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'tampered-csrf-token-1234567890abcdef'
        }
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('CSRF validation failed'));
    });

    it('should reject request from untrusted cross-origin domain with HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          Origin: 'http://malicious-attacker-domain.org'
        }
      });

      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.strictEqual(data.status, 'error');
      assert.ok(data.message.includes('untrusted origin'));
    });

    it('should allow authenticated state-changing request with valid CSRF token', async () => {
      const res = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.status, 'success');
      assert.strictEqual(data.message, 'Logged out successfully.');
    });
  });

  // --------------------------------------------------------------------------
  // 5. POST /logout - Session Lifecycle
  // --------------------------------------------------------------------------
  describe('5. POST /logout - Session Lifecycle', () => {
    it('should clear session so subsequent requests fail with HTTP 401', async () => {
      // 1. Log in
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      const cookie = extractCookie(loginRes);
      const loginData = await loginRes.json();

      // 2. Verify logged in
      const check1 = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookie, Accept: 'application/json' }
      });
      assert.strictEqual(check1.status, 200);

      // 3. Log out with CSRF token
      const logoutRes = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
          'X-CSRF-Token': loginData.csrf_token
        }
      });
      assert.strictEqual(logoutRes.status, 200);

      // 4. Verify session is destroyed: /api/auth/me should now return 401
      const check2 = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Cookie: cookie, Accept: 'application/json' }
      });
      assert.strictEqual(check2.status, 401, 'Old session cookie must no longer grant access after logout');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Data Sanitization & Zero Leakage of Secrets
  // --------------------------------------------------------------------------
  describe('6. Zero Secret Leakage', () => {
    it('should NEVER expose password, password_hash, or session secret in any public response', async () => {
      // Test login response
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: adminCredentials.email,
          password: adminCredentials.password
        })
      });
      const loginJson = await loginRes.json();
      const rawLoginText = JSON.stringify(loginJson);

      assert.strictEqual(loginJson.user.password, undefined);
      assert.strictEqual(loginJson.user.password_hash, undefined);
      assert.strictEqual(rawLoginText.includes('AdminPassword2026!'), false);
      assert.strictEqual(rawLoginText.includes('$2a$'), false);
      assert.strictEqual(rawLoginText.includes('$2b$'), false);
      assert.strictEqual(rawLoginText.includes('mongodb://'), false);

      // Test health response
      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthJson = await healthRes.json();
      const rawHealthText = JSON.stringify(healthJson);

      assert.strictEqual(rawHealthText.includes('mongodb://'), false);
      assert.strictEqual(rawHealthText.includes('secret'), false);
    });
  });
});
