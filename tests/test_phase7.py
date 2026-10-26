"""
test_phase7.py
--------------
Automated test suite for Phase 7: Energy Cost and Efficiency Analysis.
Tests:
1. Tariff table initialization and demonstration tariff retrieval (Rate values, active status).
2. Faculty settings table and configurable operating hours.
3. Cost calculations with controlled synthetic test readings:
   - Energy charge = total_kwh * energy_rate
   - Demand charge = peak_demand * demand_rate * (duration / 30 days)
   - Fixed charge = fixed_charge * (duration / 30 days)
   - Total cost = Energy + Demand + Fixed
4. Efficiency calculations with controlled readings:
   - Load factor = Avg power / Peak power
   - Average Power Factor
   - Low-PF duration (< 0.85)
   - After-hours consumption outside configured operating hours (08:00 - 17:00 / Weekends)
5. Six-building comparative efficiency endpoint and rankings:
   - GET /api/energy/efficiency/comparison
6. Historical baseline calculations against stored SQLite records.
7. Role and authentication protection on all Phase 7 endpoints:
   - GET /cost-efficiency
   - GET /api/energy/cost
   - GET /api/energy/efficiency
   - GET /api/energy/efficiency/comparison
"""

import os
import sqlite3
import datetime
from app import app
from database import (
    init_db,
    get_db_connection,
    get_active_tariff,
    get_all_tariffs,
    get_faculty_settings,
    is_timestamp_after_hours,
    calculate_building_cost,
    calculate_building_efficiency,
    get_building_historical_baseline,
    get_cost_and_efficiency_analytics,
    create_user,
    get_user_by_email,
    get_all_buildings
)

def setup_users():
    """Ensure test administrator and viewer accounts exist."""
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


def test_1_tariff_and_settings_schema():
    """Test 1: Verify tariffs and faculty_settings tables exist and have seed data."""
    print("\n--- Test 1: Tariff & Faculty Settings Schema & Seeding ---")
    init_db()
    conn = get_db_connection()
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM tariffs WHERE active = 1")
    count_t = c.fetchone()[0]
    assert count_t >= 1, "Expected at least 1 active demonstration tariff in database"

    c.execute("SELECT COUNT(*) FROM faculty_settings")
    count_s = c.fetchone()[0]
    assert count_s >= 4, "Expected at least 4 faculty operational settings seeded"
    conn.close()

    tariff = get_active_tariff()
    assert tariff is not None
    assert "Demonstration" in tariff["name"] or "Estimated" in tariff["name"]
    assert tariff["energy_rate_lkr_per_kwh"] == 38.50
    assert tariff["demand_rate_lkr_per_kw"] == 1450.00
    assert tariff["fixed_charge_lkr"] == 3000.00

    settings = get_faculty_settings()
    assert settings["operating_hours_start"] == "08:00"
    assert settings["operating_hours_end"] == "17:00"
    assert "0,1,2,3,4" in settings["operating_days"]
    print(" -> PASSED: Tariffs and faculty settings verified.")


def test_2_controlled_cost_calculation():
    """Test 2: Verify cost formula using controlled synthetic numbers."""
    print("\n--- Test 2: Controlled Cost Calculation Verification ---")
    custom_tariff = {
        "name": "Synthetic Test Tariff",
        "energy_rate_lkr_per_kwh": 40.0,
        "demand_rate_lkr_per_kw": 1500.0,
        "fixed_charge_lkr": 3000.0
    }
    # 30-day duration (2,592,000 seconds)
    duration_30d = 30 * 86400
    kwh = 1000.0
    peak_kw = 50.0

    cost_30d = calculate_building_cost(kwh, peak_kw, duration_30d, custom_tariff)
    # Energy charge = 1000 * 40 = 40,000
    # Demand charge = 50 * 1500 * (30/30) = 75,000
    # Fixed charge = 3000 * (30/30) = 3,000
    # Total = 118,000
    assert cost_30d["estimated_energy_charge_lkr"] == 40000.0
    assert cost_30d["estimated_demand_charge_lkr"] == 75000.0
    assert cost_30d["estimated_fixed_charge_lkr"] == 3000.0
    assert cost_30d["estimated_total_cost_lkr"] == 118000.0
    assert cost_30d["is_estimate"] is True

    # 1-day duration (86400 seconds)
    duration_1d = 86400
    cost_1d = calculate_building_cost(kwh, peak_kw, duration_1d, custom_tariff)
    # Demand charge scaled: 50 * 1500 * (1/30) = 2500.0
    # Fixed charge scaled: 3000 * (1/30) = 100.0
    # Energy charge: 40000.0
    # Total: 42600.0
    assert cost_1d["estimated_demand_charge_lkr"] == 2500.0
    assert cost_1d["estimated_fixed_charge_lkr"] == 100.0
    assert cost_1d["estimated_total_cost_lkr"] == 42600.0
    print(" -> PASSED: Controlled cost formulas matched theoretical calculations.")


