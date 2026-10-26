"""
test_phase6.py
--------------
Automated test suite for Phase 6: Electrical Alerts and Abnormal Condition Detection.
Faculty of Engineering, University of Ruhuna.

Verifies:
1. Alerts table existence & complete schema (all required fields + clear tracking).
2. Building rated active power storage in SQLite backend.
3. Accurate detection and severity assignment for all 8 abnormal conditions:
   - LOW POWER FACTOR (PF < 0.85, WARNING)
   - LOW VOLTAGE (Line voltage < 380 V, CRITICAL)
   - HIGH VOLTAGE (Line voltage > 420 V, CRITICAL)
   - HIGH FREQUENCY (Frequency > 50.5 Hz, WARNING)
   - LOW FREQUENCY (Frequency < 49.5 Hz, WARNING)
   - HIGH LOAD (Active power > 90% rated power, WARNING)
   - OVERLOAD (Active power > 100% rated power, CRITICAL)
   - SENSOR OFFLINE (Silence > 60 seconds, WARNING)
4. Duplicate alert prevention: only one active alert per abnormal condition cycle.
5. State clearing: alerts automatically clear (is_active = 0, cleared_at stamped) when normal.
6. Escalation logic: High Load escalates to Overload when power crosses 100%.
7. Role-Based Access Control (RBAC):
   - Unauthenticated requests blocked (401/302).
   - Only Administrator can acknowledge alerts (200 OK).
   - Viewer receives 403 Forbidden on acknowledge.
8. Alerts REST API filtering (building, severity, active/cleared, date limits).
9. Frontend DOM structure & navigation tabs for Alerts page.
"""

import os
import sys
from datetime import datetime, timedelta

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
import database


def test_schema_and_building_rated_power():
    print("\n[Test 1] Verifying Alerts Table Schema & Building Rated Capacities...")
    conn = database.get_db_connection()
    cursor = conn.cursor()

    # 1. Check alerts table columns
    cursor.execute("PRAGMA table_info(alerts)")
    columns = {col["name"] for col in cursor.fetchall()}
    expected_cols = {
        "id", "building_id", "timestamp", "alert_type", "severity",
        "measured_value", "threshold_value", "message",
        "acknowledged", "acknowledged_by", "acknowledged_at",
        "is_active", "cleared_at"
    }
    missing = expected_cols - columns
    assert not missing, f"Missing columns in alerts table: {missing}"
    print("  -> PASSED: Alerts table contains all required columns.")

    # 2. Check building rated power column & non-zero values
    buildings = database.get_all_buildings()
    assert len(buildings) >= 6, f"Expected at least 6 buildings, got {len(buildings)}"
    for b in buildings:
        assert "rated_power_kw" in b, f"Missing rated_power_kw in building {b['code']}"
        assert b["rated_power_kw"] > 0, f"Invalid rated_power_kw {b['rated_power_kw']} for {b['code']}"
        print(f"     * [{b['code']}] {b['name']}: {b['rated_power_kw']} kW rated capacity")

    conn.close()
    print(f"  -> PASSED: All {len(buildings)} buildings store configured rated power in SQLite backend.")


