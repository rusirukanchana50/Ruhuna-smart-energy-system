"""
app.py
------
Root entry wrapper for the Faculty of Engineering, University of Ruhuna Smart Energy System.
Dispatches directly to backend/app.py.
"""
import os
import sys

# Ensure root directory and backend directory are in sys.path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from backend.app import *

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
