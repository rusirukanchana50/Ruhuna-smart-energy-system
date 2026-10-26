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

import backend.configure_system

sys.modules[__name__] = backend.configure_system

if __name__ == "__main__":
    backend.configure_system.main()