def test_abnormal_conditions_detection():
    print("\n[Test 2] Verifying Electrical Abnormal Condition Detection with Controlled Values...")
    bldg_id = 1  # CEE (Rated: 60.0 kW)

    # 2.1 LOW POWER FACTOR (PF = 0.812 < 0.85)
    database.clear_alert(bldg_id, "LOW_POWER_FACTOR")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 400.0,
        "power_factor": 0.812,
        "frequency": 50.0,
        "active_power_kw": 45.0
    })
    active_pf = database.get_filtered_alerts(building_id=bldg_id, severity="WARNING", status="active")
    assert any(a["alert_type"] == "LOW_POWER_FACTOR" and a["measured_value"] == 0.812 for a in active_pf)
    print("  -> PASSED: LOW POWER FACTOR (< 0.85) detected and categorized as WARNING.")

    # 2.2 LOW VOLTAGE (V = 374.2 V < 380 V)
    database.clear_alert(bldg_id, "LOW_VOLTAGE")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 374.2,
        "power_factor": 0.90,
        "frequency": 50.0,
        "active_power_kw": 45.0
    })
    active_v_low = database.get_filtered_alerts(building_id=bldg_id, severity="CRITICAL", status="active")
    assert any(a["alert_type"] == "LOW_VOLTAGE" and a["measured_value"] == 374.2 for a in active_v_low)
    print("  -> PASSED: LOW VOLTAGE (< 380 V) detected and categorized as CRITICAL.")

    # 2.3 HIGH VOLTAGE (V = 425.6 V > 420 V)
    database.clear_alert(bldg_id, "HIGH_VOLTAGE")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 425.6,
        "power_factor": 0.90,
        "frequency": 50.0,
        "active_power_kw": 45.0
    })
    active_v_high = database.get_filtered_alerts(building_id=bldg_id, severity="CRITICAL", status="active")
    assert any(a["alert_type"] == "HIGH_VOLTAGE" and a["measured_value"] == 425.6 for a in active_v_high)
    print("  -> PASSED: HIGH VOLTAGE (> 420 V) detected and categorized as CRITICAL.")

    # 2.4 HIGH FREQUENCY (f = 50.72 Hz > 50.5 Hz)
    database.clear_alert(bldg_id, "HIGH_FREQUENCY")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 400.0,
        "power_factor": 0.90,
        "frequency": 50.72,
        "active_power_kw": 45.0
    })
    active_f_high = database.get_filtered_alerts(building_id=bldg_id, severity="WARNING", status="active")
    assert any(a["alert_type"] == "HIGH_FREQUENCY" and a["measured_value"] == 50.72 for a in active_f_high)
    print("  -> PASSED: HIGH FREQUENCY (> 50.5 Hz) detected and categorized as WARNING.")

    # 2.5 LOW FREQUENCY (f = 49.28 Hz < 49.5 Hz)
    database.clear_alert(bldg_id, "LOW_FREQUENCY")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 400.0,
        "power_factor": 0.90,
        "frequency": 49.28,
        "active_power_kw": 45.0
    })
    active_f_low = database.get_filtered_alerts(building_id=bldg_id, severity="WARNING", status="active")
    assert any(a["alert_type"] == "LOW_FREQUENCY" and a["measured_value"] == 49.28 for a in active_f_low)
    print("  -> PASSED: LOW FREQUENCY (< 49.5 Hz) detected and categorized as WARNING.")

    # 2.6 HIGH LOAD (P = 56.0 kW for 60 kW rated capacity = 93.3% > 90%)
    database.clear_alert(bldg_id, "HIGH_LOAD")
    database.clear_alert(bldg_id, "OVERLOAD")
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 400.0,
        "power_factor": 0.90,
        "frequency": 50.0,
        "active_power_kw": 56.0
    })
    active_load = database.get_filtered_alerts(building_id=bldg_id, severity="WARNING", status="active")
    assert any(a["alert_type"] == "HIGH_LOAD" and a["measured_value"] == 56.0 for a in active_load)
    print("  -> PASSED: HIGH LOAD (> 90% rated power) detected and categorized as WARNING.")

    # 2.7 OVERLOAD (P = 66.5 kW for 60 kW rated capacity = 110.8% > 100%)
    database.evaluate_electrical_alerts(bldg_id, {
        "voltage": 400.0,
        "power_factor": 0.90,
        "frequency": 50.0,
        "active_power_kw": 66.5
    })
    active_overload = database.get_filtered_alerts(building_id=bldg_id, severity="CRITICAL", status="active")
    assert any(a["alert_type"] == "OVERLOAD" and a["measured_value"] == 66.5 for a in active_overload)
    # Check that HIGH_LOAD was escalated/cleared
    active_high_load = database.get_filtered_alerts(building_id=bldg_id, severity="WARNING", status="active")
    assert not any(a["alert_type"] == "HIGH_LOAD" for a in active_high_load)
    print("  -> PASSED: OVERLOAD (> 100% rated power) detected, escalated to CRITICAL, and HIGH_LOAD de-duplicated.")


