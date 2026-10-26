"""
run_all_tests.py
----------------
Root entry wrapper for the Master Automated Test Runner.
Dispatches directly to tests/run_all_tests.py.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
TESTS_DIR = os.path.join(PROJECT_ROOT, "tests")
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")

for path in (PROJECT_ROOT, BACKEND_DIR, TESTS_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from tests.run_all_tests import run_all_suites

if __name__ == "__main__":
    exit_code = run_all_suites()
    sys.exit(exit_code)
