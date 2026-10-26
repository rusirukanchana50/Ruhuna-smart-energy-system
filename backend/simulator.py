"""
simulator.py
------------
Three-Phase Electrical Energy Monitoring Simulator for
Faculty of Engineering, University of Ruhuna.

Simulates balanced 3-phase readings every 15 seconds for each of the 6 faculty buildings:
  - Nominal 400 V line-to-line voltage (V_L)
  - Nominal 50 Hz grid frequency
  - Diurnal load profile (higher during university hours, lower at night)
  - Calculations:
      * Apparent Power (kVA) = sqrt(3) * V_L * I_L / 1000
      * Active Power (kW)   = Apparent Power * PF
      * Reactive Power (kVAr)= Apparent Power * sqrt(1 - PF^2)
      * Incremental Energy (kWh) based on actual elapsed time (with missing data handling)
"""

import os
import sys
import sqlite3
import math
import time
import random
import argparse
from datetime import datetime, timezone

# Ensure backend directory and project root are in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
for path in (BACKEND_DIR, PROJECT_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)

from database import (
    init_db,
    get_all_buildings,
    get_latest_reading_for_building,
    insert_energy_reading
)

# Constant: sqrt(3) for three-phase power calculations
SQRT_3 = math.sqrt(3)

# Nominal grid values
NOMINAL_VOLTAGE = 400.0   # Volts (Line-to-Line)
NOMINAL_FREQUENCY = 50.0  # Hertz

# Maximum gap allowed between consecutive readings (in seconds) to consider data continuous.
# If gap > MAX_CONTINUOUS_GAP_SECONDS, the system assumes sensor was offline/missing
# and does not credit energy across the downtime.
MAX_CONTINUOUS_GAP_SECONDS = 60.0
DEFAULT_INTERVAL_SECONDS = float(os.environ.get("SIMULATOR_INTERVAL", "15.0"))

# Base parameters per building code
BUILDING_PROFILES = {
    "CEE": {
        "name": "Civil and Environmental Engineering",
        "base_current": 42.0,      # Amperes
        "peak_current": 85.0,
        "pf_min": 0.86,
        "pf_max": 0.92,
        "base_energy": 2400.0      # Starting kWh if no previous readings exist
    },
    "EIE": {
        "name": "Electrical and Information Engineering",
        "base_current": 48.0,
        "peak_current": 95.0,
        "pf_min": 0.88,
        "pf_max": 0.94,
        "base_energy": 3100.0
    },
    "MME": {
        "name": "Mechanical and Manufacturing Engineering",
        "base_current": 60.0,
        "peak_current": 125.0,     # Higher inductive motor & machining loads
        "pf_min": 0.82,
        "pf_max": 0.89,
        "base_energy": 4200.0
    },
    "MENA": {
        "name": "Marine Engineering and Naval Architecture",
        "base_current": 38.0,
        "peak_current": 80.0,
        "pf_min": 0.85,
        "pf_max": 0.91,
        "base_energy": 2100.0
    },
    "ADMIN": {
        "name": "Administration Building",
        "base_current": 20.0,
        "peak_current": 55.0,      # Office AC, computing, lighting
        "pf_min": 0.90,
        "pf_max": 0.95,
        "base_energy": 1800.0
    },
    "AUDI": {
        "name": "Auditorium",
        "base_current": 12.0,      # Low when idle, high during events
        "peak_current": 75.0,
        "pf_min": 0.85,
        "pf_max": 0.92,
        "base_energy": 1200.0
    },
    "LIB": {
        "name": "Library",
        "base_current": 25.0,
        "peak_current": 60.0,      # Study areas, lighting, AC, computer terminals
        "pf_min": 0.88,
        "pf_max": 0.94,
        "base_energy": 1500.0
    }
}


def get_diurnal_load_factor(current_datetime=None):
    """
    Computes a load multiplier (0.0 to 1.0) based on university working hours:
      - 08:00 - 17:00 (Daytime lectures, labs, workshops): Peak load (0.80 - 1.00)
      - 17:00 - 22:00 (Evening library, study rooms, lighting): Medium load (0.40 - 0.60)
      - 22:00 - 06:00 (Night baseload, servers, emergency lights): Low load (0.15 - 0.25)
      - 06:00 - 08:00 (Morning ramp-up): Moderate load (0.30 - 0.70)
    """
    if current_datetime is None:
        current_datetime = datetime.now()

    hour_fraction = current_datetime.hour + (current_datetime.minute / 60.0)

    if 8.0 <= hour_fraction < 17.0:
        # Working hours peak
        # Smooth curve peaking around 11:30 - 14:00
        progress = (hour_fraction - 8.0) / 9.0
        curve = math.sin(progress * math.pi)
        factor = 0.75 + 0.25 * curve
    elif 17.0 <= hour_fraction < 22.0:
        # Evening tapering
        progress = (hour_fraction - 17.0) / 5.0
        factor = 0.60 - 0.25 * progress
    elif 22.0 <= hour_fraction or hour_fraction < 6.0:
        # Night quiet hours
        factor = 0.20
    else:
        # 06:00 to 08:00 Morning arrival
        progress = (hour_fraction - 6.0) / 2.0
        factor = 0.25 + 0.45 * progress

    # Add a small random jitter (+/- 5%) for realistic realism
    jitter = random.uniform(-0.05, 0.05)
    return max(0.10, min(1.05, factor + jitter))


