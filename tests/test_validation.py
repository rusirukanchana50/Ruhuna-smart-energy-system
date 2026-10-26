"""
test_validation.py
------------------
Automated test suite for Task 3: Input Validation and Error Handling.
Verifies:
1. Building Creation Validation: Rejects empty, invalid, out-of-range, NaN, and Infinite inputs (HTTP 400).
2. Building Uniqueness & Normalization: Enforces uniqueness for building codes and names (HTTP 409 Conflict),
   and normalizes codes to uppercase.
3. Building Update Validation & Retention: Allows building to retain its own code/name during updates (HTTP 200),
   rejects non-existent IDs (HTTP 404), rejects collisions with other buildings (HTTP 409),
   and rejects invalid numeric ratings (HTTP 400).
4. Tariff Model Validation & Transaction Atomicity: Rejects negative, zero, NaN, and Infinite tariff values (HTTP 400),
   rejects non-existent tariff IDs (HTTP 404), verifies successful valid updates (HTTP 200),
   and ensures unsuccessful requests never partially change database records.

Uses an ISOLATED TEMPORARY SQLite database to ensure the real energy.db is never modified.
"""

import os
import sys
import tempfile
import shutil
import math
import sqlite3
import database
from app import app


def run_tests():
    print("=" * 80)
    print(" RUNNING TASK 3: INPUT VALIDATION & ERROR HANDLING AUTOMATED TESTS")
    print("=" * 80)

    # 1. Setup Isolated Temporary Database
    original_db_path = database.DB_PATH
    temp_dir = tempfile.mkdtemp()
    temp_db_path = os.path.join(temp_dir, "temp_val_energy.db")

    try:
        # Redirect database module to isolated temp DB
        database.DB_PATH = temp_db_path
        print(f" [Setup] Created isolated temporary test database at: {temp_db_path}")

        # Initialize schema & seed initial 6 buildings
        database.init_db()

        # Provision test Admin and Viewer accounts in isolated DB
        database.create_user(
            email="val_admin@eng.ruh.ac.lk",
            password="AdminPassword123!",
            full_name="Validation Test Admin",
            role="Administrator"
        )
        database.create_user(
            email="val_viewer@eng.ruh.ac.lk",
            password="ViewerPassword123!",
            full_name="Validation Test Viewer",
            role="Viewer"
        )

        with app.test_client() as client:
            # Login as Administrator
            login_res = client.post("/login", json={
                "email": "val_admin@eng.ruh.ac.lk",
                "password": "AdminPassword123!"
            })
            assert login_res.status_code == 200, "Admin login failed in test setup."

            # =================================================================
            # CHECK 1: Building Creation Input Validation (HTTP 400)
            # =================================================================
            print("\n [Check 1/4] Testing building creation input validation & boundary checks...")

            invalid_creation_payloads = [
                # Missing or empty code
                ({"name": "Test Lab", "rated_power_kw": 50.0}, "missing code"),
                ({"code": "", "name": "Test Lab", "rated_power_kw": 50.0}, "empty code"),
                ({"code": "   ", "name": "Test Lab", "rated_power_kw": 50.0}, "whitespace code"),
                # Code length limits (< 2 or > 10)
                ({"code": "A", "name": "Test Lab", "rated_power_kw": 50.0}, "code too short (<2 chars)"),
                ({"code": "TOOLONGBUILDINGCODE", "name": "Test Lab", "rated_power_kw": 50.0}, "code too long (>10 chars)"),
                # Invalid code characters
                ({"code": "BAD CODE!", "name": "Test Lab", "rated_power_kw": 50.0}, "code with spaces and exclamation"),
                ({"code": "CE@#", "name": "Test Lab", "rated_power_kw": 50.0}, "code with special symbols"),
                # Missing or empty name
                ({"code": "LAB1", "rated_power_kw": 50.0}, "missing name"),
                ({"code": "LAB1", "name": "", "rated_power_kw": 50.0}, "empty name"),
                ({"code": "LAB1", "name": "X", "rated_power_kw": 50.0}, "name too short (<2 chars)"),
                # Missing or invalid rated power
                ({"code": "LAB1", "name": "Renewable Energy Lab"}, "missing rated_power_kw"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": "not-a-number"}, "non-numeric rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": -25.0}, "negative rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": 0.0}, "zero rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": "NaN"}, "string NaN rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": float("nan")}, "float nan rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": "inf"}, "string inf rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": float("inf")}, "float inf rated_power"),
                ({"code": "LAB1", "name": "Renewable Energy Lab", "rated_power_kw": 999999.0}, "exceeds max rated_power limit"),
            ]

            for payload, desc in invalid_creation_payloads:
                res = client.post("/api/buildings/create", json=payload)
                assert res.status_code == 400, (
                    f"Expected HTTP 400 Bad Request for {desc}, got {res.status_code}: {res.get_json()}"
                )
                data = res.get_json()
                assert data["status"] == "error", f"Expected error status for {desc}"
                assert len(data.get("message", "")) > 5, f"Expected informative message for {desc}"

            print("     -> [PASSED] All 19 invalid building creation payloads correctly rejected with HTTP 400.")

            # =================================================================
            # CHECK 2: Building Uniqueness & Code Normalization (HTTP 409)
            # =================================================================
            print("\n [Check 2/4] Testing building code/name uniqueness enforcement & normalization...")

            # Duplicate code (CEE already exists)
            res_dup_code = client.post("/api/buildings/create", json={
                "code": "CEE",
                "name": "Different Name Lab",
                "rated_power_kw": 60.0
            })
            assert res_dup_code.status_code == 409, f"Expected 409 Conflict for duplicate code, got {res_dup_code.status_code}"
            assert "already exists" in res_dup_code.get_json()["message"]

            # Case-insensitive duplicate code ("cee")
            res_case_code = client.post("/api/buildings/create", json={
                "code": "cee",
                "name": "Different Name Lab 2",
                "rated_power_kw": 60.0
            })
            assert res_case_code.status_code == 409, f"Expected 409 Conflict for lowercase duplicate code, got {res_case_code.status_code}"

            # Duplicate name (Auditorium already exists)
            res_dup_name = client.post("/api/buildings/create", json={
                "code": "AUD2",
                "name": "Auditorium",
                "rated_power_kw": 50.0
            })
            assert res_dup_name.status_code == 409, f"Expected 409 Conflict for duplicate name, got {res_dup_name.status_code}"

            # Valid Creation with normalization (mixed case and padding)
            res_valid = client.post("/api/buildings/create", json={
                "code": "  solar_1  ",
                "name": "  Solar Research Facility  ",
                "rated_power_kw": 45.5
            })
            assert res_valid.status_code == 200, f"Expected 200 for valid building creation, got {res_valid.status_code}"
            new_bldg_id = res_valid.get_json()["id"]

            # Verify normalized values in DB
            bldg_record = database.get_building_by_id(new_bldg_id)
            assert bldg_record["code"] == "SOLAR_1", f"Expected code normalized to 'SOLAR_1', got '{bldg_record['code']}'"
            assert bldg_record["name"] == "Solar Research Facility", f"Expected trimmed name, got '{bldg_record['name']}'"
            assert bldg_record["rated_power_kw"] == 45.5

            print("     -> [PASSED] Duplicate code & name rejected with HTTP 409; valid building normalized & saved.")

            # =================================================================
            # CHECK 3: Building Update Validation, Uniqueness & Self-Retention
            # =================================================================
            print("\n [Check 3/4] Testing building update validation, self-retention & 404/409 handling...")

            # Non-existent building ID
            res_not_found = client.post("/api/buildings/999999/update", json={
                "name": "Ghost Facility",
                "rated_power_kw": 50.0
            })
            assert res_not_found.status_code == 404, f"Expected 404 for missing building, got {res_not_found.status_code}"

            # Invalid update parameters (empty name, negative power, NaN)
            res_bad_update = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "name": "",
                "rated_power_kw": 50.0
            })
            assert res_bad_update.status_code == 400

            res_nan_update = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "name": "Solar Research Facility",
                "rated_power_kw": "NaN"
            })
            assert res_nan_update.status_code == 400

            res_neg_update = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "name": "Solar Research Facility",
                "rated_power_kw": -10.0
            })
            assert res_neg_update.status_code == 400

            # Conflict with another building's code
            res_code_conflict = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "code": "CEE",
                "name": "Solar Research Facility",
                "rated_power_kw": 45.5
            })
            assert res_code_conflict.status_code == 409, f"Expected 409 for code collision, got {res_code_conflict.status_code}"

            # Conflict with another building's name
            res_name_conflict = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "name": "Civil and Environmental Engineering",
                "rated_power_kw": 45.5
            })
            assert res_name_conflict.status_code == 409, f"Expected 409 for name collision, got {res_name_conflict.status_code}"

            # Self-Retention: Updating power and name while keeping same code/name must NOT conflict
            res_self_retain = client.post(f"/api/buildings/{new_bldg_id}/update", json={
                "code": "SOLAR_1",
                "name": "Solar Research Center & Innovation Lab",
                "rated_power_kw": 55.0
            })
            assert res_self_retain.status_code == 200, f"Expected 200 for self-retaining update, got {res_self_retain.status_code}"

            updated_record = database.get_building_by_id(new_bldg_id)
            assert updated_record["name"] == "Solar Research Center & Innovation Lab"
            assert updated_record["rated_power_kw"] == 55.0
            assert updated_record["code"] == "SOLAR_1"

            print("     -> [PASSED] 404, 400, and 409 update errors verified; self-retention successfully allowed.")

            # =================================================================
            # CHECK 4: Tariff Model Validation & Transaction Atomicity
            # =================================================================
            print("\n [Check 4/4] Testing tariff input validation & atomic transaction safety...")

            # Capture initial baseline tariff rates
            baseline_tariff = database.get_active_tariff()

            # Non-existent tariff ID -> 404
            res_bad_tariff_id = client.post("/api/config/tariff", json={
                "tariff_id": 999999,
                "energy_rate_lkr_per_kwh": 40.0
            })
            assert res_bad_tariff_id.status_code == 404, f"Expected 404 for bad tariff ID, got {res_bad_tariff_id.status_code}"

            # Invalid tariff inputs (negative rates, NaN, Inf, empty name)
            invalid_tariff_payloads = [
                ({"name": "", "energy_rate_lkr_per_kwh": 40.0}, "empty tariff name"),
                ({"energy_rate_lkr_per_kwh": -10.0}, "negative energy rate"),
                ({"energy_rate_lkr_per_kwh": 0.0}, "zero energy rate"),
                ({"energy_rate_lkr_per_kwh": "NaN"}, "string NaN energy rate"),
                ({"energy_rate_lkr_per_kwh": float("nan")}, "float nan energy rate"),
                ({"energy_rate_lkr_per_kwh": "inf"}, "string inf energy rate"),
                ({"energy_rate_lkr_per_kwh": 9999.0}, "excessive energy rate (>1000)"),
                ({"demand_rate_lkr_per_kw": -100.0}, "negative demand rate"),
                ({"demand_rate_lkr_per_kw": "NaN"}, "NaN demand rate"),
                ({"fixed_charge_lkr": -50.0}, "negative fixed charge"),
                ({"fixed_charge_lkr": float("inf")}, "infinite fixed charge"),
            ]

            for payload, desc in invalid_tariff_payloads:
                payload["tariff_id"] = 1
                res = client.post("/api/config/tariff", json=payload)
                assert res.status_code == 400, (
                    f"Expected 400 Bad Request for {desc}, got {res.status_code}: {res.get_json()}"
                )

            # Verify baseline was not partially changed or corrupted
            current_tariff = database.get_active_tariff()
            assert current_tariff["energy_rate_lkr_per_kwh"] == baseline_tariff["energy_rate_lkr_per_kwh"], "Tariff was partially altered on failed validation!"
            assert current_tariff["demand_rate_lkr_per_kw"] == baseline_tariff["demand_rate_lkr_per_kw"]
            assert current_tariff["fixed_charge_lkr"] == baseline_tariff["fixed_charge_lkr"]

            # Valid tariff update -> 200 OK
            res_valid_tariff = client.post("/api/config/tariff", json={
                "tariff_id": 1,
                "name": "Demonstration Institutional Tariff (Ground Truth Validated)",
                "energy_rate_lkr_per_kwh": 42.00,
                "demand_rate_lkr_per_kw": 1600.00,
                "fixed_charge_lkr": 3500.00
            })
            assert res_valid_tariff.status_code == 200, f"Expected 200 for valid tariff update, got {res_valid_tariff.status_code}"
            updated_rates = res_valid_tariff.get_json()["updated_rates"]
            assert updated_rates["energy_rate_lkr_per_kwh"] == 42.00
            assert updated_rates["demand_rate_lkr_per_kw"] == 1600.00
            assert updated_rates["fixed_charge_lkr"] == 3500.00

            # Verify persisted in isolated DB
            persisted_tariff = database.get_active_tariff()
            assert persisted_tariff["energy_rate_lkr_per_kwh"] == 42.00
            assert persisted_tariff["name"] == "Demonstration Institutional Tariff (Ground Truth Validated)"

            print("     -> [PASSED] Tariff validation strictly rejected 11 edge cases; valid update executed atomically.")

        print("\n" + "=" * 80)
        print(" ALL 4 TASK 3 VALIDATION & ERROR HANDLING CHECKS PASSED SUCCESSFULLY (100%)")
        print("=" * 80)
        return 0

    finally:
        # Restore original database path and cleanup isolated temp directory
        database.DB_PATH = original_db_path
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            print(" [Cleanup] Removed isolated test directory.")


if __name__ == "__main__":
    code = run_tests()
    sys.exit(code)
