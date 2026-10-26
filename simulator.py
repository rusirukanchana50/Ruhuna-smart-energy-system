"""
simulator.py
------------
Root entry wrapper for Three-Phase Electrical Energy Monitoring Simulator.
Dispatches directly to backend/simulator.py.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import backend.simulator

sys.modules[__name__] = backend.simulator

if __name__ == "__main__":
    backend.simulator.main()