def calculate_electrical_parameters(voltage_line, current_line, power_factor):
    """
    Calculates balanced 3-phase electrical power parameters:
      1. Apparent Power S (kVA) = (sqrt(3) * V_L * I_L) / 1000
      2. Active Power P (kW)    = S * PF
      3. Reactive Power Q (kVAr)= S * sqrt(1 - PF^2)
    """
    # 1. Apparent Power in kVA
    apparent_power_kva = (SQRT_3 * voltage_line * current_line) / 1000.0

    # 2. Active Power in kW
    active_power_kw = apparent_power_kva * power_factor

    # 3. Reactive Power in kVAr (where sin_phi = sqrt(1 - PF^2))
    sin_phi = math.sqrt(max(0.0, 1.0 - (power_factor ** 2)))
    reactive_power_kvar = apparent_power_kva * sin_phi

    return apparent_power_kva, active_power_kw, reactive_power_kvar


def calculate_cumulative_energy(building_id, current_active_kw, current_time, default_base_energy=1000.0):
    """
    Calculates cumulative energy in kWh using actual elapsed time differences.
    - If elapsed time <= MAX_CONTINUOUS_GAP_SECONDS, energy = previous_energy + (P * delta_t_hours).
    - If elapsed time > MAX_CONTINUOUS_GAP_SECONDS (sensor was offline / missing data),
      we DO NOT assume continuous operation; we only credit the current active 15s interval.
    - If no previous reading exists, initialize with default_base_energy + current 15s interval.
    """
    last_reading = get_latest_reading_for_building(building_id)

    if last_reading and last_reading.get("energy_kwh") is not None:
        prev_energy = float(last_reading["energy_kwh"])
        prev_time_str = last_reading.get("timestamp")

        # Parse previous timestamp
        delta_seconds = DEFAULT_INTERVAL_SECONDS
        if prev_time_str:
            try:
                # Handle SQLite timestamp string format
                if "T" in prev_time_str:
                    prev_time = datetime.fromisoformat(prev_time_str)
                else:
                    prev_time = datetime.strptime(prev_time_str, "%Y-%m-%d %H:%M:%S")

                # Make current_time naive if prev_time is naive
                c_time = current_time.replace(tzinfo=None) if prev_time.tzinfo is None else current_time
                diff = (c_time - prev_time).total_seconds()
                if diff > 0:
                    delta_seconds = diff
            except Exception:
                delta_seconds = DEFAULT_INTERVAL_SECONDS

        # Rule: Do not credit massive gaps as continuous power
        if delta_seconds > MAX_CONTINUOUS_GAP_SECONDS:
            # Data was missing during gap: only credit standard 15-second active cycle
            effective_seconds = DEFAULT_INTERVAL_SECONDS
        else:
            effective_seconds = delta_seconds

        # delta_kWh = Active_kW * (hours)
        delta_kwh = current_active_kw * (effective_seconds / 3600.0)
        cumulative_kwh = prev_energy + delta_kwh

    else:
        # First reading for this building
        delta_kwh = current_active_kw * (DEFAULT_INTERVAL_SECONDS / 3600.0)
        cumulative_kwh = default_base_energy + delta_kwh

    return round(cumulative_kwh, 4)


