"""
create_user.py
--------------
Root entry wrapper for User Account Provisioning.
Dispatches directly to backend/create_user.py.
"""
import os
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for path in (PROJECT_ROOT, BACKEND_DIR):
    if path not in sys.path:
        sys.path.insert(0, path)

from backend.create_user import main

if __name__ == "__main__":
    main()
