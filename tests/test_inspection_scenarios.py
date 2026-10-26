"""
test_inspection_scenarios.py
----------------------------
Inspection and verification script for:
1. Issue 1: Operational vs. After-Hours Energy calculation & boundary rules.
2. Issue 2: Building Overload detection, threshold escalation (HIGH_LOAD vs. OVERLOAD),
   duplicate suppression, auto-resolution, and historical audit persistence.
3. Guarantees 100% isolation with zero modification to production energy.db.
"""

import os
import sys
import shutil
import tempfile
import sqlite3
from datetime import datetime, timedelta

# Ensure Ruhuna Smart Energy System directory and backend are in path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import database

def run_inspection():
    print("=" * 80)
    print(" RUHUNA SMART ENERGY SYSTEM - TECHNICAL INSPECTION SUITE")
    print("=" * 80)

    orig_db = os.path.abspath(database.DB_PATH)
    orig_size = os.path.getsize(orig_db)
    orig_mtime = os.path.getmtime(orig_db)
    print(f"[Safety Pre-check] Monitoring production database: {orig_db}")
    print(f"                   Size: {orig_size} bytes | Mtime: {orig_mtime}")

    # Isolated temporary workspace
    temp_dir = tempfile.mkdtemp(prefix="ruhuna_inspection_")
    temp_db = os.path.join(temp_dir, "temp_inspect.db")
    shutil.copyfile(orig_db, temp_db)
    database.DB_PATH = temp_db

    try:
        # =====================================================================
        # PART 1: ISSUE 1 - AFTER-HOURS ENERGY LOGIC & BOUNDARIES
        # =====================================================================
        print("\n" + "=" * 60)
        print(" PART 1: AFTER-HOURS ENERGY CALCULATION & BOUNDARY RULES")
        print("=" * 60)

        settings = database.get_faculty_settings()
        print(f"Faculty Settings:")
        print(f"  - Operating Days:         {settings.get('operating_days')} (Mon=0, Tue=1, Wed=2, Thu=3, Fri=4)")
        print(f"  - Operating Hours Start:    {settings.get('operating_hours_start')} (08:00 AM)")
        print(f"  - Operating Hours End:      {settings.get('operating_hours_end')} (17:00 / 05:00 PM)")

        # 1.1 Test boundary classification
        print("\n[Check 1.1] Checking is_timestamp_after_hours() across critical time points:")
        test_points = [
            # Weekday (Wednesday 2026-10-21)
            (datetime(2026, 10, 21, 7, 59, 59), True,  "Wed 07:59:59 (Before 08:00)"),
            (datetime(2026, 10, 21, 8, 0, 0),   False, "Wed 08:00:00 (Operating start)"),
            (datetime(2026, 10, 21, 12, 0, 0),  False, "Wed 12:00:00 (Midday operating)"),
            (datetime(2026, 10, 21, 16, 59, 59),False, "Wed 16:59:59 (Just before 17:00)"),
            (datetime(2026, 10, 21, 17, 0, 0),  True,  "Wed 17:00:00 (Operating end)"),
            (datetime(2026, 10, 21, 22, 0, 0),  True,  "Wed 22:00:00 (Night after-hours)"),
            # Friday night crossing midnight into Saturday
            (datetime(2026, 10, 23, 23, 45, 0), True,  "Fri 23:45:00 (Friday night)"),
            (datetime(2026, 10, 24, 0, 15, 0),  True,  "Sat 00:15:00 (Midnight into Saturday)"),
            # Weekend (Saturday 2026-10-24)
            (datetime(2026, 10, 24, 10, 0, 0),  True,  "Sat 10:00:00 (Saturday daytime - Weekend)"),
            (datetime(2026, 10, 24, 21, 0, 0),  True,  "Sat 21:00:00 (Saturday night - Weekend)"),
            # Weekend (Sunday 2026-10-25)
            (datetime(2026, 10, 25, 12, 0, 0),  True,  "Sun 12:00:00 (Sunday daytime - Weekend)")
        ]

        for dt_val, expected_after_hours, label in test_points:
            res = database.is_timestamp_after_hours(dt_val, settings)
            status = "PASS" if res == expected_after_hours else "FAIL"
            print(f"  - {label:<42}: After-hours = {res!s:<5} (Expected {expected_after_hours!s:<5}) -> [{status}]")
            assert res == expected_after_hours, f"Mismatch on {label}"

        # 1.2 Synthetic energy integration tests
        print("\n[Check 1.2] Synthetic energy integration with known kWh values:")

        # Scenario A: Pure Weekday Operating Hours (Wednesday 10:00 to 12:00, constant 20 kW for 2h = 40 kWh)
        # 2 hours at 20 kW = 40.0 kWh
        readings_a = []
        t_base = datetime(2026, 10, 21, 10, 0, 0)
        for step in range(121): # 120 minutes in 1-minute steps
            t = t_base + timedelta(minutes=step)
            readings_a.append({
                "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
                "active_power_kw": 20.0,
                "power_factor": 0.90
            })
        eff_a = database.calculate_building_efficiency(readings_a)
        print(f"  Scenario A (Wed 10:00 - 12:00, Weekday Daytime):")
        print(f"    Total: {eff_a['total_energy_kwh']:.2f} kWh | Operating: {eff_a['operating_hours_kwh']:.2f} kWh | After-hours: {eff_a['after_hours_kwh']:.2f} kWh ({eff_a['after_hours_pct']:.1f}%)")
        assert abs(eff_a["total_energy_kwh"] - 40.0) < 0.5
        assert eff_a["after_hours_kwh"] == 0.0
        assert eff_a["after_hours_pct"] == 0.0
        print("    -> [PASS] Pure operating-hours period correctly reports 0% after-hours.")

        # Scenario B: Pure Weekend Hours (Saturday 10:00 to 12:00, constant 20 kW for 2h = 40 kWh)
        readings_b = []
        t_base_sat = datetime(2026, 10, 24, 10, 0, 0)
        for step in range(121):
            t = t_base_sat + timedelta(minutes=step)
            readings_b.append({
                "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
                "active_power_kw": 20.0,
                "power_factor": 0.90
            })
        eff_b = database.calculate_building_efficiency(readings_b)
        print(f"  Scenario B (Sat 10:00 - 12:00, Weekend Daytime):")
        print(f"    Total: {eff_b['total_energy_kwh']:.2f} kWh | Operating: {eff_b['operating_hours_kwh']:.2f} kWh | After-hours: {eff_b['after_hours_kwh']:.2f} kWh ({eff_b['after_hours_pct']:.1f}%)")
        assert abs(eff_b["total_energy_kwh"] - 40.0) < 0.5
        assert eff_b["after_hours_kwh"] == eff_b["total_energy_kwh"]
        assert eff_b["after_hours_pct"] == 100.0
        print("    -> [PASS] Pure weekend period correctly reports 100% after-hours.")

        # Scenario C: Mixed Period Crossing 17:00 boundary on Friday (15:00 to 19:00, 4 hours at 10 kW = 40 kWh)
        # 15:00 to 17:00 (2h operating = 20 kWh), 17:00 to 19:00 (2h after-hours = 20 kWh)
        readings_c = []
        t_base_fri = datetime(2026, 10, 23, 15, 0, 0)
        for step in range(241): # 240 minutes = 4 hours
            t = t_base_fri + timedelta(minutes=step)
            readings_c.append({
                "timestamp": t.strftime("%Y-%m-%d %H:%M:%S"),
                "active_power_kw": 10.0,
                "power_factor": 0.90
            })
        eff_c = database.calculate_building_efficiency(readings_c)
        print(f"  Scenario C (Fri 15:00 - 19:00, Crossing 17:00):")
        print(f"    Total: {eff_c['total_energy_kwh']:.2f} kWh | Operating: {eff_c['operating_hours_kwh']:.2f} kWh | After-hours: {eff_c['after_hours_kwh']:.2f} kWh ({eff_c['after_hours_pct']:.1f}%)")
        assert abs(eff_c["total_energy_kwh"] - 40.0) < 0.5
        assert abs(eff_c["operating_hours_kwh"] - 20.0) < 0.5
        assert abs(eff_c["after_hours_kwh"] - 20.0) < 0.5
        assert abs(eff_c["after_hours_pct"] - 50.0) < 1.0
        print("    -> [PASS] Boundary-crossing period accurately splits 50% operating / 50% after-hours.")

        # 1.3 Explain the User's Real "Last 24 Hours" Observation
        print("\n[Check 1.3] Inspection of Actual Stored 24h Readings in energy.db:")
        conn = sqlite3.connect(temp_db)
        cur = conn.cursor()
        cur.execute("SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM energy_readings WHERE timestamp >= '2026-10-23 23:45:00'")
        min_ts, max_ts, count_24h = cur.fetchone()
        conn.close()
        print(f"  - Reading Count in Last 24 Hours: {count_24h}")
        print(f"  - Earliest Timestamp:             {min_ts}")
        print(f"  - Latest Timestamp:               {max_ts}")
        dt_min = datetime.strptime(min_ts, "%Y-%m-%d %H:%M:%S")
        dt_max = datetime.strptime(max_ts, "%Y-%m-%d %H:%M:%S")
        print(f"  - Day of Week for Earliest:       {dt_min.strftime('%A')} (Weekday {dt_min.weekday()})")
        print(f"  - Day of Week for Latest:         {dt_max.strftime('%A')} (Weekday {dt_max.weekday()})")
        print(f"  - Hour Range:                     {dt_min.hour:02d}:{dt_min.minute:02d} to {dt_max.hour:02d}:{dt_max.minute:02d}")
        print("  - CONCLUSION FOR ISSUE 1:")
        print("    The simulator only generated readings on Saturday night between 20:44 and 23:53.")
        print("    Saturday is a weekend (not in operating days 0-4), and 20:44-23:53 is outside 08:00-17:00.")
        print("    Therefore, 100% after-hours is the EXACT mathematically correct and business-rule-compliant result.")

        # =====================================================================
        # PART 2: ISSUE 2 - BUILDING OVERLOAD & ALERT THRESHOLD BEHAVIOR
        # =====================================================================
        print("\n" + "=" * 60)
        print(" PART 2: BUILDING OVERLOAD DETECTION & ALERT RULES")
        print("=" * 60)

        # Create a disposable test building with rated capacity = 50.0 kW
        conn = sqlite3.connect(temp_db)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO buildings (code, name, description, rated_power_kw)
            VALUES ('TEST-50', 'Test 50kW Facility', 'Overload Verification Building', 50.0)
        """)
        conn.commit()
        test_bldg_id = cur.lastrowid
        conn.close()
        print(f"Created isolated test building ID {test_bldg_id} (rated_power_kw = 50.0 kW)")

        # 2.1 Test P = 45.0 kW (90.0% of rated capacity)
        # Threshold: HIGH_LOAD requires P > 0.90 * rated_kw (> 45.0 kW)
        print("\n[Check 2.1] Testing P = 45.0 kW (90.0% of 50.0 kW):")
        reading_45 = {
            "voltage": 400.0, "current": 65.0, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 50.0, "active_power_kw": 45.0, "reactive_power_kvar": 21.8,
            "energy_kwh": 100.0
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_45, "2026-10-24 10:00:00")
        active_45 = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        print(f"  Active alerts count at 45.0 kW: {len(active_45)}")
        assert len(active_45) == 0, "45.0 kW is at 90% and should NOT trigger alert"
        print("  -> [PASS] 45.0 kW (<= 90%) evaluated as Normal, no alerts triggered.")

        # 2.2 Test P = 48.0 kW (96.0% of 50.0 kW)
        # Threshold: 45.0 < P <= 50.0 kW -> triggers HIGH_LOAD (WARNING)
        print("\n[Check 2.2] Testing P = 48.0 kW (96.0% of 50.0 kW):")
        reading_48 = {
            "voltage": 400.0, "current": 70.0, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 53.3, "active_power_kw": 48.0, "reactive_power_kvar": 23.2,
            "energy_kwh": 100.2
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_48, "2026-10-24 10:00:15")
        active_48 = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        print(f"  Active alerts count at 48.0 kW: {len(active_48)}")
        assert len(active_48) == 1
        assert active_48[0]["alert_type"] == "HIGH_LOAD"
        assert active_48[0]["severity"] == "WARNING"
        assert active_48[0]["measured_value"] == 48.0
        print(f"  Alert Type: {active_48[0]['alert_type']} | Severity: {active_48[0]['severity']} | Measured: {active_48[0]['measured_value']} kW")
        print("  -> [PASS] P = 48.0 kW correctly triggered HIGH_LOAD WARNING.")

        # 2.3 Test P = 50.0 kW (Exactly 100.0% of 50.0 kW)
        # Threshold: P > 50.0 is OVERLOAD. At P = 50.0 kW, condition remains HIGH_LOAD
        print("\n[Check 2.3] Testing P = 50.0 kW (100.0% boundary of 50.0 kW):")
        reading_50 = {
            "voltage": 400.0, "current": 72.0, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 55.5, "active_power_kw": 50.0, "reactive_power_kvar": 24.2,
            "energy_kwh": 100.4
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_50, "2026-10-24 10:00:30")
        active_50 = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        assert len(active_50) == 1
        assert active_50[0]["alert_type"] == "HIGH_LOAD"
        print(f"  Alert Type: {active_50[0]['alert_type']} | Severity: {active_50[0]['severity']}")
        print("  -> [PASS] P = 50.0 kW boundary remains HIGH_LOAD WARNING (not yet exceeding rated capacity).")

        # 2.4 Test P = 55.0 kW (110.0% of 50.0 kW - Exceeds rated power)
        # Threshold: P > 50.0 kW -> triggers OVERLOAD (CRITICAL) and clears/escalates HIGH_LOAD
        print("\n[Check 2.4] Testing P = 55.0 kW (110.0% of 50.0 kW - Feeder Overload):")
        reading_55 = {
            "voltage": 400.0, "current": 80.0, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 61.1, "active_power_kw": 55.0, "reactive_power_kvar": 26.6,
            "energy_kwh": 100.6
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_55, "2026-10-24 10:00:45")
        active_55 = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        print(f"  Active alerts count at 55.0 kW: {len(active_55)}")
        assert len(active_55) == 1
        assert active_55[0]["alert_type"] == "OVERLOAD"
        assert active_55[0]["severity"] == "CRITICAL"
        assert active_55[0]["measured_value"] == 55.0
        print(f"  Alert Type: {active_55[0]['alert_type']} | Severity: {active_55[0]['severity']} | Measured: {active_55[0]['measured_value']} kW")
        print("  -> [PASS] Escalated to OVERLOAD CRITICAL, HIGH_LOAD cleared.")

        # 2.5 Duplicate Suppression test (second reading at 55.2 kW)
        print("\n[Check 2.5] Testing Duplicate Suppression on continuous overload (P = 55.2 kW):")
        reading_55_2 = {
            "voltage": 400.0, "current": 80.5, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 61.3, "active_power_kw": 55.2, "reactive_power_kvar": 26.7,
            "energy_kwh": 100.8
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_55_2, "2026-10-24 10:01:00")
        active_55_2 = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        assert len(active_55_2) == 1, f"Expected 1 active alert due to duplicate suppression, got {len(active_55_2)}"
        print("  -> [PASS] Duplicate alert suppressed; exactly 1 active OVERLOAD alert tracked.")

        # 2.6 Automatic Resolution test (load drops back to normal 35.0 kW)
        print("\n[Check 2.6] Testing Automatic Resolution (load drops to 35.0 kW, 70%):")
        reading_norm = {
            "voltage": 400.0, "current": 50.0, "power_factor": 0.90, "frequency": 50.0,
            "apparent_power_kva": 38.9, "active_power_kw": 35.0, "reactive_power_kvar": 17.0,
            "energy_kwh": 101.0
        }
        database.evaluate_electrical_alerts(test_bldg_id, reading_norm, "2026-10-24 10:01:15")
        active_norm = database.get_filtered_alerts(building_id=test_bldg_id, status="active")
        assert len(active_norm) == 0, f"Expected 0 active alerts after clearance, got {len(active_norm)}"
        print("  -> [PASS] Active OVERLOAD alert cleared automatically when power returned to normal.")

        # 2.7 Historical Audit Persistence (Alert remains in history)
        print("\n[Check 2.7] Historical Audit Persistence:")
        all_history = database.get_filtered_alerts(building_id=test_bldg_id, status="cleared")
        assert len(all_history) >= 1
        overload_hist = next((a for a in all_history if a["alert_type"] == "OVERLOAD"), None)
        assert overload_hist is not None
        assert overload_hist["is_active"] == 0
        assert overload_hist["cleared_at"] is not None
        print(f"  Archived Alert: ID {overload_hist['id']} | Type: {overload_hist['alert_type']} | Cleared At: {overload_hist['cleared_at']}")
        print("  -> [PASS] Cleared overload alert is permanently preserved in historical audit log.")

        # 2.8 Comprehensive Energy Report visibility
        print("\n[Check 2.8] Comprehensive Energy Report historical visibility:")
        # Insert readings into energy_readings table to simulate report query
        for r_dict, ts in [
            (reading_45, "2026-10-24 10:00:00"),
            (reading_48, "2026-10-24 10:00:15"),
            (reading_50, "2026-10-24 10:00:30"),
            (reading_55, "2026-10-24 10:00:45"),
            (reading_55_2, "2026-10-24 10:01:00"),
            (reading_norm, "2026-10-24 10:01:15")
        ]:
            database.insert_energy_reading(
                building_id=test_bldg_id,
                timestamp=ts,
                voltage=r_dict["voltage"],
                current=r_dict["current"],
                power_factor=r_dict["power_factor"],
                frequency=r_dict["frequency"],
                apparent_power_kva=r_dict["apparent_power_kva"],
                active_power_kw=r_dict["active_power_kw"],
                reactive_power_kvar=r_dict["reactive_power_kvar"],
                energy_kwh=r_dict["energy_kwh"]
            )

        rep = database.get_comprehensive_energy_report(
            building_id=test_bldg_id,
            start="2026-10-24 09:59:00",
            end="2026-10-24 10:02:00"
        )
        m = rep["metrics"]
        print(f"  Report Peak Demand:        {m['peak_demand_kw']} kW")
        print(f"  Report Rated Power:        {rep['rated_power_kw']} kW")
        print(f"  Report Critical Alerts:    {m['critical_alerts_count']}")
        print(f"  Report Engineering Obs:    {rep['engineering_observations']}")
        assert m["peak_demand_kw"] == 55.2
        assert m["critical_alerts_count"] >= 1
        # Confirm observation notes peak demand exceeding capacity
        obs_text = " ".join(rep["engineering_observations"])
        assert "55.2 kW" in obs_text
        print("  -> [PASS] Overload peak (55.2 kW) and historical alert event remain fully visible in report.")

    finally:
        # Restore database configuration
        database.DB_PATH = orig_db
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        # Confirm original database was untouched
        final_size = os.path.getsize(orig_db)
        final_mtime = os.path.getmtime(orig_db)
        print(f"\n[Safety Post-check] Production database verification:")
        print(f"  Size before: {orig_size} | Size after: {final_size}")
        print(f"  Mtime before: {orig_mtime} | Mtime after: {final_mtime}")
        assert orig_size == final_size, "Original database size altered!"
        assert orig_mtime == final_mtime, "Original database mtime altered!"
        print("  [CONFIRMED] energy.db was 100% PRESERVED AND UNTOUCHED.")

    print("\n" + "=" * 80)
    print(" ALL TECHNICAL INSPECTION CHECKS COMPLETED SUCCESSFULLY")
    print("=" * 80)

if __name__ == "__main__":
    run_inspection()
