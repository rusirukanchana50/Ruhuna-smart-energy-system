"""
app.py
------
Root entry wrapper for the Faculty of Engineering, University of Ruhuna Smart Energy System.
Dispatches directly to backend/app.py.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

import backend.app

# Alias in sys.modules so 'app' and 'backend.app' share the exact same instance
sys.modules[__name__] = backend.app

if __name__ == "__main__":
    backend.app.app.run(debug=True, host="127.0.0.1", port=5000)