def generate_single_reading(building, current_time=None, anomaly_type=None):
    """
    Generates and saves one reading for a building.
    Supports controlled electrical anomaly injection for viva testing (Requirement 15):
      - LOW_PF: Power factor < 0.85
      - LOW_VOLTAGE: Line voltage < 380 V
      - HIGH_VOLTAGE: Line voltage > 420 V
      - HIGH_FREQ: Frequency > 50.5 Hz
      - LOW_FREQ: Frequency < 49.5 Hz
      - HIGH_LOAD: Active power > 90% rated power
      - OVERLOAD: Active power > 100% rated power
    Returns the reading dictionary.
    """
    if current_time is None:
        current_time = datetime.now()

    building_id = building["id"]
    code = building.get("code", "GEN")
    rated_kw = float(building.get("rated_power_kw", 50.0))
    profile = BUILDING_PROFILES.get(code, {
        "name": building.get("name", "Unknown"),
        "base_current": 30.0,
        "peak_current": 70.0,
        "pf_min": 0.85,
        "pf_max": 0.92,
        "base_energy": 1000.0
    })

    # 1. Voltage with slight realistic grid variation around 400 V (396 - 404 V)
    voltage = round(NOMINAL_VOLTAGE + random.uniform(-4.5, 4.5), 2)

    # 2. Grid frequency with realistic minor fluctuation around 50 Hz (49.88 - 50.12 Hz)
    frequency = round(NOMINAL_FREQUENCY + random.uniform(-0.12, 0.12), 2)

    # 3. Line Current based on diurnal load factor
    load_factor = get_diurnal_load_factor(current_time)
    current_range = profile["peak_current"] - profile["base_current"]
    target_current = profile["base_current"] + (current_range * load_factor)
    current = round(max(3.0, target_current + random.uniform(-2.5, 2.5)), 2)

    # 4. Power factor (lagging inductive)
    power_factor = round(random.uniform(profile["pf_min"], profile["pf_max"]), 3)

    # Controlled Anomaly Injection overrides for Phase 6 Testing
    if anomaly_type:
        clean_anomaly = str(anomaly_type).strip().upper()
        if clean_anomaly in ("LOW_PF", "LOW_POWER_FACTOR"):
            power_factor = 0.812
        elif clean_anomaly == "LOW_VOLTAGE":
            voltage = 374.5
        elif clean_anomaly == "HIGH_VOLTAGE":
            voltage = 426.8
        elif clean_anomaly in ("HIGH_FREQ", "HIGH_FREQUENCY"):
            frequency = 50.78
        elif clean_anomaly in ("LOW_FREQ", "LOW_FREQUENCY"):
            frequency = 49.22
        elif clean_anomaly == "HIGH_LOAD":
            target_p = round(0.95 * rated_kw, 2)
            power_factor = 0.90
            current = round((target_p * 1000.0) / (SQRT_3 * voltage * power_factor), 2)
        elif clean_anomaly == "OVERLOAD":
            target_p = round(1.15 * rated_kw, 2)
            power_factor = 0.90
            current = round((target_p * 1000.0) / (SQRT_3 * voltage * power_factor), 2)

    # 5. Three-Phase Calculations
    s_kva, p_kw, q_kvar = calculate_electrical_parameters(voltage, current, power_factor)
    apparent_power_kva = round(s_kva, 2)
    active_power_kw = round(p_kw, 2)
    reactive_power_kvar = round(q_kvar, 2)

    # 6. Cumulative Energy (kWh)
    energy_kwh = calculate_cumulative_energy(
        building_id=building_id,
        current_active_kw=active_power_kw,
        current_time=current_time,
        default_base_energy=profile["base_energy"]
    )

    # Formatted timestamp
    timestamp_str = current_time.strftime("%Y-%m-%d %H:%M:%S")

    # 7. Insert reading into SQLite
    try:
        reading_id = insert_energy_reading(
            building_id=building_id,
            timestamp=timestamp_str,
            voltage=voltage,
            current=current,
            power_factor=power_factor,
            frequency=frequency,
            apparent_power_kva=apparent_power_kva,
            active_power_kw=active_power_kw,
            reactive_power_kvar=reactive_power_kvar,
            energy_kwh=energy_kwh,
            is_simulated=1
        )
    except Exception as e:
        if isinstance(e, sqlite3.IntegrityError) or "FOREIGN KEY" in str(e):
            print(f"  [Simulator Warning] Building ID {building_id} ({code}) no longer exists in database (deleted). Skipping reading.")
            return None
        raise

    return {
        "reading_id": reading_id,
        "building_id": building_id,
        "building_code": code,
        "building_name": building.get("name"),
        "timestamp": timestamp_str,
        "voltage": voltage,
        "current": current,
        "power_factor": power_factor,
        "frequency": frequency,
        "apparent_power_kva": apparent_power_kva,
        "active_power_kw": active_power_kw,
        "reactive_power_kvar": reactive_power_kvar,
        "energy_kwh": energy_kwh,
        "is_simulated": 1
    }


