/**
 * simulator.js
 * ------------
 * Three-Phase Electrical Energy Simulator for Ruhuna Smart Energy System.
 * Simulates balanced three-phase telemetry and saves persistently to MongoDB collection 'energy_readings'.
 * Automatically runs alert detection on every reading through alertEngine.
 * 
 * Equations:
 *   S (kVA) = (sqrt(3) * V_L * I_L) / 1000
 *   P (kW)  = S * PF
 *   Q (kVAr)= S * sqrt(1 - PF^2)
 *   Energy (kWh) calculated via elapsed delta-time integration with missing data handling.
 * 
 * Usage:
 *   node node_backend/simulator.js [--interval 15.0] [--once] [--cycles N] [--anomaly LOW_PF] [--building-id <ID|CODE>]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('./config/db');
const Building = require('./models/Building');
const EnergyReading = require('./models/EnergyReading');
const { evaluateElectricalAlerts } = require('./services/alertEngine');

// Constant: sqrt(3) for balanced three-phase power calculations
const SQRT_3 = Math.sqrt(3);

// Nominal grid specifications
const NOMINAL_VOLTAGE = 400.0;   // Volts (Line-to-Line RMS)
const NOMINAL_FREQUENCY = 50.0;  // Hertz

// Maximum gap allowed between consecutive readings (in seconds) to consider data continuous.
// If gap > MAX_CONTINUOUS_GAP_SECONDS, the system assumes sensor was offline
// and does not credit energy across the downtime.
const MAX_CONTINUOUS_GAP_SECONDS = 60.0;
const DEFAULT_INTERVAL_SECONDS = parseFloat(process.env.SIMULATOR_INTERVAL || '15.0');

// Base electrical load profiles per building code
const BUILDING_PROFILES = {
  CEE: {
    name: 'Civil and Environmental Engineering',
    base_current: 42.0,      // Amperes
    peak_current: 85.0,
    pf_min: 0.86,
    pf_max: 0.92,
    base_energy: 2400.0      // Starting kWh if no previous readings exist
  },
  EIE: {
    name: 'Electrical and Information Engineering',
    base_current: 48.0,
    peak_current: 95.0,
    pf_min: 0.88,
    pf_max: 0.94,
    base_energy: 3100.0
  },
  MME: {
    name: 'Mechanical and Manufacturing Engineering',
    base_current: 60.0,
    peak_current: 125.0,     // Heavy machinery & workshop inductive loads
    pf_min: 0.82,
    pf_max: 0.89,
    base_energy: 4200.0
  },
  MENA: {
    name: 'Marine Engineering and Naval Architecture',
    base_current: 38.0,
    peak_current: 80.0,
    pf_min: 0.85,
    pf_max: 0.91,
    base_energy: 2100.0
  },
  ADMIN: {
    name: 'Administration Building',
    base_current: 20.0,
    peak_current: 55.0,      // Office AC, computing, lighting
    pf_min: 0.90,
    pf_max: 0.95,
    base_energy: 1800.0
  },
  AUDI: {
    name: 'Auditorium',
    base_current: 12.0,      // Low when idle, high during events
    peak_current: 75.0,
    pf_min: 0.85,
    pf_max: 0.92,
    base_energy: 1200.0
  },
  LIB: {
    name: 'Library',
    base_current: 25.0,
    peak_current: 60.0,      // Study areas, lighting, AC, computer terminals
    pf_min: 0.88,
    pf_max: 0.94,
    base_energy: 1500.0
  }
};

/**
 * Computes diurnal load factor multiplier (0.10 to 1.05) based on university working hours:
 * - 08:00 - 17:00 (Daytime lectures, labs, workshops): Peak load (0.80 - 1.00)
 * - 17:00 - 22:00 (Evening library, study rooms, lighting): Medium load (0.40 - 0.60)
 * - 22:00 - 06:00 (Night baseload, servers, emergency lights): Low load (0.15 - 0.25)
 * - 06:00 - 08:00 (Morning ramp-up): Moderate load (0.30 - 0.70)
 */