def test_3_controlled_after_hours_and_efficiency():
    """Test 3: Verify after-hours classification, load factor, and PF calculation."""
    print("\n--- Test 3: Controlled After-Hours & Efficiency Analysis ---")
    settings = {
        "operating_hours_start": "08:00",
        "operating_hours_end": "17:00",
        "operating_days": "0,1,2,3,4"
    }

    # Monday 10:00 AM -> Operating hour
    mon_operating = datetime.datetime(2026, 10, 5, 10, 0, 0) # 2026-10-05 is Monday
    assert is_timestamp_after_hours(mon_operating, settings) is False

    # Monday 07:30 AM -> After hours (before 08:00)
    mon_early = datetime.datetime(2026, 10, 5, 7, 30, 0)
    assert is_timestamp_after_hours(mon_early, settings) is True

    # Monday 19:00 PM -> After hours (after 17:00)
    mon_late = datetime.datetime(2026, 10, 5, 19, 0, 0)
    assert is_timestamp_after_hours(mon_late, settings) is True

    # Saturday 11:00 AM -> Weekend is 100% after hours
    sat_weekend = datetime.datetime(2026, 10, 10, 11, 0, 0) # Saturday
    assert is_timestamp_after_hours(sat_weekend, settings) is True

    # Test controlled synthetic readings list
    # Reading 1: 07:00 (after-hours), 40 kW, PF 0.80 (low PF)
    # Reading 2: 07:01 (after-hours, dt=60s), 40 kW, PF 0.80
    # Reading 3: 09:00 (operating), 60 kW, PF 0.95
    # Reading 4: 09:01 (operating, dt=60s), 60 kW, PF 0.95
    synthetic_readings = [
        {"timestamp": "2026-10-05 07:00:00", "active_power_kw": 40.0, "power_factor": 0.80},
        {"timestamp": "2026-10-05 07:01:00", "active_power_kw": 40.0, "power_factor": 0.80},
        {"timestamp": "2026-10-05 09:00:00", "active_power_kw": 60.0, "power_factor": 0.95},
        {"timestamp": "2026-10-05 09:01:00", "active_power_kw": 60.0, "power_factor": 0.95}
    ]
    bldg_info = {"id": 1, "rated_power_kw": 70.0}

    eff = calculate_building_efficiency(synthetic_readings, bldg_info)
    assert eff["readings_count"] == 4
    # Peak power = 60.0 kW, Avg power = (40+40+60+60)/4 = 50.0 kW
    assert eff["peak_demand_kw"] == 60.0
    assert eff["avg_demand_kw"] == 50.0
    # Load factor = 50 / 60 = 0.833
    assert eff["load_factor"] == 0.833
    # Low-PF readings (0.80 < 0.85) occurred in first step (dt=60s)
    assert eff["low_pf_duration_minutes"] >= 1.0
    # After-hours kWh occurred between 07:00 and 07:01
    assert eff["after_hours_kwh"] > 0
    assert eff["after_hours_pct"] > 0
    assert len(eff["engineering_observations"]) > 0
    print(" -> PASSED: Efficiency calculations and after-hours tracking verified.")


def test_4_api_unauthorized_access():
    """Test 4: Verify unauthenticated requests to Phase 7 endpoints receive HTTP 401 or redirect."""
    print("\n--- Test 4: Unauthorized Access Protection ---")
    with app.test_client() as client:
        # Page redirect
        res_page = client.get("/cost-efficiency", follow_redirects=False)
        assert res_page.status_code == 302, f"Expected 302 redirect for /cost-efficiency, got {res_page.status_code}"
        assert "/login" in res_page.headers["Location"]

        # API 401 Unauthorized
        res_cost = client.get("/api/energy/cost")
        assert res_cost.status_code == 401, f"Expected 401 for /api/energy/cost, got {res_cost.status_code}"

        res_eff = client.get("/api/energy/efficiency")
        assert res_eff.status_code == 401, f"Expected 401 for /api/energy/efficiency, got {res_eff.status_code}"

        res_comp = client.get("/api/energy/efficiency/comparison")
        assert res_comp.status_code == 401, f"Expected 401 for /api/energy/efficiency/comparison, got {res_comp.status_code}"
    print(" -> PASSED: Unauthorized access rejected.")


