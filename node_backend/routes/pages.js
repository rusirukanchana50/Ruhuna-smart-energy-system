/**
 * routes/pages.js
 * ---------------
 * Express router serving frontend HTML pages rendered with Nunjucks.
 * 
 * Endpoints:
 * - GET /                   : Redirects to /dashboard (if authenticated) or /login
 * - GET /login              : Renders university authentication portal (or redirects to /dashboard)
 * - GET /dashboard          : Protected live monitoring overview with faculty building cards
 * - GET /analytics          : Protected historical energy analytics portal
 * - GET /alerts             : Protected electrical anomaly detection portal
 * - GET /cost-efficiency    : Protected energy cost breakdown and efficiency portal
 * - GET /reports            : Protected audit reporting center
 * - GET /reports/printable  : Protected university-formatted printable audit report
 */

const express = require('express');
const router = express.Router();
const Building = require('../models/Building');
const { requireAuth } = require('../middleware/auth');
const {
  getActiveTariff,
  getFacultySettings,
  getComprehensiveEnergyReport
} = require('../services/analyticsService');

/**
 * Helper to fetch campus buildings and format them for template rendering.
 */
async function getFormattedBuildings() {
  const rawBuildings = await Building.find().sort({ code: 1 }).lean();
  return rawBuildings.map((b) => ({
    ...b,
    id: b._id.toString(),
    keys: function () {
      return Object.keys(this);
    }
  }));
}

/**
 * GET /
 * Root route: redirects to /dashboard if authenticated, else /login.
 */
router.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

/**
 * GET /login
 * Renders the University of Ruhuna login portal.
 * If user already holds an authenticated session, redirects directly to /dashboard.
 */
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard');
  }
  return res.render('login.html', {
    email: ''
  });
});

/**
 * GET /dashboard
 * Protected route: Renders live monitoring dashboard with campus facility cards.
 */
router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const buildings = await getFormattedBuildings();
    return res.render('dashboard.html', {
      buildings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /analytics
 * Protected route: Renders historical energy analytics portal.
 */
router.get('/analytics', requireAuth, async (req, res, next) => {
  try {
    const buildings = await getFormattedBuildings();
    return res.render('analytics.html', {
      buildings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /alerts
 * Protected route: Renders electrical anomaly detection portal.
 */
router.get('/alerts', requireAuth, async (req, res, next) => {
  try {
    const buildings = await getFormattedBuildings();
    return res.render('alerts.html', {
      buildings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /cost-efficiency
 * Protected route: Renders energy cost breakdown & efficiency portal.
 */
router.get('/cost-efficiency', requireAuth, async (req, res, next) => {
  try {
    const [buildings, tariff, settings] = await Promise.all([
      getFormattedBuildings(),
      getActiveTariff(),
      getFacultySettings()
    ]);
    return res.render('cost_efficiency.html', {
      buildings,
      tariff,
      settings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /reports
 * Protected route: Renders audit reporting center.
 */
router.get('/reports', requireAuth, async (req, res, next) => {
  try {
    const [buildings, tariff, settings] = await Promise.all([
      getFormattedBuildings(),
      getActiveTariff(),
      getFacultySettings()
    ]);
    return res.render('reports.html', {
      buildings,
      tariff,
      settings
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /reports/printable
 * Protected route: Renders university printable audit report for browser PDF export.
 */
router.get('/reports/printable', requireAuth, async (req, res, next) => {
  try {
    const buildingId = req.query.building_id || 'all';
    const start = req.query.start || null;
    const end = req.query.end || null;
    const reportData = await getComprehensiveEnergyReport(buildingId, start, end);
    return res.render('printable_report.html', {
      report: reportData
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
