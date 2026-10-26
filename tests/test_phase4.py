"""
test_phase4.py
--------------
Automated test suite for Phase 4: Live Energy Monitoring Dashboard.
Verifies:
1. Access control to /dashboard (unauthenticated blocked vs authenticated allowed).
2. Presence of all 6 building telemetry card DOM anchors in /dashboard HTML.
3. Presence of Chart.js canvases and Campus Overview KPI elements.
4. /api/energy/live data integrity (8 electrical parameters per building, SIMULATED tag).
5. Dynamic database updates when simulator cycles run.
"""

from app import app
from simulator import run_simulation_cycle
from database import get_all_buildings


def test_dashboard_access_and_dom_elements():
    print("\n[Test 1] Verifying Dashboard Authentication & DOM Structure...")
    with app.test_client() as client:
        # 1. Unauthenticated -> 302 to /login
        unauth_res = client.get("/dashboard")
        assert unauth_res.status_code == 302, f"Expected 302 redirect, got {unauth_res.status_code}"
        assert "/login" in unauth_res.headers["Location"], "Expected redirect to /login"
        print("  -> Unauthenticated user successfully redirected to /login.")

        # 2. Authenticate
        login_res = client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        assert login_res.status_code in (200, 302), "Login failed"

        # 3. Authenticated -> 200 with all dashboard components
        res = client.get("/dashboard")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        html = res.get_data(as_text=True)

        # Check Campus KPI anchors
        assert "kpiTotalActivePower" in html, "Missing kpiTotalActivePower anchor"
        assert "kpiTotalApparentPower" in html, "Missing kpiTotalApparentPower anchor"
        assert "kpiTotalEnergy" in html, "Missing kpiTotalEnergy anchor"
        assert "kpiAvgPf" in html, "Missing kpiAvgPf anchor"
        assert "kpiOnlineCount" in html, "Missing kpiOnlineCount anchor"

        # Check Charts
        assert "activePowerLineChart" in html, "Missing activePowerLineChart canvas"
        assert "activePowerBarChart" in html, "Missing activePowerBarChart canvas"
        assert "chart.js" in html.lower(), "Missing Chart.js script reference"

        # Check Simulated Badge
        assert "SIMULATED DATA" in html, "Missing SIMULATED DATA badge"

        # Check All 6 Building Cards
        expected_buildings = ["CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"]
        for b in expected_buildings:
            assert f"card_{b}" in html, f"Missing card_{b} in dashboard"
            assert f"bldg_{b}_v" in html, f"Missing bldg_{b}_v"
            assert f"bldg_{b}_i" in html, f"Missing bldg_{b}_i"
            assert f"bldg_{b}_p" in html, f"Missing bldg_{b}_p"
            assert f"bldg_{b}_s" in html, f"Missing bldg_{b}_s"
            assert f"bldg_{b}_q" in html, f"Missing bldg_{b}_q"
            assert f"bldg_{b}_pf" in html, f"Missing bldg_{b}_pf"
            assert f"bldg_{b}_freq" in html, f"Missing bldg_{b}_freq"
            assert f"bldg_{b}_kwh" in html, f"Missing bldg_{b}_kwh"

        print("  -> PASSED: All 6 building cards, 2 Chart.js canvases, and 5 KPI anchors verified.")


def test_live_api_telemetry_schema():
    print("\n[Test 2] Verifying /api/energy/live JSON Telemetry Schema...")
    with app.test_client() as client:
        # Authenticate
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        res = client.get("/api/energy/live")
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}"
        payload = res.get_json()

        assert payload["status"] == "success"
        expected_count = len(get_all_buildings())
        assert payload["count"] == expected_count, f"Expected {expected_count} buildings, got {payload['count']}"

        readings = payload["data"]
        assert len(readings) == expected_count

        required_keys = [
            "building_id", "building_code", "building_name", "timestamp",
            "voltage", "current", "active_power_kw", "apparent_power_kva",
            "reactive_power_kvar", "power_factor", "frequency", "energy_kwh", "is_simulated"
        ]

        for r in readings:
            for k in required_keys:
                assert k in r, f"Key '{k}' missing from reading for {r.get('building_code')}"
            assert r["is_simulated"] == 1
            assert r["voltage"] > 0
            assert r["current"] > 0
            assert r["active_power_kw"] > 0
            assert r["power_factor"] > 0

        print(f"  -> PASSED: All 6 buildings contain valid 8-parameter 3-phase electrical readings.")


def test_simulator_live_updates():
    print("\n[Test 3] Verifying Simulator Update & Database Progression...")
    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # Fetch baseline
        res1 = client.get("/api/energy/live").get_json()
        bldg1_before = res1["data"][0]

        # Execute one simulation cycle (simulating the background simulator running)
        buildings = get_all_buildings()
        run_simulation_cycle(buildings)

        # Fetch updated
        res2 = client.get("/api/energy/live").get_json()
        bldg1_after = res2["data"][0]

        # Check energy accumulated
        assert bldg1_after["energy_kwh"] >= bldg1_before["energy_kwh"], "Energy should accumulate or stay constant"
        assert bldg1_after["reading_id"] > bldg1_before["reading_id"], "Reading ID should increment on new cycle"
        print(f"  -> Building 1 Reading ID progressed from {bldg1_before['reading_id']} -> {bldg1_after['reading_id']}")
        print(f"  -> Energy progressed from {bldg1_before['energy_kwh']} -> {bldg1_after['energy_kwh']} kWh")
        print("  -> PASSED: Live API reflects fresh cycles immediately.")


def run_all():
    print("=" * 70)
    print(" RUNNING PHASE 4 LIVE ENERGY MONITORING DASHBOARD TESTS")
    print("=" * 70)
    test_dashboard_access_and_dom_elements()
    test_live_api_telemetry_schema()
    test_simulator_live_updates()
    print("\n" + "=" * 70)
    print(" ALL PHASE 4 TESTS COMPLETED AND PASSED SUCCESSFULLY! ")
    print("=" * 70)


if __name__ == "__main__":
    run_all()
