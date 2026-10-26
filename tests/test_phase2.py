"""
test_phase2.py
--------------
Automated test suite for Phase 2:
1. Provisions test Administrator and Viewer accounts.
2. Tests unauthorized access prevention (GET /dashboard, GET /api/buildings).
3. Tests invalid password handling.
4. Tests valid login & session creation.
5. Tests protected access when logged in.
6. Tests logout and subsequent unauthorized access blocking.
"""

import os
import sys
import json

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
from database import create_user, get_user_by_email, get_db_connection

def setup_test_users():
    """Ensure test admin and viewer accounts exist in energy.db."""
    # Create Admin user if not exists
    if not get_user_by_email("test_admin@eng.ruh.ac.lk"):
        create_user(
            email="test_admin@eng.ruh.ac.lk",
            password="AdminSecretPassword123!",
            full_name="Eng. Faculty Administrator",
            role="Administrator"
        )
    # Create Viewer user if not exists
    if not get_user_by_email("test_viewer@eng.ruh.ac.lk"):
        create_user(
            email="test_viewer@eng.ruh.ac.lk",
            password="ViewerSecretPassword123!",
            full_name="Student Energy Viewer",
            role="Viewer"
        )


def run_tests():
    print("=" * 65)
    print(" Running Phase 2 Automated Authentication & Security Tests")
    print("=" * 65)

    setup_test_users()

    with app.test_client() as client:
        # TEST 1: Unauthorized access to /dashboard (Should redirect to /login)
        print("\n[Test 1] Unauthorized access to GET /dashboard...")
        res = client.get("/dashboard", follow_redirects=False)
        assert res.status_code == 302, f"Expected 302 redirect, got {res.status_code}"
        assert "/login" in res.headers["Location"], f"Expected redirect to /login, got {res.headers['Location']}"
        print(" -> PASSED: Unauthenticated user redirected to /login.")

        # TEST 2: Unauthorized access to API endpoint /api/buildings (Should return 401)
        print("\n[Test 2] Unauthorized access to GET /api/buildings...")
        res = client.get("/api/buildings")
        assert res.status_code == 401, f"Expected 401 Unauthorized, got {res.status_code}"
        data = res.get_json()
        assert data.get("status") == "error", "Expected error status in JSON"
        print(f" -> PASSED: Protected API returned 401 Unauthorized: '{data.get('message')}'.")

        # TEST 3: Login with invalid password
        print("\n[Test 3] Login attempt with WRONG password...")
        res = client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "WrongPasswordXYZ"
        }, follow_redirects=True)
        assert res.status_code == 401, f"Expected 401, got {res.status_code}"
        assert b"Invalid email or password" in res.data, "Expected error flash message in HTML"
        print(" -> PASSED: Incorrect password was rejected with 401 and validation message.")

        # TEST 4: Valid Administrator Login
        print("\n[Test 4] Valid Administrator login...")
        res = client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        }, follow_redirects=False)
        assert res.status_code == 302, f"Expected 302 redirect after login, got {res.status_code}"
        assert "/dashboard" in res.headers["Location"], f"Expected redirect to /dashboard"
        print(" -> PASSED: Valid credentials authenticated and redirected to /dashboard.")

        # TEST 5: Access protected /dashboard with active session
        print("\n[Test 5] Access /dashboard with active session...")
        res = client.get("/dashboard")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        assert b"Eng. Faculty Administrator" in res.data, "User full name not found in dashboard"
        assert b"Administrator" in res.data, "User role badge not found in dashboard"
        assert b"Civil and Environmental Engineering" in res.data, "Buildings list not rendered"
        print(" -> PASSED: Dashboard loaded with user credentials and buildings overview.")

        # TEST 6: Access protected /api/buildings with active session
        print("\n[Test 6] Access GET /api/buildings with active session...")
        res = client.get("/api/buildings")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        api_data = res.get_json()
        from database import get_all_buildings
        expected_count = len(get_all_buildings())
        assert api_data.get("count") == expected_count, f"Expected {expected_count} buildings, got {api_data.get('count')}"
        assert api_data.get("count") >= 6, f"Expected at least 6 core buildings, got {api_data.get('count')}"
        assert len(api_data.get("data", [])) == expected_count
        print(f" -> PASSED: Authenticated API returned {api_data.get('count')} buildings.")

        # TEST 7: Logout
        print("\n[Test 7] Logout via POST /logout...")
        res = client.post("/logout", follow_redirects=False)
        assert res.status_code == 302, f"Expected 302 redirect on logout, got {res.status_code}"
        assert "/login" in res.headers["Location"], "Expected redirect to /login"
        print(" -> PASSED: Session cleared and redirected to /login.")

        # TEST 8: Verify access is blocked again after logout
        print("\n[Test 8] Access /dashboard immediately after logout...")
        res = client.get("/dashboard", follow_redirects=False)
        assert res.status_code == 302, f"Expected 302 redirect, got {res.status_code}"
        print(" -> PASSED: Access blocked after logout.")

    print("\n" + "=" * 65)
    print(" ALL 8 PHASE 2 TESTS PASSED SUCCESSFULLY! ")
    print("=" * 65)


if __name__ == "__main__":
    run_tests()
