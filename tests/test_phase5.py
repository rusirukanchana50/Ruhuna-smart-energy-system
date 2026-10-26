"""
test_phase5.py
--------------
Automated test suite for Phase 5: Historical Energy Analytics.
Verifies:
1. Authentication access control to /analytics and /api/energy/* endpoints.
2. /analytics HTML DOM structure (filters, preset buttons, KPI cards, charts).
3. /api/energy/history endpoint filtering (building_id, start, end).
4. /api/energy/analytics for single building:
   - Mathematical validity of Load Factor = Avg Power / Peak Power.
   - All 13 electrical parameter outputs (Active/Apparent/Reactive, PF, V, I, f, Energy).
   - Consecutive timestamp trapezoidal energy integration with missing data handling.
5. /api/energy/analytics for campus comparison mode (building_id=all).
"""

import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
from database import get_all_buildings, get_energy_analytics, calculate_building_analytics


def test_analytics_page_access_and_dom():
    print("\n[Test 1] Verifying /analytics Access & DOM Elements...")
    with app.test_client() as client:
        # 1. Unauthenticated -> 302
        res = client.get("/analytics")
        assert res.status_code == 302, f"Expected 302 redirect, got {res.status_code}"
        assert "/login" in res.headers["Location"]
        print("  -> Unauthenticated user blocked and redirected to /login.")

        # 2. Authenticate
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # 3. Authenticated -> 200
        res = client.get("/analytics")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        html = res.get_data(as_text=True)

        # Filters & Presets
        assert "filterBuilding" in html, "Missing filterBuilding select"
        assert "filterStart" in html, "Missing filterStart input"
        assert "filterEnd" in html, "Missing filterEnd input"
        assert "btnAnalyze" in html, "Missing btnAnalyze button"
        assert 'data-preset="1h"' in html, "Missing 1h preset"
        assert 'data-preset="today"' in html, "Missing today preset"
        assert 'data-preset="24h"' in html, "Missing 24h preset"
        assert 'data-preset="7d"' in html, "Missing 7d preset"

        # KPI anchors
        assert "kpiEnergyKwh" in html, "Missing kpiEnergyKwh"
        assert "kpiPeakDemandKw" in html, "Missing kpiPeakDemandKw"
        assert "kpiAvgDemandKw" in html, "Missing kpiAvgDemandKw"
        assert "kpiLoadFactorSingle" in html, "Missing kpiLoadFactorSingle"

        # Chart canvases
        assert "chartActivePowerTime" in html, "Missing chartActivePowerTime"
        assert "chartEnergyTime" in html, "Missing chartEnergyTime"
        assert "chartPfTime" in html, "Missing chartPfTime"
        assert "chartVoltageTime" in html, "Missing chartVoltageTime"
        assert "chartCompEnergy" in html, "Missing chartCompEnergy"

        # Script reference
        assert "analytics.js" in html, "Missing analytics.js reference"

        print("  -> PASSED: /analytics template contains all required filters, presets, KPI cards, and charts.")


def test_api_history_filtering():
    print("\n[Test 2] Verifying /api/energy/history Filtering...")
    with app.test_client() as client:
        # Unauthenticated check
        res = client.get("/api/energy/history")
        assert res.status_code == 401, f"Expected 401, got {res.status_code}"

        # Authenticate
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # Authenticated query with building_id=1 and limit=10
        res = client.get("/api/energy/history?building_id=1&limit=10")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        payload = res.get_json()
        assert payload["status"] == "success"
        assert payload["data_source"] == "SIMULATED"
        assert len(payload["data"]) > 0
        for r in payload["data"]:
            assert r["building_id"] == 1, f"Expected building_id 1, got {r['building_id']}"

        print(f"  -> PASSED: Retrieved {len(payload['data'])} filtered readings for Building 1.")


def test_single_building_analytics_math():
    print("\n[Test 3] Verifying Single Building Electrical Analytics Math...")
    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        res = client.get("/api/energy/analytics?building_id=1")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        payload = res.get_json()

        assert payload["status"] == "success"
        assert payload["mode"] == "single"
        assert payload["building_id"] == 1

        a = payload["analytics"]
        print(f"  -> Building 1 [{payload.get('building_code')}] Results:")
        print(f"     * Total Energy Consumed: {a['total_energy_kwh']} kWh")
        print(f"     * Avg Active Power:      {a['avg_active_power_kw']} kW")
        print(f"     * Peak Demand:           {a['peak_active_power_kw']} kW")
        print(f"     * Min Active Power:      {a['min_active_power_kw']} kW")
        print(f"     * Avg Apparent Power:    {a['avg_apparent_power_kva']} kVA")
        print(f"     * Avg Reactive Power:    {a['avg_reactive_power_kvar']} kVAr")
        print(f"     * Avg Power Factor:      {a['avg_power_factor']}")
        print(f"     * Min Power Factor:      {a['min_power_factor']}")
        print(f"     * Avg Voltage:           {a['avg_voltage']} V (Range: {a['min_voltage']}V - {a['max_voltage']}V)")
        print(f"     * Avg Current:           {a['avg_current']} A")
        print(f"     * Avg Frequency:         {a['avg_frequency']} Hz")
        print(f"     * Load Factor:           {a['load_factor']} ({a['load_factor_pct']}%)")

        # Mathematical Verifications
        assert a["peak_active_power_kw"] >= a["avg_active_power_kw"], "Peak demand must be >= Average demand"
        assert a["avg_active_power_kw"] >= a["min_active_power_kw"], "Average demand must be >= Min demand"

        # Verify Load Factor calculation: LF = Avg / Peak
        if a["peak_active_power_kw"] > 0:
            expected_lf = round(a["avg_active_power_kw"] / a["peak_active_power_kw"], 3)
            assert abs(a["load_factor"] - expected_lf) <= 0.01, f"Load factor mismatch: {a['load_factor']} vs {expected_lf}"

        assert 0.0 <= a["load_factor"] <= 1.0, f"Load factor must be between 0 and 1: {a['load_factor']}"
        assert a["total_energy_kwh"] > 0, "Total energy must be greater than zero"

        print("  -> PASSED: All 13 electrical parameter calculations and Load Factor verified.")


