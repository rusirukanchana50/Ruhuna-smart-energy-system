"""
test_building_lifecycle_simulation.py
--------------------------------------
Verification suite for Building Deletion, Re-creation, and Dynamic Simulator Telemetry.

Validates:
  Req 1: Isolated temporary SQLite database testing (energy.db preserved).
  Req 2: Simulator dynamically refreshes building list from SQLite on each cycle.
  Req 3: Newly created building receives simulated telemetry automatically.
  Req 4: Cumulative energy for new building initializes correctly.
  Req 5: Deleted building immediately stops receiving simulation data.
  Req 6: Deletion and re-creation of the same building code (e.g. LIB) with a NEW ID
         is handled safely, cleanly resets telemetry, and starts fresh telemetry.
  Req 7: Foreign keys are strictly maintained throughout.
  Req 8: Live endpoint reflects 'Awaiting simulator data' state until first reading,
         then provides real telemetry.
"""

import os
import shutil
import tempfile
import sqlite3

import database
from simulator import (
    run_simulation_cycle,
    calculate_electrical_parameters,
    calculate_cumulative_energy,
    BUILDING_PROFILES,
    DEFAULT_INTERVAL_SECONDS
)
from app import app


def run_tests():
    print("=" * 85)
    print(" UNIVERSITY OF RUHUNA - FACULTY OF ENGINEERING")
    print(" VERIFICATION SUITE: BUILDING LIFECYCLE & DYNAMIC SIMULATOR TELEMETRY")
    print("=" * 85)

    original_db_path = database.DB_PATH
    temp_dir = tempfile.mkdtemp(prefix="ruhuna_lifecycle_test_")
    temp_db_path = os.path.join(temp_dir, "temp_lifecycle_energy.db")

    try:
        print(f"\n[Setup] Isolated Test Environment:")
        print(f"        Temp DB Path : {temp_db_path}")
        print(f"        Original DB  : {original_db_path} (UNTOUCHED)")

        database.DB_PATH = temp_db_path
        app.config["TESTING"] = True

        # Initialize schema & seed core 6 buildings
        database.init_db()

        # Provision Admin account for deletion operations
        admin_email = "admin_lifecycle@eng.ruh.ac.lk"
        database.create_user(
            email=admin_email,
            password="AdminPassword123!",
            full_name="Lifecycle Admin",
            role="Administrator"
        )

        with app.test_client() as client:
            client.post("/login", data={"email": admin_email, "password": "AdminPassword123!"})

            # ------------------------------------------------------------------
            # TEST 1: Baseline Core Buildings
            # ------------------------------------------------------------------
            print("\n[Test 1] Verifying Core Buildings Baseline...")
            initial_buildings = database.get_all_buildings()
            assert len(initial_buildings) == 6, f"Expected 6 core buildings, got {len(initial_buildings)}"
            print(f"  -> Core buildings detected: {[b['code'] for b in initial_buildings]}")
            print("  -> PASSED: Initial building count is 6.")

            # ------------------------------------------------------------------
            # TEST 2: Add New Building (LIB - Library)
            # ------------------------------------------------------------------
            print("\n[Test 2] Adding New Building 'LIB' (Faculty Library)...")
            lib_id_1 = database.add_building(code="LIB", name="Faculty Library", rated_power_kw=55.0)
            assert lib_id_1 is not None and lib_id_1 > 0
            print(f"  -> Added 'LIB' with database ID: {lib_id_1}")

            # Verify live readings endpoint before simulator runs
            live_before = database.get_live_energy_readings()
            lib_live_before = next((b for b in live_before if b["building_id"] == lib_id_1), None)
            assert lib_live_before is not None, "LIB not found in live energy readings"
            assert lib_live_before["reading_id"] is None, "Expected reading_id to be None before simulator runs"
            print("  -> Verified: LIB card appears on dashboard with reading_id = None ('Awaiting simulator data...')")
            print("  -> PASSED: Newly created building starts in awaiting data state.")

            # ------------------------------------------------------------------
            # TEST 3: Dynamic Simulator Cycle Automatically Discovers 'LIB'
            # ------------------------------------------------------------------
            print("\n[Test 3] Running Simulation Cycle (Auto-Refreshing Building List)...")
            # Call without passing static buildings list to test dynamic refresh
            cycle_1_readings = run_simulation_cycle()
            assert len(cycle_1_readings) == 7, f"Expected 7 readings (6 core + 1 LIB), got {len(cycle_1_readings)}"

            lib_r1 = next((r for r in cycle_1_readings if r["building_id"] == lib_id_1), None)
            assert lib_r1 is not None, "Simulator did not generate reading for LIB"
            assert lib_r1["building_code"] == "LIB"
            assert lib_r1["is_simulated"] == 1
            assert 390.0 <= lib_r1["voltage"] <= 410.0
            assert 49.5 <= lib_r1["frequency"] <= 50.5
            assert lib_r1["power_factor"] >= 0.85
            assert lib_r1["active_power_kw"] > 0
            assert lib_r1["energy_kwh"] > 0
            print(f"  -> LIB Reading #1: P={lib_r1['active_power_kw']}kW | V={lib_r1['voltage']}V | "
                  f"Energy={lib_r1['energy_kwh']}kWh [SIMULATED]")

            # Verify cumulative energy initialization
            expected_base = BUILDING_PROFILES.get("LIB", {}).get("base_energy", 1000.0)
            assert lib_r1["energy_kwh"] >= expected_base, f"Energy should start from base ({expected_base})"
            print(f"  -> Verified: Cumulative energy initialized from base ({expected_base} kWh) + 15s delta.")

            # Verify live readings endpoint now contains the reading
            live_after_1 = database.get_live_energy_readings()
            lib_live_after_1 = next((b for b in live_after_1 if b["building_id"] == lib_id_1), None)
            assert lib_live_after_1["reading_id"] is not None
            assert lib_live_after_1["reading_id"] == lib_r1["reading_id"]
            print("  -> Verified: Live endpoint now provides active telemetry (Awaiting simulator data cleared).")
            print("  -> PASSED: Simulator dynamically detects and generates readings for new building.")

            # ------------------------------------------------------------------
            # TEST 4: Generate a Second Cycle to Confirm Continuity
            # ------------------------------------------------------------------
            print("\n[Test 4] Generating Second Simulation Cycle...")
            cycle_2_readings = run_simulation_cycle()
            lib_r2 = next((r for r in cycle_2_readings if r["building_id"] == lib_id_1), None)
            assert lib_r2 is not None
            assert lib_r2["energy_kwh"] >= lib_r1["energy_kwh"], "Energy must be monotonically non-decreasing"
            print(f"  -> LIB Reading #2: Energy={lib_r2['energy_kwh']}kWh (Accumulated from cycle #1)")
            print("  -> PASSED: Second cycle accumulated properly.")

            # ------------------------------------------------------------------
            # TEST 5: Safely Delete Building 'LIB' (ID 1)
            # ------------------------------------------------------------------
            print(f"\n[Test 5] Safely Deleting Building 'LIB' (ID {lib_id_1}) and its simulated data...")
            del_result = database.delete_building_and_simulated_data(
                building_id=lib_id_1,
                confirm_code="LIB",
                actor_email=admin_email
            )
            assert del_result is not None
            assert del_result["success"] is True
            assert del_result["deleted_readings_count"] == 2
            assert database.get_building_by_id(lib_id_1) is None
            print(f"  -> Successfully deleted LIB (ID {lib_id_1}) and {del_result['deleted_readings_count']} simulated readings.")

            # ------------------------------------------------------------------
            # TEST 6: Simulator Immediately Stops Generating Data for Deleted Building
            # ------------------------------------------------------------------
            print("\n[Test 6] Running Simulator Cycle After Deletion...")
            cycle_post_del = run_simulation_cycle()
            assert len(cycle_post_del) == 6, f"Expected 6 readings after deletion, got {len(cycle_post_del)}"
            assert not any(r["building_id"] == lib_id_1 for r in cycle_post_del), "Deleted building was simulated!"
            assert not any(r["building_code"] == "LIB" for r in cycle_post_del), "LIB code still present in cycle!"
            print("  -> Simulator automatically generated readings for ONLY the 6 remaining buildings.")
            print("  -> PASSED: Simulator immediately stopped generating data for deleted building.")

            # ------------------------------------------------------------------
            # TEST 7: Re-create Same Building Code ('LIB') with a New ID
            # ------------------------------------------------------------------
            print("\n[Test 7] Re-creating Building with Same Code 'LIB'...")
            lib_id_2 = database.add_building(code="LIB", name="Faculty Library Reborn", rated_power_kw=60.0)
            assert lib_id_2 is not None
            assert lib_id_2 != lib_id_1, f"New ID ({lib_id_2}) must differ from old ID ({lib_id_1})"
            print(f"  -> Recreated 'LIB' with NEW database ID: {lib_id_2} (Old ID: {lib_id_1})")

            # Check live endpoint before cycle
            live_recreate_before = database.get_live_energy_readings()
            lib_live_recreate_before = next((b for b in live_recreate_before if b["building_id"] == lib_id_2), None)
            assert lib_live_recreate_before is not None
            assert lib_live_recreate_before["reading_id"] is None
            print("  -> Verified: Re-created LIB initially has reading_id = None ('Awaiting simulator data...')")

            # ------------------------------------------------------------------
            # TEST 8: Run Simulator Cycle for Re-created Building (New ID)
            # ------------------------------------------------------------------
            print("\n[Test 8] Running Simulator Cycle for Re-created Building...")
            cycle_recreated = run_simulation_cycle()
            assert len(cycle_recreated) == 7, f"Expected 7 readings, got {len(cycle_recreated)}"

            lib_r_new = next((r for r in cycle_recreated if r["building_id"] == lib_id_2), None)
            assert lib_r_new is not None, "New LIB did not receive reading!"
            assert lib_r_new["building_id"] == lib_id_2
            assert lib_r_new["building_code"] == "LIB"
            assert lib_r_new["active_power_kw"] > 0
            # Cumulative energy should cleanly re-initialize
            assert lib_r_new["energy_kwh"] >= expected_base
            print(f"  -> Fresh LIB (ID {lib_id_2}) Reading: P={lib_r_new['active_power_kw']}kW | "
                  f"Energy={lib_r_new['energy_kwh']}kWh [SIMULATED]")

            # Verify live endpoint now displays the new telemetry
            live_recreate_after = database.get_live_energy_readings()
            lib_live_recreate_after = next((b for b in live_recreate_after if b["building_id"] == lib_id_2), None)
            assert lib_live_recreate_after is not None
            assert lib_live_recreate_after["reading_id"] == lib_r_new["reading_id"]
            assert lib_live_recreate_after["voltage"] == lib_r_new["voltage"]
            assert lib_live_recreate_after["active_power_kw"] == lib_r_new["active_power_kw"]
            print("  -> Verified: Live dashboard endpoint receives and serves fresh telemetry for new ID!")
            print("  -> PASSED: Complete deletion and re-creation lifecycle verified successfully.")

            # ------------------------------------------------------------------
            # TEST 9: Foreign Key Constraint and Orphan Defense
            # ------------------------------------------------------------------
            print("\n[Test 9] Verifying SQLite Foreign Key Constraint Enforcement...")
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("PRAGMA foreign_key_check;")
            violations = cursor.fetchall()
            assert len(violations) == 0, f"Foreign key check failed: {violations}"
            print("  -> PRAGMA foreign_key_check returned 0 violations.")
            conn.close()
            print("  -> PASSED: Database relational integrity strictly intact.")

        print("\n" + "=" * 85)
        print(" >>> ALL 9 LIFECYCLE & DYNAMIC TELEMETRY TESTS PASSED SUCCESSFULLY! <<<")
        print("=" * 85)

    finally:
        database.DB_PATH = original_db_path
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass


if __name__ == "__main__":
    run_tests()