function getDiurnalLoadFactor(currentDatetime = new Date()) {
  const d = currentDatetime instanceof Date ? currentDatetime : new Date(currentDatetime);
  const hourFraction = d.getHours() + d.getMinutes() / 60.0;

  let factor;
  if (hourFraction >= 8.0 && hourFraction < 17.0) {
    // Working hours peak: smooth curve peaking around 11:30 - 14:00
    const progress = (hourFraction - 8.0) / 9.0;
    const curve = Math.sin(progress * Math.PI);
    factor = 0.75 + 0.25 * curve;
  } else if (hourFraction >= 17.0 && hourFraction < 22.0) {
    // Evening tapering
    const progress = (hourFraction - 17.0) / 5.0;
    factor = 0.60 - 0.25 * progress;
  } else if (hourFraction >= 22.0 || hourFraction < 6.0) {
    // Night quiet hours
    factor = 0.20;
  } else {
    // 06:00 to 08:00 Morning arrival
    const progress = (hourFraction - 6.0) / 2.0;
    factor = 0.25 + 0.45 * progress;
  }

  // Realistic random jitter (+/- 5%)
  const jitter = (Math.random() * 0.10) - 0.05;
  return Math.max(0.10, Math.min(1.05, factor + jitter));
}

/**
 * Calculates balanced 3-phase electrical power parameters:
 *   1. S (kVA) = (sqrt(3) * V_L * I_L) / 1000
 *   2. P (kW)  = S * PF
 *   3. Q (kVAr)= S * sqrt(1 - PF^2)
 */
function calculateElectricalParameters(voltageLine, currentLine, powerFactor) {
  const apparentPowerKva = (SQRT_3 * voltageLine * currentLine) / 1000.0;
  const activePowerKw = apparentPowerKva * powerFactor;
  const sinPhi = Math.sqrt(Math.max(0.0, 1.0 - (powerFactor ** 2)));
  const reactivePowerKvar = apparentPowerKva * sinPhi;

  return {
    apparent_power_kva: Math.round(apparentPowerKva * 100) / 100,
    active_power_kw: Math.round(activePowerKw * 100) / 100,
    reactive_power_kvar: Math.round(reactivePowerKvar * 100) / 100
  };
}

/**
 * Calculates cumulative energy in kWh using actual elapsed time differences.
 * Protects against unrealistic energy accumulation during system downtime.
 */
async function calculateCumulativeEnergy(buildingId, currentActiveKw, currentTime = new Date(), defaultBaseEnergy = 1000.0) {
  const lastReading = await EnergyReading.findOne({ building_id: buildingId })
    .sort({ timestamp: -1, _id: -1 })
    .lean();

  if (lastReading && lastReading.energy_kwh !== undefined && lastReading.energy_kwh !== null) {
    const prevEnergy = Number(lastReading.energy_kwh);
    const prevTime = new Date(lastReading.timestamp);
    const curTime = currentTime instanceof Date ? currentTime : new Date(currentTime);

    let deltaSeconds = DEFAULT_INTERVAL_SECONDS;
    const diff = (curTime.getTime() - prevTime.getTime()) / 1000.0;
    if (diff > 0) {
      deltaSeconds = diff;
    }

    // Do not credit massive gaps as continuous power
    let effectiveSeconds = deltaSeconds;
    if (deltaSeconds > MAX_CONTINUOUS_GAP_SECONDS) {
      effectiveSeconds = DEFAULT_INTERVAL_SECONDS;
    }

    const deltaKwh = currentActiveKw * (effectiveSeconds / 3600.0);
    return Math.round((prevEnergy + deltaKwh) * 10000) / 10000;
  } else {
    // First reading for this building
    const deltaKwh = currentActiveKw * (DEFAULT_INTERVAL_SECONDS / 3600.0);
    return Math.round((defaultBaseEnergy + deltaKwh) * 10000) / 10000;
  }
}

/**
 * Generates and saves a single telemetry reading for a building, and evaluates alerts.
 * Supports controlled electrical anomaly injection:
 *   - LOW_PF: Power factor < 0.85
 *   - LOW_VOLTAGE: Line voltage < 380 V
 *   - HIGH_VOLTAGE: Line voltage > 420 V
 *   - HIGH_FREQ: Frequency > 50.5 Hz
 *   - LOW_FREQ: Frequency < 49.5 Hz
 *   - HIGH_LOAD: Active power > 90% rated power
 *   - OVERLOAD: Active power > 100% rated power
 */
