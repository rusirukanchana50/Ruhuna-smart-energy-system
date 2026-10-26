"""
test_phase5_thorough.py
-----------------------
Comprehensive Phase 5 Verification Test Suite for Ruhuna Smart Energy System.
Thoroughly verifies all aspects of Historical Energy Analytics without modifying
or deleting the existing database (energy.db).

Covers:
1. GET /api/energy/history parameter variations (valid IDs, invalid non-numeric IDs,
   non-existent numeric IDs, valid date formats, missing params, empty results).
2. GET /api/energy/analytics calculation verification using a separate temporary SQLite
   database with known synthetic readings and manual mathematical validation.
3. Energy integration with irregular sampling intervals, missing-data gaps (>60s),
   single reading, and empty readings.
4. Time-weighted average power, peak power, load factor (LF = P_avg / P_peak),
   power factor statistics, and voltage range verification.
5. Six-building comparison analytics, campus totals, load factor aggregation, and
   prevention of double-counting.
6. Access control: Unauthorized requests (401/302), authenticated requests,
   Administrator vs Viewer role permissions, and session invalidation on logout.
7. Dashboard DOM elements: Date filters, preset buttons, building selector, KPI anchors,
   Chart.js canvas elements, and zero-baseline empty states.
8. Telemetry source verification: SQLite database integrity, no frontend Math.random()
   or hardcoded fake datasets.
"""

import os
import sys
import tempfile
import sqlite3
import json
from datetime import datetime

# Ensure project root and backend are in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import database
from app import app


class TestTracker:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.tests = []

    def log_result(self, name, success, details=""):
        if success:
            self.passed += 1
            status = "PASSED"
            print(f"  [PASS] {name} {details}")
        else:
            self.failed += 1
            status = "FAILED"
            print(f"  [FAIL] {name} - ERROR: {details}")
        self.tests.append({"name": name, "status": status, "details": details})


tracker = TestTracker()


# ==============================================================================
# 1. Test GET /api/energy/history
# ==============================================================================
def test_energy_history_endpoint():
    print("\n" + "=" * 75)
    print(" 1. TESTING GET /api/energy/history (Parameters, Bounds & Edge Cases)")
    print("=" * 75)

    with app.test_client() as client:
        # Authenticate as test admin
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # 1.1 Valid building IDs: numeric (1..6)
        for b_id in [1, 2, 3, 4, 5, 6]:
            res = client.get(f"/api/energy/history?building_id={b_id}&limit=5")
            data = res.get_json()
            is_ok = (res.status_code == 200 and data.get("status") == "success" and data.get("building_id") == b_id)
            tracker.log_result(f"Valid building_id={b_id}", is_ok, f"Count: {data.get('count', 0)}")

        # 1.2 Valid building ID: 'all'
        res = client.get("/api/energy/history?building_id=all&limit=10")
        data = res.get_json()
        is_ok = (res.status_code == 200 and data.get("status") == "success" and data.get("building_id") == "all")
        tracker.log_result("Valid building_id='all'", is_ok, f"Retrieved {data.get('count', 0)} multi-building records")

        # 1.3 Invalid building ID: non-existent numeric ID (9999) -> empty result
        res = client.get("/api/energy/history?building_id=9999")
        data = res.get_json()
        is_ok = (res.status_code == 200 and data.get("status") == "success" and data.get("count") == 0 and len(data.get("data", [])) == 0)
        tracker.log_result("Non-existent numeric ID (9999)", is_ok, "Returned 200 with count=0 and empty data array")

        # 1.4 Invalid building ID: non-numeric string ('invalid_string') -> 400 Bad Request
        res = client.get("/api/energy/history?building_id=invalid_string")
        data = res.get_json()
        is_ok = (res.status_code == 400 and data.get("status") == "error")
        tracker.log_result("Invalid non-numeric ID ('invalid_string')", is_ok, f"Returned 400 with message: '{data.get('message')}'")

        # 1.5 Missing required parameter: omitting building_id -> 400 Bad Request
        res = client.get("/api/energy/history")
        data = res.get_json()
        is_ok = (res.status_code == 400 and data.get("status") == "error" and "required" in data.get("message", "").lower())
        tracker.log_result("Missing required parameter (omitted building_id)", is_ok, f"Returned 400 with message: '{data.get('message')}'")

        # 1.6 Valid date range filtering (ISO format)
        res = client.get("/api/energy/history?building_id=1&start=2026-10-01T00:00&end=2026-10-07T23:59&limit=10")
        data = res.get_json()
        is_ok = (res.status_code == 200 and data.get("status") == "success")
        tracker.log_result("Valid ISO date range filtering (start & end)", is_ok, f"Returned {data.get('count', 0)} records")

        # 1.7 Empty results: future date range where no data exists
        res = client.get("/api/energy/history?building_id=1&start=2099-01-01T00:00&end=2099-01-02T00:00")
        data = res.get_json()
        is_ok = (res.status_code == 200 and data.get("status") == "success" and data.get("count") == 0 and data.get("data") == [])
        tracker.log_result("Empty result on future date range (2099)", is_ok, "Returned 200 with count=0 and data=[]")


