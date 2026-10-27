/**
 * buildings.js
 * ------------
 * Express router providing complete MongoDB-backed CRUD operations for campus buildings.
 * 
 * Endpoints:
 * - GET  /api/buildings                  : List all buildings (requires authenticated session)
 * - POST /api/buildings/create           : Create building (requires Administrator + CSRF)
 * - POST /api/buildings/:id/update       : Update building (requires Administrator + CSRF)
 * - GET  /api/buildings/:id/delete-preview : Inspect deletion safety & dependencies (requires Administrator)
 * - POST /api/buildings/:id/delete       : Delete non-core building without dependencies (requires Administrator + CSRF)
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Building = require('../models/Building');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// Canonical original faculty building codes protected from deletion
const CORE_BUILDING_CODES = new Set(['CEE', 'EIE', 'MME', 'MENA', 'ADMIN', 'AUDI']);

/**
 * Escapes regex special characters to prevent regex injection during name matching.
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates and normalizes building code:
 * - Must be non-empty string
 * - Trimmed and uppercase
 * - Length between 2 and 20 characters
 * - Only alphanumeric characters, dashes, and underscores
 */
function validateBuildingCode(code) {
  if (code === undefined || code === null || !String(code).trim()) {
    throw new Error('Building code is required.');
  }
  const cleanCode = String(code).trim().toUpperCase();
  if (cleanCode.length < 2 || cleanCode.length > 20) {
    throw new Error(`Building code must be between 2 and 20 characters (received ${cleanCode.length}).`);
  }
  if (!/^[A-Z0-9_-]+$/.test(cleanCode)) {
    throw new Error('Building code may only contain uppercase letters, numbers, hyphens, and underscores.');
  }
  return cleanCode;
}

/**
 * Validates and normalizes building name:
 * - Must be non-empty string
 * - Trimmed
 * - Length between 2 and 100 characters
 */
function validateBuildingName(name) {
  if (name === undefined || name === null || !String(name).trim()) {
    throw new Error('Building name is required.');
  }
  const cleanName = String(name).trim();
  if (cleanName.length < 2 || cleanName.length > 100) {
    throw new Error(`Building name must be between 2 and 100 characters (received ${cleanName.length}).`);
  }
  return cleanName;
}

/**
 * Validates rated active power capacity in kW:
 * - Must be a finite numeric value
 * - Strictly positive (> 0 kW)
 * - Maximum limit <= 10,000 kW
 */
function validateRatedPower(val) {
  if (val === undefined || val === null || (typeof val === 'string' && !val.trim())) {
    throw new Error('Rated power (kW) is required.');
  }
  const p = Number(val);
  if (isNaN(p) || !isFinite(p)) {
    throw new Error('Rated power must be a valid finite numeric value.');
  }
  if (p <= 0) {
    throw new Error('Rated power must be greater than 0 kW.');
  }
  if (p > 10000.0) {
    throw new Error('Rated power exceeds maximum allowable limit of 10,000 kW.');
  }
  return p;
}

/**
 * Finds a building document by ObjectId or uppercase code.
 * Safely guards against cast errors when an arbitrary ID string is passed.
 */
async function findBuildingById(id) {
  if (!id) return null;
  const strId = String(id).trim();

  // 1. Check if valid 24-char hex ObjectId
  if (mongoose.Types.ObjectId.isValid(strId) && String(new mongoose.Types.ObjectId(strId)) === strId) {
    const doc = await Building.findById(strId);
    if (doc) return doc;
  }

  // 2. Fallback check by uppercase code
  const byCode = await Building.findOne({ code: strId.toUpperCase() });
  if (byCode) return byCode;

  return null;
}

/**
 * Determines whether a building is classified as a protected core facility.
 */
function isCoreBuilding(building) {
  if (!building) return false;
  if (building.is_core === true) return true;
  if (building.code && CORE_BUILDING_CODES.has(String(building.code).trim().toUpperCase())) {
    return true;
  }
  return false;
}

/**
 * Counts related dependent records (energy readings and alerts) for a building across MongoDB collections.
 * Compatible with MongoDB 3.4.
 */
