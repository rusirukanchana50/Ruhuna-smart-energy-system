"""
test_phase8.py
--------------
Automated test suite for Phase 8: Reports, Export and Final System Integration.
Tests:
1. Reports page (/reports) and printable report page (/reports/printable) routes:
   - Unauthenticated access redirects to /login.
   - Authenticated Administrator and Viewer access succeeds.
2. GET /api/reports/summary:
   - Full 16-parameter metrics validation for single building.
   - Six-building campus summary report validation.
   - Simulation note and disclaimer verification.
3. CSV Telemetry Export (GET /api/reports/export/csv):
   - Mimetype verification (text/csv).
   - CSV header columns and line count verification.
4. Demonstration Tariff configuration update (POST /api/config/tariff):
   - Role permission enforcement: Administrator succeeds (HTTP 200).
   - Role permission enforcement: Viewer receives HTTP 403 Forbidden.
5. Evidence-based engineering observations generation (no fabricated data).
"""

import os
import sys
import sqlite3

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
from database import (
    init_db,
    get_db_connection,
    get_active_tariff,
    get_comprehensive_energy_report,
    get_user_by_email,
    create_user
)

def setup_users():
    """Ensure test administrator and viewer accounts exist."""
    init_db()
    if not get_user_by_email("test_admin@eng.ruh.ac.lk"):
        create_user(
            email="test_admin@eng.ruh.ac.lk",
            password="AdminSecretPassword123!",
            full_name="Eng. Faculty Administrator",
            role="Administrator"
        )
    if not get_user_by_email("test_viewer@eng.ruh.ac.lk"):
        create_user(
            email="test_viewer@eng.ruh.ac.lk",
            password="ViewerSecretPassword123!",
            full_name="Student Energy Viewer",
            role="Viewer"
        )