# ==============================================================================
# 2. Independent Calculations on Temporary Isolated Test Database
# ==============================================================================
def test_analytics_isolated_temporary_db():
    print("\n" + "=" * 75)
    print(" 2. INDEPENDENT VERIFICATION USING TEMPORARY SYNTHETIC DATABASE")
    print("=" * 75)

    original_db_path = database.DB_PATH
    temp_dir = tempfile.mkdtemp()
    temp_db_path = os.path.join(temp_dir, "temp_synthetic_energy.db")

    try:
        # Switch database module to temporary database
        database.DB_PATH = temp_db_path
        print(f"  [Setup] Redirected DB_PATH to isolated test DB: {temp_db_path}")

        # Initialize schema & seed buildings
        database.init_db()

        # Seed admin user in temp db so Flask session can authenticate against it
        database.create_user(
            email="temp_admin@eng.ruh.ac.lk",
            password="TempAdminPassword123!",
            full_name="Temp Test Administrator",
            role="Administrator"
        )

        # Insert 3 Known Synthetic Readings for Building 1 (CEE):
        # Reading 1: 10:00:00 -> P=60 kW, S=75 kVA, Q=45 kVAr, PF=0.80, V=400 V, I=108.25 A, f=50.0 Hz
        # Reading 2: 10:00:15 -> P=80 kW, S=100 kVA, Q=60 kVAr, PF=0.80, V=402 V, I=143.68 A, f=50.1 Hz  (dt = 15s)
        # Reading 3: 10:00:30 -> P=100 kW, S=125 kVA, Q=75 kVAr, PF=0.80, V=398 V, I=181.75 A, f=49.9 Hz (dt = 15s)
        database.insert_energy_reading(
            building_id=1,
            timestamp="2026-10-06 10:00:00",
            voltage=400.0,
            current=108.25,
            power_factor=0.80,
            frequency=50.0,
            apparent_power_kva=75.0,
            active_power_kw=60.0,
            reactive_power_kvar=45.0,
            energy_kwh=100.0,
            is_simulated=1
        )
        database.insert_energy_reading(
            building_id=1,
            timestamp="2026-10-06 10:00:15",
            voltage=402.0,
            current=143.68,
            power_factor=0.80,
            frequency=50.1,
            apparent_power_kva=100.0,
            active_power_kw=80.0,
            reactive_power_kvar=60.0,
            energy_kwh=100.2917,
            is_simulated=1
        )
        database.insert_energy_reading(
            building_id=1,
            timestamp="2026-10-06 10:00:30",
            voltage=398.0,
            current=181.75,
            power_factor=0.80,
            frequency=49.9,
            apparent_power_kva=125.0,
            active_power_kw=100.0,
            reactive_power_kvar=75.0,
            energy_kwh=100.6667,
            is_simulated=1
        )

        # Theoretical Ground Truth Calculations:
        # N = 3
        # Avg Active Power = (60 + 80 + 100) / 3 = 80.0 kW
        # Peak Active Power = max(60, 80, 100) = 100.0 kW
        # Min Active Power = min(60, 80, 100) = 60.0 kW
        # Load Factor = 80.0 / 100.0 = 0.800 (80.0%)
        # Avg Apparent Power = (75 + 100 + 125) / 3 = 100.0 kVA
        # Avg Reactive Power = (45 + 60 + 75) / 3 = 60.0 kVAr
        # Avg PF = 0.800, Min PF = 0.800
        # Avg Voltage = (400 + 402 + 398) / 3 = 400.0 V, Min = 398.0 V, Max = 402.0 V
        # Avg Current = (108.25 + 143.68 + 181.75) / 3 = 144.56 A
        # Avg Frequency = (50.0 + 50.1 + 49.9) / 3 = 50.00 Hz
        # Energy Trapezoidal:
        #  Interval 1 (15s): (60 + 80)/2 * (15/3600) = 70 * 0.00416667 = 0.29167 kWh
        #  Interval 2 (15s): (80 + 100)/2 * (15/3600) = 90 * 0.00416667 = 0.37500 kWh
        #  Total Energy = 0.29167 + 0.37500 = 0.66667 -> 0.667 kWh

        with app.test_client() as client:
            client.post("/login", data={
                "email": "temp_admin@eng.ruh.ac.lk",
                "password": "TempAdminPassword123!"
            })

            res = client.get("/api/energy/analytics?building_id=1")
            is_http_ok = (res.status_code == 200)
            data = res.get_json()
            a = data.get("analytics", {})

            # Compare each metric against theoretical manual ground truth
            checks = [
                ("Readings Count", a.get("readings_count") == 3, f"Expected 3, got {a.get('readings_count')}"),
                ("Avg Active Power", abs(a.get("avg_active_power_kw", 0) - 80.0) < 0.01, f"Expected 80.0 kW, got {a.get('avg_active_power_kw')}"),
                ("Peak Active Power", abs(a.get("peak_active_power_kw", 0) - 100.0) < 0.01, f"Expected 100.0 kW, got {a.get('peak_active_power_kw')}"),
                ("Min Active Power", abs(a.get("min_active_power_kw", 0) - 60.0) < 0.01, f"Expected 60.0 kW, got {a.get('min_active_power_kw')}"),
                ("Load Factor (Avg/Peak)", abs(a.get("load_factor", 0) - 0.800) < 0.01, f"Expected 0.800, got {a.get('load_factor')}"),
                ("Load Factor Pct", abs(a.get("load_factor_pct", 0) - 80.0) < 0.1, f"Expected 80.0%, got {a.get('load_factor_pct')}%"),
                ("Avg Apparent Power", abs(a.get("avg_apparent_power_kva", 0) - 100.0) < 0.01, f"Expected 100.0 kVA, got {a.get('avg_apparent_power_kva')}"),
                ("Avg Reactive Power", abs(a.get("avg_reactive_power_kvar", 0) - 60.0) < 0.01, f"Expected 60.0 kVAr, got {a.get('avg_reactive_power_kvar')}"),
                ("Avg Power Factor", abs(a.get("avg_power_factor", 0) - 0.800) < 0.005, f"Expected 0.800, got {a.get('avg_power_factor')}"),
                ("Avg Voltage", abs(a.get("avg_voltage", 0) - 400.0) < 0.1, f"Expected 400.0 V, got {a.get('avg_voltage')}"),
                ("Voltage Range", (a.get("min_voltage") == 398.0 and a.get("max_voltage") == 402.0), f"Expected [398.0, 402.0], got [{a.get('min_voltage')}, {a.get('max_voltage')}]"),
                ("Avg Current", abs(a.get("avg_current", 0) - 144.6) < 0.2, f"Expected ~144.6 A, got {a.get('avg_current')}"),
                ("Avg Frequency", abs(a.get("avg_frequency", 0) - 50.00) < 0.05, f"Expected 50.0 Hz, got {a.get('avg_frequency')}"),
                ("Integrated Energy (kWh)", abs(a.get("total_energy_kwh", 0) - 0.667) < 0.01, f"Expected 0.667 kWh, got {a.get('total_energy_kwh')} kWh")
            ]

            for param_name, passed, detail in checks:
                tracker.log_result(f"Synthetic Ground Truth -> {param_name}", passed and is_http_ok, detail)

    finally:
        # Restore original database path and clean up temp db
        database.DB_PATH = original_db_path
        if os.path.exists(temp_db_path):
            try:
                os.remove(temp_db_path)
            except Exception:
                pass
        try:
            os.rmdir(temp_dir)
        except Exception:
            pass
        print(f"  [Cleanup] Restored original DB_PATH ({database.DB_PATH}) and removed temporary database.\n")


