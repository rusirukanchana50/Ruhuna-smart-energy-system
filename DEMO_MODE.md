# University of Ruhuna — Smart Energy Monitoring & Analytics System
## Viva Demonstration Guide (`DEMO_MODE.md`)

This guide provides a structured, step-by-step walkthrough for presenting the **Smart Energy Monitoring and Analytics System** (Faculty of Engineering, University of Ruhuna, Hapugala, Galle) during your final project evaluation and viva examination.

---

## 🎯 Viva Presentation Objectives

When presenting to academic evaluators, demonstrate that the system satisfies key engineering requirements:
1. **Accurate Three-Phase Electrical Mathematics**: Adherence to power triangle relationships ($S = \sqrt{3} V_L I_L$, $P = S \times PF$, $Q = \sqrt{S^2 - P^2}$).
2. **Reliable Real-Time Telemetry Pipeline**: Dual-process architecture where `simulator.py` generates telemetry and `app.py` serves the portal without database lock contention.
3. **Role-Based Access Control (RBAC)**: Secure separation between Administrator and Viewer roles.
4. **Energy Cost & Institutional Tariff Modeling**: Two-part industrial/commercial tariff calculation with after-hours consumption detection.
5. **Analytical Insights & Engineering Observations**: Automated detection of high demand peaks, low power factor, and electrical anomalies.
6. **Academic Transparency**: Clear disclosure that telemetry is simulated and tariff rates represent an educational demonstration model.

---

## ⏱️ Recommended 10-Minute Viva Demonstration Sequence

```text
[00:00 - 01:30]  1. Terminal Setup & Dual-Process Launch
[01:30 - 02:45]  2. Authentication & Role-Based Access Control
[02:45 - 04:15]  3. Live Monitoring Dashboard & Real-Time Telemetry
[04:15 - 05:45]  4. Historical Analytics & Load Factor Analysis
[05:45 - 07:15]  5. Electrical Anomaly Detection & Live Anomaly Injection
[07:15 - 08:30]  6. Energy Cost & Efficiency Rankings (Two-Part Tariff)
[08:30 - 09:30]  7. Comprehensive Audit Reports & Official PDF Print View
[09:30 - 10:00]  8. System Validation Scorecard & Q&A Conclusion
```

---

## 🛠️ Step 1: Terminal Setup & System Startup (2 Terminals)

Open **two separate terminals** in the project directory (`Ruhuna Smart Energy System`).

### Terminal 1: Start Flask Application Server
```powershell
python app.py
```
- **What happens**: Flask boots on `http://127.0.0.1:5000`, initializes SQLite tables in `energy.db` using Write-Ahead Logging (`WAL`), and binds protected endpoints.
- **Examiner Note**: Point out that the server runs with cryptographically signed sessions (`app.secret_key`).

### Terminal 2: Start Three-Phase Simulator
```powershell
python simulator.py --interval 5.0
```
- **What happens**: The simulator loads all 6 faculty buildings (CEE, EIE, MME, MENA, ADMIN, AUDI) and emits balanced 3-phase readings every 5 seconds.
- **Examiner Note**: Point out the nominal 400 V line-to-line voltage and 50 Hz grid frequency logged cleanly in Terminal 2.

---

## 🔐 Step 2: Authentication & Role-Based Access Control (RBAC)

1. Open your web browser and navigate to:
   ```text
   http://127.0.0.1:5000
   ```
2. **Demonstrate Route Protection**:
   - Point out that unauthenticated users are automatically redirected to `/login`.
   - Try directly accessing `http://127.0.0.1:5000/dashboard` in an Incognito window to show that unauthorized access is blocked (HTTP 302 redirect).
3. **Log in as Administrator**:
   - **Email**: `admin@ruh.ac.lk` (or `test_admin@eng.ruh.ac.lk`)
   - **Password**: `AdminSecretPassword123!`
   - **Click**: "Sign In"
   - **Highlight**: Dark-themed university branding, session persistence, and the `ADMINISTRATOR` status badge in the top navigation bar.

---

## ⚡ Step 3: Live Monitoring Dashboard

1. **Observe Building Telemetry Cards**:
   - Point out all 6 faculty buildings:
     * Civil and Environmental Engineering (`CEE`)
     * Electrical and Information Engineering (`EIE`)
     * Mechanical and Manufacturing Engineering (`MME`)
     * Marine Engineering and Naval Architecture (`MENA`)
     * Administration Building (`ADMIN`)
     * Auditorium (`AUDI`)
2. **Highlight Real-Time 5-Second Polling**:
   - Point out that live values (Voltage, Current, Active Power, Power Factor, Frequency, Energy) update automatically without manual page refreshes.
   - Point out the **"SIMULATED DATA"** indicator badge showing ethical academic disclosure.
3. **Interactive Charts**:
   - Observe the real-time sliding-window Line Chart (Active Power kW) and Bar Chart comparing electrical demand across all 6 facilities.

---

## 📊 Step 4: Historical Analytics & Load Factor

1. Click **"Historical Analytics"** in the top navigation bar (`/analytics`).
2. **Demonstrate Filter Controls**:
   - Select **Civil and Environmental Engineering (CEE)**.
   - Click preset buttons: `1h`, `Today`, `24h`, `7d`.
   - Click **"Apply Filter"**.
3. **Explain Key Electrical KPIs**:
   - **Total Consumed Energy ($kWh$)**: Integrates active power using consecutive timestamp integration with missing sensor data credit protection.
   - **Peak Demand ($kW$)**: Highest observed active demand.
   - **Load Factor ($LF$)**:
     $$\text{Load Factor} = \frac{P_{\text{avg}}}{P_{\text{peak}}}$$
     Explain that a high load factor (~85–90%) indicates steady utilization of feeder capacity.
   - **Power Factor ($PF$)**: Average displacement power factor (~0.88–0.92).
