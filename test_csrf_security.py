"""
test_csrf_security.py
---------------------
Automated Security Test Suite for CSRF Defense & Secret Key Integrity.
Verifies:
1. Secret Key Security: Ensures app.secret_key is loaded from environment or persistent private .secret_key
   (not a hardcoded public string), and that .secret_key is ignored in .gitignore.
2. Origin Defense: Rejects cross-origin mutation requests from untrusted external origins (HTTP 403 Forbidden).
3. Tampered Token Defense: Rejects authenticated mutation requests containing invalid or forged CSRF tokens (HTTP 403 Forbidden).
4. Valid Token Acceptance: Allows authenticated requests with valid X-CSRF-Token header (HTTP 200 OK).
5. Form Token Acceptance: Allows authenticated form requests with valid csrf_token field (HTTP 200 OK).

Uses an ISOLATED TEMPORARY SQLite database to ensure the real energy.db is never modified.
"""

import os
import sys
import tempfile
import shutil
import sqlite3
import database
from app import app, get_or_create_secret_key


def run_tests():
    print("=" * 80)
    print(" RUNNING CSRF DEFENSE & SECRET KEY SECURITY AUTOMATED TESTS")
    print("=" * 80)

    # 1. Setup Isolated Temporary Database
    original_db_path = database.DB_PATH
    temp_dir = tempfile.mkdtemp()
    temp_db_path = os.path.join(temp_dir, "temp_csrf_security.db")

    try:
        database.DB_PATH = temp_db_path
        print(f" [Setup] Created isolated temporary test database at: {temp_db_path}")

        database.init_db()

        # Provision test Admin account
        database.create_user(
            email="sec_admin@eng.ruh.ac.lk",
            password="AdminPassword123!",
            full_name="Security Test Admin",
            role="Administrator"
        )

        with app.test_client() as client:
            # =================================================================
            # CHECK 1: Secret Key Verification & Git Exclusion
            # =================================================================
            print("\n [Check 1/5] Verifying persistent secret key and .gitignore protection...")
            key = get_or_create_secret_key()
            assert key and len(key) >= 32, f"Secret key must be at least 32 characters, got: {key}"
            assert key != "ruhuna-smart-energy-secret-key-3f8a9e2d1c", "Hardcoded fallback must not be used."

            # Verify .secret_key is in .gitignore
            gitignore_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".gitignore")
            assert os.path.exists(gitignore_path), ".gitignore file must exist."
            with open(gitignore_path, "r", encoding="utf-8") as f:
                content = f.read()
                assert ".secret_key" in content, ".secret_key must be listed in .gitignore."
                assert ".env" in content, ".env must be listed in .gitignore."

            print("     -> [PASSED] Secret key is high-entropy, persistent, and strictly excluded from git.")

            # =================================================================
            # CHECK 2: Login and Session CSRF Token Provisioning
            # =================================================================
            print("\n [Check 2/5] Verifying login and session CSRF token generation...")
            login_res = client.post("/login", json={
                "email": "sec_admin@eng.ruh.ac.lk",
                "password": "AdminPassword123!"
            })
            assert login_res.status_code == 200, "Login failed in test setup."

            with client.session_transaction() as sess:
                csrf_token = sess.get("csrf_token")
                assert csrf_token and len(csrf_token) >= 16, f"Expected valid csrf_token in session, got: {csrf_token}"

            print(f"     -> [PASSED] Authenticated session assigned unique CSRF token: {csrf_token[:8]}...")

            # =================================================================
            # CHECK 3: Cross-Origin Attack Defense (Untrusted Origin Rejection)
            # =================================================================
            print("\n [Check 3/5] Testing cross-origin attack defense (Origin: http://evil.attacker.com)...")
            res_evil = client.post(
                "/api/buildings/create",
                json={"code": "EVIL", "name": "Malicious Facility", "rated_power_kw": 50.0},
                headers={"Origin": "http://evil.attacker.com"}
            )
            assert res_evil.status_code == 403, (
                f"Expected HTTP 403 Forbidden for untrusted Origin, got {res_evil.status_code}: {res_evil.get_json()}"
            )
            data_evil = res_evil.get_json()
            assert data_evil["status"] == "error"
            assert "CSRF validation failed" in data_evil["message"]
            print("     -> [PASSED] Cross-origin mutation request blocked with HTTP 403 Forbidden.")

            # =================================================================
            # CHECK 4: Tampered / Invalid CSRF Token Rejection
            # =================================================================
            print("\n [Check 4/5] Testing forged or tampered CSRF token rejection...")
            res_tampered = client.post(
                "/api/buildings/create",
                json={"code": "FAKE", "name": "Fake Lab", "rated_power_kw": 50.0},
                headers={"X-CSRF-Token": "forged_invalid_csrf_token_9999"}
            )
            assert res_tampered.status_code == 403, (
                f"Expected HTTP 403 Forbidden for tampered token, got {res_tampered.status_code}: {res_tampered.get_json()}"
            )
            data_tampered = res_tampered.get_json()
            assert data_tampered["status"] == "error"
            assert "Invalid or tampered CSRF token" in data_tampered["message"]
            print("     -> [PASSED] Forged CSRF token strictly blocked with HTTP 403 Forbidden.")

            # =================================================================
            # CHECK 5: Valid CSRF Token Acceptance (Header & Form Body)
            # =================================================================
            print("\n [Check 5/5] Testing valid CSRF token acceptance (X-CSRF-Token header & form)...")

            # A. Valid X-CSRF-Token header
            res_valid_header = client.post(
                "/api/buildings/create",
                json={"code": "SEC1", "name": "Security Lab One", "rated_power_kw": 40.0},
                headers={
                    "Origin": "http://127.0.0.1:5000",
                    "X-CSRF-Token": csrf_token
                }
            )
            assert res_valid_header.status_code == 200, (
                f"Expected HTTP 200 OK for valid CSRF token, got {res_valid_header.status_code}: {res_valid_header.get_json()}"
            )
            bldg_id = res_valid_header.get_json()["id"]
            assert bldg_id > 0

            # B. Valid csrf_token in Form Post
            res_valid_form = client.post(
                f"/api/buildings/{bldg_id}/update",
                data={
                    "name": "Security Research Lab (Updated)",
                    "rated_power_kw": "45.0",
                    "csrf_token": csrf_token
                },
                headers={"Origin": "http://127.0.0.1:5000"}
            )
            assert res_valid_form.status_code == 200, (
                f"Expected HTTP 200 OK for valid form CSRF token, got {res_valid_form.status_code}: {res_valid_form.get_json()}"
            )

            print("     -> [PASSED] Valid CSRF token accepted in both X-CSRF-Token header and form body (HTTP 200).")

        print("\n" + "=" * 80)
        print(" ALL 5 CSRF & SECRET KEY SECURITY CHECKS PASSED WITH 100% SUCCESS")
        print("=" * 80)
        return 0

    finally:
        database.DB_PATH = original_db_path
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
            print(" [Cleanup] Removed isolated test directory.")


if __name__ == "__main__":
    code = run_tests()
    sys.exit(code)
