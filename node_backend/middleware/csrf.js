/**
 * csrf.js
 * -------
 * Cross-Site Request Forgery (CSRF) defense middleware.
 * Protects authenticated state-changing requests (POST, PUT, DELETE, PATCH).
 * Validates Origin/Referer and cryptographically verifies CSRF tokens.
 */

const crypto = require('crypto');

// Default trusted origins for local development and test suites
const DEFAULT_TRUSTED_ORIGINS = new Set([
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
]);

/**
 * Compares two strings using constant-time comparison to prevent timing attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a cryptographically secure hex CSRF token.
 * @returns {string}
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * CSRF middleware for state-changing requests.
 * Exempts safe methods (GET, HEAD, OPTIONS) and public unauthenticated endpoints (/login).
 */
function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();

  // 1. Skip safe read-only methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  // 2. Skip unauthenticated public entrypoints (e.g. initial login)
  if (req.path === '/login' || req.path === '/api/login') {
    return next();
  }

  // 3. Origin header check: If browser provided Origin header, verify against trusted origins
  const origin = req.headers.origin;
  if (origin) {
    const trustedOrigins = new Set(DEFAULT_TRUSTED_ORIGINS);
    if (process.env.APP_ORIGIN) {
      trustedOrigins.add(process.env.APP_ORIGIN);
    }

    if (!trustedOrigins.has(origin)) {
      return res.status(403).json({
        status: 'error',
        message: `CSRF validation failed: Cross-origin request from untrusted origin '${origin}' is forbidden.`
      });
    }
  }

  // 4. Token verification for authenticated sessions
  if (req.session && req.session.userId) {
    const expectedToken = req.session.csrfToken;
    const receivedToken =
      req.headers['x-csrf-token'] ||
      req.headers['x-xsrf-token'] ||
      (req.body && (req.body.csrf_token || req.body._csrf));

    if (!expectedToken || !receivedToken || !safeCompare(receivedToken, expectedToken)) {
      return res.status(403).json({
        status: 'error',
        message: 'CSRF validation failed: Invalid or missing CSRF token.'
      });
    }
  }

  return next();
}

module.exports = {
  csrfProtection,
  generateCsrfToken,
  safeCompare,
  DEFAULT_TRUSTED_ORIGINS
};
