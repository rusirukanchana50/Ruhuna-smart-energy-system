/**
 * auth.js
 * -------
 * Express router handling user authentication, session creation, profile retrieval, and logout.
 */

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { generateCsrfToken } = require('../middleware/csrf');

/**
 * Helper to determine if incoming request is an API/JSON request.
 */
function isApiRequest(req) {
  return (
    req.xhr ||
    req.is('json') ||
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    (req.headers['content-type'] && req.headers['content-type'].includes('application/json'))
  );
}

/**
 * POST /login
 * Authenticates user credentials and establishes server-side session.
 * Supports both JSON API requests and standard HTML form submissions.
 */
router.post('/login', async (req, res) => {
  try {
    const email = (req.body && req.body.email ? String(req.body.email) : '').trim().toLowerCase();
    const password = req.body && req.body.password ? String(req.body.password) : '';

    // Validation: required fields
    if (!email || !password) {
      const errorMsg = 'Please provide both email and password.';
      if (isApiRequest(req)) {
        return res.status(400).json({
          status: 'error',
          message: errorMsg
        });
      }
      return res.status(400).render('login.html', {
        email,
        get_flashed_messages: () => [['error', errorMsg]]
      });
    }

    // Find user in MongoDB (case-insensitive lowercase)
    const user = await User.findOne({ email });
    if (!user) {
      const errorMsg = 'Invalid email or password. Please try again.';
      if (isApiRequest(req)) {
        return res.status(401).json({
          status: 'error',
          message: errorMsg
        });
      }
      return res.status(401).render('login.html', {
        email,
        get_flashed_messages: () => [['error', errorMsg]]
      });
    }

    // Secure bcrypt password verification
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      const errorMsg = 'Invalid email or password. Please try again.';
      if (isApiRequest(req)) {
        return res.status(401).json({
          status: 'error',
          message: errorMsg
        });
      }
      return res.status(401).render('login.html', {
        email,
        get_flashed_messages: () => [['error', errorMsg]]
      });
    }

    // Credentials valid: initialize session and generate fresh CSRF token
    const csrfToken = generateCsrfToken();
    req.session.userId = user._id.toString();
    req.session.email = user.email;
    req.session.full_name = user.full_name;
    req.session.role = user.role;
    req.session.csrfToken = csrfToken;

    // Explicitly save session before responding
    req.session.save((err) => {
      if (err) {
        console.error('[Auth] Session save error:', err);
        if (isApiRequest(req)) {
          return res.status(500).json({
            status: 'error',
            message: 'Failed to establish session.'
          });
        }
        return res.status(500).render('login.html', {
          email,
          get_flashed_messages: () => [['error', 'Failed to establish session.']]
        });
      }

      if (isApiRequest(req)) {
        return res.status(200).json({
          status: 'success',
          message: 'Login successful.',
          user: {
            id: user._id.toString(),
            email: user.email,
            full_name: user.full_name,
            role: user.role
          },
          csrf_token: csrfToken,
          redirect: '/dashboard'
        });
      }

      return res.redirect('/dashboard');
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    if (isApiRequest(req)) {
      return res.status(500).json({
        status: 'error',
        message: 'An unexpected error occurred during authentication.'
      });
    }
    return res.status(500).render('login.html', {
      email: (req.body && req.body.email ? String(req.body.email) : '').trim(),
      get_flashed_messages: () => [['error', 'An unexpected error occurred during authentication.']]
    });
  }
});

/**
 * GET /api/auth/me
 * Retrieves profile and role of currently authenticated session user.
 */
router.get('/api/auth/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    if (!user) {
      // Session exists but user deleted from DB
      req.session.destroy();
      return res.status(401).json({
        status: 'error',
        message: 'User account no longer exists.'
      });
    }

    return res.status(200).json({
      status: 'success',
      user: {
        id: user._id.toString(),
        email: user.email,
        full_name: user.full_name,
        role: user.role
      },
      csrf_token: req.session.csrfToken || null
    });
  } catch (err) {
    console.error('[Auth] Profile retrieval error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve user profile.'
    });
  }
});

/**
 * GET /api/auth/csrf
 * Retrieves current session CSRF token.
 */
router.get('/api/auth/csrf', requireAuth, (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  return res.status(200).json({
    status: 'success',
    csrf_token: req.session.csrfToken
  });
});

/**
 * POST /logout
 * Destroys active session and clears the session cookie.
 * Supports both JSON API requests and browser form submissions.
 */
router.post('/logout', (req, res) => {
  const cookieName = 'connect.sid';
  const isApi = isApiRequest(req);

  const respond = (statusCode, payload) => {
    if (isApi) {
      return res.status(statusCode).json(payload);
    }
    return res.redirect('/login');
  };

  if (!req.session) {
    res.clearCookie(cookieName, { path: '/' });
    return respond(200, {
      status: 'success',
      message: 'Logged out successfully.'
    });
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
      if (isApi) {
        return res.status(500).json({
          status: 'error',
          message: 'Failed to clear session.'
        });
      }
      return res.redirect('/login');
    }

    res.clearCookie(cookieName, { path: '/' });
    return respond(200, {
      status: 'success',
      message: 'Logged out successfully.'
    });
  });
});

/**
 * GET /logout
 * Browser trigger to clear active session and redirect back to login.
 */
router.get('/logout', (req, res) => {
  const cookieName = 'connect.sid';
  if (!req.session) {
    res.clearCookie(cookieName, { path: '/' });
    return res.redirect('/login');
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('[Auth] Logout error:', err);
    }
    res.clearCookie(cookieName, { path: '/' });
    return res.redirect('/login');
  });
});

module.exports = router;
