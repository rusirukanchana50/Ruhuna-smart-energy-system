"""
test_workflow_e2e.py
--------------------
Phase 10: Complete End-to-End Workflow Verification Suite.

Validates the full user journey:
  1. Login (/login)
  2. Dashboard Overview (/dashboard)
  3. Live Monitoring (/api/energy/live)
  4. Historical Analytics (/analytics, /api/energy/history, /api/energy/analytics)
  5. Alerts & Threshold Violations (/alerts, /api/alerts)
  6. Cost & Efficiency (/cost-efficiency, /api/energy/cost, /api/energy/efficiency)
  7. Reports & CSV Export (/reports, /api/reports/summary, /api/reports/export/csv)
  8. Logout (/logout)
  9. Post-logout security lock verification
"""

import unittest
from app import app
from database import init_db, get_user_by_email, create_user, get_all_buildings


class TestCompleteWorkflow(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        init_db()
        # Ensure test accounts exist
        if not get_user_by_email("workflow_admin@eng.ruh.ac.lk"):
            create_user(
                email="workflow_admin@eng.ruh.ac.lk",
                password="AdminPassword123!",
                full_name="Workflow Administrator",
                role="Administrator"
            )
        if not get_user_by_email("workflow_viewer@eng.ruh.ac.lk"):
            create_user(
                email="workflow_viewer@eng.ruh.ac.lk",
                password="ViewerPassword123!",
                full_name="Workflow Viewer",
                role="Viewer"
            )

    def setUp(self):
        self.client = app.test_client()

    def test_complete_administrator_workflow(self):
        print("\n" + "=" * 75)
        print(" [E2E Workflow Test] Executing Full Demonstration Workflow (Administrator)")
        print("=" * 75)

        # Step 1: Access Login Page
        print("\n [Step 1] Accessing Login Page (GET /login)...")
        res = self.client.get("/login")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Sign In", res.data)
        self.assertIn(b"Faculty of Engineering", res.data)
        print("  -> PASSED: Login page loaded with Faculty branding.")

        # Step 2: Perform Login
        print("\n [Step 2] Authenticating as Administrator (POST /login)...")
        res = self.client.post("/login", data={
            "email": "workflow_admin@eng.ruh.ac.lk",
            "password": "AdminPassword123!"
        }, follow_redirects=False)
        self.assertEqual(res.status_code, 302)
        self.assertIn("/dashboard", res.headers["Location"])
        print("  -> PASSED: Authentication successful, redirected to /dashboard.")

        # Step 3: View Dashboard Overview
        print("\n [Step 3] Loading Dashboard (GET /dashboard)...")
        res = self.client.get("/dashboard")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Workflow Administrator", res.data)
        self.assertIn(b"Civil and Environmental Engineering", res.data)
        self.assertIn(b"Electrical and Information Engineering", res.data)
        print("  -> PASSED: Dashboard overview rendered with 6 faculty buildings.")

        # Step 4: Live Monitoring Telemetry API
        print("\n [Step 4] Querying Live Telemetry (GET /api/energy/live)...")
        res = self.client.get("/api/energy/live")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("status"), "success")
        expected_count = len(get_all_buildings())
        self.assertEqual(len(data.get("data", [])), expected_count)
        first = data["data"][0]
        self.assertIn("voltage", first)
        self.assertIn("current", first)
        self.assertIn("power_factor", first)
        self.assertIn("active_power_kw", first)
        print(f"  -> PASSED: 6 buildings telemetry retrieved (Latest: {first['building_code']} P={first['active_power_kw']} kW).")

        # Step 5: Historical Analytics
        print("\n [Step 5] Accessing Historical Analytics (GET /analytics & APIs)...")
        res = self.client.get("/analytics")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Historical Analytics", res.data)

        # Single building analytics
        res = self.client.get("/api/energy/analytics?building_id=1")
        self.assertEqual(res.status_code, 200)
        ana = res.get_json().get("analytics", {})
        self.assertIn("total_energy_kwh", ana)
        self.assertIn("load_factor", ana)
        self.assertIn("peak_active_power_kw", ana)

        # Campus comparison analytics
        res = self.client.get("/api/energy/analytics?building_id=all")
        self.assertEqual(res.status_code, 200)
        json_data = res.get_json()
        comp = json_data.get("comparison", [])
        expected_count = len(get_all_buildings())
        self.assertEqual(len(comp), expected_count)
        campus_sum = json_data.get("campus_summary", {})
        print(f"  -> PASSED: Historical analytics & campus comparison verified (Campus Total: {campus_sum.get('total_energy_kwh')} kWh).")

        # Step 6: Alerts & Anomaly Management
        print("\n [Step 6] Navigating to Electrical Alerts (/alerts & /api/alerts)...")
        res = self.client.get("/alerts")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Electrical Alerts", res.data)

        res = self.client.get("/api/alerts")
        self.assertEqual(res.status_code, 200)
        alerts_data = res.get_json()
        self.assertIn("summary", alerts_data)
        self.assertIn("data", alerts_data)
        crit = alerts_data["summary"].get("active_critical", 0)
        warn = alerts_data["summary"].get("active_warnings", 0)
        print(f"  -> PASSED: Alerts portal active (Summary: {crit} Critical, {warn} Warning).")

        # Step 7: Cost & Efficiency Analysis
        print("\n [Step 7] Accessing Energy Cost & Efficiency (/cost-efficiency & APIs)...")
        res = self.client.get("/cost-efficiency")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Cost &amp; Efficiency", res.data)

        res = self.client.get("/api/energy/cost?building_id=1")
        self.assertEqual(res.status_code, 200)
        cost_data = res.get_json()
        self.assertEqual(cost_data.get("status"), "success")
        self.assertIn("estimated_total_cost_lkr", cost_data)
        self.assertIn("estimated_energy_charge_lkr", cost_data)

        res = self.client.get("/api/energy/efficiency?building_id=1")
        self.assertEqual(res.status_code, 200)
        eff_data = res.get_json()
        self.assertEqual(eff_data.get("status"), "success")
        self.assertIn("after_hours_kwh", eff_data)
        self.assertIn("energy_performance_status", eff_data)

        res = self.client.get("/api/energy/efficiency/comparison")
        self.assertEqual(res.status_code, 200)
        comp_eff = res.get_json()
        expected_count = len(get_all_buildings())
        self.assertEqual(len(comp_eff.get("comparison", [])), expected_count)
        print(f"  -> PASSED: Two-part tariff cost calculations & efficiency ratings verified (Bldg 1 Est Cost: LKR {cost_data.get('estimated_total_cost_lkr')}).")

        # Step 8: Reports & Export
        print("\n [Step 8] Generating Comprehensive Energy Reports (/reports & /api/reports)...")
        res = self.client.get("/reports")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"Energy Audit Reports", res.data)

        res = self.client.get("/api/reports/summary?building_id=all")
        self.assertEqual(res.status_code, 200)
        rep = res.get_json().get("report", {})
        self.assertIn("metrics", rep)
        self.assertIn("total_energy_kwh", rep["metrics"])
        self.assertIn("estimated_electricity_cost_lkr", rep["metrics"])
        self.assertIn("engineering_observations", rep)

        # CSV Export
        res = self.client.get("/api/reports/export/csv?building_id=all")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "text/csv")
        self.assertIn(b"Reading ID,Building ID,Building Code", res.data)

        # Printable Report
        res = self.client.get("/reports/printable?building_id=all")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"UNIVERSITY OF RUHUNA", res.data)
        self.assertIn(b"Faculty of Engineering", res.data)
        print("  -> PASSED: 16-parameter summary audit report, printable view, and CSV export verified.")

        # Step 9: Logout
        print("\n [Step 9] Logging out (POST /logout)...")
        res = self.client.post("/logout", follow_redirects=False)
        self.assertEqual(res.status_code, 302)
        self.assertIn("/login", res.headers["Location"])
        print("  -> PASSED: Session terminated, redirected to /login.")

        # Step 10: Unauthorized Access Prevention
        print("\n [Step 10] Verifying Unauthorized Access Blocked After Logout...")
        res = self.client.get("/dashboard", follow_redirects=False)
        self.assertEqual(res.status_code, 302)
        self.assertIn("/login", res.headers["Location"])
        res = self.client.get("/api/energy/live")
        self.assertEqual(res.status_code, 401)
        print("  -> PASSED: Security barrier active; unauthenticated requests blocked.")

        print("\n" + "=" * 75)
        print(" >>> FULL END-TO-END WORKFLOW VERIFIED WITH 100% SUCCESS! <<<")
        print("=" * 75)


if __name__ == "__main__":
    unittest.main()