# ==============================================================================
# 3. Energy Integration with Irregular Intervals & Missing-Data Gaps
# ==============================================================================
def test_energy_integration_irregular_and_gaps():
    print("\n" + "=" * 75)
    print(" 3. VERIFYING ENERGY INTEGRATION (Irregular Intervals & Sensor Gaps)")
    print("=" * 75)

    # Scenario A: Irregular sampling intervals within continuous 60s threshold:
    # Reading 1: 00:00:00, 40 kW
    # Reading 2: 00:00:10 (dt = 10s), 60 kW -> P_avg = 50 kW -> E1 = 50 * (10/3600) = 0.13889 kWh
    # Reading 3: 00:00:40 (dt = 30s), 80 kW -> P_avg = 70 kW -> E2 = 70 * (30/3600) = 0.58333 kWh
    # Reading 4: 00:01:25 (dt = 45s), 40 kW -> P_avg = 60 kW -> E3 = 60 * (45/3600) = 0.75000 kWh
    # Expected sum = 0.13889 + 0.58333 + 0.75000 = 1.47222 kWh (~1.472 kWh)
    irregular_readings = [
        {"timestamp": "2026-10-06 00:00:00", "active_power_kw": 40.0, "apparent_power_kva": 45.0, "reactive_power_kvar": 20.0, "power_factor": 0.89, "voltage": 400.0, "current": 57.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 00:00:10", "active_power_kw": 60.0, "apparent_power_kva": 67.0, "reactive_power_kvar": 30.0, "power_factor": 0.89, "voltage": 401.0, "current": 86.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 00:00:40", "active_power_kw": 80.0, "apparent_power_kva": 90.0, "reactive_power_kvar": 40.0, "power_factor": 0.89, "voltage": 399.0, "current": 115.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 00:01:25", "active_power_kw": 40.0, "apparent_power_kva": 45.0, "reactive_power_kvar": 20.0, "power_factor": 0.89, "voltage": 400.0, "current": 57.0, "frequency": 50.0}
    ]
    res_irreg = database.calculate_building_analytics(irregular_readings)
    is_irreg_ok = abs(res_irreg["total_energy_kwh"] - 1.472) < 0.01
    tracker.log_result("Irregular intervals integration (dt = 10s, 30s, 45s)", is_irreg_ok, f"Computed: {res_irreg['total_energy_kwh']} kWh (Expected: ~1.472 kWh)")

    # Scenario B: Sensor offline / missing-data gap (> 60s)
    # Append Reading 5 after a 45-minute missing gap:
    # 00:46:25 (dt = 2700s > 60s), 50 kW
    # Algorithm MUST NOT assume 50 kW continuous over 45 min (which would add 50 * 0.75 = 37.5 kWh!)
    # Algorithm must credit ONLY active 15s sampling cycle: 50 * (15/3600) = 0.20833 kWh
    # Expected total = 1.47222 + 0.20833 = 1.68055 kWh (~1.681 kWh)
    gap_readings = irregular_readings + [
        {"timestamp": "2026-10-06 00:46:25", "active_power_kw": 50.0, "apparent_power_kva": 56.0, "reactive_power_kvar": 25.0, "power_factor": 0.89, "voltage": 400.0, "current": 72.0, "frequency": 50.0}
    ]
    res_gap = database.calculate_building_analytics(gap_readings)
    is_gap_safe = (res_gap["total_energy_kwh"] < 2.5)  # If continuous, it would be > 38 kWh!
    is_gap_exact = abs(res_gap["total_energy_kwh"] - 1.681) < 0.015
    tracker.log_result("Missing sensor gap (>60s) energy credit protection", is_gap_safe and is_gap_exact, f"Computed: {res_gap['total_energy_kwh']} kWh (Expected: ~1.681 kWh, uninflated)")

    # Scenario C: Single reading edge case (N = 1)
    # Reading 1: 60 kW -> credits 60 * (15/3600) = 0.25 kWh
    single_reading = [irregular_readings[0]]
    res_single = database.calculate_building_analytics(single_reading)
    expected_single_kwh = round(40.0 * (15.0 / 3600.0), 3)
    is_single_ok = (res_single["total_energy_kwh"] == expected_single_kwh and res_single["readings_count"] == 1)
    tracker.log_result("Single reading edge case (N=1)", is_single_ok, f"Computed: {res_single['total_energy_kwh']} kWh")

    # Scenario D: Empty readings edge case (N = 0)
    res_empty = database.calculate_building_analytics([])
    is_empty_ok = (res_empty["readings_count"] == 0 and res_empty["total_energy_kwh"] == 0.0 and res_empty["load_factor"] == 0.0)
    tracker.log_result("Empty readings edge case (N=0)", is_empty_ok, "Returned clean zero metrics without division by zero")


# ==============================================================================
# 4. Electrical Load Factor & Parameter Constraints
# ==============================================================================
def test_electrical_parameters_and_load_factor():
    print("\n" + "=" * 75)
    print(" 4. VERIFYING LOAD FACTOR, POWER FACTOR & VOLTAGE STATISTICS")
    print("=" * 75)

    # 4.1 Constant load: P_avg == P_peak -> Load Factor must be exactly 1.0 (100%)
    constant_readings = [
        {"timestamp": f"2026-10-06 10:00:{i*15:02d}", "active_power_kw": 50.0, "apparent_power_kva": 55.0, "reactive_power_kvar": 20.0, "power_factor": 0.90, "voltage": 400.0, "current": 72.0, "frequency": 50.0}
        for i in range(4)
    ]
    res_const = database.calculate_building_analytics(constant_readings)
    is_lf_one = (res_const["load_factor"] == 1.0 and res_const["load_factor_pct"] == 100.0)
    tracker.log_result("Constant load condition -> Load Factor = 1.0 (100%)", is_lf_one, f"LF: {res_const['load_factor']}")

    # 4.2 Peaky load: Baseline 20 kW, sudden peak 100 kW
    # P_avg = (20 + 20 + 20 + 100) / 4 = 40.0 kW, P_peak = 100 kW -> LF = 40 / 100 = 0.40 (40%)
    peaky_readings = [
        {"timestamp": "2026-10-06 10:00:00", "active_power_kw": 20.0, "apparent_power_kva": 22.0, "reactive_power_kvar": 9.0, "power_factor": 0.90, "voltage": 400.0, "current": 29.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 10:00:15", "active_power_kw": 20.0, "apparent_power_kva": 22.0, "reactive_power_kvar": 9.0, "power_factor": 0.90, "voltage": 400.0, "current": 29.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 10:00:30", "active_power_kw": 20.0, "apparent_power_kva": 22.0, "reactive_power_kvar": 9.0, "power_factor": 0.90, "voltage": 400.0, "current": 29.0, "frequency": 50.0},
        {"timestamp": "2026-10-06 10:00:45", "active_power_kw": 100.0, "apparent_power_kva": 111.0, "reactive_power_kvar": 45.0, "power_factor": 0.90, "voltage": 398.0, "current": 145.0, "frequency": 50.0}
    ]
    res_peaky = database.calculate_building_analytics(peaky_readings)
    is_lf_peaky = (res_peaky["load_factor"] == 0.40 and res_peaky["load_factor_pct"] == 40.0)
    tracker.log_result("Peaky load condition -> Load Factor = 0.40 (40%)", is_lf_peaky, f"LF: {res_peaky['load_factor']}")

    # 4.3 Active database real readings validation across all 6 buildings
    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        for b_id in [1, 2, 3, 4, 5, 6]:
            res = client.get(f"/api/energy/analytics?building_id={b_id}")
            data = res.get_json()
            a = data.get("analytics", {})
            b_code = data.get("building_code", f"B{b_id}")

            # Verify physical bounds
            peak_ge_avg = a["peak_active_power_kw"] >= a["avg_active_power_kw"]
            avg_ge_min = a["avg_active_power_kw"] >= a["min_active_power_kw"]
            lf_in_range = 0.0 <= a["load_factor"] <= 1.0
            v_in_range = 380.0 <= a["avg_voltage"] <= 420.0
            pf_in_range = 0.70 <= a["avg_power_factor"] <= 1.0

            all_physical_ok = peak_ge_avg and avg_ge_min and lf_in_range and v_in_range and pf_in_range
            tracker.log_result(
                f"Building {b_id} [{b_code}] Physical Bounds (P_peak >= P_avg >= P_min, LF in [0,1], V in [380,420], PF in [0.7,1.0])",
                all_physical_ok,
                f"Peak: {a['peak_active_power_kw']}kW, Avg: {a['avg_active_power_kw']}kW, LF: {a['load_factor']}, V_avg: {a['avg_voltage']}V, PF_avg: {a['avg_power_factor']}"
            )


# ==============================================================================
# 5. Six-Building Comparison & Campus Totals (Double-Counting Prevention)
# ==============================================================================
def test_six_building_comparison_and_aggregation():
    print("\n" + "=" * 75)
    print(" 5. VERIFYING SIX-BUILDING COMPARISON & NON-DOUBLE-COUNTED TOTALS")
    print("=" * 75)

    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # Query comparison mode
        res = client.get("/api/energy/analytics?building_id=all")
        assert res.status_code == 200, "Comparison endpoint returned non-200"
        data = res.get_json()

        campus = data.get("campus_summary", {})
        comp = data.get("comparison", [])

        # 5.1 Dynamic building count check
        expected_bldg_count = len(database.get_all_buildings())
        is_count_match = (campus.get("building_count") == expected_bldg_count and len(comp) == expected_bldg_count)
        tracker.log_result(f"Building count equals database count ({expected_bldg_count})", is_count_match, f"Campus summary count: {campus.get('building_count')}, List length: {len(comp)}")

        # 5.2 Unique building IDs without duplicates
        comp_ids = sorted([c["building_id"] for c in comp])
        is_ids_unique = (len(comp_ids) == len(set(comp_ids)) and len(comp_ids) == expected_bldg_count)
        tracker.log_result("Unique building IDs without duplicates", is_ids_unique, f"Building IDs found: {comp_ids}")

        # 5.3 Required Faculty Building Codes
        expected_codes = {"CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"}
        actual_codes = {c["building_code"] for c in comp}
        is_codes_match = expected_codes.issubset(actual_codes)
        tracker.log_result("All core Faculty building codes present", is_codes_match, f"Found codes: {actual_codes}")

        # 5.4 Campus Total Energy: sum of individual building energies
        summed_energy = round(sum(c["total_energy_kwh"] for c in comp), 3)
        campus_energy = campus.get("total_energy_kwh", 0.0)
        is_energy_sum_exact = abs(campus_energy - summed_energy) < 0.005
        tracker.log_result("Campus Total Energy equals sum of buildings (no double-counting)", is_energy_sum_exact, f"Campus: {campus_energy} kWh == Sum: {summed_energy} kWh")

        # 5.5 Campus Average Demand: sum of building average demands
        summed_avg_power = round(sum(c["avg_active_power_kw"] for c in comp), 2)
        campus_avg_power = campus.get("avg_active_power_kw", 0.0)
        is_power_sum_exact = abs(campus_avg_power - summed_avg_power) < 0.05
        tracker.log_result("Campus Average Demand equals sum of building average demands", is_power_sum_exact, f"Campus: {campus_avg_power} kW == Sum: {summed_avg_power} kW")

        # 5.6 Campus Peak Demand: maximum of building peak demands
        max_peak = max(c["peak_active_power_kw"] for c in comp)
        campus_peak = campus.get("peak_active_power_kw", 0.0)
        is_peak_match = abs(campus_peak - max_peak) < 0.01
        tracker.log_result("Campus Peak Demand equals highest observed peak among buildings", is_peak_match, f"Campus Peak: {campus_peak} kW == Max Building Peak: {max_peak} kW")


# ==============================================================================
# 6. Authentication, Role Permissions & Unauthorized Requests
# ==============================================================================
def test_auth_and_role_permissions():
    print("\n" + "=" * 75)
    print(" 6. VERIFYING UNAUTHORIZED REQUESTS, SESSIONS & ROLE PERMISSIONS")
    print("=" * 75)

    with app.test_client() as client:
        # 6.1 Unauthenticated requests to /analytics -> 302 redirect to /login
        res = client.get("/analytics", follow_redirects=False)
        is_unauth_page = (res.status_code == 302 and "/login" in res.headers.get("Location", ""))
        tracker.log_result("Unauthenticated GET /analytics redirects to /login", is_unauth_page, f"Status: {res.status_code}, Location: {res.headers.get('Location')}")

        # 6.2 Unauthenticated requests to /api/energy/history -> 401
        res = client.get("/api/energy/history?building_id=1")
        is_unauth_hist = (res.status_code == 401 and res.get_json().get("status") == "error")
        tracker.log_result("Unauthenticated GET /api/energy/history returns 401 Unauthorized", is_unauth_hist, f"Status: {res.status_code}")

        # 6.3 Unauthenticated requests to /api/energy/analytics -> 401
        res = client.get("/api/energy/analytics?building_id=1")
        is_unauth_anal = (res.status_code == 401 and res.get_json().get("status") == "error")
        tracker.log_result("Unauthenticated GET /api/energy/analytics returns 401 Unauthorized", is_unauth_anal, f"Status: {res.status_code}")

        # 6.4 Authenticate as Administrator
        res_login_admin = client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        }, follow_redirects=False)
        is_admin_logged = (res_login_admin.status_code == 302 and "/dashboard" in res_login_admin.headers.get("Location", ""))
        tracker.log_result("Administrator authentication", is_admin_logged, "Admin logged in successfully")

        # Admin accesses /analytics
        res_admin_page = client.get("/analytics")
        html_admin = res_admin_page.get_data(as_text=True)
        is_admin_page_ok = (res_admin_page.status_code == 200 and "Administrator" in html_admin and "role-admin" in html_admin)
        tracker.log_result("Administrator role rendering on /analytics", is_admin_page_ok, "Admin badge 'role-admin' rendered")

        # Admin logs out
        res_logout = client.post("/logout", follow_redirects=False)
        is_logged_out = (res_logout.status_code == 302 and "/login" in res_logout.headers.get("Location", ""))
        tracker.log_result("POST /logout invalidates active session", is_logged_out, "Redirected to /login")

        # Verify access blocked immediately after logout
        res_post_logout = client.get("/analytics", follow_redirects=False)
        is_blocked_post_logout = (res_post_logout.status_code == 302 and "/login" in res_post_logout.headers.get("Location", ""))
        tracker.log_result("Subsequent access blocked after logout", is_blocked_post_logout, "302 redirect enforced")

        # 6.5 Authenticate as Viewer role
        res_login_viewer = client.post("/login", data={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        }, follow_redirects=False)
        is_viewer_logged = (res_login_viewer.status_code == 302)
        tracker.log_result("Viewer role authentication", is_viewer_logged, "Viewer logged in successfully")

        # Viewer accesses /analytics and sees Viewer badge
        res_viewer_page = client.get("/analytics")
        html_viewer = res_viewer_page.get_data(as_text=True)
        is_viewer_page_ok = (res_viewer_page.status_code == 200 and "Viewer" in html_viewer and "role-viewer" in html_viewer)
        tracker.log_result("Viewer role rendering on /analytics", is_viewer_page_ok, "Viewer badge 'role-viewer' rendered")

        # Viewer can query /api/energy/history and /api/energy/analytics
        res_viewer_api = client.get("/api/energy/analytics?building_id=1")
        is_viewer_api_ok = (res_viewer_api.status_code == 200 and res_viewer_api.get_json().get("status") == "success")
        tracker.log_result("Viewer role permission to query /api/energy/analytics", is_viewer_api_ok, "Viewer successfully retrieved analytics data")


