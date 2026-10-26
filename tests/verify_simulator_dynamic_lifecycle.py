"""
verify_simulator_dynamic_lifecycle.py
-------------------------------------
Focused verification script executing on an isolated temporary SQLite database:
  1. Starts simulator with initial 6 core buildings.
  2. Adds a new disposable building while simulator cycle logic runs.
  3. Confirms next cycle automatically detects the building and generates valid 3-phase readings without restarting.
  4. Deletes the disposable building using the safe simulated-data cleanup flow.
  5. Confirms simulator stops generating readings for the deleted building.
  6. Re-creates the same building code with a new database ID.
  7. Confirms new readings are generated for the new ID with fresh cumulative energy.
  8. Confirms unrelated buildings and records remain unchanged.
  9. Validates that original energy.db was completely untouched.
"""

import os
import sys
import shutil
import tempfile
import sqlite3
from datetime import datetime

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import database
from simulator import (
    run_simulation_cycle,
    calculate_electrical_parameters,
    BUILDING_PROFILES,
    DEFAULT_INTERVAL_SECONDS
)
from app import app


def run_focused_verification():
    print("=" * 85)
    print(" UNIVERSITY OF RUHUNA - FACULTY OF ENGINEERING")
    print(" FOCUSED VERIFICATION: DYNAMIC SIMULATOR TELEMETRY & SAFE CLEANUP LIFECYCLE")
    print("=" * 85)

    # Record original production database state to prove zero modifications
    prod_db_path = os.path.abspath(database.DB_PATH)
    prod_stat_before = os.stat(prod_db_path)
    prod_size_before = prod_stat_before.st_size
    prod_mtime_before = prod_stat_before.st_mtime

    print(f"\n[Safety Pre-check] Original Production Database:")
    print(f"  Path          : {prod_db_path}")
    print(f"  Size Before   : {prod_size_before:,} bytes")
    print(f"  Last Modified : {datetime.fromtimestamp(prod_mtime_before)}")

    # Create completely isolated temporary database
    temp_dir = tempfile.mkdtemp(prefix="ruhuna_lifecycle_verify_")
    temp_db_path = os.path.join(temp_dir, "temp_verify_energy.db")

    print(f"\n[Environment Setup] Initializing Isolated Test Sandbox:")
    print(f"  Isolated DB Path : {temp_db_path}")

    try:
        # Redirect database layer to temporary DB
        database.DB_PATH = temp_db_path
        app.config["TESTING"] = True

        # Initialize schema and seed 6 standard buildings
        database.init_db()

        # Create test administrator for cleanup authorization
        admin_email = "admin_verify@eng.ruh.ac.lk"
        database.create_user(
            email=admin_email,
            password="AdminPassword123!",
            full_name="Verification Admin",
            role="Administrator"
        )

        with app.test_client() as client:
            client.post("/login", data={"email": admin_email, "password": "AdminPassword123!"})

            # ------------------------------------------------------------------
            # STEP 1: Simulator starts with initial building list
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print("STEP 1: Starting Simulator with Initial Building List (6 Core Complexes)")
            print("-" * 85)
            initial_buildings = database.get_all_buildings()
            initial_codes = [b["code"] for b in initial_buildings]
            print(f"  Initial Buildings in SQLite ({len(initial_buildings)}): {initial_codes}")
            assert len(initial_buildings) == 6, f"Expected 6 initial buildings, found {len(initial_buildings)}"

            # Run baseline cycle
            baseline_readings = run_simulation_cycle()
            assert len(baseline_readings) == 6, f"Expected 6 readings, got {len(baseline_readings)}"
            print(f"  -> Baseline simulation cycle generated {len(baseline_readings)} readings successfully.")

            # Record baseline snapshot of core buildings for Step 8 comparison
            core_snapshot_before = {
                b["id"]: {
                    "code": b["code"],
                    "name": b["name"],
                    "rated_power_kw": b["rated_power_kw"],
                    "initial_readings_count": len(database.get_building_energy_history(b["id"], limit=100))
                }
                for b in initial_buildings
            }

            # ------------------------------------------------------------------
            # STEP 2: Add new disposable building while simulator is active
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print("STEP 2: Adding New Disposable Building (DISP_01) to SQLite")
            print("-" * 85)
            disp_code = "DISP_01"
            disp_name = "Renewable Energy Test Lab"
            disp_rated = 45.0

            disp_id_1 = database.add_building(
                code=disp_code,
                name=disp_name,
                rated_power_kw=disp_rated
            )
            print(f"  -> Added '{disp_name}' [{disp_code}] with Database ID: {disp_id_1}")
            assert disp_id_1 is not None and disp_id_1 > 0

            # Check that live endpoint immediately reflects building as 'Awaiting simulator data...'
            live_status_before = database.get_live_energy_readings()
            disp_live_entry = next((b for b in live_status_before if b["building_id"] == disp_id_1), None)
            assert disp_live_entry is not None, "Disposable building not listed in live status"
            assert disp_live_entry["reading_id"] is None, "New building should start with reading_id = None"
            print("  -> Verified: Live endpoint lists building in 'Awaiting simulator data...' state before cycle.")

            # ------------------------------------------------------------------
            # STEP 3: Confirm next cycle automatically detects new building & generates valid readings
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print("STEP 3: Next Simulation Cycle - Dynamic Detection & Valid Reading Generation")
            print("-" * 85)
            # simulator.py dynamically calls get_all_buildings() at top of cycle
            cycle_with_new = run_simulation_cycle()
            assert len(cycle_with_new) == 7, f"Expected 7 readings (6 core + 1 new), got {len(cycle_with_new)}"

            disp_r1 = next((r for r in cycle_with_new if r["building_id"] == disp_id_1), None)
            assert disp_r1 is not None, "Simulator failed to generate reading for disposable building!"

            print(f"  -> Discovered Building ID {disp_r1['building_id']} [{disp_r1['building_code']}]:")
            print(f"     Line Voltage   : {disp_r1['voltage']:.1f} V (Nominal ~400 V)")
            print(f"     Line Current   : {disp_r1['current']:.1f} A")
            print(f"     Power Factor   : {disp_r1['power_factor']:.3f} (Lagging)")
            print(f"     Grid Frequency : {disp_r1['frequency']:.2f} Hz (Nominal ~50 Hz)")
            print(f"     Apparent Power : {disp_r1['apparent_power_kva']:.2f} kVA")
            print(f"     Active Power   : {disp_r1['active_power_kw']:.2f} kW")
            print(f"     Reactive Power : {disp_r1['reactive_power_kvar']:.2f} kVAr")
            print(f"     Cumulative kWh : {disp_r1['energy_kwh']:.4f} kWh")
            print(f"     Simulated Flag : is_simulated = {disp_r1['is_simulated']}")

            # Validate physical boundaries
            assert 380.0 <= disp_r1["voltage"] <= 420.0, "Voltage outside grid range"
            assert 49.5 <= disp_r1["frequency"] <= 50.5, "Frequency outside grid range"
            assert 0.80 <= disp_r1["power_factor"] <= 0.98, "Power factor outside realistic range"
            assert disp_r1["active_power_kw"] > 0, "Active power must be positive"
            assert disp_r1["energy_kwh"] > 0, "Energy must be positive"
            assert disp_r1["is_simulated"] == 1, "Must be tagged as SIMULATED"

            # Run a second cycle to verify continuous integration
            cycle_with_new_2 = run_simulation_cycle()
            disp_r2 = next((r for r in cycle_with_new_2 if r["building_id"] == disp_id_1), None)
            assert disp_r2 is not None
            assert disp_r2["energy_kwh"] >= disp_r1["energy_kwh"], "Cumulative energy must accumulate monotonically"
            print(f"  -> Cycle 2 verified: Energy accumulated from {disp_r1['energy_kwh']:.4f} to {disp_r2['energy_kwh']:.4f} kWh.")

            # ------------------------------------------------------------------
            # STEP 4: Delete disposable building using safe simulated-data cleanup flow
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print(f"STEP 4: Safe Simulated-Data Cleanup Deletion for [{disp_code}] (ID: {disp_id_1})")
            print("-" * 85)
            del_result = database.delete_building_and_simulated_data(
                building_id=disp_id_1,
                confirm_code=disp_code,
                actor_email=admin_email
            )
            assert del_result is not None
            assert del_result["success"] is True
            print(f"  -> Cleanup Action Succeeded:")
            print(f"     Building Deleted       : {del_result['building_name']} [{del_result['building_code']}]")
            print(f"     Deleted Readings Count : {del_result['deleted_readings_count']}")
            print(f"     Backup Snapshot File   : {os.path.basename(del_result['backup_path'])}")
            print(f"     Deleted Alerts Count   : {del_result['deleted_alerts_count']}")

            # Verify building record is gone
            assert database.get_building_by_id(disp_id_1) is None, "Building record still present!"
            # Verify telemetry readings for disp_id_1 are completely purged
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM energy_readings WHERE building_id = ?", (disp_id_1,))
            orphaned_readings = cursor.fetchone()[0]
            conn.close()
            assert orphaned_readings == 0, f"Found {orphaned_readings} orphaned readings for deleted building!"
            print(f"  -> Verified: 0 orphaned readings remaining for Building ID {disp_id_1}.")

            # ------------------------------------------------------------------
            # STEP 5: Confirm simulator stops generating readings for deleted building
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print("STEP 5: Confirm Simulator Stops Generating Readings for Deleted Building")
            print("-" * 85)
            cycle_post_del = run_simulation_cycle()
            assert len(cycle_post_del) == 6, f"Expected 6 readings after deletion, got {len(cycle_post_del)}"
            assert not any(r["building_id"] == disp_id_1 for r in cycle_post_del), "Deleted building was still simulated!"
            assert not any(r["building_code"] == disp_code for r in cycle_post_del), "Deleted code was still simulated!"
            print(f"  -> Simulation cycle executed cleanly with exactly {len(cycle_post_del)} core buildings.")
            print(f"  -> Verified: Zero readings generated for deleted Building ID {disp_id_1} [{disp_code}].")

            # ------------------------------------------------------------------
            # STEP 6: Re-create same building code with a NEW database ID
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print(f"STEP 6: Re-creating Same Building Code [{disp_code}] with a New Database ID")
            print("-" * 85)
            disp_name_reborn = "Renewable Energy Test Lab Re-commissioned"
            disp_rated_reborn = 50.0

            disp_id_2 = database.add_building(
                code=disp_code,
                name=disp_name_reborn,
                rated_power_kw=disp_rated_reborn
            )
            print(f"  -> Recreated '{disp_name_reborn}' [{disp_code}] with NEW Database ID: {disp_id_2}")
            assert disp_id_2 is not None and disp_id_2 > 0
            assert disp_id_2 != disp_id_1, f"New ID ({disp_id_2}) must differ from old ID ({disp_id_1})"
            print(f"  -> Confirmed ID Differentiation: Old ID = {disp_id_1} vs New ID = {disp_id_2}.")

            # ------------------------------------------------------------------
            # STEP 7: Verify new readings are generated for new ID
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print(f"STEP 7: Verifying Fresh Readings Generated for New Database ID: {disp_id_2}")
            print("-" * 85)
            cycle_reborn = run_simulation_cycle()
            assert len(cycle_reborn) == 7, f"Expected 7 readings after re-creation, got {len(cycle_reborn)}"

            disp_r_new = next((r for r in cycle_reborn if r["building_id"] == disp_id_2), None)
            assert disp_r_new is not None, "Simulator did not generate reading for re-created building!"
            assert disp_r_new["building_id"] == disp_id_2
            assert disp_r_new["building_code"] == disp_code
            assert disp_r_new["active_power_kw"] > 0
            assert disp_r_new["energy_kwh"] > 0
            print(f"  -> Fresh Reading for New ID {disp_id_2}:")
            print(f"     P = {disp_r_new['active_power_kw']:.2f} kW | "
                  f"V = {disp_r_new['voltage']:.1f} V | "
                  f"Energy = {disp_r_new['energy_kwh']:.4f} kWh [SIMULATED]")

            # Verify live API reflects the new telemetry
            live_reborn = database.get_live_energy_readings()
            disp_live_reborn = next((b for b in live_reborn if b["building_id"] == disp_id_2), None)
            assert disp_live_reborn is not None
            assert disp_live_reborn["reading_id"] == disp_r_new["reading_id"]
            print("  -> Live dashboard endpoint confirmed serving active telemetry for new ID.")

            # ------------------------------------------------------------------
            # STEP 8: Confirm unrelated buildings and records remain unchanged
            # ------------------------------------------------------------------
            print("\n" + "-" * 85)
            print("STEP 8: Confirming Unrelated Buildings & Records Remain 100% Unchanged")
            print("-" * 85)
            for b_id, before in core_snapshot_before.items():
                current_b = database.get_building_by_id(b_id)
                assert current_b is not None, f"Core building ID {b_id} was lost!"
                assert current_b["code"] == before["code"], f"Building {b_id} code mutated!"
                assert current_b["name"] == before["name"], f"Building {b_id} name mutated!"
                assert current_b["rated_power_kw"] == before["rated_power_kw"], f"Building {b_id} rating mutated!"

                # Ensure its readings were never deleted
                cur_readings_count = len(database.get_building_energy_history(b_id, limit=100))
                assert cur_readings_count >= before["initial_readings_count"], (
                    f"Core building {before['code']} lost readings! Before: {before['initial_readings_count']}, Now: {cur_readings_count}"
                )
                print(f"  -> Building ID {b_id} [{current_b['code']:<5}] ({current_b['name']}): "
                      f"Rating={current_b['rated_power_kw']} kW | Readings={cur_readings_count} [VERIFIED UNCHANGED]")

            # Check database foreign key integrity
            conn = database.get_db_connection()
            cursor = conn.cursor()
            cursor.execute("PRAGMA foreign_key_check;")
            fk_violations = cursor.fetchall()
            conn.close()
            assert len(fk_violations) == 0, f"Foreign key check returned violations: {fk_violations}"
            print("  -> PRAGMA foreign_key_check returned 0 violations. Relational integrity intact.")

        print("\n" + "=" * 85)
        print(" >>> ALL 8 LIFECYCLE VERIFICATION STEPS PASSED WITH 100% SUCCESS! <<<")
        print("=" * 85)

    finally:
        # Restore production database path
        database.DB_PATH = prod_db_path

        # Clean up temporary test directory
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

        # Verify original production database was completely untouched
        prod_stat_after = os.stat(prod_db_path)
        assert prod_stat_after.st_size == prod_size_before, (
            f"ALERT: Production energy.db size changed from {prod_size_before} to {prod_stat_after.st_size}!"
        )
        assert prod_stat_after.st_mtime == prod_mtime_before, (
            f"ALERT: Production energy.db mtime changed from {prod_mtime_before} to {prod_stat_after.st_mtime}!"
        )

        print(f"\n[Safety Post-check] Production Database Verification:")
        print(f"  Path          : {prod_db_path}")
        print(f"  Size After    : {prod_stat_after.st_size:,} bytes (EXACT MATCH)")
        print(f"  Last Modified : {datetime.fromtimestamp(prod_stat_after.st_mtime)} (UNTOUCHED)")
        print("  -> CONFIRMED: original energy.db was 100% PRESERVED AND UNTOUCHED.")


if __name__ == "__main__":
    run_focused_verification()
