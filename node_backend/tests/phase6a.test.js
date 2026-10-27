/**
 * phase6a.test.js
 * ----------------
 * Automated test suite for Phase 6A: Basic Frontend Integration.
 * 
 * Verifies:
 * 1. Static asset delivery from frontend/static (CSS, JS).
 * 2. Unauthenticated access protection & redirects to /login.
 * 3. MongoDB login form authentication, session cookie issuance, and error states.
 * 4. Protected page rendering and Jinja2/Nunjucks template compatibility:
 *    - /dashboard
 *    - /analytics
 *    - /alerts
 *    - /cost-efficiency
 *    - /reports
 *    - /reports/printable
 * 5. Role-based template rendering (Administrator vs. Viewer).
 * 6. Logout workflow (POST /logout and GET /logout).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const app = require('../app');
const User = require('../models/User');
const Building = require('../models/Building');
const { initBuildings } = require('../init_db');

/**
 * Extracts session cookie from response Set-Cookie header.
 */
function extractCookie(res) {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) return null;
  return setCookie.split(';')[0];
}

describe('Phase 6A: Basic Frontend Integration & Template Rendering', () => {
  let server;
  let baseUrl;

  const adminCredentials = {
    full_name: 'Phase6A Administrator',
    email: 'phase6a.admin@eng.ruh.ac.lk',
    password: 'AdminPasswordPhase6A!',
    role: 'Administrator'
  };

  const viewerCredentials = {
    full_name: 'Phase6A Viewer',
    email: 'phase6a.viewer@eng.ruh.ac.lk',
    password: 'ViewerPasswordPhase6A!',
    role: 'Viewer'
  };

  let adminCookie = '';
  let viewerCookie = '';

  before(async () => {
    await connectDB(process.env.MONGODB_URI);

    // Initialize core buildings for page rendering
    await initBuildings({ silent: true });

    // Clean up any existing test accounts
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

    // Obtain authenticated sessions
    const adminRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: adminCredentials.email,
        password: adminCredentials.password
      }),
      redirect: 'manual'
    });
    adminCookie = extractCookie(adminRes);

    const viewerRes = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        email: viewerCredentials.email,
        password: viewerCredentials.password
      }),
      redirect: 'manual'
    });
    viewerCookie = extractCookie(viewerRes);
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

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
  // 1. Static Asset Serving
  // --------------------------------------------------------------------------
  describe('1. Static Asset Serving (/static)', () => {
    it('1.1 should serve frontend CSS with correct MIME type and content', async () => {
      const res = await fetch(`${baseUrl}/static/css/style.css`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/css'));
      const text = await res.text();
      assert.ok(text.includes('auth-wrapper'), 'CSS should contain .auth-wrapper class definition');
      assert.ok(text.includes('navbar'), 'CSS should contain .navbar styling');
    });

    it('1.2 should serve frontend JavaScript with correct MIME type and content', async () => {
      const res = await fetch(`${baseUrl}/static/js/auth.js`);
      assert.strictEqual(res.status, 200);
      assert.ok(
        res.headers.get('content-type').includes('javascript'),
        'MIME type should indicate javascript'
      );
      const text = await res.text();
      assert.ok(text.includes('togglePasswordBtn'), 'auth.js must contain togglePasswordBtn handler');
    });

    it('1.3 should return HTTP 404 for non-existent static assets', async () => {
      const res = await fetch(`${baseUrl}/static/css/nonexistent_styles_123.css`);
      assert.strictEqual(res.status, 404);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Unauthenticated Page Access & Redirection
  // --------------------------------------------------------------------------
  describe('2. Unauthenticated Access & Protection', () => {
    it('2.1 GET / should redirect unauthenticated users to /login', async () => {
      const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.2 GET /login should render HTML login portal with university branding', async () => {
      const res = await fetch(`${baseUrl}/login`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Energy Portal'), 'Should contain "Energy Portal" title');
      assert.ok(html.includes('Faculty of Engineering'), 'Should contain faculty branding');
      assert.ok(html.includes('id="loginForm"'), 'Should contain login form');
      assert.ok(html.includes('action="/login"'), 'Form action must target /login');
    });

    it('2.3 GET /dashboard should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.4 GET /analytics should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/analytics`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.5 GET /alerts should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/alerts`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.6 GET /cost-efficiency should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/cost-efficiency`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.7 GET /reports should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/reports`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });

    it('2.8 GET /reports/printable should redirect unauthenticated request to /login', async () => {
      const res = await fetch(`${baseUrl}/reports/printable`, { redirect: 'manual' });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/login');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Login Page Authentication & Session Handling
  // --------------------------------------------------------------------------
  describe('3. Login Form Submission & MongoDB Authentication', () => {
    it('3.1 should reject empty form submission with HTTP 400 and display error message', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email: '', password: '' }),
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 400);
      const html = await res.text();
      assert.ok(html.includes('Please provide both email and password.'));
    });

    it('3.2 should reject invalid credentials with HTTP 401 and display error message', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: adminCredentials.email,
          password: 'IncorrectPassword123!'
        }),
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 401);
      const html = await res.text();
      assert.ok(html.includes('Invalid email or password. Please try again.'));
    });

    it('3.3 should authenticate valid credentials, issue session cookie, and redirect to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: adminCredentials.email,
          password: adminCredentials.password
        }),
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
      const cookie = extractCookie(res);
      assert.ok(cookie && cookie.startsWith('connect.sid='), 'Session cookie must be issued');
    });

    it('3.4 GET /login with active session should redirect to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        headers: { Cookie: adminCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });

    it('3.5 GET / with active session should redirect to /dashboard', async () => {
      const res = await fetch(`${baseUrl}/`, {
        headers: { Cookie: adminCookie },
        redirect: 'manual'
      });
      assert.strictEqual(res.status, 302);
      assert.strictEqual(res.headers.get('location'), '/dashboard');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Protected Page Rendering & Navigation
  // --------------------------------------------------------------------------
  describe('4. Protected Page Rendering & Template Context', () => {
    it('4.1 GET /dashboard should render live monitor page with buildings and user details', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Faculty Energy Monitoring Portal'));
      assert.ok(html.includes(adminCredentials.full_name));
      assert.ok(html.includes('Administrator'));
      assert.ok(html.includes('SIMULATED DATA'));
      // Verify building card rendered from MongoDB
      assert.ok(html.includes('CEE') || html.includes('EIE'));
    });

    it('4.2 GET /analytics should render historical analytics page with facility options', async () => {
      const res = await fetch(`${baseUrl}/analytics`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Historical Energy Analytics'));
      assert.ok(html.includes(viewerCredentials.full_name));
      assert.ok(html.includes('role-viewer'));
    });

    it('4.3 GET /alerts should render electrical alerts portal', async () => {
      const res = await fetch(`${baseUrl}/alerts`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Electrical Alerts'));
      assert.ok(html.includes('Active Critical Alerts'));
      assert.ok(html.includes('Active Warnings'));
    });

    it('4.4 GET /cost-efficiency should render cost breakdown and tariff calculations', async () => {
      const res = await fetch(`${baseUrl}/cost-efficiency`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Cost &amp; Efficiency') || html.includes('Cost & Efficiency'));
      assert.ok(html.includes('Demonstration Tariff Model'));
      assert.ok(html.includes('Query Parameters'));
    });

    it('4.5 GET /reports should render reporting management center', async () => {
      const res = await fetch(`${baseUrl}/reports`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('Reports &amp; Export') || html.includes('Reports & Export'));
      assert.ok(html.includes('Report Configuration'));
      assert.ok(html.includes('Facility / Scope'));
    });

    it('4.6 GET /reports/printable should render formal university printable audit report', async () => {
      const res = await fetch(`${baseUrl}/reports/printable?building_id=all`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get('content-type').includes('text/html'));
      const html = await res.text();
      assert.ok(html.includes('UNIVERSITY OF RUHUNA'));
      assert.ok(html.includes('Faculty of Engineering'));
      assert.ok(html.includes('Smart Energy Monitoring'));
      assert.ok(html.includes('Print / Save as PDF'));
    });
  });

  // --------------------------------------------------------------------------
  // 5. Role-Based Navigation & Administrative Controls
  // --------------------------------------------------------------------------
  describe('5. Role-Based Navigation & Action Controls', () => {
    it('5.1 Administrator dashboard should display "Manage Buildings" action button', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: adminCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('Manage Buildings'), 'Admin view should include Manage Buildings button');
    });

    it('5.2 Viewer dashboard should NOT display "Manage Buildings" action button', async () => {
      const res = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: viewerCookie }
      });
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.ok(!html.includes('openManageBuildingsBtn'), 'Viewer view must not contain Manage Buildings button');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Logout & Session Invalidation
  // --------------------------------------------------------------------------
  describe('6. Logout Workflows (POST & GET)', () => {
    it('6.1 POST /logout with CSRF should destroy session and redirect browser to /login', async () => {
      // First obtain a dedicated session to log out
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: viewerCredentials.email,
          password: viewerCredentials.password
        }),
        redirect: 'manual'
      });
      const tempCookie = extractCookie(loginRes);

      // Extract CSRF token from authenticated dashboard page
      const dashRes = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: tempCookie }
      });
      const dashHtml = await dashRes.text();
      const match = dashHtml.match(/name="csrf-token"\s+content="([^"]+)"/);
      const csrf = match ? match[1] : '';

      const logoutRes = await fetch(`${baseUrl}/logout`, {
        method: 'POST',
        headers: {
          Cookie: tempCookie,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          csrf_token: csrf
        }),
        redirect: 'manual'
      });
      assert.strictEqual(logoutRes.status, 302);
      assert.strictEqual(logoutRes.headers.get('location'), '/login');

      // Subsequent access with expired cookie must redirect to /login
      const checkRes = await fetch(`${baseUrl}/dashboard`, {
        headers: { Cookie: tempCookie },
        redirect: 'manual'
      });
      assert.strictEqual(checkRes.status, 302);
      assert.strictEqual(checkRes.headers.get('location'), '/login');
    });

    it('6.2 GET /logout should clear session and redirect browser to /login', async () => {
      const loginRes = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: adminCredentials.email,
          password: adminCredentials.password
        }),
        redirect: 'manual'
      });
      const tempCookie = extractCookie(loginRes);

      const logoutRes = await fetch(`${baseUrl}/logout`, {
        headers: { Cookie: tempCookie },
        redirect: 'manual'
      });
      assert.strictEqual(logoutRes.status, 302);
      assert.strictEqual(logoutRes.headers.get('location'), '/login');
    });
  });
});