# ==============================================================================
# 7. Dashboard DOM Structure, Date Filters, Charts & Empty States
# ==============================================================================
def test_dashboard_dom_filters_and_empty_states():
    print("\n" + "=" * 75)
    print(" 7. VERIFYING DASHBOARD CONTROLS, CHARTS & ZERO-BASELINE EMPTY STATES")
    print("=" * 75)

    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        res = client.get("/analytics")
        html = res.get_data(as_text=True)

        # Check Filter Elements
        filters = ["filterBuilding", "filterStart", "filterEnd", "btnAnalyze"]
        for f in filters:
            tracker.log_result(f"DOM Filter Control: {f}", f in html, f"Element '{f}' present in HTML")

        # Check Preset Buttons
        presets = ["1h", "today", "24h", "7d"]
        for p in presets:
            tracker.log_result(f"Preset Button: data-preset='{p}'", f'data-preset="{p}"' in html, f"Preset '{p}' present in HTML")

        # Check Single Building KPI and Parameter Anchors
        single_anchors = [
            "kpiEnergyKwh", "kpiPeakDemandKw", "kpiAvgDemandKw", "kpiAvgPfSingle",
            "kpiMinPfSingle", "kpiLoadFactorSingle", "kpiLoadFactorPctSingle",
            "paramMinP", "paramAvgS", "paramAvgQ", "paramAvgV",
            "paramMinV", "paramMaxV", "paramAvgI", "paramAvgF", "paramCount"
        ]
        all_single_anchors_present = all(anchor in html for anchor in single_anchors)
        tracker.log_result("All 16 Single-Building KPI & Operational Parameter Anchors in DOM", all_single_anchors_present, f"Verified all {len(single_anchors)} anchor IDs")

        # Check Single Building Canvas Elements
        single_canvases = ["chartActivePowerTime", "chartEnergyTime", "chartPfTime", "chartVoltageTime"]
        all_single_canvases_present = all(c in html for c in single_canvases)
        tracker.log_result("All 4 Single-Building Time-Series Chart Canvases in DOM", all_single_canvases_present, f"Verified: {single_canvases}")

        # Check Campus Comparison Anchors and Canvases
        comp_elements = ["compTotalEnergy", "compPeakPower", "compAvgPower", "compAvgPf", "compLoadFactor", "chartCompEnergy", "chartCompPeak", "chartCompPf", "comparisonTableBody"]
        all_comp_elements_present = all(e in html for e in comp_elements)
        tracker.log_result("All 9 Campus Comparison KPI Anchors, Canvases & Table in DOM", all_comp_elements_present, f"Verified: {comp_elements}")

        # Empty State Test: Single building with future date range returns clean zero baseline
        res_empty_single = client.get("/api/energy/analytics?building_id=1&start=2099-01-01T00:00&end=2099-01-02T00:00")
        data_es = res_empty_single.get_json()
        a_es = data_es.get("analytics", {})
        is_empty_single_safe = (
            res_empty_single.status_code == 200 and
            a_es.get("readings_count") == 0 and
            a_es.get("total_energy_kwh") == 0.0 and
            a_es.get("load_factor") == 0.0
        )
        tracker.log_result("Empty State: Single facility future date range returns clean zeroes", is_empty_single_safe, f"Readings: {a_es.get('readings_count')}, Energy: {a_es.get('total_energy_kwh')} kWh")

        # Empty State Test: Campus comparison with future date range returns clean zero baseline
        res_empty_comp = client.get("/api/energy/analytics?building_id=all&start=2099-01-01T00:00&end=2099-01-02T00:00")
        data_ec = res_empty_comp.get_json()
        campus_ec = data_ec.get("campus_summary", {})
        is_empty_comp_safe = (
            res_empty_comp.status_code == 200 and
            campus_ec.get("total_energy_kwh") == 0.0 and
            campus_ec.get("avg_active_power_kw") == 0.0 and
            campus_ec.get("load_factor") == 0.0
        )
        tracker.log_result("Empty State: Campus comparison future date range returns clean zeroes", is_empty_comp_safe, f"Total Energy: {campus_ec.get('total_energy_kwh')} kWh, Campus LF: {campus_ec.get('load_factor')}")


