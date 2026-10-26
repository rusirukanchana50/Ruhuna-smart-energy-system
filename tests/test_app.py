"""
test_app.py
-----------
Automated test script to verify that:
1. Unauthenticated requests to /api/buildings are rejected with 401.
2. Authenticated sessions can successfully query all 6 faculty buildings.
"""

import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.join(PROJECT_ROOT, "backend")
for p in (PROJECT_ROOT, BACKEND_DIR):
    if p not in sys.path:
        sys.path.insert(0, p)

from app import app
import json

def test_buildings_api():
    print("Testing GET /api/buildings...")
    with app.test_client() as client:
        # 1. Unauthenticated check
        unauth_resp = client.get('/api/buildings')
        print(f"Unauthenticated Status Code: {unauth_resp.status_code} (Expected 401)")
        assert unauth_resp.status_code == 401, f"Expected 401, got {unauth_resp.status_code}"

        # 2. Authenticate
        login_resp = client.post('/login', data={
            'email': 'test_admin@eng.ruh.ac.lk',
            'password': 'AdminSecretPassword123!'
        })
        assert login_resp.status_code in (200, 302), "Login failed during test setup"

        # 3. Authenticated check
        response = client.get('/api/buildings')
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = json.loads(response.data)
        print(f"Authenticated Status Code: {response.status_code}")
        print(f"Response Status: {data.get('status')}")
        print(f"Building Count: {data.get('count')}")
        print("\nBuildings retrieved:")
        for b in data.get('data', []):
            print(f" - [{b['id']}] {b['code']}: {b['name']}")
            
        from database import get_all_buildings
        expected_count = len(get_all_buildings())
        assert data.get('count') == expected_count, f"Expected {expected_count} buildings, got {data.get('count')}"
        assert data.get('count') >= 6, f"Expected at least 6 core buildings, got {data.get('count')}"
        assert len(data.get('data', [])) == expected_count
        print("\n--> All tests passed successfully!")

if __name__ == "__main__":
    test_buildings_api()