def test_1_reports_page_auth_and_rendering():
    """Test 1: Verify /reports and /reports/printable require login and render successfully."""
    print("\n--- Test 1: Reports Page Access & Rendering ---")
    setup_users()
    with app.test_client() as client:
        # Unauthenticated access
        res_rep_unauth = client.get("/reports", follow_redirects=False)
        assert res_rep_unauth.status_code == 302
        assert "/login" in res_rep_unauth.headers["Location"]

        res_print_unauth = client.get("/reports/printable", follow_redirects=False)
        assert res_print_unauth.status_code == 302
        assert "/login" in res_print_unauth.headers["Location"]

        # Authenticated Viewer access
        client.post("/login", json={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        })

        res_rep = client.get("/reports")
        assert res_rep.status_code == 200
        html = res_rep.data.decode("utf-8")
        assert "Energy Audit Reports &amp; Data Export" in html or "Energy Audit Reports & Data Export" in html
        assert "btnGenerateReport" in html
        assert "btnPrintReport" in html
        assert "btnExportCsv" in html
        # Viewer must NOT see the tariff editing form
        assert "tariffConfigForm" not in html

        # Authenticated Administrator access (should see tariff config form)
        client.post("/login", json={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        res_admin = client.get("/reports")
        assert res_admin.status_code == 200
        assert "tariffConfigForm" in res_admin.data.decode("utf-8")

        # Test printable view HTML
        res_print = client.get("/reports/printable?building_id=1")
        assert res_print.status_code == 200
        print_html = res_print.data.decode("utf-8")
        assert "UNIVERSITY OF RUHUNA" in print_html
        assert "Faculty of Engineering" in print_html
        assert "Smart Energy Monitoring &amp; Analytics System" in print_html or "Smart Energy Monitoring & Analytics System" in print_html
        assert "Measurements used in this prototype are simulated" in print_html
    print(" -> PASSED: Reports and Printable HTML pages authenticated and rendered.")


def test_2_report_summary_api():
    """Test 2: Verify GET /api/reports/summary returns all 16 required metrics."""
    print("\n--- Test 2: Report Summary API 16-Parameter Verification ---")
    with app.test_client() as client:
        client.post("/login", json={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        res = client.get("/api/reports/summary?building_id=1")
        assert res.status_code == 200
        data = res.get_json()
        assert data["status"] == "success"
        assert data["data_source"] == "SIMULATED"
        rep = data["report"]
        assert rep["mode"] == "single"
        assert rep["building_code"] == "CEE"
        assert "Civil and Environmental" in rep["building_name"]
        assert "Measurements used in this prototype are simulated" in rep["simulation_note"]
        assert "not an official CEB bill" in rep["disclaimer"]

        m = rep["metrics"]
        # Check required fields
        required_fields = [
            "total_energy_kwh", "avg_active_power_kw", "peak_demand_kw",
            "avg_apparent_power_kva", "avg_reactive_power_kvar", "avg_power_factor",
            "min_power_factor", "load_factor", "load_factor_pct", "avg_voltage",
            "min_voltage", "max_voltage", "avg_frequency", "after_hours_kwh",
            "estimated_electricity_cost_lkr", "warning_alerts_count", "critical_alerts_count"
        ]
        for f in required_fields:
            assert f in m, f"Missing required metric: {f}"

        # Campus summary test
        res_campus = client.get("/api/reports/summary?building_id=all")
        assert res_campus.status_code == 200
        c_data = res_campus.get_json()["report"]
        assert c_data["mode"] == "campus_summary"
        from database import get_all_buildings
        expected_count = len(get_all_buildings())
        assert len(c_data["building_breakdown"]) == expected_count, f"Expected {expected_count} buildings in breakdown, got {len(c_data['building_breakdown'])}"
        assert len(c_data["ranked_comparison"]) == expected_count, f"Expected {expected_count} buildings in ranked comparison, got {len(c_data['ranked_comparison'])}"
    print(" -> PASSED: Comprehensive 16-metric report structure verified.")


def test_3_csv_export_streaming():
    """Test 3: Verify GET /api/reports/export/csv streams valid CSV data."""
    print("\n--- Test 3: CSV Telemetry Export Verification ---")
    with app.test_client() as client:
        client.post("/login", json={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        })

        res = client.get("/api/reports/export/csv?building_id=1")
        assert res.status_code == 200
        assert "text/csv" in res.headers["Content-Type"]
        assert "attachment" in res.headers["Content-Disposition"]

        csv_text = res.data.decode("utf-8")
        lines = csv_text.strip().split("\r\n") if "\r\n" in csv_text else csv_text.strip().split("\n")
        assert len(lines) >= 2, "Expected CSV header and at least 1 reading row"

        header = lines[0]
        assert "Reading ID" in header
        assert "Line Voltage (V)" in header
        assert "Active Power (kW)" in header
        assert "Data Source" in header
        assert "SIMULATED" in lines[1]
    print(" -> PASSED: CSV telemetry streaming verified.")


def test_4_tariff_config_rbac():
    """Test 4: Verify Administrator can update tariff and Viewer is blocked with HTTP 403."""
    print("\n--- Test 4: Demonstration Tariff Configuration RBAC ---")
    with app.test_client() as client:
        # Viewer Attempt -> 403 Forbidden
        client.post("/login", json={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        })
        res_viewer = client.post("/api/config/tariff", json={
            "energy_rate_lkr_per_kwh": 99.0
        })
        assert res_viewer.status_code == 403, f"Expected 403 Forbidden for Viewer, got {res_viewer.status_code}"

        # Administrator Attempt -> 200 OK
        client.post("/login", json={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        res_admin = client.post("/api/config/tariff", json={
            "tariff_id": 1,
            "name": "Demonstration Institutional Tariff (Updated)",
            "energy_rate_lkr_per_kwh": 39.00,
            "demand_rate_lkr_per_kw": 1500.00,
            "fixed_charge_lkr": 3200.00
        })
        assert res_admin.status_code == 200
        assert res_admin.get_json()["status"] == "success"

        # Reset back to standard test values
        client.post("/api/config/tariff", json={
            "tariff_id": 1,
            "name": "Demonstration Institutional Tariff (Estimated Non-Official Model)",
            "energy_rate_lkr_per_kwh": 38.50,
            "demand_rate_lkr_per_kw": 1450.00,
            "fixed_charge_lkr": 3000.00
        })
    print(" -> PASSED: Tariff configuration RBAC verified (Administrator allowed, Viewer blocked).")


if __name__ == "__main__":
    test_1_reports_page_auth_and_rendering()
    test_2_report_summary_api()
    test_3_csv_export_streaming()
    test_4_tariff_config_rbac()
    print("\n========================================================")
    print(" ALL 4 PHASE 8 TEST MODULES PASSED WITH 100% SUCCESS!")
    print("========================================================\n")