# ==============================================================================
# 8. SQLite Telemetry Integrity & No Random Client-Side Data
# ==============================================================================
def test_sqlite_telemetry_integrity():
    print("\n" + "=" * 75)
    print(" 8. VERIFYING SQLITE DATA SOURCE INTEGRITY & ZERO FRONTEND RANDOM DATA")
    print("=" * 75)

    # 8.1 Verify analytics.js contains NO Math.random() calls
    js_path = os.path.join(PROJECT_ROOT, "frontend", "static", "js", "analytics.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js_code = f.read()

    has_math_random = "Math.random" in js_code
    tracker.log_result("Frontend analytics.js contains NO Math.random() calls", not has_math_random, "Verified 0 instances of Math.random()")

    # 8.2 Verify analytics.js queries endpoints
    has_history_fetch = "/api/energy/history" in js_code
    has_analytics_fetch = "/api/energy/analytics" in js_code
    tracker.log_result("Frontend analytics.js fetches strictly from /api/energy/history & /api/energy/analytics", has_history_fetch and has_analytics_fetch, "Verified REST endpoints queried")

    # 8.3 Verify backend queries SQLite directly
    conn = database.get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM energy_readings")
    total_db_readings = cursor.fetchone()[0]
    conn.close()

    tracker.log_result("SQLite database energy_readings table active and queryable", total_db_readings > 0, f"Total telemetry rows in SQLite: {total_db_readings}")


# ==============================================================================
# Master Test Execution & Summary Report
# ==============================================================================
def run_all_thorough_tests():
    print("*" * 75)
    print(" RUHUNA SMART ENERGY SYSTEM - PHASE 5 THOROUGH VERIFICATION SUITE")
    print(" Faculty of Engineering, University of Ruhuna")
    print("*" * 75)

    test_energy_history_endpoint()
    test_analytics_isolated_temporary_db()
    test_energy_integration_irregular_and_gaps()
    test_electrical_parameters_and_load_factor()
    test_six_building_comparison_and_aggregation()
    test_auth_and_role_permissions()
    test_dashboard_dom_filters_and_empty_states()
    test_sqlite_telemetry_integrity()

    print("\n" + "=" * 75)
    print(" PHASE 5 VERIFICATION RESULTS SUMMARY")
    print("=" * 75)
    print(f" Total Executed Checks : {tracker.passed + tracker.failed}")
    print(f" Passed Checks         : {tracker.passed}")
    print(f" Failed Checks         : {tracker.failed}")
    print("=" * 75)

    if tracker.failed == 0:
        print(" >>> ALL VERIFICATION CHECKS PASSED PERFECTLY WITH ZERO DEFECTS! <<<")
    else:
        print(f" >>> ATTENTION: {tracker.failed} CHECK(S) FAILED. INSPECT ABOVE LOGS. <<<")

    return tracker.failed == 0


if __name__ == "__main__":
    success = run_all_thorough_tests()
    sys.exit(0 if success else 1)