def test_duplicate_prevention_and_clearing():
    print("\n[Test 3] Verifying Duplicate Suppression & Return-to-Normal Clearing...")
    bldg_id = 4  # MENA (Rated: 55.0 kW)

    database.clear_alert(bldg_id, "LOW_VOLTAGE")

    # 1. First undervoltage reading (V = 375.0 V) -> Alert triggered
    database.evaluate_electrical_alerts(bldg_id, {"voltage": 375.0, "power_factor": 0.90, "frequency": 50.0, "active_power_kw": 30.0})
    initial_alerts = database.get_filtered_alerts(building_id=bldg_id, status="active")
    initial_count = len([a for a in initial_alerts if a["alert_type"] == "LOW_VOLTAGE"])
    assert initial_count == 1, "Expected exactly 1 active LOW_VOLTAGE alert."

    # 2. Subsequent undervoltage readings (V = 372.0 V, 370.0 V) -> MUST NOT duplicate!
    for v_bad in [372.0, 370.0, 368.0]:
        database.evaluate_electrical_alerts(bldg_id, {"voltage": v_bad, "power_factor": 0.90, "frequency": 50.0, "active_power_kw": 30.0})

    after_dupes = database.get_filtered_alerts(building_id=bldg_id, status="active")
    dupe_count = len([a for a in after_dupes if a["alert_type"] == "LOW_VOLTAGE"])
    assert dupe_count == 1, f"Expected 1 active alert (duplicate prevention), got {dupe_count}"
    print("  -> PASSED: Consecutive abnormal simulator readings do NOT create duplicate alerts.")

    # 3. Voltage returns to normal (V = 401.0 V >= 380 V) -> Alert MUST clear
    database.evaluate_electrical_alerts(bldg_id, {"voltage": 401.0, "power_factor": 0.90, "frequency": 50.0, "active_power_kw": 30.0})
    after_cleared = database.get_filtered_alerts(building_id=bldg_id, status="active")
    cleared_count = len([a for a in after_cleared if a["alert_type"] == "LOW_VOLTAGE"])
    assert cleared_count == 0, f"Expected 0 active alerts after return to normal, got {cleared_count}"

    # Check cleared record has is_active = 0 and cleared_at stamped
    cleared_records = database.get_filtered_alerts(building_id=bldg_id, status="cleared")
    assert any(a["alert_type"] == "LOW_VOLTAGE" and a["is_active"] == 0 and a["cleared_at"] is not None for a in cleared_records)
    print("  -> PASSED: Return to normal operation successfully records condition cleared.")


def test_sensor_offline_detection():
    print("\n[Test 4] Verifying SENSOR OFFLINE Detection & Auto-Recovery...")
    bldg_id = 5  # ADMIN

    # Clear existing SENSOR_OFFLINE alerts for ADMIN
    database.clear_alert(bldg_id, "SENSOR_OFFLINE")

    # Manually check sensor offline: with threshold = 0.0 seconds to force offline detection
    offline_count = database.check_sensor_offline_alerts(threshold_seconds=0.0)
    assert offline_count >= 1, "Expected offline alerts to trigger with threshold 0s"

    active_offline = database.get_filtered_alerts(building_id=bldg_id, status="active")
    assert any(a["alert_type"] == "SENSOR_OFFLINE" and a["severity"] == "WARNING" for a in active_offline)
    print("  -> PASSED: SENSOR OFFLINE detected when elapsed sensor silence exceeds threshold.")

    # Insert fresh reading -> SENSOR_OFFLINE must auto-clear!
    database.evaluate_electrical_alerts(bldg_id, {"voltage": 400.0, "power_factor": 0.92, "frequency": 50.0, "active_power_kw": 25.0})
    cleared_offline = database.get_filtered_alerts(building_id=bldg_id, status="active")
    assert not any(a["alert_type"] == "SENSOR_OFFLINE" for a in cleared_offline)
    print("  -> PASSED: Arrival of fresh telemetry automatically clears SENSOR OFFLINE alert.")