4. **Campus Comparison Mode**:
   - Select **"All Buildings (Campus Comparison)"** from the dropdown.
   - Show the 6-building comparative bar charts showing energy distribution across departments without double-counting.

---

## 🚨 Step 5: Electrical Anomaly Detection & Live Injection

1. Click **"Electrical Alerts"** in the navigation bar (`/alerts`).
2. **Explain Monitored Safety Conditions**:
   - Low Power Factor ($PF < 0.85$) — Utility surcharge risk.
   - Undervoltage ($V_L < 380\text{ V}$, $-5\%$) & Overvoltage ($V_L > 420\text{ V}$, $+5\%$).
   - Frequency Excursions ($f < 49.5\text{ Hz}$ or $f > 50.5\text{ Hz}$).
   - Feeder High Load ($> 90\%$ rated capacity) & Overload ($> 100\%$).
   - Sensor Offline ($> 60\text{ s}$ telemetry silence).
3. **Perform Live Anomaly Injection (Viva "Wow" Factor)**:
   In Terminal 2, stop the simulator (Ctrl+C) and run with an injected anomaly:
   ```powershell
   python simulator.py --interval 5.0 --anomaly LOW_PF --building-id 1
   ```
   - Return to the browser `/alerts` page.
   - Notice the **CRITICAL / WARNING** alert banner appear in real time for Building 1 (CEE) with exact measured value and threshold.
4. **Demonstrate Administrator Acknowledgment**:
   - Click the **"Acknowledge"** button on the newly triggered alert.
   - Show that the alert is updated with the administrator's name and timestamp.
   - Note: If logged in as a Viewer, the button is hidden/disabled (enforcing RBAC).

---

## 💰 Step 6: Cost & Efficiency Analysis

1. Click **"Cost & Efficiency"** in the top navigation bar (`/cost-efficiency`).
2. **Explain Two-Part Demonstration Tariff**:
   - **Energy Charge**: Real consumption $\times$ Rs. 38.50/kWh.
   - **Peak Demand Charge**: Monthly peak kW $\times$ Rs. 1,450.00/kW (scaled to query window).
   - **Fixed Service Charge**: Rs. 3,000.00/month (scaled to query window).
3. **After-Hours Energy Tracking**:
   - Operating Hours: Weekdays 08:00 – 17:00.
   - Any energy consumed outside these hours or on weekends is flagged as after-hours energy.
4. **Departmental Efficiency Rankings**:
   - Show the ranked list of faculty complexes scored from Best to Needs Attention based on load factor, average power factor, and after-hours percentage.

---

## 📄 Step 7: Comprehensive Reports & Official PDF Print View

1. Click **"Energy Reports"** in the top navigation bar (`/reports`).
2. **Generate 16-Parameter Summary Audit**:
   - Select Date Range (e.g., `Today` or `Last 7 Days`).
   - Click **"Generate Audit Report"**.
   - Review the 16 standard energy audit parameters and automated engineering observations.
3. **Demonstrate Telemetry CSV Export**:
   - Click **"Export CSV"**.
   - Show the downloaded `.csv` file containing timestamped 3-phase records with data source clearly tagged as `SIMULATED`.
4. **Demonstrate Printable PDF Export**:
   - Click **"Printable View / PDF"**.
   - A clean white-background document opens formatted specifically for university administrative reporting:
     * Official University of Ruhuna crest header.
     * Summary audit KPI table.
     * Departmental breakdown table.
     * Safety threshold event log.
     * Formal educational disclaimer note.
   - Press **Ctrl+P** (or click "Print / Save as PDF") to show clean pagination.

---

## 🧪 Step 8: System Verification Scorecard

To prove system stability to the examiners, open a third terminal and execute the master automated test runner:
```powershell
python run_all_tests.py
```
- **Show the Final Output Scorecard**:
  * Total Test Suites: **11**
  * Total Verification Checks: **129**
  * Passed: **129**
  * Failed: **0**
  * Execution Time: **~12 seconds**

---

## 💬 Common Viva Questions & Model Answers

### Q1: Are these readings coming from physical meters installed in the faculty?
> **Answer**: No. In this prototype, readings are generated by a three-phase software simulator (`simulator.py`) using balanced 400 V / 50 Hz formulas and realistic diurnal university load curves. Every page, API endpoint, CSV export, and printed report explicitly discloses the `SIMULATED` label to maintain complete academic integrity.

### Q2: Why did you use SQLite instead of a dedicated time-series database?
> **Answer**: SQLite was chosen for portability, self-containment, and zero-configuration demonstration during project evaluations. To support concurrent writes from `simulator.py` and reads from Flask `app.py`, Write-Ahead Logging (`WAL` mode) and connection timeouts are utilized. In future deployment, a time-series engine like TimescaleDB or PostgreSQL would be integrated.

### Q3: How is electricity cost calculated? Is this the official CEB bill?
> **Answer**: Cost estimates use a configurable two-part demonstration institutional tariff model (Energy Rate: LKR 38.50/kWh, Maximum Demand: LKR 1,450.00/kW, Fixed Charge: LKR 3,000.00/month). It is an engineering estimation tool to demonstrate the financial impact of peak demand and low power factor, clearly noted as a non-official estimate.

### Q4: How is Load Factor defined and why is it important?
> **Answer**: Load Factor is defined as the ratio of Average Active Power to Peak Active Power over a given interval:
> $$\text{Load Factor} = \frac{P_{\text{avg}}}{P_{\text{peak}}}$$
> A load factor close to 1.0 indicates steady and efficient utilization of substation transformer capacity. A low load factor means high peak demand with low average consumption, resulting in high utility maximum demand charges.