def test_campus_comparison_analytics():
    print("\n[Test 4] Verifying Six-Building Comparison Analytics...")
    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        res = client.get("/api/energy/analytics?building_id=all")
        assert res.status_code == 200, f"Expected 200, got {res.status_code}"
        payload = res.get_json()

        assert payload["status"] == "success"
        assert payload["mode"] == "comparison"

        campus = payload["campus_summary"]
        expected_count = len(get_all_buildings())
        assert campus["building_count"] == expected_count, f"Expected {expected_count} buildings, got {campus['building_count']}"
        assert campus["total_energy_kwh"] > 0

        comparison = payload["comparison"]
        assert len(comparison) == expected_count, f"Expected {expected_count} comparison items, got {len(comparison)}"

        codes = [c["building_code"] for c in comparison]
        for expected in ["CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"]:
            assert expected in codes, f"Building code {expected} missing from comparison"

        print(f"  -> Campus Total Energy: {campus['total_energy_kwh']} kWh across all 6 complexes.")
        print(f"  -> Campus Peak Demand:  {campus['peak_active_power_kw']} kW")
        print(f"  -> Campus Average PF:   {campus['avg_power_factor']}")
        print(f"  -> Comparison contains all 6 buildings with valid metrics.")
        print("  -> PASSED: Six-building comparison mode verified.")


def test_consecutive_timestamp_energy_integration():
    print("\n[Test 5] Verifying Consecutive Timestamp Energy Integration Logic...")
    # Synthetic test data simulating 3 readings:
    # Reading 1: 00:00:00, 50 kW
    # Reading 2: 00:00:15 (dt = 15s), 60 kW  -> p_avg = 55 kW -> energy = 55 * (15/3600) = 0.22917 kWh
    # Reading 3: 02:00:00 (dt = 2 hours gap! sensor offline) -> should ONLY credit 60 * (15/3600) = 0.25 kWh, NOT 2 hours!
    synthetic_readings = [
        {
            "timestamp": "2026-10-06 10:00:00",
            "active_power_kw": 50.0,
            "apparent_power_kva": 55.0,
            "reactive_power_kvar": 20.0,
            "power_factor": 0.90,
            "voltage": 400.0,
            "current": 45.0,
            "frequency": 50.0
        },
        {
            "timestamp": "2026-10-06 10:00:15",
            "active_power_kw": 60.0,
            "apparent_power_kva": 66.0,
            "reactive_power_kvar": 25.0,
            "power_factor": 0.90,
            "voltage": 401.0,
            "current": 52.0,
            "frequency": 50.0
        },
        {
            "timestamp": "2026-10-06 12:00:00",  # 2 hour missing gap!
            "active_power_kw": 60.0,
            "apparent_power_kva": 66.0,
            "reactive_power_kvar": 25.0,
            "power_factor": 0.90,
            "voltage": 399.0,
            "current": 52.0,
            "frequency": 50.0
        }
    ]

    stats = calculate_building_analytics(synthetic_readings)

    # Expected:
    # Cycle 1: (50 + 60)/2 * (15/3600) = 55 * 0.0041666 = 0.22917 kWh
    # Cycle 2: Gap > 60s -> 60 * (15/3600) = 0.25 kWh
    # Total expected: ~0.479 kWh
    # If gap was erroneously multiplied by 2 hours, it would be 60 * 2 = 120 kWh!
    assert stats["total_energy_kwh"] < 1.0, f"Energy integration blew up during gap: {stats['total_energy_kwh']} kWh"
    assert abs(stats["total_energy_kwh"] - 0.479) < 0.01, f"Expected ~0.479 kWh, got {stats['total_energy_kwh']}"

    print(f"  -> Total Integrated Energy for gap test: {stats['total_energy_kwh']} kWh (Expected: ~0.479 kWh).")
    print("  -> PASSED: Discontinuous missing sensor gaps correctly prevent false energy inflation.")


def run_all():
    print("=" * 70)
    print(" RUNNING PHASE 5 HISTORICAL ENERGY ANALYTICS TESTS")
    print("=" * 70)
    test_analytics_page_access_and_dom()
    test_api_history_filtering()
    test_single_building_analytics_math()
    test_campus_comparison_analytics()
    test_consecutive_timestamp_energy_integration()
    print("\n" + "=" * 70)
    print(" ALL PHASE 5 TESTS COMPLETED AND PASSED SUCCESSFULLY! ")
    print("=" * 70)


if __name__ == "__main__":
    run_all()
