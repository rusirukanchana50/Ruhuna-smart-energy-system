/**
 * auth.js
 * -------
 * Authentication and Role-Based Access Control (RBAC) middleware.
 * Enforces authenticated sessions and Administrator privileges.
 */

/**
 * Middleware ensuring the user has an active authenticated session.
 * For API requests, returns 401 JSON.
 * For browser navigation, redirects to /login.
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }

  const isApi =
    req.path.startsWith('/api/') ||
    req.xhr ||
    (req.headers.accept && req.headers.accept.includes('application/json')) ||
    (req.headers['content-type'] && req.headers['content-type'].includes('application/json'));

  if (isApi) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized access. Please log in first.'
    });
  }

  return res.redirect('/login');
}

/**
 * Middleware ensuring the authenticated user has the 'Administrator' role.
 * Viewer users are strictly prohibited and receive 403 Forbidden.
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    const isApi =
      req.path.startsWith('/api/') ||
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json'));
    if (isApi) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized access. Please log in first.'
      });
    }
    return res.redirect('/login');
  }

  if (req.session.role !== 'Administrator') {
    return res.status(403).json({
      status: 'error',
      message: 'Forbidden. Administrator role required.'
    });
  }

  return next();
}

/**
 * Enforces membership in specified roles.
 * @param {string|string[]} allowedRoles
 */
function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized access. Please log in first.'
      });
    }

    if (!roles.includes(req.session.role)) {
      return res.status(403).json({
        status: 'error',
        message: `Forbidden. Requires one of the following roles: ${roles.join(', ')}`
      });
    }

    return next();
  };
}

module.exports = {
  requireAuth,
  requireAdmin,
  requireRole
};