def run_simulation_cycle(buildings=None, anomaly_type=None, anomaly_bldg_id=1):
    """
    Executes one reading cycle for all given buildings.
    If buildings is None, dynamically refreshes the building list from SQLite.
    If anomaly_type is specified, injects the anomaly into anomaly_bldg_id.
    """
    if buildings is None:
        buildings = get_all_buildings()

    now = datetime.now()
    cycle_time = now.strftime("%Y-%m-%d %H:%M:%S")
    print(f"\n[{cycle_time}] --- Generating 3-Phase Readings (SIMULATED) ---")

    readings = []
    for b in buildings:
        is_target = (b["id"] == anomaly_bldg_id)
        cur_anomaly = anomaly_type if is_target else None
        try:
            r = generate_single_reading(b, current_time=now, anomaly_type=cur_anomaly)
        except sqlite3.IntegrityError:
            print(f"  [Simulator Warning] Building ID {b.get('id')} ({b.get('code')}) was deleted. Skipped.")
            r = None

        if r is not None:
            readings.append(r)
            anomaly_marker = f" [ANOMALY: {anomaly_type}]" if (is_target and anomaly_type) else ""
            print(
                f"  [{r['building_code']:<5}] V_L: {r['voltage']:5.1f}V | "
                f"I_L: {r['current']:5.1f}A | "
                f"PF: {r['power_factor']:0.3f} | "
                f"S: {r['apparent_power_kva']:5.1f}kVA | "
                f"P: {r['active_power_kw']:5.1f}kW | "
                f"Q: {r['reactive_power_kvar']:5.1f}kVAr | "
                f"Energy: {r['energy_kwh']:8.2f}kWh [SIMULATED]{anomaly_marker}"
            )

    return readings


def main():
    parser = argparse.ArgumentParser(
        description="University of Ruhuna - Three-Phase Electrical Energy Simulator"
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=DEFAULT_INTERVAL_SECONDS,
        help="Sampling interval in seconds (default: 15.0 or SIMULATOR_INTERVAL env var)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run only a single cycle and exit (useful for testing or batch runs)"
    )
    parser.add_argument(
        "--cycles",
        type=int,
        default=None,
        help="Run a specific number of cycles then exit"
    )
    parser.add_argument(
        "--anomaly",
        type=str,
        default=None,
        choices=["LOW_PF", "LOW_VOLTAGE", "HIGH_VOLTAGE", "HIGH_FREQ", "LOW_FREQ", "HIGH_LOAD", "OVERLOAD"],
        help="Inject a specific electrical anomaly for viva testing and alert detection"
    )
    parser.add_argument(
        "--building-id",
        type=int,
        default=1,
        help="Building ID to inject anomaly into (default: 1 [CEE])"
    )

    args = parser.parse_args()

    # Ensure database tables exist
    init_db()

    # Initial check and display of current buildings
    initial_buildings = get_all_buildings()
    print("=" * 80)
    print(" University of Ruhuna - Faculty of Engineering")
    print(" Three-Phase Electrical Energy Monitoring Simulator [SIMULATED DATA]")
    print("=" * 80)
    print(f" Initial Faculty Buildings Detected ({len(initial_buildings)}):")
    for b in initial_buildings:
        print(f"   - [ID {b['id']}] {b['code']}: {b['name']} (Rated: {b.get('rated_power_kw', 50.0)} kW)")
    print("-" * 80)
    print(f" Sampling Interval:  {args.interval} seconds")
    print(f" Nominal Grid:       400 V Line-to-Line | 50.0 Hz Frequency")
    if args.anomaly:
        print(f" Anomaly Injection:  {args.anomaly} on Building ID {args.building_id}")
    print(f" Dynamic Refresh:    Building list refreshed from SQLite on every cycle")
    print(f" Data Label:         SIMULATED (stored directly in energy.db)")
    print(f" Press Ctrl+C in this terminal to stop the simulator anytime.")
    print("=" * 80)

    cycles_completed = 0
    try:
        while True:
            # Refresh building list from SQLite at the beginning of EVERY simulation cycle
            # so new buildings automatically receive simulated readings,
            # and deleted buildings immediately stop receiving data.
            current_buildings = get_all_buildings()
            if not current_buildings:
                print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [Simulator Warning] No buildings found in database. Waiting...")
            else:
                run_simulation_cycle(current_buildings, anomaly_type=args.anomaly, anomaly_bldg_id=args.building_id)

            cycles_completed += 1

            if args.once or (args.cycles and cycles_completed >= args.cycles):
                print(f"\n[Simulator] Completed {cycles_completed} cycle(s). Exiting.")
                break

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\n[Simulator] Received shutdown signal. Stopped cleanly.")


if __name__ == "__main__":
    main()