async function generateSingleReading(building, currentTime = new Date(), anomalyType = null) {
  const buildingId = building._id;
  const code = building.code ? String(building.code).trim().toUpperCase() : 'GEN';
  const name = building.name || 'Unknown Building';
  const ratedKw = Number(building.rated_power_kw) || 50.0;

  const profile = BUILDING_PROFILES[code] || {
    name: name,
    base_current: 30.0,
    peak_current: 70.0,
    pf_min: 0.85,
    pf_max: 0.92,
    base_energy: 1000.0
  };

  // 1. Voltage with realistic grid variation around 400 V (395.5 - 404.5 V)
  let voltage = Math.round((NOMINAL_VOLTAGE + (Math.random() * 9.0 - 4.5)) * 10) / 10;

  // 2. Frequency with realistic minor fluctuation around 50 Hz (49.88 - 50.12 Hz)
  let frequency = Math.round((NOMINAL_FREQUENCY + (Math.random() * 0.24 - 0.12)) * 100) / 100;

  // 3. Line Current based on diurnal load factor
  const loadFactor = getDiurnalLoadFactor(currentTime);
  const currentRange = profile.peak_current - profile.base_current;
  const targetCurrent = profile.base_current + (currentRange * loadFactor);
  let current = Math.round(Math.max(3.0, targetCurrent + (Math.random() * 5.0 - 2.5)) * 10) / 10;

  // 4. Power factor (lagging inductive)
  let powerFactor = Math.round((profile.pf_min + Math.random() * (profile.pf_max - profile.pf_min)) * 1000) / 1000;

  // Controlled Anomaly Injection overrides
  if (anomalyType) {
    const cleanAnomaly = String(anomalyType).trim().toUpperCase();
    if (cleanAnomaly === 'LOW_PF' || cleanAnomaly === 'LOW_POWER_FACTOR') {
      powerFactor = 0.812;
    } else if (cleanAnomaly === 'LOW_VOLTAGE') {
      voltage = 374.5;
    } else if (cleanAnomaly === 'HIGH_VOLTAGE') {
      voltage = 426.8;
    } else if (cleanAnomaly === 'HIGH_FREQ' || cleanAnomaly === 'HIGH_FREQUENCY') {
      frequency = 50.78;
    } else if (cleanAnomaly === 'LOW_FREQ' || cleanAnomaly === 'LOW_FREQUENCY') {
      frequency = 49.22;
    } else if (cleanAnomaly === 'HIGH_LOAD') {
      const targetP = Math.round(0.95 * ratedKw * 100) / 100;
      powerFactor = 0.90;
      current = Math.round(((targetP * 1000.0) / (SQRT_3 * voltage * powerFactor)) * 10) / 10;
    } else if (cleanAnomaly === 'OVERLOAD') {
      const targetP = Math.round(1.15 * ratedKw * 100) / 100;
      powerFactor = 0.90;
      current = Math.round(((targetP * 1000.0) / (SQRT_3 * voltage * powerFactor)) * 10) / 10;
    }
  }

  // 5. Three-Phase Calculations
  const powers = calculateElectricalParameters(voltage, current, powerFactor);

  // 6. Cumulative Energy (kWh)
  const energyKwh = await calculateCumulativeEnergy(
    buildingId,
    powers.active_power_kw,
    currentTime,
    profile.base_energy
  );

  // 7. Insert reading into MongoDB collection 'energy_readings'
  const reading = await EnergyReading.create({
    building_id: buildingId,
    building_code: code,
    building_name: name,
    timestamp: currentTime,
    voltage,
    current,
    power_factor: powerFactor,
    frequency,
    apparent_power_kva: powers.apparent_power_kva,
    active_power_kw: powers.active_power_kw,
    reactive_power_kvar: powers.reactive_power_kvar,
    energy_kwh: energyKwh,
    is_simulated: true
  });

  // 8. Run Alert Engine evaluation for this reading
  await evaluateElectricalAlerts(building, reading, currentTime);

  return reading;
}

/**
 * Executes one reading cycle for all active campus buildings.
 * Dynamically queries MongoDB for buildings so newly added facilities receive telemetry automatically.
 */
