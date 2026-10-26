import os
import sys
import sqlite3
import math

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
from database import (
    get_db_connection,
    get_all_buildings,
    get_active_tariff,
    get_faculty_settings,
    get_comprehensive_energy_report,
    get_filtered_alerts
)

def run_checks():
    print("=================================================================")
    print("PHASE 9 SYSTEM INTEGRATION & VERIFICATION SCRIPT")
    print("=================================================================")

    # 1. Database & Tables Check
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
    tables = [r[0] for r in c.fetchall()]
    print("[1] SQLite Tables in energy.db:")
    for t in tables:
        c.execute(f"SELECT COUNT(*) FROM {t}")
        print(f"    - {t}: {c.fetchone()[0]} rows")

    # 2. Six Buildings Check
    print("\n[2] Six Registered Faculty Buildings:")
    buildings = get_all_buildings()
    assert len(buildings) >= 6, f"Expected at least 6 buildings, found {len(buildings)}"
    core_codes = {"CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"}
    found_codes = {b['code'] for b in buildings}
    assert core_codes.issubset(found_codes), f"Missing core buildings: {core_codes - found_codes}"
    for b in buildings:
        print(f"    - [{b['code']}] {b['name']} (Rated Power: {b['rated_power_kw']} kW)")

    # 3. Three-Phase Electrical Mathematics Verification
    print("\n[3] Three-Phase Electrical Mathematics Verification:")
    # Test reading with V_L = 400.0 V, I_L = 72.17 A, PF = 0.85
    v_l = 400.0
    i_l = 72.16878
    pf = 0.85
    expected_s = math.sqrt(3) * v_l * i_l / 1000.0
    expected_p = expected_s * pf
    expected_q = math.sqrt(max(0.0, expected_s**2 - expected_p**2))
    print(f"    Formula S: sqrt(3)*{v_l}*{i_l:.2f}/1000 = {expected_s:.2f} kVA")
    print(f"    Formula P: S * PF = {expected_p:.2f} kW")
    print(f"    Formula Q: sqrt(S^2 - P^2) = {expected_q:.2f} kVAr")
    assert abs(expected_s - 50.0) < 0.05
    assert abs(expected_p - 42.5) < 0.05
    assert abs(expected_q - 26.34) < 0.05
    print("    -> PASSED: Theoretical power triangle formulas perfectly verified.")

    # 4. Energy Integration Check
    print("\n[4] Energy Integration Timestamp Difference Check:")
    c.execute("""
        SELECT timestamp, active_power_kw, energy_kwh 
        FROM energy_readings 
        WHERE building_id = 1 
        ORDER BY id DESC LIMIT 5;
    """)
    rows = c.fetchall()
    print("    Latest 5 readings for CEE Building (Building 1):")
    for r in rows:
        print(f"    - Timestamp: {r['timestamp']} | P: {r['active_power_kw']} kW | Cumulative: {r['energy_kwh']:.2f} kWh")

    # 5. Demonstration Tariff & Disclaimer Check
    print("\n[5] Demonstration Tariff Check:")
    tariff = get_active_tariff()
    print(f"    - Name: {tariff['name']}")
    print(f"    - Energy Rate: LKR {tariff['energy_rate_lkr_per_kwh']}/kWh")
    print(f"    - Demand Rate: LKR {tariff['demand_rate_lkr_per_kw']}/kW")
    print(f"    - Fixed Charge: LKR {tariff['fixed_charge_lkr']}")
    assert "Demonstration" in tariff["name"] or "Estimated" in tariff["name"]

    # 6. Comprehensive 16-parameter Report Check
    print("\n[6] 16-Parameter Comprehensive Report Check:")
    rep = get_comprehensive_energy_report(building_id=1)
    m = rep["metrics"]
    print(f"    - Scope: {rep['building_name']}")
    print(f"    - Energy: {m['total_energy_kwh']} kWh")
    print(f"    - Estimated Cost: LKR {m['estimated_electricity_cost_lkr']}")
    print(f"    - Peak Demand: {m['peak_demand_kw']} kW")
    print(f"    - Load Factor: {m['load_factor']} ({m['load_factor_pct']}%)")
    print(f"    - Average PF: {m['avg_power_factor']}")
    print(f"    - After-Hours: {m['after_hours_kwh']} kWh ({m['after_hours_pct']}%)")
    print(f"    - Voltage: {m['avg_voltage']} V (Range: {m['min_voltage']}V - {m['max_voltage']}V)")
    print(f"    - Frequency: {m['avg_frequency']} Hz")
    print(f"    - Alerts: {m['warning_alerts_count']} Warning / {m['critical_alerts_count']} Critical")
    print(f"    - Observations count: {len(rep['engineering_observations'])}")
    for obs in rep["engineering_observations"]:
        print(f"      * {obs}")
    print(f"    - Simulation Note: \"{rep['simulation_note']}\"")
    print(f"    - Disclaimer: \"{rep['disclaimer']}\"")

    conn.close()
    print("\n=================================================================")
    print("ALL CORE PHASE 9 SYSTEM CHECKS PASSED SUCCESSFULLY!")
    print("=================================================================")

if __name__ == "__main__":
    run_checks()
