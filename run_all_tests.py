"""
run_all_tests.py
----------------
Phase 10: Master Automated Test Runner for the University of Ruhuna
Smart Energy Monitoring and Analytics System.

Executes all test modules across Phases 1 to 10:
  1. test_app.py              - Phase 1: Database & Buildings API
  2. test_phase2.py           - Phase 2: Authentication, RBAC & Session Security
  3. test_phase3.py           - Phase 3: Three-Phase Electrical Simulator & Formulas
  4. test_phase4.py           - Phase 4: Live Telemetry Dashboard & Polling
  5. test_phase5.py           - Phase 5: Historical Analytics & Load Factor
  6. test_phase5_thorough.py  - Phase 5: Thorough Mathematical Ground-Truth Suite (70 checks)
  7. test_phase6.py           - Phase 6: Electrical Alerts & Abnormal Conditions
  8. test_phase7.py           - Phase 7: Energy Cost, Two-Part Tariff & Efficiency
  9. test_phase8.py           - Phase 8: 16-Parameter Reports, CSV Export & Printable View
  10. test_workflow_e2e.py    - Phase 10: Complete End-to-End User Journey Workflow
  11. verify_phase9.py        - Phase 9: Multi-Phase System Integration Verification

Outputs a unified scorecard reporting:
  - Total test suites
  - Total individual assertions/tests
  - Passed count
  - Failed count
"""

import sys
import subprocess
import time

TEST_MODULES = [
    {
        "file": "test_app.py",
        "name": "Phase 1: Database & Buildings REST API",
        "tests_count": 5
    },
    {
        "file": "test_phase2.py",
        "name": "Phase 2: Authentication, RBAC & Session Protection",
        "tests_count": 8
    },
    {
        "file": "test_phase3.py",
        "name": "Phase 3: Three-Phase Simulator & Electrical Math",
        "tests_count": 4
    },
    {
        "file": "test_phase4.py",
        "name": "Phase 4: Live Telemetry Dashboard & Polling",
        "tests_count": 3
    },
    {
        "file": "test_phase5.py",
        "name": "Phase 5: Historical Analytics & Load Factor",
        "tests_count": 5
    },
    {
        "file": "test_phase5_thorough.py",
        "name": "Phase 5 Thorough: Mathematical Ground-Truth & Edge Cases",
        "tests_count": 70
    },
    {
        "file": "test_phase6.py",
        "name": "Phase 6: Electrical Alerts & Anomaly Detection",
        "tests_count": 7
    },
    {
        "file": "test_phase7.py",
        "name": "Phase 7: Cost Calculation & Efficiency Analysis",
        "tests_count": 7
    },
    {
        "file": "test_phase8.py",
        "name": "Phase 8: Comprehensive Reports, CSV Export & RBAC",
        "tests_count": 4
    },
    {
        "file": "test_workflow_e2e.py",
        "name": "Phase 10: End-to-End Workflow (Login->Reports->Logout)",
        "tests_count": 10
    },
    {
        "file": "verify_phase9.py",
        "name": "Phase 9: Comprehensive System Integration Verification",
        "tests_count": 6
    },
    {
        "file": "test_building_deletion.py",
        "name": "Phase 11: Foreign Key Safety & Safe Building Deletion",
        "tests_count": 4
    },
    {
        "file": "test_validation.py",
        "name": "Phase 12: Input Validation, Error Handling & Uniqueness",
        "tests_count": 4
    },
    {
        "file": "test_csrf_security.py",
        "name": "Phase 13: CSRF Defense & Secret Key Security",
        "tests_count": 5
    },
    {
        "file": "test_building_simulated_deletion.py",
        "name": "Phase 14: Safe Admin Building & Simulated Data Deletion",
        "tests_count": 8
    },
    {
        "file": "test_building_lifecycle_simulation.py",
        "name": "Phase 15: Building Re-creation & Dynamic Simulator Telemetry",
        "tests_count": 9
    }
]


def run_all_suites():
    print("=" * 85)
    print(" UNIVERSITY OF RUHUNA - FACULTY OF ENGINEERING")
    print(" SMART ENERGY MONITORING & ANALYTICS SYSTEM")
    print(" MASTER AUTOMATED TEST RUNNER (PHASE 10)")
    print("=" * 85)
    print(f" Executing {len(TEST_MODULES)} Test Suites across all project phases...\n")

    suite_results = []
    total_individual_tests = sum(m["tests_count"] for m in TEST_MODULES)
    passed_individual_tests = 0
    failed_individual_tests = 0

    start_time = time.time()

    for idx, mod in enumerate(TEST_MODULES, 1):
        filename = mod["file"]
        desc = mod["name"]
        tests_in_mod = mod["tests_count"]
        print(f"[{idx:2d}/{len(TEST_MODULES)}] Running {filename} ({desc})...")

        t0 = time.time()
        res = subprocess.run([sys.executable, filename], capture_output=True, text=True)
        elapsed = time.time() - t0

        if res.returncode == 0:
            print(f"     -> [PASSED] {tests_in_mod} test check(s) passed ({elapsed:.2f}s)")
            suite_results.append({
                "file": filename,
                "name": desc,
                "status": "PASSED",
                "tests": tests_in_mod,
                "passed": tests_in_mod,
                "failed": 0,
                "duration": elapsed
            })
            passed_individual_tests += tests_in_mod
        else:
            print(f"     -> [FAILED] Test suite exited with error code {res.returncode} ({elapsed:.2f}s)")
            print(res.stderr or res.stdout)
            suite_results.append({
                "file": filename,
                "name": desc,
                "status": "FAILED",
                "tests": tests_in_mod,
                "passed": 0,
                "failed": tests_in_mod,
                "duration": elapsed
            })
            failed_individual_tests += tests_in_mod

    total_duration = time.time() - start_time

    # Print Summary Table
    print("\n" + "=" * 85)
    print(" MASTER TEST EXECUTION SUMMARY TABLE")
    print("=" * 85)
    print(f" {'#':<3} | {'Test Script':<24} | {'Status':<8} | {'Checks':<8} | {'Time':<8} | {'Description'}")
    print("-" * 85)

    for idx, r in enumerate(suite_results, 1):
        status_tag = "[PASS]" if r["status"] == "PASSED" else "[FAIL]"
        print(f" {idx:<3} | {r['file']:<24} | {status_tag:<8} | {r['passed']}/{r['tests']:<5} | {r['duration']:<6.2f}s | {r['name']}")

    print("=" * 85)
    print(f" Total Test Suites   : {len(TEST_MODULES)} ({len([s for s in suite_results if s['status'] == 'PASSED'])} Passed, {len([s for s in suite_results if s['status'] == 'FAILED'])} Failed)")
    print(f" Total Checks/Tests  : {total_individual_tests}")
    print(f" Passed              : {passed_individual_tests}")
    print(f" Failed              : {failed_individual_tests}")
    print(f" Total Duration      : {total_duration:.2f} seconds")
    print("=" * 85)

    if failed_individual_tests == 0:
        print("\n >>> ALL AUTOMATED TESTS COMPLETED WITH 100% SUCCESS! <<<")
        print(" >>> THE SYSTEM IS FULLY VALIDATED AND READY FOR UNIVERSITY DEMONSTRATION. <<<\n")
        return 0
    else:
        print(f"\n [ERROR] {failed_individual_tests} test(s) failed. Please review errors above.\n")
        return 1


if __name__ == "__main__":
    exit_code = run_all_suites()
    sys.exit(exit_code)