async function getBuildingRelatedCounts(building) {
  let total_readings = 0;
  let simulated_readings = 0;
  let alerts_count = 0;

  if (mongoose.connection && mongoose.connection.readyState === 1 && mongoose.connection.db) {
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const colNames = collections.map((c) => c.name);

    // Reading filter matching building ID or code
    const readingFilter = {
      $or: [
        { building_id: building._id },
        { building_id: building._id.toString() },
        { building_code: building.code },
        { building: building._id }
      ]
    };

    // Check potential readings collections
    const readingColCandidates = ['energy_readings', 'readings', 'energyreadings'];
    for (const rName of readingColCandidates) {
      if (colNames.includes(rName)) {
        const col = db.collection(rName);
        const total = await col.countDocuments(readingFilter);
        total_readings += total;

        const sim = await col.countDocuments({
          ...readingFilter,
          $or: [{ is_simulated: 1 }, { is_simulated: true }]
        });
        simulated_readings += sim;
      }
    }

    // Check alerts collection
    if (colNames.includes('alerts')) {
      const aCol = db.collection('alerts');
      const alertFilter = {
        $or: [
          { building_id: building._id },
          { building_id: building._id.toString() },
          { building_code: building.code },
          { building: building._id }
        ]
      };
      alerts_count = await aCol.countDocuments(alertFilter);
    }
  }

  const non_simulated_readings = Math.max(0, total_readings - simulated_readings);

  return {
    total_readings,
    simulated_readings,
    non_simulated_readings,
    alerts_count,
    total_dependencies: total_readings + alerts_count
  };
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * GET /api/buildings
 * Protected endpoint: Retrieves all campus buildings from MongoDB.
 * Matches existing frontend expected JSON format.
 */
router.get('/api/buildings', requireAuth, async (req, res) => {
  try {
    const buildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });

    const formattedBuildings = buildings.map((b) => ({
      id: b._id.toString(),
      name: b.name,
      code: b.code,
      description: b.description || '',
      rated_power_kw: b.rated_power_kw,
      is_core: !!b.is_core,
      created_at: b.createdAt,
      updated_at: b.updatedAt
    }));

    return res.status(200).json({
      status: 'success',
      count: formattedBuildings.length,
      data: formattedBuildings
    });
  } catch (err) {
    console.error('[Building API] Error fetching buildings:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve buildings: ' + err.message
    });
  }
});

/**
 * POST /api/buildings/create
 * Protected endpoint: Administrator only with valid CSRF token.
 * Validates name, uppercase unique code, and positive rated_power_kw.
 * Rejects duplicates with HTTP 409 Conflict.
 */
router.post('/api/buildings/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const data = req.body || {};

    // 1. Input format & range validation
    let code, name, ratedPower;
    try {
      code = validateBuildingCode(data.code);
      name = validateBuildingName(data.name);
      ratedPower = validateRatedPower(data.rated_power_kw);
    } catch (valErr) {
      return res.status(400).json({
        status: 'error',
        message: valErr.message
      });
    }

    const description = data.description ? String(data.description).trim() : '';

    // 2. Uniqueness checks
    const existingCode = await Building.findOne({ code });
    if (existingCode) {
      return res.status(409).json({
        status: 'error',
        message: `Building code '${code}' already exists (assigned to '${existingCode.name}').`
      });
    }

    const existingName = await Building.findOne({
      name: new RegExp(`^${escapeRegExp(name)}$`, 'i')
    });
    if (existingName) {
      return res.status(409).json({
        status: 'error',
        message: `Building name '${name}' already exists (Code: '${existingName.code}').`
      });
    }

    // 3. Database insertion
    const building = await Building.create({
      code,
      name,
      description,
      rated_power_kw: ratedPower,
      is_core: false
    });

    return res.status(200).json({
      status: 'success',
      id: building._id.toString(),
      message: `Building '${building.name}' (${building.code}) successfully created.`,
      data: {
        id: building._id.toString(),
        name: building.name,
        code: building.code,
        description: building.description,
        rated_power_kw: building.rated_power_kw,
        is_core: building.is_core
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Database integrity conflict: Duplicate building code or name.'
      });
    }
    console.error('[Building API] Error creating building:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to create building: ' + err.message
    });
  }
});

/**
 * POST /api/buildings/:id/update
 * Protected endpoint: Administrator only with valid CSRF token.
 * Validates updated fields and persists changes to MongoDB.
 */
