/**
 * app.js
 * ------
 * Express application configuration for Ruhuna Smart Energy System.
 * Configures middleware, MongoDB session store, CSRF defense, and authentication routes.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);
const mongoose = require('mongoose');
const nunjucks = require('nunjucks');
const { DEFAULT_MONGODB_URI } = require('./config/db');
const { csrfProtection } = require('./middleware/csrf');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const buildingRoutes = require('./routes/buildings');
const energyRoutes = require('./routes/energy');
const alertRoutes = require('./routes/alerts');
const reportRoutes = require('./routes/reports');
const pageRoutes = require('./routes/pages');

const app = express();

// Path configuration for templates and static assets
const templatesDir = path.resolve(__dirname, '../frontend/templates');
const staticDir = path.resolve(__dirname, '../frontend/static');

// Serve existing CSS, JavaScript, and assets correctly from frontend/static
app.use('/static', express.static(staticDir));

// Configure Nunjucks template engine with Jinja2 compatibility hooks
const loader = new nunjucks.FileSystemLoader(templatesDir, {
  noCache: process.env.NODE_ENV !== 'production'
});

// Hook loader getSource to transparently support Python slice notation [:N]
const origGetSource = loader.getSource.bind(loader);
loader.getSource = function (name) {
  const result = origGetSource(name);
  if (result && result.src) {
    result.src = result.src.replace(/\[:(\d+)\]/g, (match, p1) => `.slice(0, ${p1})`);
  }
  return result;
};

const nunjucksEnv = new nunjucks.Environment(loader, {
  autoescape: true
});
nunjucksEnv.express(app);

// Custom 'with' extension for Jinja2 template compatibility (e.g. login.html)
function WithExtension() {
  this.tags = ['with'];
  this.parse = function (parser, nodes) {
    const tok = parser.nextToken();
    const args = parser.parseSignature(null, true);
    parser.advanceAfterBlockEnd(tok.value);
    const body = parser.parseUntilBlocks('endwith');
    parser.advanceAfterBlockEnd();
    return new nodes.CallExtension(this, 'run', args, [body]);
  };
  this.run = function (context, kwargs, body) {
    if (kwargs && typeof kwargs === 'object') {
      Object.assign(context.ctx, kwargs);
    }
    return body();
  };
}
nunjucksEnv.addExtension('WithExtension', new WithExtension());

// Custom 'format' filter for printf/sprintf format strings (e.g. "%.2f"|format(...))
nunjucksEnv.addFilter('format', (fmt, ...args) => {
  if (typeof fmt === 'string' && fmt.startsWith('%.') && fmt.endsWith('f')) {
    const decimals = parseInt(fmt.slice(2, -1), 10);
    const num = Number(args[0]);
    return isNaN(num) ? '0.00' : num.toFixed(decimals);
  }
  return args[0] !== undefined ? String(args[0]) : '';
});

// Global url_for helper matching Flask route endpoints
nunjucksEnv.addGlobal('url_for', (endpoint, opts) => {
  if (endpoint === 'static') {
    const fn = opts && opts.filename ? String(opts.filename) : '';
    return '/static/' + fn.replace(/^\/+/, '');
  }
  const routeMap = {
    dashboard: '/dashboard',
    analytics_page: '/analytics',
    alerts_page: '/alerts',
    cost_efficiency_page: '/cost-efficiency',
    reports_page: '/reports',
    printable_report_page: '/reports/printable',
    login: '/login',
    logout: '/logout'
  };
  return routeMap[endpoint] || `/${endpoint}`;
});

app.set('view engine', 'html');
app.set('views', templatesDir);

// Core parsing middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration using environment variable with fallback
const SESSION_SECRET = process.env.SESSION_SECRET || 'ruhuna-smart-energy-system-secret-key-default-256bit';
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;

// Instantiate MongoDB session store
const sessionStore = new MongoStore({
  url: MONGODB_URI,
  collection: 'sessions',
  ttl: 60 * 60 * 24, // 1 day
  autoRemove: process.env.NODE_ENV === 'test' ? 'disabled' : 'native'
});

app.sessionStore = sessionStore;

// Secure cookie settings appropriate for local development (HTTP) and production (HTTPS)
const sessionConfig = {
  secret: SESSION_SECRET,
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true, // Mitigate XSS cookie theft
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production, works on HTTP locally
    sameSite: 'lax', // Protect against cross-site CSRF while allowing normal navigation
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
};

app.use(session(sessionConfig));

// Template locals middleware: exposes session helper (.get), CSRF token, and flash messages
app.use((req, res, next) => {
  const sess = req.session || {};
  res.locals.session = {
    ...sess,
    get(key, fallback) {
      return sess[key] !== undefined && sess[key] !== null ? sess[key] : fallback;
    }
  };
  res.locals.csrf_token = req.session && req.session.csrfToken ? req.session.csrfToken : '';
  res.locals.get_flashed_messages = () => {
    return req.session && req.session.flashedMessages ? req.session.flashedMessages : [];
  };
  next();
});

// Apply CSRF defense on state-changing requests
app.use(csrfProtection);

// Mount Frontend Page routes (/, /login, /dashboard, /analytics, /alerts, /cost-efficiency, /reports, /reports/printable)
app.use(pageRoutes);

// Mount Authentication routes (/login, /logout, /api/auth/*)
app.use(authRoutes);

// Mount Building CRUD routes (/api/buildings, /api/buildings/create, etc.)
app.use(buildingRoutes);

// Mount Energy Telemetry routes (/api/energy/live)
app.use(energyRoutes);

// Mount Electrical Alerts routes (/api/alerts, /api/alerts/:id/acknowledge)
app.use(alertRoutes);

// Mount Reports and Configuration routes (/api/reports/*, /api/config/tariff)
app.use(reportRoutes);

// Protected Admin diagnostic route (for RBAC verification)
app.get('/api/admin/check', requireAuth, requireAdmin, (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Administrator authorization confirmed.',
    user: {
      id: req.session.userId,
      email: req.session.email,
      role: req.session.role
    }
  });
});

// System Health and Diagnostic Endpoint (sanitized: no credentials, secrets, or raw connection strings)
app.get('/api/health', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStates = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting'
  };

  res.json({
    status: 'ok',
    phase: 'Phase 6A: Basic Frontend Integration (Nunjucks & Static Assets)',
    database: {
      status: dbStates[dbState] || 'Unknown',
      connected: dbState === 1
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