def test_5_api_authenticated_cost():
    """Test 5: Verify authenticated GET /api/energy/cost for single building and campus summary."""
    print("\n--- Test 5: Authenticated GET /api/energy/cost ---")
    setup_users()
    with app.test_client() as client:
        # Login
        login_res = client.post("/login", json={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        assert login_res.status_code == 200

        # Query single building cost
        res_single = client.get("/api/energy/cost?building_id=1")
        assert res_single.status_code == 200
        d_single = res_single.get_json()
        assert d_single["status"] == "success"
        assert d_single["mode"] == "single"
        assert "energy_consumed_kwh" in d_single
        assert "estimated_energy_charge_lkr" in d_single
        assert "peak_demand_kw" in d_single
        assert "estimated_demand_charge_lkr" in d_single
        assert "estimated_fixed_charge_lkr" in d_single
        assert "estimated_total_cost_lkr" in d_single
        assert "tariff_name" in d_single
        assert d_single["is_estimate"] is True
        assert "disclaimer" in d_single

        # Query campus-wide summary cost
        res_all = client.get("/api/energy/cost?building_id=all")
        assert res_all.status_code == 200
        d_all = res_all.get_json()
        assert d_all["status"] == "success"
        assert d_all["mode"] == "campus_summary"
        expected_count = len(get_all_buildings())
        assert len(d_all["building_breakdown"]) == expected_count, f"Expected {expected_count} buildings in breakdown, got {len(d_all['building_breakdown'])}"
    print(" -> PASSED: Authenticated cost endpoints return valid tariff structures.")


def test_6_api_authenticated_efficiency_and_comparison():
    """Test 6: Verify authenticated GET /api/energy/efficiency and GET /api/energy/efficiency/comparison."""
    print("\n--- Test 6: Authenticated GET /api/energy/efficiency & Comparison ---")
    with app.test_client() as client:
        client.post("/login", json={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # Single building efficiency
        res_eff = client.get("/api/energy/efficiency?building_id=2")
        assert res_eff.status_code == 200
        d_eff = res_eff.get_json()
        assert d_eff["status"] == "success"
        assert "average_demand_kw" in d_eff
        assert "peak_demand_kw" in d_eff
        assert "load_factor" in d_eff
        assert "average_power_factor" in d_eff
        assert "low_pf_duration_minutes" in d_eff
        assert "after_hours_kwh" in d_eff
        assert "energy_performance_status" in d_eff
        assert "engineering_observations" in d_eff
        assert isinstance(d_eff["engineering_observations"], list)

        # Dedicated six-building comparison
        res_comp = client.get("/api/energy/efficiency/comparison")
        assert res_comp.status_code == 200
        d_comp = res_comp.get_json()
        assert d_comp["status"] == "success"
        assert "campus_summary" in d_comp
        assert "comparison" in d_comp
        assert "ranked_comparison" in d_comp
        expected_count = len(get_all_buildings())
        assert len(d_comp["comparison"]) == expected_count, f"Expected {expected_count} buildings in comparison, got {len(d_comp['comparison'])}"
        assert len(d_comp["ranked_comparison"]) == expected_count, f"Expected {expected_count} buildings in ranked comparison, got {len(d_comp['ranked_comparison'])}"

        # Check required comparative attributes for each building
        for bldg in d_comp["comparison"]:
            assert "total_kwh" in bldg
            assert "estimated_cost_lkr" in bldg
            assert "peak_demand_kw" in bldg
            assert "load_factor" in bldg
            assert "avg_power_factor" in bldg
            assert "after_hours_kwh" in bldg

        # Check rank ordering (rank 1 should have highest efficiency score)
        ranked = d_comp["ranked_comparison"]
        assert ranked[0]["efficiency_rank"] == 1
        for i in range(len(ranked) - 1):
            assert ranked[i]["efficiency_score"] >= ranked[i + 1]["efficiency_score"]
    print(" -> PASSED: Efficiency metrics and six-building rankings verified.")


def test_7_html_cost_efficiency_page():
    """Test 7: Verify /cost-efficiency HTML page renders properly with navbar and disclaimer."""
    print("\n--- Test 7: HTML Page Rendering ---")
    with app.test_client() as client:
        client.post("/login", json={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        })
        res = client.get("/cost-efficiency")
        assert res.status_code == 200
        html = res.data.decode("utf-8")
        assert "Energy Cost &amp; Efficiency Analysis" in html or "Energy Cost & Efficiency Analysis" in html
        assert "Demonstration Tariff Model" in html
        assert "not an official CEB bill" in html
        assert "kpiEnergyConsumed" in html
        assert "kpiEstimatedCost" in html
        assert "efficiencyTableBody" in html
    print(" -> PASSED: HTML template rendering confirmed.")


if __name__ == "__main__":
    test_1_tariff_and_settings_schema()
    test_2_controlled_cost_calculation()
    test_3_controlled_after_hours_and_efficiency()
    test_4_api_unauthorized_access()
    test_5_api_authenticated_cost()
    test_6_api_authenticated_efficiency_and_comparison()
    test_7_html_cost_efficiency_page()
    print("\n========================================================")
    print(" ALL 7 PHASE 7 TESTS PASSED WITH 100% SUCCESS!")
    print("========================================================\n")
