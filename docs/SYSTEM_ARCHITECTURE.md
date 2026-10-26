# System Architecture

## Faculty of Engineering, University of Ruhuna
### Smart Energy Monitoring and Analytics System (Phases 1–9)

---

## 1. High-Level Architecture Overview

The system is designed as a multi-tier, SCADA-inspired IoT telemetry and analytics platform for monitoring electrical energy consumption, power quality, and abnormal grid conditions across the six primary complexes of the Faculty of Engineering, University of Ruhuna (Hapugala, Galle).

```
+-----------------------------------------------------------------------------------+
|                        PHYSICAL / SIMULATION LAYER                                |
|  - 3-Phase Electrical Physics Engine (simulator.py)                               |
|  - 400 V Line-to-Line Balanced 50 Hz Grid Model with Gaussian Noise               |
|  - Time-of-Day Faculty Load Profiles (Baseline, Working Hours, Lunch, Night)      |
|  - Anomaly Injection Engine (Low PF, Overload, Voltage Excursions, Disconnection) |
+-----------------------------------------------------------------------------------+
                                      |
                                      | (15-second Polling / Insertion)
                                      v
+-----------------------------------------------------------------------------------+
|                           STORAGE & PERSISTENCE LAYER                             |
|  - SQLite RDBMS (energy.db) with Foreign Keys & B-Tree Indexes                    |
|  - Tables: buildings, users, energy_readings, alerts, tariffs, faculty_settings   |
|  - True Riemann Trapezoidal Integration & State-Machine Alert Tracking            |
+-----------------------------------------------------------------------------------+
                                      |
                                      | (SQLAlchemy / sqlite3 Dict Rows)
                                      v
+-----------------------------------------------------------------------------------+
|                           APPLICATION & API LAYER                                 |
|  - Python Flask REST Backend (app.py)                                             |
|  - Cryptographic Session Authentication (SHA-256 Werkzeug Security)               |
|  - Role-Based Access Control (RBAC): Administrator vs. Viewer                     |
|  - Anomaly Detection Engine (Auto-Clearing State Machine)                         |
|  - Demonstration Institutional Tariff & Cost Engine                               |
|  - Reporting Engine (16-Parameter Audit, CSV Telemetry Streaming, Print HTML)     |
+-----------------------------------------------------------------------------------+
                                      |
                                      | (JSON REST Endpoints & HTML Templates)
                                      v
+-----------------------------------------------------------------------------------+
|                           PRESENTATION / UI LAYER                                 |
|  - University of Ruhuna Branded Dark Engineering Portal (Outfit & JetBrains Mono) |
|  - Standardized 6 Navigation Views:                                               |
|      1. Live Monitor (/dashboard)                                                 |
|      2. Historical Analytics (/analytics)                                         |
|      3. Electrical Alerts (/alerts)                                               |
|      4. Cost & Efficiency (/cost-efficiency)                                      |
|      5. Audit Reports (/reports)                                                  |
|      6. Printable Audit View (/reports/printable)                                 |
|  - Interactive Chart.js Visualizations (Sliding-window Real-time & Bar Charts)    |
|  - 5-Second Real-Time AJAX Polling & CSV Downloader                               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Component Details

### A. Physics Simulation Layer (`simulator.py`)
- Simulates realistic smart energy meter hardware (e.g., Schneider Electric, Socomec, or Carlo Gavazzi Modbus power analyzers) installed at 400 V main distribution boards (MDBs).
- Generates 8 distinct electrical quantities per building every 15 seconds:
  1. Line-to-line voltage ($V_L \approx 400\text{ V}$)
  2. Line current ($I_L \text{ Amperes}$)
  3. Power Factor ($PF = \cos \phi$)
  4. System Frequency ($f \approx 50.0\text{ Hz}$)
  5. Apparent Power ($S = \sqrt{3} V_L I_L / 1000 \text{ kVA}$)
  6. Active Power ($P = S \times PF \text{ kW}$)
  7. Reactive Power ($Q = \sqrt{S^2 - P^2} \text{ kVAr}$)
  8. Cumulative Integrated Energy ($kWh$)
- Simulates daily academic load curves:
  - `00:00 - 07:00`: Baseline / Standby (Security lighting, servers, refrigeration)
  - `08:00 - 12:00`: Morning Peak (Lecture halls, workshops, HVAC, laboratories)
  - `12:00 - 13:00`: Lunch Dip (Brief lighting reduction)
  - `13:00 - 17:00`: Afternoon Academic Peak (Heavy workshop machinery, computing labs)
  - `17:00 - 24:00`: Evening Decay (After-hours cleaning, library study, hostel baseline)
- Clearly tags all emitted database rows with `is_simulated = 1`.

### B. Persistence Layer (`database.py` & `energy.db`)
- Relational schema optimized with compound indexes:
  - `idx_readings_building_timestamp` on `energy_readings(building_id, timestamp)`
  - `idx_alerts_bldg_active` on `alerts(building_id, is_active)`
  - `idx_alerts_lookup` on `alerts(building_id, alert_type, is_active)`
  - `idx_alerts_timestamp` on `alerts(timestamp DESC)`
- Stores institutional configuration parameters in SQLite:
  - Facility rated power ratings ($kW$) in `buildings`
  - Two-part demonstration tariff rates in `tariffs`
  - Standard operating hours ($08:00\text{--}17:00$) in `faculty_settings`

### C. Backend Engine & API Layer (`app.py`)
- Built using Flask with session-cookie authentication.
- Implements two primary access tiers:
  - **Administrator**: Full access to monitor telemetry, view analytics, filter reports, download CSVs, acknowledge electrical alarms, and modify demonstration tariff parameters.
  - **Viewer**: Read-only access to monitoring, analytics, and reports; restricted from modifying system configurations or acknowledging alerts (receives HTTP 403 Forbidden).
- Endpoints:
  - `GET /api/buildings`: Faculty building metadata.
  - `GET /api/energy/live`: Real-time 3-phase telemetry across all 6 facilities.
  - `GET /api/energy/history`: Query stored telemetry with date and limit filters.
  - `GET /api/energy/analytics`: 13 electrical statistics, Load Factor, and campus totals.
  - `GET /api/alerts`: Real-time active alerts and campus counters.
  - `POST /api/alerts/<id>/acknowledge`: Administrator-only alert acknowledgment.
  - `GET /api/energy/cost`: Demonstration tariff calculations (Energy, Demand, Fixed charges).
  - `GET /api/energy/efficiency`: Power factor compliance, after-hours usage, and observations.
  - `GET /api/energy/efficiency/comparison`: Six-building efficiency rankings.
  - `GET /api/reports/summary`: Comprehensive 16-parameter audit data.
  - `GET /api/reports/export/csv`: Streams historical readings as CSV.
  - `POST /api/config/tariff`: Administrator-only tariff updates.

### D. Presentation Layer
- Custom dark-mode design system (`style.css`) using CSS variables, glassmorphic containers, and typography (`Outfit` and `JetBrains Mono`).
- JavaScript controllers (`dashboard.js`, `analytics.js`, `alerts.js`, `cost_efficiency.js`, `reports.js`) poll backend endpoints and update Chart.js canvases and DOM elements without full-page reloads.
- No client-side telemetry synthesis: all data originates from backend SQLite queries.
- Clean printable PDF audit document accessible at `/reports/printable`.
