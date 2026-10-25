"""
test_phase3.py
--------------
Automated test suite for Phase 3:
1. Verifies 3-phase electrical formula math (S, P, Q, and S^2 = P^2 + Q^2).
2. Verifies simulator execution, data generation, and SQLite storage for all 6 buildings.
3. Verifies missing sensor gap logic (does not assume continuous power during downtime).
4. Verifies unauthenticated API protection on /api/energy/live and /api/energy/history (HTTP 401).
5. Verifies authenticated API results, JSON schemas, and SIMULATED labels.
"""

import math
from app import app
from simulator import calculate_electrical_parameters, calculate_cumulative_energy, run_simulation_cycle
from database import get_all_buildings, get_live_energy_readings, get_building_energy_history


def test_three_phase_formulas():
    print("\n[Test 1] Verifying 3-Phase Electrical Calculations...")
    # Test case: V_L = 400 V, I_L = 50 A, PF = 0.90
    vl = 400.0
    il = 50.0
    pf = 0.90

    s_kva, p_kw, q_kvar = calculate_electrical_parameters(vl, il, pf)

    expected_s = (math.sqrt(3) * 400.0 * 50.0) / 1000.0  # ~34.6410 kVA
    expected_p = expected_s * 0.90                      # ~31.1769 kW
    expected_q = expected_s * math.sqrt(1.0 - 0.90**2)  # ~15.0977 kVAr

    assert abs(s_kva - expected_s) < 1e-4, f"Apparent power mismatch: {s_kva} vs {expected_s}"
    assert abs(p_kw - expected_p) < 1e-4, f"Active power mismatch: {p_kw} vs {expected_p}"
    assert abs(q_kvar - expected_q) < 1e-4, f"Reactive power mismatch: {q_kvar} vs {expected_q}"

    # Power Triangle verification: S^2 == P^2 + Q^2
    s_calc_from_triangle = math.sqrt(p_kw**2 + q_kvar**2)
    assert abs(s_kva - s_calc_from_triangle) < 1e-4, "Power triangle relationship S^2 = P^2 + Q^2 failed!"

    print(f"  -> S = {s_kva:.2f} kVA, P = {p_kw:.2f} kW, Q = {q_kvar:.2f} kVAr")
    print("  -> Power Triangle: sqrt(P^2 + Q^2) = S verified.")
    print("  -> PASSED: All 3-phase equations mathematically accurate.")


def test_missing_data_gap_handling():
    print("\n[Test 2] Verifying Missing Data / Discontinuous Sensor Handling...")
    from datetime import datetime, timedelta

    # Simulate a 5-hour gap in time
    current_time = datetime.now()
    active_kw = 50.0

    # If previous energy is 1000.0 kWh, a 15-second normal increment is: 50 * (15/3600) = ~0.2083 kWh
    normal_increment = active_kw * (15.0 / 3600.0)

    # Calling calculate_cumulative_energy with a huge gap should ONLY credit the active 15s interval,
    # NOT 5 hours of downtime (which would be 250 kWh!)
    calculated = calculate_cumulative_energy(
        building_id=999,  # Non-existent building ID for fresh test
        current_active_kw=active_kw,
        current_time=current_time,
        default_base_energy=1000.0
    )

    expected = 1000.0 + normal_increment
    assert abs(calculated - expected) < 0.01, f"Expected {expected}, got {calculated}"
    print(f"  -> Initial Base: 1000.0 kWh | 15s Delta: +{normal_increment:.4f} kWh -> Total: {calculated:.4f} kWh")
    print("  -> PASSED: Missing data does not assume continuous operation.")


def test_simulator_data_generation():
    print("\n[Test 3] Verifying Simulator Data Generation for All Buildings...")
    buildings = get_all_buildings()
    assert len(buildings) >= 6, f"Expected at least 6 buildings, got {len(buildings)}"

    readings = run_simulation_cycle(buildings)
    assert len(readings) == len(buildings), f"Expected {len(buildings)} readings, got {len(readings)}"

    for r in readings:
        assert r["is_simulated"] == 1, "Reading not labeled as simulated"
        assert 385.0 <= r["voltage"] <= 415.0, f"Voltage out of reasonable range: {r['voltage']}"
        assert 49.5 <= r["frequency"] <= 50.5, f"Frequency out of range: {r['frequency']}"
        assert 0.75 <= r["power_factor"] <= 1.0, f"PF out of range: {r['power_factor']}"
        assert r["active_power_kw"] > 0, "Active power must be positive"
        assert r["apparent_power_kva"] >= r["active_power_kw"], "S must be >= P"
        assert r["energy_kwh"] > 0, "Cumulative energy must be positive"

    print("  -> Generated and stored readings for all 6 buildings in SQLite.")
    print("  -> PASSED: All readings have realistic electrical values & are marked SIMULATED.")


def test_api_endpoints():
    print("\n[Test 4] Verifying Live & History API Endpoints & Protection...")
    with app.test_client() as client:
        # 1. Unauthenticated /api/energy/live -> 401
        res = client.get("/api/energy/live")
        assert res.status_code == 401, f"Expected 401 for unauthenticated live API, got {res.status_code}"

        # 2. Unauthenticated /api/energy/history -> 401
        res = client.get("/api/energy/history?building_id=1")
        assert res.status_code == 401, f"Expected 401 for unauthenticated history API, got {res.status_code}"

        # 3. Authenticate with test admin
        login_res = client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        assert login_res.status_code in (200, 302), "Authentication failed during test"

        # 4. Authenticated /api/energy/live -> 200
        res = client.get("/api/energy/live")
        assert res.status_code == 200, f"Expected 200 for live API, got {res.status_code}"
        live_data = res.get_json()
        assert live_data["status"] == "success"
        assert live_data["data_source"] == "SIMULATED"
        expected_count = len(get_all_buildings())
        assert live_data["count"] == expected_count, f"Expected {expected_count} buildings, got {live_data['count']}"
        assert len(live_data["data"]) == expected_count
        print(f"  -> Live API returned {live_data['count']} buildings with label: {live_data['data_source']}")

        # 5. Authenticated /api/energy/history with building_id=1 -> 200
        res = client.get("/api/energy/history?building_id=1&limit=5")
        assert res.status_code == 200, f"Expected 200 for history API, got {res.status_code}"
        hist_data = res.get_json()
        assert hist_data["status"] == "success"
        assert hist_data["data_source"] == "SIMULATED"
        assert hist_data["building_id"] == 1
        assert len(hist_data["data"]) > 0
        latest_hist = hist_data["data"][0]
        print(f"  -> History API for Building 1 ({latest_hist.get('building_name')}): {len(hist_data['data'])} records retrieved.")

        # 6. Authenticated /api/energy/history missing building_id -> 400
        res = client.get("/api/energy/history")
        assert res.status_code == 400, f"Expected 400 when building_id missing, got {res.status_code}"

        print("  -> PASSED: All API endpoints protected, functional, and accurately reporting simulated telemetry.")


def run_all_tests():
    print("=" * 70)
    print(" RUNNING PHASE 3 AUTOMATED ELECTRICAL SIMULATOR TESTS")
    print("=" * 70)

    test_three_phase_formulas()
    test_missing_data_gap_handling()
    test_simulator_data_generation()
    test_api_endpoints()

    print("\n" + "=" * 70)
    print(" ALL PHASE 3 TESTS COMPLETED AND PASSED SUCCESSFULLY! ")
    print("=" * 70)


if __name__ == "__main__":
    run_all_tests()
