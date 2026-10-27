# Live Demonstration Checklist for University Viva

## University of Ruhuna &bull; Faculty of Engineering
### Smart Energy Monitoring and Analytics System (Phases 1–9)

Follow this step-by-step procedure to demonstrate the full application to your examiners during your viva examination.

---

## 1. Pre-Demonstration Setup (Terminal 1 & Terminal 2)

### Terminal 1: Launch Backend Server
```powershell
python app.py
```
- Verify startup output:
  - `[Database] 'energy.db' already initialized with 6 building(s).`
  - Running on `http://127.0.0.1:5000`

### Terminal 2: Launch Real-Time Physics Simulator
```powershell
python simulator.py
```
- Verify the simulator begins logging 3-phase readings every 15 seconds for all 6 complexes.
- Point out to examiners that readings are explicitly labelled `[SIMULATED]`.

---

## 2. Demonstration Flow

### Step 1: Authentication & Role-Based Access Control (RBAC)
1. Open browser to `http://127.0.0.1:5000/`.
2. Notice automatic redirect to `/login` with clean University of Ruhuna dark branding.
3. Attempt to access `/dashboard` or `/api/energy/live` unauthenticated.
   - Explain to examiners: Protected routes redirect browsers and return HTTP 401 Unauthorized for API clients.
4. Log in using the **Viewer** account:
   - Email: `test_viewer@eng.ruh.ac.lk`
   - Password: `<your-viewer-password>` *(entered interactively during account creation)*
5. Point out the **Viewer** role badge in the upper navigation bar.

---

### Step 2: Live Monitoring Dashboard (`/dashboard`)
1. Show the 6 building telemetry cards:
   - Civil and Environmental Engineering (`CEE`)
   - Electrical and Information Engineering (`EIE`)
   - Mechanical and Manufacturing Engineering (`MME`)
   - Marine Engineering and Naval Architecture (`MENA`)
   - Administration Building (`ADMIN`)
   - Auditorium (`AUDI`)
2. Explain the parameters on each card:
   - Line Voltage ($V_L \approx 400\text{ V}$)
   - Line Current ($I_L\text{ A}$)
   - Power Factor ($\cos \phi$)
   - Active Power ($P\text{ kW}$)
   - Apparent Power ($S\text{ kVA}$)
   - Reactive Power ($Q\text{ kVAr}$)
   - System Frequency ($f \approx 50.0\text{ Hz}$)
   - Cumulative Energy ($kWh$)
3. Show that every 5 seconds, values update without full page reloads via REST API polling.
4. Point out the Chart.js real-time sliding graphs (30-point window).

---

### Step 3: Historical Analytics & Load Factor (`/analytics`)
1. Click the **Historical Analytics** tab.
2. Select **Last 24 Hours** or **Today** preset.
3. Select an individual building (e.g., `EIE` or `CEE`).
4. Walk through the 5 KPI cards:
   - True Integrated Energy ($kWh$)
   - Peak Demand ($kW$)
   - Average Active Power ($kW$)
   - Load Factor ($LF = \frac{P_{\text{avg}}}{P_{\text{peak}}}$ and percentage)
   - Average Power Factor
5. Explain the mathematical integration:
   - Explain that energy is integrated using consecutive timestamp intervals ($\Delta t$), and gaps $>60\text{s}$ are capped to prevent false inflation during outages.
6. Select **Six-Building Campus Comparison (All Buildings)**:
   - Show campus aggregated totals and the three comparative bar graphs.
   - Show the comparative analytics table comparing all 6 complexes.

---

### Step 4: Electrical Alerts & Controlled Anomaly Injection (`/alerts`)
1. Click the **Electrical Alerts** tab. Show the current active/cleared table.
2. In Terminal 3 (or a separate PowerShell window), trigger controlled anomalies:
   ```powershell
   # Inject Low Power Factor on Building 2 (EIE):
   python simulator.py --once --anomaly LOW_PF --building-id 2

   # Inject Severe Overload on Building 1 (CEE):
   python simulator.py --once --anomaly OVERLOAD --building-id 1

   # Inject Undervoltage on Building 4 (MENA):
   python simulator.py --once --anomaly LOW_VOLTAGE --building-id 4
   ```
3. Return to the browser:
   - On `/dashboard`: Show the red pulsating border on CEE (`has-alert-critical`) and amber warning border on EIE (`has-alert-warning`).
   - On the top navigation bar: Show the red active alert counter badge.
   - On `/alerts`: Show the newly recorded alerts with exact measured values, safety thresholds, and severity badges (`CRITICAL`, `WARNING`).
4. Demonstrate Duplicate Suppression:
   - Run the anomaly command again: show that no redundant rows are created while the condition remains active.
5. Demonstrate Auto-Clearing:
   ```powershell
   # Restore normal conditions:
   python simulator.py --once
   ```
   - Show that the alerts update to `Cleared` with recorded `cleared_at` timestamps.
6. Demonstrate RBAC on Alert Acknowledgment:
   - As `test_viewer`, attempt to acknowledge an alert (the button is disabled or displays "Viewer: Read-Only").
   - Log out and log in as `test_admin@eng.ruh.ac.lk` / `<your-admin-password>`.
   - Click **Acknowledge**: confirm the alert is stamped with `Admin`, current timestamp, and green checkmark.

---

### Step 5: Cost & Efficiency Analysis (`/cost-efficiency`)
1. Click the **Cost & Efficiency** tab.
2. Point out the **Demonstration Tariff Disclaimer Banner**:
   - Highlight: *"Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."*
3. Explain the Two-Part Institutional Tariff Breakdown:
   - $\text{Energy Charge} = \text{Energy (kWh)} \times 38.50\text{ LKR}$
   - $\text{Demand Charge} = \text{Peak Demand (kW)} \times 1,450.00\text{ LKR} \times \left(\frac{\text{days}}{30}\right)$
   - $\text{Fixed Charge} = 3,000.00\text{ LKR} \times \left(\frac{\text{days}}{30}\right)$
4. Explain After-Hours Energy:
   - Show how consumption outside $08:00\text{--}17:00$ (or on weekends) is calculated and flagged.
5. Show the **Departmental Efficiency Rankings** table (#1 to #6) and 4 comparison bar charts.

---

### Step 6: Reports, PDF Print & CSV Export (`/reports`)
1. Click the **Reports** tab.
2. Select preset **Last 24 Hours** and click **Generate**:
   - Point out all 16 calculated metrics in the KPI grid.
   - Point out the **Evidence-Based Engineering Observations** box.
3. Click **Print / Save PDF**:
   - A clean window opens with official *University of Ruhuna &bull; Faculty of Engineering* headers.
   - Open browser print preview (`Ctrl+P`) to show clean A4 formatting ready for PDF save.
4. Click **Export CSV**:
   - Show the downloaded `.csv` file in Excel or Notepad.
   - Point out columns: timestamp, voltage, current, PF, frequency, powers, and `SIMULATED` tags.
5. Demonstrate Administrator Tariff Rate Updates:
   - As `test_admin`, scroll to the bottom configuration form.
   - Adjust the energy rate or demand rate and click **Save Tariff Rates**.
   - Show that cost estimates update immediately from SQLite.

---

## 3. Concluding Summary for Examiners
- Remind the examiners:
  - 100% of data is stored and calculated in SQLite (no Math.random() in the frontend).
  - All mathematical integrations use true consecutive timestamps.
  - The architecture is modular: real smart energy meters with Modbus RS-485 / MQTT gateways can replace `simulator.py` without rewriting the Flask backend or frontend portals.