async function runSimulationCycle(options = {}) {
  const { anomalyType = null, anomalyBuildingId = null, verbose = true } = options;

  // Refresh building list from MongoDB on every single simulation cycle
  const buildings = await Building.find({}).sort({ createdAt: 1, _id: 1 });
  if (!buildings || buildings.length === 0) {
    if (verbose) {
      console.log('[Simulator Warning] No buildings found in MongoDB. Waiting...');
    }
    return [];
  }

  const now = new Date();
  const readings = [];

  for (const b of buildings) {
    const isTarget = anomalyBuildingId && (
      b._id.toString() === String(anomalyBuildingId) ||
      b.code === String(anomalyBuildingId).trim().toUpperCase()
    );

    const curAnomaly = isTarget ? anomalyType : (anomalyType && !anomalyBuildingId ? anomalyType : null);
    const reading = await generateSingleReading(b, now, curAnomaly);
    readings.push(reading);

    if (verbose) {
      const marker = curAnomaly ? ` [ANOMALY: ${curAnomaly}]` : '';
      console.log(
        `  [${b.code.padEnd(5)}] V: ${reading.voltage.toFixed(1).padStart(5)}V | ` +
        `I: ${reading.current.toFixed(1).padStart(5)}A | ` +
        `PF: ${reading.power_factor.toFixed(3)} | ` +
        `S: ${reading.apparent_power_kva.toFixed(1).padStart(5)}kVA | ` +
        `P: ${reading.active_power_kw.toFixed(1).padStart(5)}kW | ` +
        `Q: ${reading.reactive_power_kvar.toFixed(1).padStart(5)}kVAr | ` +
        `Energy: ${reading.energy_kwh.toFixed(2).padStart(8)}kWh [SIMULATED]${marker}`
      );
    }
  }

  return readings;
}

/**
 * Main simulator execution loop for CLI running.
 */
async function runSimulator(options = {}) {
  const interval = options.interval !== undefined ? Number(options.interval) : DEFAULT_INTERVAL_SECONDS;
  const once = Boolean(options.once);
  const maxCycles = options.cycles ? Number(options.cycles) : null;
  const anomaly = options.anomaly || null;
  const targetBuilding = options.buildingId || options.building_id || null;

  console.log('='.repeat(80));
  console.log(' University of Ruhuna - Faculty of Engineering');
  console.log(' Three-Phase Electrical Energy Monitoring Simulator [MongoDB]');
  console.log('='.repeat(80));
  console.log(` Sampling Interval:  ${interval} seconds`);
  console.log(' Nominal Grid:       400 V Line-to-Line | 50.0 Hz Frequency');
  if (anomaly) {
    console.log(` Anomaly Injection:  ${anomaly} on ${targetBuilding || 'All Buildings'}`);
  }
  console.log(' Dynamic Refresh:    Building list queried from MongoDB on every cycle');
  console.log(' Data Label:         SIMULATED (stored in MongoDB collection energy_readings)');
  console.log(' Press Ctrl+C to stop the simulator.');
  console.log('='.repeat(80));

  let cyclesCompleted = 0;
  let isRunning = true;

  const handleShutdown = async () => {
    isRunning = false;
    console.log('\n[Simulator] Shutting down cleanly...');
    await disconnectDB();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  while (isRunning) {
    const cycleTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`\n[${cycleTime}] --- Generating 3-Phase Readings (SIMULATED) ---`);

    await runSimulationCycle({
      anomalyType: anomaly,
      anomalyBuildingId: targetBuilding,
      verbose: true
    });

    cyclesCompleted++;

    if (once || (maxCycles && cyclesCompleted >= maxCycles)) {
      console.log(`\n[Simulator] Completed ${cyclesCompleted} cycle(s). Finished.`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }

  process.removeListener('SIGINT', handleShutdown);
  process.removeListener('SIGTERM', handleShutdown);
}

// When run directly from CLI
if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      const options = {};

      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--once') {
          options.once = true;
        } else if (args[i] === '--interval' && args[i + 1]) {
          options.interval = parseFloat(args[++i]);
        } else if (args[i] === '--cycles' && args[i + 1]) {
          options.cycles = parseInt(args[++i], 10);
        } else if (args[i] === '--anomaly' && args[i + 1]) {
          options.anomaly = args[++i];
        } else if ((args[i] === '--building-id' || args[i] === '--building') && args[i + 1]) {
          options.buildingId = args[++i];
        }
      }

      await connectDB();
      await runSimulator(options);
      await disconnectDB();
      process.exit(0);
    } catch (err) {
      console.error('[Simulator Fatal Error]:', err);
      process.exit(1);
    }
  })();
}

module.exports = {
  SQRT_3,
  NOMINAL_VOLTAGE,
  NOMINAL_FREQUENCY,
  MAX_CONTINUOUS_GAP_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
  BUILDING_PROFILES,
  getDiurnalLoadFactor,
  calculateElectricalParameters,
  calculateCumulativeEnergy,
  generateSingleReading,
  runSimulationCycle,
  runSimulator
};
