"""
test_building_deletion.py
-------------------------
Automated test suite for Task 2: Database Foreign Key Safety & Safe Deletion Handling.
Verifies:
1. SQLite foreign key enforcement is active (PRAGMA foreign_keys = ON) on all connections.
2. Blocked deletion: Attempting to delete a building with dependent records (energy_readings, alerts)
   is prevented, safeguarding historical telemetry and returning HTTP 409 Conflict.
3. Successful deletion: Deletion of a newly created test building with zero dependent records succeeds (HTTP 200).
4. Unauthorized deletion protection (RBAC):
   - Unauthenticated requests are blocked (HTTP 401).
   - Viewer role requests are rejected with HTTP 403 Forbidden.
   - Only Administrator can execute deletion.

Uses an ISOLATED TEMPORARY SQLite database to ensure the real energy.db is never modified or compromised.
"""

import os
import sys
import tempfile
import shutil
import sqlite3

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import database
from app import app


def run_tests():
    print("=" * 75)
    print(" RUNNING TASK 2: DATABASE FOREIGN KEY SAFETY & SAFE DELETION TESTS")
    print("=" * 75)

    # 1. Setup Isolated Temporary Database
    original_db_path = database.DB_PATH
    temp_dir = tempfile.mkdtemp()
    temp_db_path = os.path.join(temp_dir, "temp_safety_energy.db")

    try:
        # Redirect database module to isolated temp DB
        database.DB_PATH = temp_db_path
        print(f" [Setup] Created isolated temporary test database at: {temp_db_path}")

        # Initialize schema & seed initial 6 buildings
        database.init_db()

        # Provision test Admin and Viewer accounts in isolated DB
        database.create_user(
            email="del_admin@eng.ruh.ac.lk",
            password="AdminPassword123!",
            full_name="Deletion Test Admin",
            role="Administrator"
        )
        database.create_user(
            email="del_viewer@eng.ruh.ac.lk",
            password="ViewerPassword123!",
            full_name="Deletion Test Viewer",
            role="Viewer"
        )

        with app.test_client() as client:

            # ------------------------------------------------------------------
            # TEST 1: Verify PRAGMA foreign_keys = ON on application connections
            # ------------------------------------------------------------------
            print("\n[Test 1] Verifying SQLite Foreign Key Enforcement (PRAGMA foreign_keys = ON)...")
            conn = database.get_db_connection()
            fk_status = conn.execute("PRAGMA foreign_keys;").fetchone()[0]
            conn.close()
            assert fk_status == 1, f"Expected PRAGMA foreign_keys = 1 (ON), got {fk_status}"
            print("  -> PASSED: Foreign key constraints are actively enforced on all connections.")

            # ------------------------------------------------------------------
            # TEST 2: Blocked Deletion When Dependent Records Exist (Safeguard)
            # ------------------------------------------------------------------
            print("\n[Test 2] Verifying Blocked Deletion for Building with Dependent Telemetry...")
            # Insert a reading and an alert for Building 1 (CEE)
            database.insert_energy_reading(
                building_id=1,
                timestamp="2026-10-23 10:00:00",
                voltage=400.0,
                current=50.0,
                power_factor=0.90,
                frequency=50.0,
                apparent_power_kva=34.64,
                active_power_kw=31.18,
                reactive_power_kvar=15.10,
                energy_kwh=100.0,
                is_simulated=1
            )
            database.trigger_alert(
                building_id=1,
                alert_type="LOW_POWER_FACTOR",
                severity="WARNING",
                measured_value=0.81,
                threshold_value=0.85,
                message="Test low PF alert"
            )

            # Check dependency counts via helper
            deps = database.get_building_dependencies(1)
            assert deps["readings_count"] >= 1, "Expected at least 1 reading for building 1"
            assert deps["alerts_count"] >= 1, "Expected at least 1 alert for building 1"

            # Authenticate as Administrator
            client.post("/login", data={
                "email": "del_admin@eng.ruh.ac.lk",
                "password": "AdminPassword123!"
            })

            # Attempt to delete Building 1 (CEE)
            res = client.post("/api/buildings/1/delete")
            assert res.status_code == 409, f"Expected 409 Conflict, got {res.status_code}"
            data = res.get_json()
            assert data["status"] == "error"
            assert "historical" in data["message"].lower() or "preserved" in data["message"].lower()
            print(f"  -> Returned HTTP 409 with safeguard message: '{data['message']}'")

            # Verify building still exists in database
            bldg_check = database.get_building_by_id(1)
            assert bldg_check is not None, "Building 1 was erroneously deleted!"
            assert bldg_check["code"] == "CEE"
            print("  -> PASSED: Deletion blocked; historical energy readings and alerts safely preserved.")

            # ------------------------------------------------------------------
            # TEST 3: Successful Deletion for Newly Created Building (No Dependencies)
            # ------------------------------------------------------------------
            print("\n[Test 3] Verifying Successful Deletion of Test Building with Zero Dependencies...")
            # Create a new test building without any readings or alerts
            new_id = database.add_building(
                code="TEMP_TEST",
                name="Temporary Test Facility",
                rated_power_kw=35.0
            )
            assert new_id is not None and new_id > 0

            # Verify it has 0 dependencies
            temp_deps = database.get_building_dependencies(new_id)
            assert temp_deps["total_dependencies"] == 0

            # Delete the temporary building as Administrator
            del_res = client.post(f"/api/buildings/{new_id}/delete")
            assert del_res.status_code == 200, f"Expected 200 OK, got {del_res.status_code}"
            del_data = del_res.get_json()
            assert del_data["status"] == "success"
            print(f"  -> Returned HTTP 200: '{del_data.get('message')}'")

            # Verify building row is now gone
            assert database.get_building_by_id(new_id) is None, f"Building #{new_id} should have been deleted"
            print("  -> PASSED: Test building with zero dependencies deleted cleanly.")

            # ------------------------------------------------------------------
            # TEST 4: Unauthorized Deletion Protection (RBAC)
            # ------------------------------------------------------------------
            print("\n[Test 4] Verifying Role-Based Access Control on Building Deletion...")
            # 4.1 Unauthenticated request -> 401 Unauthorized
            client.post("/logout")
            unauth_res = client.post("/api/buildings/1/delete")
            assert unauth_res.status_code == 401, f"Expected 401 Unauthorized, got {unauth_res.status_code}"
            print("  -> Unauthenticated deletion request blocked with 401.")

            # 4.2 Authenticated as Viewer -> 403 Forbidden
            client.post("/login", data={
                "email": "del_viewer@eng.ruh.ac.lk",
                "password": "ViewerPassword123!"
            })
            viewer_res = client.post("/api/buildings/1/delete")
            assert viewer_res.status_code == 403, f"Expected 403 Forbidden, got {viewer_res.status_code}"
            viewer_data = viewer_res.get_json()
            assert viewer_data["status"] == "error"
            print(f"  -> Viewer deletion request rejected with 403: '{viewer_data['message']}'")
            print("  -> PASSED: Role-Based Access Control verified (Administrator-only permission).")

        print("\n" + "=" * 75)
        print(" ALL 4 TASK 2 DATABASE SAFETY & DELETION CHECKS PASSED WITH 100% SUCCESS!")
        print("=" * 75)

    finally:
        # Restore original database path and cleanup temporary directory
        database.DB_PATH = original_db_path
        shutil.rmtree(temp_dir, ignore_errors=True)
        print(" [Cleanup] Restored production database path & removed temporary test DB.\n")


if __name__ == "__main__":
    run_tests()
