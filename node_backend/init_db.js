/**
 * init_db.js
 * ----------
 * Isolated MongoDB initialization script for Ruhuna Smart Energy System.
 * Safely seeds the 6 original Faculty of Engineering campus buildings.
 * Repeatable and idempotent: running multiple times will not create duplicates.
 * 
 * Usage:
 *   node node_backend/init_db.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { connectDB, disconnectDB } = require('./config/db');
const Building = require('./models/Building');

// The 6 canonical core Faculty of Engineering buildings
const INITIAL_BUILDINGS = [
  {
    name: 'Civil and Environmental Engineering',
    code: 'CEE',
    description: 'Department of Civil and Environmental Engineering building.',
    rated_power_kw: 60.0,
    is_core: true
  },
  {
    name: 'Electrical and Information Engineering',
    code: 'EIE',
    description: 'Department of Electrical and Information Engineering building.',
    rated_power_kw: 70.0,
    is_core: true
  },
  {
    name: 'Mechanical and Manufacturing Engineering',
    code: 'MME',
    description: 'Department of Mechanical and Manufacturing Engineering building.',
    rated_power_kw: 85.0,
    is_core: true
  },
  {
    name: 'Marine Engineering and Naval Architecture',
    code: 'MENA',
    description: 'Department of Marine Engineering and Naval Architecture building.',
    rated_power_kw: 55.0,
    is_core: true
  },
  {
    name: 'Administration Building',
    code: 'ADMIN',
    description: "Dean's Office and Administrative staff offices.",
    rated_power_kw: 40.0,
    is_core: true
  },
  {
    name: 'Auditorium',
    code: 'AUDI',
    description: 'Main Faculty Auditorium for lectures, conferences, and events.',
    rated_power_kw: 50.0,
    is_core: true
  }
];

/**
 * Initializes and seeds the campus buildings into MongoDB.
 * @param {Object} [options]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<{ created: number, existing: number, buildings: Array }>}
 */
async function initBuildings(options = {}) {
  const silent = options.silent || false;
  let createdCount = 0;
  let existingCount = 0;
  const results = [];

  for (const bldgData of INITIAL_BUILDINGS) {
    const normCode = bldgData.code.trim().toUpperCase();

    // Check if building already exists by uppercase code
    let building = await Building.findOne({ code: normCode });

    if (!building) {
      // Create new building
      building = await Building.create({
        name: bldgData.name,
        code: normCode,
        description: bldgData.description,
        rated_power_kw: bldgData.rated_power_kw,
        is_core: true
      });
      createdCount++;
      if (!silent) {
        console.log(`[InitDB] Created core building: ${building.code} - ${building.name} (${building.rated_power_kw} kW)`);
      }
    } else {
      existingCount++;
      // Ensure is_core flag is set for original buildings
      if (!building.is_core) {
        building.is_core = true;
        await building.save();
      }
      if (!silent) {
        console.log(`[InitDB] Building already exists: ${building.code} - ${building.name} (Retained)`);
      }
    }
    results.push(building);
  }

  if (!silent) {
    console.log(`[InitDB] Seeding complete. Created: ${createdCount}, Existing: ${existingCount}, Total Core: ${results.length}`);
  }

  return {
    created: createdCount,
    existing: existingCount,
    buildings: results
  };
}

// When executed directly via command line
if (require.main === module) {
  (async () => {
    try {
      console.log('='.repeat(65));
      console.log(' University of Ruhuna - Faculty of Engineering');
      console.log(' Smart Energy System : Isolated MongoDB Initializer');
      console.log('='.repeat(65));

      await connectDB();
      await initBuildings();
      await disconnectDB();
      console.log('[InitDB] Database initialization finished successfully.');
      process.exit(0);
    } catch (err) {
      console.error('[InitDB] Initialization failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  INITIAL_BUILDINGS,
  initBuildings
};