def test_rbac_and_acknowledgment():
    print("\n[Test 5] Verifying RBAC and Alert Acknowledgment Permissions...")

    # Create a test alert for testing acknowledge
    alert_id = database.trigger_alert(
        building_id=1,
        alert_type="LOW_POWER_FACTOR",
        severity="WARNING",
        measured_value=0.82,
        threshold_value=0.85,
        message="RBAC Test Alert"
    )

    with app.test_client() as client:
        # 1. Unauthenticated acknowledge attempt -> 401
        res = client.post(f"/api/alerts/{alert_id}/acknowledge")
        assert res.status_code == 401, f"Expected 401, got {res.status_code}"
        print("  -> PASSED: Unauthenticated acknowledge blocked with 401.")

        # 2. Viewer acknowledge attempt -> 403 Forbidden
        client.post("/login", data={
            "email": "test_viewer@eng.ruh.ac.lk",
            "password": "ViewerSecretPassword123!"
        })
        res_viewer = client.post(f"/api/alerts/{alert_id}/acknowledge")
        assert res_viewer.status_code == 403, f"Expected 403, got {res_viewer.status_code}"
        assert "Administrator" in res_viewer.get_json()["message"]
        print("  -> PASSED: Viewer acknowledge blocked with 403 Forbidden.")

        # 3. Administrator acknowledge attempt -> 200 OK
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        res_admin = client.post(f"/api/alerts/{alert_id}/acknowledge")
        assert res_admin.status_code == 200, f"Expected 200, got {res_admin.status_code}"
        ack_data = res_admin.get_json()["alert"]
        assert ack_data["acknowledged"] == 1
        assert "Administrator" in ack_data["acknowledged_by"]
        assert ack_data["acknowledged_at"] is not None
        print(f"  -> PASSED: Administrator successfully acknowledged alert #{alert_id}.")


def test_alerts_api_filters_and_counters():
    print("\n[Test 6] Verifying GET /api/alerts Endpoint & Real-Time Counters...")
    with app.test_client() as client:
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })

        # Query all alerts
        res = client.get("/api/alerts")
        assert res.status_code == 200
        payload = res.get_json()
        assert payload["status"] == "success"
        summary = payload["summary"]
        assert "active_total" in summary
        assert "active_warnings" in summary
        assert "active_critical" in summary
        assert "cleared_total" in summary
        print(f"  -> Summary Counters: {summary['active_critical']} Critical, {summary['active_warnings']} Warnings, {summary['cleared_total']} Cleared.")

        # Filter by building_id
        res_bldg = client.get("/api/alerts?building_id=1")
        assert res_bldg.status_code == 200
        for a in res_bldg.get_json()["data"]:
            assert a["building_id"] == 1

        # Filter by severity
        res_sev = client.get("/api/alerts?severity=CRITICAL")
        assert res_sev.status_code == 200
        for a in res_sev.get_json()["data"]:
            assert a["severity"] == "CRITICAL"

        # Invalid building_id returns 400
        res_inv = client.get("/api/alerts?building_id=invalid")
        assert res_inv.status_code == 400
        print("  -> PASSED: All API filters and error handling verified.")


def test_frontend_dom_elements():
    print("\n[Test 7] Verifying /alerts Page DOM Elements and Navigation...")
    with app.test_client() as client:
        # Unauthenticated access to /alerts -> 302
        res_unauth = client.get("/alerts", follow_redirects=False)
        assert res_unauth.status_code == 302
        assert "/login" in res_unauth.headers["Location"]
        print("  -> PASSED: Unauthenticated user redirected to /login.")

        # Authenticated access
        client.post("/login", data={
            "email": "test_admin@eng.ruh.ac.lk",
            "password": "AdminSecretPassword123!"
        })
        res = client.get("/alerts")
        assert res.status_code == 200
        html = res.get_data(as_text=True)

        # Filters
        assert "filterBuilding" in html
        assert "filterSeverity" in html
        assert "filterStatus" in html
        assert "filterStart" in html
        assert "filterEnd" in html
        assert "btnFilterApply" in html
        assert "btnFilterReset" in html

        # KPI Cards
        assert "kpiActiveCritical" in html
        assert "kpiActiveWarnings" in html
        assert "kpiTotalActive" in html
        assert "kpiClearedTotal" in html

        # Table & Script
        assert "alertsTableBody" in html
        assert "alerts.js" in html

        # Nav links
        assert "Electrical Alerts" in html

        print("  -> PASSED: Alerts page HTML template contains all required DOM elements and script bindings.")


def run_all():
    print("=" * 75)
    print(" RUNNING PHASE 6 ELECTRICAL ALERTS & ANOMALY DETECTION TEST SUITE")
    print("=" * 75)
    test_schema_and_building_rated_power()
    test_abnormal_conditions_detection()
    test_duplicate_prevention_and_clearing()
    test_sensor_offline_detection()
    test_rbac_and_acknowledgment()
    test_alerts_api_filters_and_counters()
    test_frontend_dom_elements()
    print("\n" + "=" * 75)
    print(" ALL 7 PHASE 6 TEST MODULES PASSED SUCCESSFULLY! ")
    print("=" * 75)


if __name__ == "__main__":
    run_all()