router.post('/api/buildings/:id/update', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const building = await findBuildingById(id);

    if (!building) {
      return res.status(404).json({
        status: 'error',
        message: `Building with ID ${id} not found.`
      });
    }

    const data = req.body || {};

    // 1. Input format & range validation
    let name, ratedPower, code;
    try {
      name = validateBuildingName(data.name);
      ratedPower = validateRatedPower(data.rated_power_kw);
      if (data.code !== undefined && data.code !== null && String(data.code).trim() !== '') {
        code = validateBuildingCode(data.code);
      }
    } catch (valErr) {
      return res.status(400).json({
        status: 'error',
        message: valErr.message
      });
    }

    // 2. Uniqueness checks (excluding current building to allow retention)
    if (code && code !== building.code) {
      const codeConflict = await Building.findOne({
        code,
        _id: { $ne: building._id }
      });
      if (codeConflict) {
        return res.status(409).json({
          status: 'error',
          message: `Building code '${code}' is already in use by building '${codeConflict.name}'.`
        });
      }
      building.code = code;
    }

    if (name.toLowerCase() !== building.name.toLowerCase()) {
      const nameConflict = await Building.findOne({
        name: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
        _id: { $ne: building._id }
      });
      if (nameConflict) {
        return res.status(409).json({
          status: 'error',
          message: `Building name '${name}' is already in use by building [${nameConflict.code}].`
        });
      }
    }

    // 3. Apply updates and save
    building.name = name;
    building.rated_power_kw = ratedPower;
    if (data.description !== undefined) {
      building.description = String(data.description).trim();
    }

    await building.save();

    return res.status(200).json({
      status: 'success',
      message: `Building #${id} successfully updated.`,
      data: {
        id: building._id.toString(),
        name: building.name,
        code: building.code,
        description: building.description,
        rated_power_kw: building.rated_power_kw,
        is_core: building.is_core
      }
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        status: 'error',
        message: 'Database integrity conflict: Duplicate building code or name.'
      });
    }
    console.error('[Building API] Error updating building:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update building: ' + err.message
    });
  }
});

/**
 * GET /api/buildings/:id/delete-preview
 * Protected endpoint: Administrator only.
 * Returns pre-deletion metadata, related-record counts, and deletion eligibility status.
 */
router.get('/api/buildings/:id/delete-preview', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const building = await findBuildingById(id);

    if (!building) {
      return res.status(404).json({
        status: 'error',
        message: `Building with ID ${id} not found.`
      });
    }

    const isCore = isCoreBuilding(building);
    const counts = await getBuildingRelatedCounts(building);

    let canDelete = true;
    let rejectionReason = null;

    if (isCore) {
      canDelete = false;
      rejectionReason = 'Core campus facilities (CEE, EIE, MME, MENA, ADMIN, AUDI) are protected and cannot be deleted.';
    } else if (counts.total_dependencies > 0) {
      canDelete = false;
      const deps = [];
      if (counts.total_readings > 0) {
        deps.push(`${counts.total_readings} historical energy reading(s)`);
      }
      if (counts.alerts_count > 0) {
        deps.push(`${counts.alerts_count} alert record(s)`);
      }
      rejectionReason = `Cannot delete building '${building.name}' (${building.code}): it has ${deps.join(' and ')}. Historical electrical data must be preserved.`;
    }

    return res.status(200).json({
      status: 'success',
      preview: {
        building_id: building._id.toString(),
        id: building._id.toString(),
        name: building.name,
        code: building.code,
        is_core: isCore,
        total_readings: counts.total_readings,
        simulated_readings: counts.simulated_readings,
        non_simulated_readings: counts.non_simulated_readings,
        alerts_count: counts.alerts_count,
        total_dependencies: counts.total_dependencies,
        can_delete: canDelete,
        rejection_reason: rejectionReason
      }
    });
  } catch (err) {
    console.error('[Building API] Error previewing building deletion:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to generate deletion preview: ' + err.message
    });
  }
});

/**
 * POST /api/buildings/:id/delete
 * Protected endpoint: Administrator only with valid CSRF token.
 * Safely deletes a building with no dependent records.
 * Protects core buildings and buildings with related telemetry or alerts with HTTP 409 Conflict.
 */
