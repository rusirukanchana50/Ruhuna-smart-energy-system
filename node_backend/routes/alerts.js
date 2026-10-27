/**
 * routes/alerts.js
 * ----------------
 * Express router handling electrical abnormal conditions and alert management.
 * 
 * Endpoints:
 * - GET  /api/alerts                 : Retrieves stored alerts and summary counters (filtered by building, severity, status).
 * - POST /api/alerts/:id/acknowledge : Administrator acknowledgment with CSRF verification.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Alert = require('../models/Alert');
const Building = require('../models/Building');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  checkSensorOfflineAlerts,
  getAlertsSummary,
  acknowledgeAlert
} = require('../services/alertEngine');

/**
 * Formats a Date object to "YYYY-MM-DD HH:MM:SS".
 */
function formatTimestamp(d) {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return String(d);
  const pad = (n) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

/**
 * Normalizes query string boundary timestamps.
 */
function parseDateFilter(val, isEnd = false) {
  if (!val || typeof val !== 'string' || !val.trim()) return null;
  const clean = val.trim();
  const d = new Date(clean);
  if (isNaN(d.getTime())) return null;
  if (isEnd && clean.length <= 10) {
    // If date only (e.g. 2026-10-26), include entire day until 23:59:59.999
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

/**
 * GET /api/alerts
 * Protected endpoint: Retrieves stored electrical alerts and summary counters.
 * Filterable by building_id, severity, status ('active', 'cleared', 'all'), start, end, limit.
 */
router.get('/api/alerts', requireAuth, async (req, res) => {
  try {
    // 1. Run real-time check for silent/offline sensors
    try {
      await checkSensorOfflineAlerts(60.0);
    } catch (offlineErr) {
      console.warn('[Alerts API] Offline sensor check warning:', offlineErr.message);
    }

    const {
      building_id: rawBldgId,
      severity,
      status = 'all',
      start,
      end,
      limit = 100
    } = req.query;

    const query = {};

    // Building filter
    if (rawBldgId && String(rawBldgId).trim().toLowerCase() !== 'all') {
      const bldgTrim = String(rawBldgId).trim();
      if (mongoose.Types.ObjectId.isValid(bldgTrim)) {
        query.building_id = mongoose.Types.ObjectId(bldgTrim);
      } else {
        // Find building by uppercase code or id
        const matchedBldg = await Building.findOne({
          $or: [
            { code: bldgTrim.toUpperCase() },
            { name: new RegExp(`^${bldgTrim}$`, 'i') }
          ]
        });
        if (matchedBldg) {
          query.building_id = matchedBldg._id;
        } else {
          query.building_code = bldgTrim.toUpperCase();
        }
      }
    }

    // Severity filter
    if (severity && String(severity).trim().toLowerCase() !== 'all') {
      query.severity = String(severity).trim().toUpperCase();
    }

    // Status filter
    if (status && String(status).trim().toLowerCase() !== 'all') {
      const cleanStatus = String(status).trim().toLowerCase();
      if (['active', '1', 'true'].includes(cleanStatus)) {
        query.is_active = true;
      } else if (['cleared', '0', 'false'].includes(cleanStatus)) {
        query.is_active = false;
      }
    }

    // Date range filter
    const startDate = parseDateFilter(start, false);
    const endDate = parseDateFilter(end, true);

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    const maxLimit = Math.min(Math.max(1, parseInt(limit, 10) || 100), 1000);

    const alertDocs = await Alert.find(query)
      .sort({ is_active: -1, timestamp: -1, id: -1 })
      .limit(maxLimit)
      .lean();

    const formattedAlerts = alertDocs.map((a) => ({
      id: a.id !== undefined && a.id !== null ? a.id : a._id.toString(),
      _id: a._id.toString(),
      building_id: a.building_id ? a.building_id.toString() : '',
      building_name: a.building_name || '',
      building_code: a.building_code || '',
      timestamp: formatTimestamp(a.timestamp),
      alert_type: a.alert_type,
      severity: a.severity,
      measured_value: a.measured_value,
      threshold_value: a.threshold_value,
      message: a.message,
      acknowledged: a.acknowledged ? 1 : 0,
      acknowledged_by: a.acknowledged_by,
      acknowledged_at: a.acknowledged_at ? formatTimestamp(a.acknowledged_at) : null,
      is_active: a.is_active ? 1 : 0,
      cleared_at: a.cleared_at ? formatTimestamp(a.cleared_at) : null
    }));

    const summary = await getAlertsSummary();

    return res.status(200).json({
      status: 'success',
      data_source: 'SIMULATED',
      count: formattedAlerts.length,
      summary,
      data: formattedAlerts
    });
  } catch (err) {
    console.error('[Alerts API] Error fetching alerts:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve electrical alerts: ' + err.message
    });
  }
});

/**
 * POST /api/alerts/:id/acknowledge
 * Protected endpoint: Administrator only with valid CSRF token.
 * Acknowledges an active or historical electrical alert.
 */
router.post('/api/alerts/:id/acknowledge', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const userName = req.session.full_name || req.session.email || 'Faculty Administrator';

    const updatedAlert = await acknowledgeAlert(id, userName);

    if (!updatedAlert) {
      return res.status(404).json({
        status: 'error',
        message: `Electrical alert #${id} not found.`
      });
    }

    const formattedAlert = {
      id: updatedAlert.id !== undefined && updatedAlert.id !== null ? updatedAlert.id : updatedAlert._id.toString(),
      _id: updatedAlert._id.toString(),
      building_id: updatedAlert.building_id ? updatedAlert.building_id.toString() : '',
      building_name: updatedAlert.building_name || '',
      building_code: updatedAlert.building_code || '',
      timestamp: formatTimestamp(updatedAlert.timestamp),
      alert_type: updatedAlert.alert_type,
      severity: updatedAlert.severity,
      measured_value: updatedAlert.measured_value,
      threshold_value: updatedAlert.threshold_value,
      message: updatedAlert.message,
      acknowledged: updatedAlert.acknowledged ? 1 : 0,
      acknowledged_by: updatedAlert.acknowledged_by,
      acknowledged_at: updatedAlert.acknowledged_at ? formatTimestamp(updatedAlert.acknowledged_at) : null,
      is_active: updatedAlert.is_active ? 1 : 0,
      cleared_at: updatedAlert.cleared_at ? formatTimestamp(updatedAlert.cleared_at) : null
    };

    return res.status(200).json({
      status: 'success',
      message: `Alert #${id} (${updatedAlert.alert_type}) successfully acknowledged by ${userName}.`,
      alert: formattedAlert
    });
  } catch (err) {
    console.error('[Alerts API] Error acknowledging alert:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to acknowledge electrical alert: ' + err.message
    });
  }
});

module.exports = router;
