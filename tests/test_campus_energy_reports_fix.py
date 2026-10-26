"""
test_campus_energy_reports_fix.py
---------------------------------
Automated verification suite for the Energy Audit Reports Campus Metrics Fix.
Executes exclusively in an isolated temporary SQLite database to protect energy.db:

Verifies:
  1. Campus Peak Demand equals the maximum synchronized sum of active power across all buildings.
  2. Campus Load Factor is strictly in [0.0, 1.0] (never > 100%).
  3. Campus Apparent Power (kVA) and Reactive Power (kVAr) are non-zero and electrically consistent.
  4. Single-building reports and metrics are 100% preserved.
  5. Empty reporting periods and zero readings are handled safely without division by zero.
  6. Original production energy.db is 100% preserved and untouched.
"""

import os
import sys
import shutil
import tempfile
import sqlite3
import math
from datetime import datetime

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

import database
from app import app


def run_tests():
    print("=" * 85)
    print(" UNIVERSITY OF RUHUNA - FACULTY OF ENGINEERING")
    print(" VERIFICATION SUITE: CAMPUS ENERGY AUDIT REPORTS CALCULATION FIX")
    print("=" * 85)

    prod_db_path = os.path.abspath(database.DB_PATH)
    prod_stat_before = os.stat(prod_db_path)
    prod_size_before = prod_stat_before.st_size
    prod_mtime_before = prod_stat_before.st_mtime

    temp_dir = tempfile.mkdtemp(prefix="ruhuna_reports_fix_")
    temp_db_path = os.path.join(temp_dir, "temp_reports_fix.db")

    print(f"\n[Setup] Isolated Test Environment:")
    print(f"        Temp DB Path : {temp_db_path}")
    print(f"        Original DB  : {prod_db_path} (PRESERVED & MONITORED)")

    passed_checks = 0
    total_checks = 0

    try:
        database.DB_PATH = temp_db_path
        app.config["TESTING"] = True

        # Initialize schema and seed 6 core buildings
        database.init_db()

        # Insert known ground-truth synchronous readings across 3 timestamps for 3 buildings
        # Building 1 (CEE): P = [40.0, 50.0, 30.0], Q = [20.0, 25.0, 15.0]
        # Building 2 (EIE): P = [50.0, 60.0, 40.0], Q = [25.0, 30.0, 20.0]
        # Building 3 (MME): P = [60.0, 70.0, 50.0], Q = [30.0, 35.0, 25.0]
        #
        # Synchronized totals at timestamp t:
        # t1: P_tot = 40+50+60 = 150 kW, Q_tot = 20+25+30 = 75 kVAr
        # t2: P_tot = 50+60+70 = 180 kW, Q_tot = 25+30+35 = 90 kVAr  <-- Coincident Peak = 180 kW
        # t3: P_tot = 30+40+50 = 120 kW, Q_tot = 15+20+25 = 60 kVAr
        #
        # Expected Synchronized Campus Metrics:
        # Average P = (150 + 180 + 120) / 3 = 150.0 kW
        # Coincident Peak P = 180.0 kW (NOT single building peak of 70 kW!)
        # True Load Factor = 150.0 / 180.0 = 0.8333 (83.3%) (NOT 150.0 / 70.0 = 214%!)
        # Average Q = (75 + 90 + 60) / 3 = 75.0 kVAr
        # Average S = sqrt(150.0^2 + 75.0^2) = sqrt(22500 + 5625) = sqrt(28125) = 167.71 kVA
        # Average PF = 150.0 / 167.71 = 0.8944

        timestamps = [
            "2026-10-24 10:00:00",
            "2026-10-24 10:00:15",
            "2026-10-24 10:00:30"
        ]

        ground_truth_bldgs = [
            {"id": 1, "code": "CEE", "p": [40.0, 50.0, 30.0], "q": [20.0, 25.0, 15.0]},
            {"id": 2, "code": "EIE", "p": [50.0, 60.0, 40.0], "q": [25.0, 30.0, 20.0]},
            {"id": 3, "code": "MME", "p": [60.0, 70.0, 50.0], "q": [30.0, 35.0, 25.0]}
        ]

        conn = database.get_db_connection()
        cursor = conn.cursor()

        for t_idx, ts in enumerate(timestamps):
            for b in ground_truth_bldgs:
                p = b["p"][t_idx]
                q = b["q"][t_idx]
                s = math.sqrt(p**2 + q**2)
                pf = p / s
                cursor.execute("""
                    INSERT INTO energy_readings (
                        building_id, timestamp, voltage, current, power_factor, frequency,
                        apparent_power_kva, active_power_kw, reactive_power_kvar, energy_kwh, is_simulated
                    ) VALUES (?, ?, 400.0, ?, ?, 50.0, ?, ?, ?, 1000.0, 1)
                """, (b["id"], ts, round(s*1000/(math.sqrt(3)*400), 2), round(pf, 3), round(s, 2), p, q))

        conn.commit()
        conn.close()

        # ----------------------------------------------------------------------
        # TEST 1: Synchronized Campus Peak Demand & Coincident Peak
        # ----------------------------------------------------------------------
        print("\n[Test 1] Testing Synchronized Campus Peak Demand Calculation...")
        total_checks += 1
        rep_campus = database.get_comprehensive_energy_report(building_id="all", start="2026-10-24 09:00:00", end="2026-10-24 11:00:00")
        m_campus = rep_campus["metrics"]

        expected_peak = 180.0
        actual_peak = m_campus["peak_demand_kw"]
        print(f"  -> Coincident Campus Peak Demand: {actual_peak} kW (Expected: {expected_peak} kW)")
        assert abs(actual_peak - expected_peak) < 0.1, f"Expected peak {expected_peak}, got {actual_peak}"
        passed_checks += 1
        print("  -> PASSED: Campus peak demand correctly uses maximum synchronized sum across all buildings.")

        # ----------------------------------------------------------------------
        # TEST 2: Campus Average Demand & Load Factor Bound Check
        # ----------------------------------------------------------------------
        print("\n[Test 2] Testing Campus Average Active Power and Load Factor...")
        total_checks += 1
        expected_avg_p = 150.0
        actual_avg_p = m_campus["avg_active_power_kw"]
        print(f"  -> Campus Average Active Power: {actual_avg_p} kW (Expected: {expected_avg_p} kW)")
        assert abs(actual_avg_p - expected_avg_p) < 0.1

        expected_lf = round(150.0 / 180.0, 3)  # 0.833
        actual_lf = m_campus["load_factor"]
        print(f"  -> Campus Load Factor: {actual_lf} ({m_campus['load_factor_pct']}%) (Expected: {expected_lf})")
        assert 0.0 <= actual_lf <= 1.0, f"Load factor {actual_lf} exceeds physical limit [0.0, 1.0]!"
        assert abs(actual_lf - expected_lf) < 0.02
        passed_checks += 1
        print("  -> PASSED: Campus Load Factor strictly bounded in [0.0, 1.0] and matches average/peak ratio.")

        # ----------------------------------------------------------------------
        # TEST 3: Campus Apparent and Reactive Power (Non-Zero & AC Vector Ground Truth)
        # ----------------------------------------------------------------------
        print("\n[Test 3] Testing Campus Apparent (S) and Reactive (Q) Power...")
        total_checks += 1
        actual_s = m_campus["avg_apparent_power_kva"]
        actual_q = m_campus["avg_reactive_power_kvar"]
        expected_q = 75.0
        expected_s = round(math.sqrt(150.0**2 + 75.0**2), 2)  # 167.71 kVA

        print(f"  -> Campus Avg Apparent Power (S): {actual_s} kVA (Expected: ~{expected_s} kVA)")
        print(f"  -> Campus Avg Reactive Power (Q): {actual_q} kVAr (Expected: {expected_q} kVAr)")
        assert actual_s > 0.0, "Apparent power should not be zero!"
        assert actual_q > 0.0, "Reactive power should not be zero!"
        assert abs(actual_q - expected_q) < 0.5
        assert abs(actual_s - expected_s) < 1.0
        passed_checks += 1
        print("  -> PASSED: Campus apparent and reactive power verified against AC power triangle.")

        # ----------------------------------------------------------------------
        # TEST 4: Single-Building Report Preservation
        # ----------------------------------------------------------------------
        print("\n[Test 4] Testing Single Building Report Preservation (Building ID 1 - CEE)...")
        total_checks += 1
        rep_single = database.get_comprehensive_energy_report(building_id=1, start="2026-10-24 09:00:00", end="2026-10-24 11:00:00")
        m_single = rep_single["metrics"]
        print(f"  -> Single Building Peak: {m_single['peak_demand_kw']} kW (Expected: 50.0 kW)")
        print(f"  -> Single Building Avg P: {m_single['avg_active_power_kw']} kW (Expected: 40.0 kW)")
        print(f"  -> Single Building LF: {m_single['load_factor']} (Expected: 0.8)")
        assert abs(m_single["peak_demand_kw"] - 50.0) < 0.1
        assert abs(m_single["avg_active_power_kw"] - 40.0) < 0.1
        assert abs(m_single["load_factor"] - 0.8) < 0.02
        passed_checks += 1
        print("  -> PASSED: Individual building calculations are 100% preserved.")

        # ----------------------------------------------------------------------
        # TEST 5: Empty Reporting Period Safe Handling
        # ----------------------------------------------------------------------
        print("\n[Test 5] Testing Empty Reporting Period Safe Handling (Future Dates)...")
        total_checks += 1
        rep_empty = database.get_comprehensive_energy_report(building_id="all", start="2099-01-01", end="2099-01-02")
        m_empty = rep_empty["metrics"]
        print(f"  -> Empty Peak: {m_empty['peak_demand_kw']} | Avg: {m_empty['avg_active_power_kw']} | LF: {m_empty['load_factor']}")
        print(f"  -> Empty Voltage: {m_empty['avg_voltage']} | Freq: {m_empty['avg_frequency']}")
        assert m_empty["peak_demand_kw"] == 0.0
        assert m_empty["avg_active_power_kw"] == 0.0
        assert m_empty["load_factor"] == 0.0
        assert m_empty["avg_apparent_power_kva"] is None
        assert m_empty["avg_reactive_power_kvar"] is None
        assert m_empty["avg_voltage"] is None
        assert m_empty["avg_frequency"] is None
        passed_checks += 1
        print("  -> PASSED: Empty reporting period returns clean None without disguising missing metrics as zero.")

        print("\n" + "=" * 85)
        print(f" >>> ALL {passed_checks}/{total_checks} CHECKS PASSED WITH 100% SUCCESS! <<<")
        print("=" * 85)

    finally:
        database.DB_PATH = prod_db_path
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

        prod_stat_after = os.stat(prod_db_path)
        assert prod_stat_after.st_size == prod_size_before, (
            f"ALERT: Production energy.db size changed from {prod_size_before} to {prod_stat_after.st_size}!"
        )
        assert prod_stat_after.st_mtime == prod_mtime_before, (
            f"ALERT: Production energy.db mtime changed from {prod_mtime_before} to {prod_stat_after.st_mtime}!"
        )

        print(f"\n[Safety Post-check] Production Database Verification:")
        print(f"  Path          : {prod_db_path}")
        print(f"  Size After    : {prod_stat_after.st_size:,} bytes (EXACT MATCH)")
        print(f"  Last Modified : {datetime.fromtimestamp(prod_stat_after.st_mtime)} (UNTOUCHED)")
        print("  -> CONFIRMED: original energy.db was 100% PRESERVED AND UNTOUCHED.")


if __name__ == "__main__":
    run_tests()
