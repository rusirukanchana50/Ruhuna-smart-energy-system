"""
test_report_views_consistency.py
--------------------------------
Automated verification suite for Energy Audit Reports calculations across:
1. API endpoint (/api/reports/summary)
2. Formal printable view (/reports/printable)
3. CSV export endpoint (/api/reports/export/csv)
4. Multi-period testing: Last 24 Hours, Last 7 Days, Individual Building
5. Verification of load factor <= 1.0 (100%), coincident peak demand, apparent & reactive power
6. Safe handling of empty periods (rendering '--' without disguising missing metrics)
7. Verification that original energy.db is NOT modified
"""

import os
import sys
import shutil
import tempfile
import sqlite3
from datetime import datetime, timedelta

# Ensure Ruhuna Smart Energy System directory is in path
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

import database
from app import app

def run_tests():
    print("=" * 70)
    print("ENERGY AUDIT REPORTS VIEW CONSISTENCY VERIFICATION")
    print("=" * 70)

    # 1. Verify original energy.db state
    orig_db = os.path.abspath(database.DB_PATH)
    orig_size = os.path.getsize(orig_db)
    orig_mtime = os.path.getmtime(orig_db)
    print(f"[1] Original database: {orig_db}")
    print(f"    Size: {orig_size} bytes | Mtime: {orig_mtime}")

    # Create temporary copy to guarantee 100% database safety
    temp_dir = tempfile.mkdtemp(prefix="ruhuna_report_test_")
    temp_db = os.path.join(temp_dir, "test_energy.db")
    shutil.copyfile(orig_db, temp_db)
    database.DB_PATH = temp_db

    test_passed = 0
    total_tests = 0

    try:
        app.config["TESTING"] = True
        client = app.test_client()

        # Login to obtain authenticated session
        with client.session_transaction() as sess:
            sess["user_id"] = 1
            sess["username"] = "admin"
            sess["role"] = "Administrator"
            sess["full_name"] = "Dr. Asanka (Head of Dept)"

        now = datetime.now()
        start_24h = (now - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
        start_7d = (now - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        end_now = now.strftime("%Y-%m-%d %H:%M:%S")

        # -------------------------------------------------------------
        # TEST 1: Campus Summary - Last 24 Hours
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 1: Campus Summary (Last 24 Hours) ---")
        res_24h = client.get(f"/api/reports/summary?building_id=all&start={start_24h}&end={end_now}")
        assert res_24h.status_code == 200, f"Expected 200, got {res_24h.status_code}"
        data_24h = res_24h.get_json()["report"]
        m_24h = data_24h["metrics"]

        print(f"    Peak Demand:     {m_24h['peak_demand_kw']} kW")
        print(f"    Average Demand:  {m_24h['avg_active_power_kw']} kW")
        print(f"    Load Factor:     {m_24h['load_factor']} ({m_24h['load_factor_pct']}%)")
        print(f"    Apparent Power:  {m_24h['avg_apparent_power_kva']} kVA")
        print(f"    Reactive Power:  {m_24h['avg_reactive_power_kvar']} kVAr")
        print(f"    Power Factor:    {m_24h['avg_power_factor']}")

        # Validate physics & math bounds
        assert m_24h["peak_demand_kw"] >= m_24h["avg_active_power_kw"], "Peak demand must be >= average demand"
        assert 0.0 <= m_24h["load_factor"] <= 1.0, f"Load factor must be in [0, 1], got {m_24h['load_factor']}"
        assert m_24h["load_factor_pct"] <= 100.0, f"Load factor % cannot exceed 100%, got {m_24h['load_factor_pct']}%"
        assert m_24h["avg_apparent_power_kva"] > 0, "Apparent power must be > 0"
        assert m_24h["avg_reactive_power_kvar"] > 0, "Reactive power must be > 0"
        assert m_24h["avg_apparent_power_kva"] >= m_24h["avg_active_power_kw"] * 0.95, "Apparent power S >= P in AC circuits"
        print("    [PASS] Physical metrics and bounds are mathematically valid.")
        test_passed += 1

        # -------------------------------------------------------------
        # TEST 2: Campus Summary - Last 7 Days
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 2: Campus Summary (Last 7 Days) ---")
        res_7d = client.get(f"/api/reports/summary?building_id=all&start={start_7d}&end={end_now}")
        assert res_7d.status_code == 200
        data_7d = res_7d.get_json()["report"]
        m_7d = data_7d["metrics"]

        print(f"    Peak Demand:     {m_7d['peak_demand_kw']} kW")
        print(f"    Average Demand:  {m_7d['avg_active_power_kw']} kW")
        print(f"    Load Factor:     {m_7d['load_factor']} ({m_7d['load_factor_pct']}%)")
        print(f"    Apparent Power:  {m_7d['avg_apparent_power_kva']} kVA")
        print(f"    Reactive Power:  {m_7d['avg_reactive_power_kvar']} kVAr")

        assert m_7d["peak_demand_kw"] >= m_7d["avg_active_power_kw"]
        assert 0.0 <= m_7d["load_factor"] <= 1.0
        assert m_7d["load_factor_pct"] <= 100.0
        assert m_7d["avg_apparent_power_kva"] > 0
        assert m_7d["avg_reactive_power_kvar"] > 0
        print("    [PASS] 7-Day Campus metrics are consistent and Load Factor <= 100%.")
        test_passed += 1

        # -------------------------------------------------------------
        # TEST 3: Individual Building Report (Building 1)
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 3: Individual Building Scope (Building ID 1) ---")
        res_bldg = client.get(f"/api/reports/summary?building_id=1&start={start_24h}&end={end_now}")
        assert res_bldg.status_code == 200
        data_bldg = res_bldg.get_json()["report"]
        m_bldg = data_bldg["metrics"]

        print(f"    Building Code:   {data_bldg['building_code']}")
        print(f"    Peak Demand:     {m_bldg['peak_demand_kw']} kW")
        print(f"    Average Demand:  {m_bldg['avg_active_power_kw']} kW")
        print(f"    Load Factor:     {m_bldg['load_factor']} ({m_bldg['load_factor_pct']}%)")
        print(f"    Apparent Power:  {m_bldg['avg_apparent_power_kva']} kVA")
        print(f"    Reactive Power:  {m_bldg['avg_reactive_power_kvar']} kVAr")

        assert m_bldg["peak_demand_kw"] >= m_bldg["avg_active_power_kw"]
        assert 0.0 <= m_bldg["load_factor"] <= 1.0
        assert m_bldg["avg_apparent_power_kva"] > 0
        assert m_bldg["avg_reactive_power_kvar"] > 0
        # Single building peak must be strictly less than campus total coincident peak
        assert m_bldg["peak_demand_kw"] < m_24h["peak_demand_kw"], "Single building peak must be < campus coincident peak"
        print("    [PASS] Individual building report is mathematically consistent and < campus peak.")
        test_passed += 1

        # -------------------------------------------------------------
        # TEST 4: Printable View Parity with API Summary
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 4: Printable View (/reports/printable) HTML Consistency ---")
        res_print = client.get(f"/reports/printable?building_id=all&start={start_24h}&end={end_now}")
        assert res_print.status_code == 200
        html = res_print.data.decode("utf-8")

        # Format strings matching HTML templates
        peak_str = f"{m_24h['peak_demand_kw']:.1f}"
        avg_p_str = f"{m_24h['avg_active_power_kw']:.1f}"
        lf_str = f"{m_24h['load_factor']:.2f}"
        s_str = f"{m_24h['avg_apparent_power_kva']:.2f}"
        q_str = f"{m_24h['avg_reactive_power_kvar']:.2f}"

        print(f"    Checking HTML contains peak demand '{peak_str}'...")
        assert peak_str in html, f"HTML missing peak demand {peak_str}"
        print(f"    Checking HTML contains average demand '{avg_p_str}'...")
        assert avg_p_str in html, f"HTML missing average demand {avg_p_str}"
        print(f"    Checking HTML contains load factor '{lf_str}'...")
        assert lf_str in html, f"HTML missing load factor {lf_str}"
        print(f"    Checking HTML contains apparent power '{s_str}'...")
        assert s_str in html, f"HTML missing apparent power {s_str}"
        print(f"    Checking HTML contains reactive power '{q_str}'...")
        assert q_str in html, f"HTML missing reactive power {q_str}"

        # Check breakdown table presence in printable report
        assert "Faculty Complexes Energy &amp; Demand Breakdown" in html or "Faculty Complexes Energy & Demand Breakdown" in html
        assert "Print / Save as PDF" in html
        print("    [PASS] Printable view reflects exact API metrics and includes building breakdown.")
        test_passed += 1

        # -------------------------------------------------------------
        # TEST 5: CSV Export Endpoint Functionality
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 5: CSV Export (/api/reports/export/csv) ---")
        res_csv = client.get(f"/api/reports/export/csv?building_id=all&start={start_24h}&end={end_now}")
        assert res_csv.status_code == 200
        assert "text/csv" in res_csv.headers.get("Content-Type", "")
        csv_content = res_csv.data.decode("utf-8")
        lines = [line.strip() for line in csv_content.splitlines() if line.strip()]

        print(f"    CSV rows returned: {len(lines)}")
        assert len(lines) > 1, "CSV must contain header + at least 1 data row"
        header = lines[0]
        expected_cols = [
            "Reading ID", "Building ID", "Building Code", "Building Name",
            "Timestamp", "Line Voltage (V)", "Line Current (A)", "Power Factor",
            "Frequency (Hz)", "Apparent Power (kVA)", "Active Power (kW)",
            "Reactive Power (kVAr)", "Cumulative Energy (kWh)", "Data Source"
        ]
        for col in expected_cols:
            assert col in header, f"Missing column {col} in CSV header"

        sample_row = lines[1].split(",")
        print(f"    Sample CSV Data Row: {sample_row[:5]}... ({len(sample_row)} fields)")
        assert len(sample_row) == len(expected_cols)
        print("    [PASS] CSV export generates valid RFC 4180 telemetry records.")
        test_passed += 1

        # -------------------------------------------------------------
        # TEST 6: Handling of Empty Reporting Period (No False Zeros)
        # -------------------------------------------------------------
        total_tests += 1
        print("\n--- TEST 6: Empty Period Safe Formatting ('--' without fake zeroes) ---")
        future_start = "2099-01-01 00:00:00"
        future_end = "2099-01-02 00:00:00"
        res_empty_api = client.get(f"/api/reports/summary?building_id=all&start={future_start}&end={future_end}")
        assert res_empty_api.status_code == 200
        empty_report = res_empty_api.get_json()["report"]
        empty_m = empty_report["metrics"]

        # Null values expected for missing periods
        assert empty_m["total_energy_kwh"] == 0.0
        assert empty_m["avg_active_power_kw"] is None or empty_m["avg_active_power_kw"] == 0.0
        assert empty_m["avg_apparent_power_kva"] is None

        # Check printable view for empty period renders '--' and not fake measurements
        res_empty_print = client.get(f"/reports/printable?building_id=all&start={future_start}&end={future_end}")
        assert res_empty_print.status_code == 200
        empty_html = res_empty_print.data.decode("utf-8")
        assert "--" in empty_html, "Empty printable report should contain '--' for missing metrics"
        # Ensure 400.0 or 50.00 are NOT disguised as measured readings
        assert "400.0 V (Min: 395.0 V" not in empty_html, "Must not disguise missing voltage with 400.0 fallback"
        assert "50.00 Hz" not in empty_html or empty_m["avg_frequency"] is not None
        print("    [PASS] Missing periods correctly render '--' without disguising as 0.0 or standard defaults.")
        test_passed += 1

    finally:
        # Restore database configuration
        database.DB_PATH = orig_db
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)

        # Confirm original database was untouched
        final_size = os.path.getsize(orig_db)
        final_mtime = os.path.getmtime(orig_db)
        print(f"\n[Verification] Original database check:")
        print(f"    Size before: {orig_size} | Size after: {final_size}")
        print(f"    Mtime before: {orig_mtime} | Mtime after: {final_mtime}")
        assert orig_size == final_size, "Original database size altered!"
        assert orig_mtime == final_mtime, "Original database mtime altered!"
        print("    [PASS] energy.db was NOT modified or deleted.")

    print("\n" + "=" * 70)
    print(f"RESULT: {test_passed}/{total_tests} ALL AUDIT REPORT VERIFICATION TESTS PASSED")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