router.post('/api/buildings/:id/delete', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const building = await findBuildingById(id);

    if (!building) {
      return res.status(404).json({
        status: 'error',
        message: `Building with ID ${id} not found.`
      });
    }

    // 1. Safeguard: Core building protection
    if (isCoreBuilding(building)) {
      return res.status(409).json({
        status: 'error',
        message: `Cannot delete core campus facility '${building.name}' (${building.code}): Core buildings are protected system entities.`
      });
    }

    // 2. Safeguard: Dependent records protection
    const counts = await getBuildingRelatedCounts(building);
    if (counts.total_dependencies > 0) {
      const deps = [];
      if (counts.total_readings > 0) {
        deps.push(`${counts.total_readings} historical energy reading(s)`);
      }
      if (counts.alerts_count > 0) {
        deps.push(`${counts.alerts_count} alert record(s)`);
      }
      return res.status(409).json({
        status: 'error',
        message: `Cannot delete building '${building.name}' (${building.code}): it has ${deps.join(' and ')}. Historical electrical data must be preserved.`
      });
    }

    // 3. Execute safe deletion
    await Building.deleteOne({ _id: building._id });

    return res.status(200).json({
      status: 'success',
      message: `Building #${id} successfully deleted.`
    });
  } catch (err) {
    console.error('[Building API] Error deleting building:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to delete building: ' + err.message
    });
  }
});

/**
 * POST /api/buildings/:id/delete-simulated
 * Protected endpoint: Administrator only with CSRF verification.
 * Safely and atomically deletes a selected demonstration building along with all
 * associated simulated records, strictly guarding core buildings and real data.
 */
router.post('/api/buildings/:id/delete-simulated', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const building = await findBuildingById(id);

    if (!building) {
      return res.status(404).json({
        status: 'error',
        message: `Building with ID ${id} not found.`
      });
    }

    // 1. Safeguard: Core building protection
    if (isCoreBuilding(building)) {
      return res.status(403).json({
        status: 'error',
        message: `Cannot delete core campus facility '${building.name}' (${building.code}): Core buildings are protected system entities.`
      });
    }

    const data = req.body || {};
    const confirmCode = String(data.confirm_code || '').trim().toUpperCase();
    if (!confirmCode) {
      return res.status(400).json({
        status: 'error',
        message: 'Building code confirmation is required to execute deletion.'
      });
    }

    if (confirmCode !== building.code.toUpperCase()) {
      return res.status(400).json({
        status: 'error',
        message: `Confirmation code '${confirmCode}' does not match building code '${building.code}'.`
      });
    }

    // 2. Safeguard: Real (non-simulated) records protection
    const counts = await getBuildingRelatedCounts(building);
    if (counts.non_simulated_readings > 0) {
      return res.status(409).json({
        status: 'error',
        message: `Cannot delete building '${building.name}' (${building.code}): It has ${counts.non_simulated_readings} non-simulated real meter telemetry record(s). Only fully simulated demonstration facilities may be purged.`
      });
    }

    // 3. Purge simulated readings and alerts for this building
    const db = mongoose.connection.db;
    const readingFilter = {
      $or: [
        { building_id: building._id },
        { building_id: building._id.toString() },
        { building_code: building.code },
        { building: building._id }
      ]
    };

    let deletedReadings = 0;
    let deletedAlerts = 0;

    if (db) {
      const colNames = (await db.listCollections().toArray()).map((c) => c.name);
      for (const rName of ['energy_readings', 'readings', 'energyreadings']) {
        if (colNames.includes(rName)) {
          const resR = await db.collection(rName).deleteMany({
            ...readingFilter,
            $or: [{ is_simulated: 1 }, { is_simulated: true }]
          });
          deletedReadings += resR.deletedCount || 0;
        }
      }
      if (colNames.includes('alerts')) {
        const resA = await db.collection('alerts').deleteMany(readingFilter);
        deletedAlerts += resA.deletedCount || 0;
      }
    }

    // 4. Delete the building record
    await Building.deleteOne({ _id: building._id });

    return res.status(200).json({
      status: 'success',
      message: `Building '${building.name}' (${building.code}) and all simulated records successfully deleted.`,
      details: {
        building_id: building._id.toString(),
        building_code: building.code,
        building_name: building.name,
        deleted_readings: deletedReadings,
        deleted_alerts: deletedAlerts
      }
    });
  } catch (err) {
    console.error('[Building API] Error in delete-simulated:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to delete building and simulated data: ' + err.message
    });
  }
});

module.exports = router;
