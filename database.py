"""
database.py
-----------
Root entry wrapper for the SQLite Database & Analytical Engine.
Dispatches directly to backend/database.py and registers as canonical module.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import backend.database

# Replace module in sys.modules so 'database' is an identical singleton to 'backend.database'
sys.modules[__name__] = backend.database
