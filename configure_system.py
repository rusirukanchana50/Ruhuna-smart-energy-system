"""
configure_system.py
-------------------
Root entry wrapper for Ruhuna Smart Energy System Configuration.
Dispatches directly to backend/configure_system.py.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from backend.configure_system import main

if __name__ == "__main__":
    main()
