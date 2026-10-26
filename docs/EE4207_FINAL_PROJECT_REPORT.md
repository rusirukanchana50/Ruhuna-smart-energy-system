# UNIVERSITY OF RUHUNA — FACULTY OF ENGINEERING
## DEPARTMENT OF ELECTRICAL AND INFORMATION ENGINEERING
### EE4207: Web Application Development — Mini-Project Final Report

---

# Centralized Smart Energy Monitoring and Analytics System for the Faculty of Engineering, University of Ruhuna

**Student Name:** [Your Full Name]  
**Student Registration / Index Number:** [EG/202X/XXXX]  
**Course Code & Module:** EE4207 — Web Application Development  
**Academic Year / Semester:** Academic Year 2025/2026 — Semester 8  
**Department:** Department of Electrical and Information Engineering  
**Submission Date:** October 2026  
**GitHub Repository:** `https://github.com/[Your-Username]/ruhuna-smart-energy-system`  
**Video Demonstration Link:** `https://youtu.be/[Your-Video-ID]`  

---

## Executive Summary

This report documents the design, implementation, security hardening, and verification of the **Ruhuna Smart Energy System**, a full-stack web application developed for the Faculty of Engineering, University of Ruhuna (Hapugala, Galle). The system provides continuous supervision of balanced three-phase electrical consumption ($400\text{ V}$, $50.0\text{ Hz}$), automated safety anomaly detection across 8 electrical conditions, two-part institutional electricity cost estimation, 16-parameter audit reporting, and complete building inventory management with full Create, Read, Update, and Delete (CRUD) capabilities. 

The software architecture integrates a server-rendered and API-driven Flask backend, an embedded SQLite relational database with Write-Ahead Logging (WAL) and enforced foreign keys, and a responsive dark-themed frontend utilizing vanilla HTML5, CSS3, JavaScript (ES6+), and Chart.js. Security is enforced through PBKDF2 password hashing, role-based access control (Administrator and Viewer), timing-safe Cross-Site Request Forgery (CSRF) protection, and private persistent session signing. The system was validated through 14 master automated test suites (142 checks passing with 100% success) and 11 live HTTP socket workflow verifications. All telemetry data is explicitly designated as `SIMULATED` to maintain scientific and academic integrity.

---

## 1. Introduction & Problem Statement

### 1.1 Context & Background
The Faculty of Engineering at the University of Ruhuna comprises multiple specialized academic and administrative complexes distributed across its Hapugala campus, including Civil and Environmental Engineering (CEE), Electrical and Information Engineering (EIE), Mechanical and Manufacturing Engineering (MME), Marine Engineering and Naval Architecture (MENA), Administration (ADMIN), and the Faculty Auditorium (AUDI). Each complex houses distinct electrical equipment, from heavy inductive motor loads in mechanical machine shops and hydraulics pumps in civil labs, to computing clusters, server rooms, and air conditioning units.

### 1.2 Problem Statement
In conventional educational institutions in Sri Lanka, electricity monitoring relies heavily on monthly aggregate utility bills issued by the Ceylon Electricity Board (CEB). This manual, retrospective approach presents major operational challenges:
1. **Lack of Instantaneous Visibility**: Facility engineers cannot observe live three-phase line voltages, currents, active power, or power factor fluctuations.
2. **Delayed Fault Detection**: Abnormal electrical conditions—such as severe undervoltage ($<380\text{ V}$), grid overvoltage ($>420\text{ V}$), or low power factor ($<0.850$)—remain undetected until physical equipment suffers thermal damage or utility surcharges are billed.
3. **Unmonitored After-Hours Waste**: Significant electrical energy is wasted during non-operational hours (weekends and 17:00–08:00 weekdays) due to unmonitored baseline lighting, idle lab rigs, and air conditioning units left running.
4. **Decentralized Data Management**: Facility managers lack a unified, secure database to manage building inventories, track rated capacities, and generate formal audit reports.

### 1.3 Project Objectives
The primary objective of this project is to develop and demonstrate a robust, secure, full-stack web application that solves these challenges:
- **Objective 1 (Core CRUD & Data Management)**: Provide a secure, validated interface to Create, Read, Update, and Safely Delete campus building records with foreign key safeguards.
- **Objective 2 (Three-Phase Power Modeling)**: Simulate balanced $400\text{ V} / 50\text{ Hz}$ electrical parameters using standard AC power formulas ($S$, $P$, $Q$, and rectangular/trapezoidal energy integration).
- **Objective 3 (Automated Anomaly Alerting)**: Implement an automated state-machine alert engine for 8 electrical anomaly conditions without alert duplication.
- **Objective 4 (Institutional Cost & Efficiency Analytics)**: Model energy expenditures using a configurable two-part tariff and analyze Load Factor and after-hours energy.
- **Objective 5 (Audit Reporting & Export)**: Generate 16-parameter audit summaries, stream raw telemetry to CSV, and provide a print-optimized PDF document.
- **Objective 6 (Security & Role-Based Access Control)**: Restrict administrative actions (CRUD, alert acknowledgment, tariff updates) using session security, CSRF protection, and password hashing.

---

## 2. System Architecture & Technologies Used

### 2.1 Multi-Tier Decoupled Architecture
The system adopts an asynchronous client-server architecture separating telemetry generation, database storage, application logic, and user interface rendering:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    THREE-PHASE TELEMETRY SIMULATOR                     │
 │                             (simulator.py)                             │
 │  • 400 V / 50 Hz Nominal AC Model   • Diurnal Working Hours Curves     │
 │  • S (kVA), P (kW), Q (kVAr) Math   • Anomaly Injection (--anomaly)    │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ Direct SQLite Writes (Every 15s)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      SQLITE DATABASE (energy.db)                       │
 │                   PRAGMA foreign_keys = ON | WAL Mode                  │
 │  • buildings (Campus Complexes)     • users (RBAC Hashed Credentials)  │
 │  • energy_readings (SIMULATED Data) • alerts (Active / Cleared State)  │
 │  • tariffs (Demonstration Model)    • faculty_settings (Schedule Rules)│
 └───────────────────────────────────▲────────────────────────────────────┘
                                     │ SQL Queries & Atomic Transactions
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                        FLASK BACKEND (app.py)                          │
 │  • Cryptographic Session Cookie     • Role Decorators (@login_required,│
 │  • Timing-Safe CSRF Verification      @role_required(["Administrator"]))│
 │  • RESTful API Endpoints (/api/...) • Analytical Computation Engine    │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP Responses (JSON / Jinja2 HTML)
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                       WEB BROWSER FRONTEND (UI)                        │
 │  • HTML5 / Jinja2 Server Templates  • Dark Theme Vanilla CSS3 (Grid)   │
 │  • Vanilla JavaScript Controllers   • Interactive Chart.js Graphs      │
 │  • Asynchronous 5s fetch() Polling  • Print Stylesheet (@media print)  │
 └────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack Justification
- **Backend (Python 3.10+ / Flask 3.1+)**: Python provides mathematical precision for electrical power calculations. Flask was selected for its clean WSGI routing, lightweight footprint, and explicit decorator pipeline.
- **Security (Werkzeug 3.1+)**: Provides PBKDF2-HMAC-SHA256 password hashing (`generate_password_hash`, `check_password_hash`) and constant-time string comparisons (`hmac.compare_digest`).
- **Database (SQLite 3 with WAL Mode)**: Embedded relational engine configured with Write-Ahead Logging (`WAL`), `timeout=30.0`, and active foreign key enforcement (`PRAGMA foreign_keys = ON`). This ensures high concurrent read/write throughput between the background simulator and web server.
- **Frontend (Vanilla HTML5, CSS3, ES6 JavaScript)**: Built without heavy frontend frameworks to maximize performance, ensure zero external build-tool dependencies, and maintain full control over styling.
- **Visual Analytics (Chart.js 4.4+)**: Canvas-based client-side charting library for real-time 5-second polling updates and multi-building comparison bar charts.

---

## 3. Database Design & Relational Integrity

### 3.1 Relational Schema & Entity-Relationship Structure
The application database schema is normalized into 6 relational tables in `energy.db`:

```text
 ┌────────────────────────┐                   ┌────────────────────────┐
 │       buildings        │1                 *│    energy_readings     │
 ├────────────────────────┤───────────────────├────────────────────────┤
 │ PK  id (INTEGER)       │                   │ PK  id (INTEGER)       │
 │     name (TEXT UNIQUE) │                   │ FK  building_id (INT)  │
 │     code (TEXT UNIQUE) │                   │     timestamp (TEXT)   │
 │     description (TEXT) │                   │     voltage (REAL)     │
 │     rated_power_kw     │                   │     current (REAL)     │
 └───────────┬────────────┘                   │     power_factor (REAL)│
             │1                               │     frequency (REAL)   │
             │                                │     active_power_kw    │
             │                                │     apparent_power_kva │
             │                                │     reactive_power_kvar│
             │*                               │     energy_kwh (REAL)  │
 ┌───────────┴────────────┐                   │     is_simulated (INT) │
 │         alerts         │                   └────────────────────────┘
 ├────────────────────────┤
 │ PK  id (INTEGER)       │                   ┌────────────────────────┐
 │ FK  building_id (INT)  │                   │         users          │
 │     timestamp (TEXT)   │                   ├────────────────────────┤
 │     alert_type (TEXT)  │                   │ PK  id (INTEGER)       │
 │     severity (TEXT)    │                   │     email (TEXT UNIQUE)│
 │     measured_value     │                   │     password_hash      │
 │     threshold_value    │                   │     full_name (TEXT)   │
 │     message (TEXT)     │                   │     role (TEXT: Admin  │
 │     acknowledged (INT) │                   │           or Viewer)   │
 │     acknowledged_by    │                   │     created_at (TEXT)  │
 │     acknowledged_at    │                   └────────────────────────┘
 │     is_active (INTEGER)│
 │     cleared_at (TEXT)  │                   ┌────────────────────────┐
 └────────────────────────┘                   │        tariffs         │
                                              ├────────────────────────┤
 ┌────────────────────────┐                   │ PK  id (INTEGER)       │
 │    faculty_settings    │                   │     name (TEXT)        │
 ├────────────────────────┤                   │     energy_rate_lkr    │
 │ PK  id (INTEGER)       │                   │     demand_rate_lkr    │
 │     setting_key (TEXT) │                   │     fixed_charge_lkr   │
 │     setting_value      │                   │     active (INTEGER)   │
 │     description (TEXT) │                   └────────────────────────┘
 └────────────────────────┘
```

### 3.2 Foreign Key Safety & Preserving Historical Data
In industrial electrical management, historical telemetry records must never be lost due to accidental user actions. 
1. **Connection Enforcement**: SQLite requires explicit activation of constraints. In `database.py`, every connection executes:
   ```python
   conn.execute("PRAGMA foreign_keys = ON;")
   ```
2. **Safe Deletion Guard**: In `delete_building(building_id)`, the application queries dependent records:
   ```python
   cursor.execute("SELECT COUNT(*) FROM energy_readings WHERE building_id = ?", (b_id,))
   readings_count = cursor.fetchone()[0]
   cursor.execute("SELECT COUNT(*) FROM alerts WHERE building_id = ?", (b_id,))
   alerts_count = cursor.fetchone()[0]
   if readings_count > 0 or alerts_count > 0:
       raise ValueError("Cannot delete building: dependent historical records exist.")
   ```
   If historical records exist, the deletion is rejected with `HTTP 409 Conflict`. If no dependencies exist (a newly created disposable test building), the SQL `DELETE` executes cleanly.

---

## 4. Authentication, Role-Based Access Control (RBAC) & Security Hardening

### 4.1 Authentication & Session Management
- **Password Security**: Passwords are never stored in plain text. They are hashed using PBKDF2-HMAC-SHA256 (`werkzeug.security.generate_password_hash`) with unique per-user cryptographic salts.
- **Session Protection**: Sessions use client-side cryptographically signed cookies. Cookies are hardened with `SESSION_COOKIE_HTTPONLY=True` (preventing JavaScript cookie theft via XSS) and `SESSION_COOKIE_SAMESITE="Lax"`.
- **Persistent Private Secret Key**: In `app.py`, `get_or_create_secret_key()` loads the secret key from the environment (`FLASK_SECRET_KEY`) or reads/generates a high-entropy 256-bit token persisted in a local git-ignored `.secret_key` file. This prevents user sessions from terminating unexpectedly on server restarts.

### 4.2 Role-Based Permissions
The system enforces strict role segregation:
- **Administrator**: Full privileges (Building CRUD, Alert Acknowledgment, Tariff Editing, Reports, CSV Download).
- **Viewer**: Read-only privileges (Dashboard, Historical Analytics, Alert Viewing, Cost Breakdown, CSV Download).
Server-side endpoints are guarded by decorators in `app.py`:
```python
@login_required
@role_required(["Administrator"])
def create_building(): ...
```
Any unauthorized mutation request from a Viewer is halted with `HTTP 403 Forbidden`.

### 4.3 Minimal, Timing-Safe CSRF Defense
To prevent Cross-Site Request Forgery (CSRF) on state-changing requests (`POST`, `PUT`, `DELETE`):
1. **Origin Verification**: In `@app.before_request`, the `Origin` header is verified against `TRUSTED_ORIGINS = {"http://127.0.0.1:5000", "http://localhost:5000"}`. Cross-origin requests from external malicious sites are rejected with `HTTP 403`.
2. **Synchronizer Token**: A unique random token (`session["csrf_token"]`) is generated on login and injected into `<meta name="csrf-token" content="{{ csrf_token }}">`. JavaScript attaches this value to the `X-CSRF-Token` header on all mutation `fetch()` calls. Flask validates the token using timing-safe `hmac.compare_digest`.

---

## 5. Core Feature Implementation: Building CRUD Operations & Input Validation

The Building Management module represents a central evaluation criteria of the EE4207 project, demonstrating end-to-end database integration, form handling, validation, and error reporting.

### 5.1 Create Building (POST `/api/buildings/create`)
- **Client Handling**: In `templates/dashboard.html`, `submitAddBuilding(e)` intercepts form submission via `e.preventDefault()`. It validates inputs, reads the CSRF token, and dispatches a JSON `POST` request.
- **Server Validation & Insertion**: In `app.py`, `create_building()` sanitizes inputs:
  1. `code`: Stripped, normalized to uppercase, length $2–10$, matching regex `^[A-Z0-9_-]+$`.
  2. `name`: Stripped, length $2–100$.
  3. `rated_power_kw`: Strictly validated as a finite positive float greater than $0\text{ kW}$ and $\le 10,000\text{ kW}$.
  4. **Uniqueness**: Queries SQLite for duplicate code or duplicate name. If already assigned, returns `HTTP 409 Conflict`.
  5. **Persistence**: Calls `database.add_building()` within an atomic transaction.

```python
# Server Validation Snippet in app.py
code = validate_building_code(data.get("code"))
name = validate_building_name(data.get("name"))
power_val = validate_rated_power(data.get("rated_power_kw"))

if get_building_by_code(code):
    return jsonify({"status": "error", "message": f"Building code '{code}' already exists."}), 409
```

### 5.2 Read Buildings (GET `/api/buildings` & Jinja2 Server Render)
- **Server Rendering**: In `app.py`, `dashboard()` retrieves all buildings and passes them to `templates/dashboard.html`.
- **Dynamic Client Ingestion**: The live telemetry polling function `fetchLiveEnergy()` calls `ensureBuildingCard(code, r)`, dynamically creating DOM cards for any registered facility.

### 5.3 Update Building (POST `/api/buildings/<id>/update`)
- **Client Handling**: The administrator clicks "Edit" in the Manage Buildings modal. Table cells switch to active input fields via `toggleEditBuilding(id)`. Clicking "Save" calls `saveBuildingEdit(id)`.
- **Server Processing**: `update_building_api(id)` validates input ranges and checks uniqueness against other buildings (`exclude_id=id`), allowing a building to retain its own existing code while updating its rated capacity.

### 5.4 Delete Building (POST `/api/buildings/<id>/delete`)
- **Safeguard Enforcement**: Calling delete on a historical building (such as CEE with over 1,500 readings) triggers the dependency check in `database.delete_building()`, aborting the delete and returning `HTTP 409 Conflict`.
- **Successful Safe Deletion**: When an administrator creates a disposable building (e.g. `DISP`) without telemetry, no dependencies exist. The SQL `DELETE` executes cleanly, returning `HTTP 200 OK`, and the table immediately updates.

---

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INSERT SCREENSHOT 1 HERE                              │
│ Screenshot of Manage Buildings Modal showing:                               │
│  1. Input validation error ("Building code 'CEE' already exists")           │
│  2. Inventory table with Edit, Save, and Delete buttons                     │
│  3. Blocked deletion alert notification protecting historical records       │
└─────────────────────────────────────────────────────────────────────────────┘
Figure 1: Building Management CRUD modal showing validation and safe deletion enforcement.
```

---

## 6. Three-Phase Electrical Simulation & Mathematical Modeling

*Note: All electrical telemetry generated by `simulator.py` is explicitly designated as `SIMULATED`.*

### 6.1 Three-Phase Power Formulations
The application models a balanced three-phase 4-wire electrical distribution system ($400.0\text{ V}$ line-to-line, $50.0\text{ Hz}$). The calculations implemented in [`simulator.py`](simulator.py) are:

1. **Apparent Power ($S$)**: Total power flowing through the three-phase conductors:
   $$S = \frac{\sqrt{3} \times V_L \times I_L}{1000} \quad [\text{kVA}]$$
2. **Active Power ($P$)**: Useful power converted into work:
   $$P = S \times \text{PF} = \frac{\sqrt{3} \times V_L \times I_L \times \text{PF}}{1000} \quad [\text{kW}]$$
3. **Reactive Power ($Q$)**: Sustaining magnetic fields in inductive loads ($\sin\theta = \sqrt{1 - \text{PF}^2}$):
   $$Q = S \times \sqrt{1 - \text{PF}^2} \quad [\text{kVAr}]$$
4. **Power Triangle Verification**: The fundamental relationship $S^2 = P^2 + Q^2$ is enforced across all cycles.

### 6.2 Energy Integration: Rectangular vs. Trapezoidal Methods
- **Real-Time Step Integration (in `simulator.py`)**: Uses rectangular (Euler) numerical integration:
  $$\Delta E_i = P_i \times \frac{\Delta t_i}{3600} \quad [\text{kWh}], \quad E_{\text{cumulative}} = E_{\text{prev}} + \Delta E_i$$
- **Historical Query Integration (in `database.py`)**: When recalculating net consumption over a user-filtered date range, trapezoidal numerical integration is used:
  $$\Delta E_i = \left( \frac{P_{i-1} + P_i}{2} \right) \times \frac{\Delta t_i}{3600} \quad [\text{kWh}]$$
- **Missing Sensor Gap Protection**: If elapsed time between consecutive readings exceeds $60.0\text{ seconds}$ (`MAX_CONTINUOUS_GAP_SECONDS`), the system treats the gap as sensor downtime and credits only a single nominal $15.0\text{ s}$ active interval, preventing false energy inflation.

### 6.3 Campus Diurnal Load Profiles
In `simulator.py`, `BUILDING_PROFILES` defines base/peak currents and power factor ranges for the 6 core facilities:
- **Mechanical (MME)**: Highest inductive current ($60–125\text{ A}$) and lowest power factor ($0.82–0.89$) due to machine shop motors.
- **Electrical (EIE)**: High computing load ($48–95\text{ A}$, $\text{PF } 0.88–0.94$).
- **Administration (ADMIN)**: Moderate office AC and lighting ($20–55\text{ A}$, $\text{PF } 0.90–0.95$).
- **Diurnal Factor**: `get_diurnal_load_factor()` scales current using a sinusoidal curve peaking at midday ($11:30–13:30$), tapering in the evening, and dropping to a $0.20$ baseline at night.

---

## 7. Electrical Alerts, Historical Analytics & Two-Part Cost Estimation

### 7.1 Electrical Alerts State Machine
The alert engine in `database.py` evaluates 8 configured engineering thresholds:
1. `LOW_POWER_FACTOR`: $\text{PF} < 0.850$ (WARNING)
2. `LOW_VOLTAGE`: $V_L < 380.0\text{ V}$ (CRITICAL, $-5\%$ nominal)
3. `HIGH_VOLTAGE`: $V_L > 420.0\text{ V}$ (CRITICAL, $+5\%$ nominal)
4. `HIGH_FREQUENCY`: $f > 50.50\text{ Hz}$ (WARNING, $+1\%$ nominal)
5. `LOW_FREQUENCY`: $f < 49.50\text{ Hz}$ (WARNING, $-1\%$ nominal)
6. `HIGH_LOAD`: $P > 90\%$ of building rated power (WARNING)
7. `OVERLOAD`: $P > 100\%$ of building rated power (CRITICAL)
8. `SENSOR_OFFLINE`: Sensor silence $> 60.0\text{ s}$ (WARNING)

- **De-duplication**: `trigger_alert()` checks if an active alert already exists for `(building_id, alert_type)`. If active, it avoids inserting duplicate rows.
- **Acknowledgment vs. Resolution**: An Administrator acknowledgment (`POST /api/alerts/<id>/acknowledge`) records administrative awareness (`acknowledged = 1`), but **`is_active` remains 1** until electrical parameters physically normalize. Once normal, `clear_alert()` sets `is_active = 0`.

### 7.2 Historical Analytics & Operational Load Factor
- **Load Factor ($\text{LF}$)**: Evaluated in `calculate_building_analytics()` as the arithmetic average active power divided by peak demand:
  $$\text{LF} = \frac{P_{\text{avg}}}{P_{\text{peak}}} = \frac{\frac{1}{N}\sum P_i}{\max(P)}$$
  *Interpretation*: A higher load factor indicates steady, uniform capacity utilization; it does not necessarily imply low consumption or high efficiency.
- **After-Hours Energy**: Defined in `faculty_settings` as Monday–Friday outside 08:00–17:00 and all 24 hours on weekends. The engine integrates after-hours consumption ($\text{kWh}$) and after-hours percentage ($\%$) to flag idle energy waste.

### 7.3 Demonstration Two-Part Tariff Cost Model
*Disclaimer: All electricity cost calculations represent non-official demonstration models configured in SQLite to show industrial two-part billing concepts.*

$$\text{Total Cost} = C_{\text{energy}} + C_{\text{demand}} + C_{\text{fixed}} \quad [\text{LKR}]$$
Where:
- **Energy Charge**: $C_{\text{energy}} = E_{\text{total}} \times 38.50\text{ LKR/kWh}$
- **Demand Charge**: $C_{\text{demand}} = P_{\text{peak}} \times 1,450.00\text{ LKR/kW} \times \left( \frac{T_{\text{days}}}{30} \right)$
- **Fixed Charge**: $C_{\text{fixed}} = 3,000.00\text{ LKR} \times \left( \frac{T_{\text{days}}}{30} \right)$

---

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INSERT SCREENSHOT 2 HERE                              │
│ Screenshot of Live Monitoring Dashboard (/dashboard) showing:              │
│  1. Top Campus KPI summary cards (Total Power, Energy, Avg PF)              │
│  2. Chart.js real-time Line Chart (Active Power over time)                  │
│  3. Building Telemetry Cards with "SIMULATED" badge and Power Factor tags   │
└─────────────────────────────────────────────────────────────────────────────┘
Figure 2: Live energy monitoring dashboard displaying real-time telemetry and Chart.js analytics.
```

---

## 8. Audit Reports, CSV Export & Formal Printable View

### 8.1 16-Parameter Engineering Audit Summary
In `database.py`, `get_comprehensive_energy_report()` compiles a 16-metric audit summary across user-defined time windows:
1. Total Energy ($\text{kWh}$)
2. Average Active Power ($\text{kW}$)
3. Peak Active Demand ($\text{kW}$)
4. Minimum Active Power ($\text{kW}$)
5. Average Apparent Power ($\text{kVA}$)
6. Average Reactive Power ($\text{kVAr}$)
7. Average Power Factor
8. Minimum Power Factor
9. Load Factor ($\%$)
10. Average Voltage ($\text{V}$)
11. Voltage Range ($\text{Min / Max V}$)
12. Average Frequency ($\text{Hz}$)
13. After-Hours Energy ($\text{kWh}$ and $\%$)
14. Operating-Hours Energy ($\text{kWh}$)
15. Estimated Cost Breakdown ($\text{LKR}$)
16. Total Alerts Breakdown (Warning and Critical counts)

### 8.2 Data Export & Printable PDF Output
- **Raw CSV Streaming (`GET /api/reports/export/csv`)**: Streams historical telemetry rows directly from SQLite using Python's `csv.writer`, including voltage, current, PF, apparent/active/reactive power, and cumulative kWh.
- **Formal Printable Document (`GET /reports/printable`)**: Renders `printable_report.html` formatted with `@media print` CSS. Users can archive or submit official reports via the browser's built-in "Print / Save as PDF" function without requiring heavy server-side PDF generation binaries.

---

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INSERT SCREENSHOT 3 HERE                              │
│ Screenshot of Reports Page (/reports) showing:                              │
│  1. 16-parameter energy summary cards and date filter presets               │
│  2. Multi-building comparative efficiency breakdown table                   │
│  3. "Download Raw CSV" and "Printable Audit Report" action buttons          │
└─────────────────────────────────────────────────────────────────────────────┘
Figure 3: Comprehensive energy audit reporting portal with CSV export and printable report triggers.
```

---

## 9. Verification, Automated Testing & Evaluation Results

### 9.1 Verification Methodology
The system was verified using a layered testing approach:
1. **Master Automated Test Suite (`run_all_tests.py`)**: 14 test modules executing 142 assertions via Flask's test client, testing database transactions, foreign key constraints, mathematical ground-truth formulas, session security, and CSRF defense.
2. **Live HTTP Network Socket Suite**: 11 live socket tests executing against the running Flask server (`http://127.0.0.1:5000`) using Python's `urllib` with real HTTP headers, cookies, and CSRF tokens.
3. **Frontend Syntax & Script Verification**: Automated syntax validation across all JavaScript controllers and HTML inline scripts using `node --check`.

### 9.2 Summary of Verification Results
```text
=====================================================================================
 MASTER AUTOMATED TEST EXECUTION SCORECARD (run_all_tests.py)
=====================================================================================
 Suite Name                          Checks  Status  Duration  Focus Area
-------------------------------------------------------------------------------------
 Phase 1: Database & Buildings REST   5/5    PASSED  0.98 s    Schema & Building API
 Phase 2: Authentication & RBAC       8/8    PASSED  1.78 s    Password Hash & Sessions
 Phase 3: Three-Phase Simulator Math  4/4    PASSED  3.04 s    S, P, Q Power Triangle
 Phase 4: Live Telemetry Dashboard    3/3    PASSED  2.89 s    Live API & Dynamic Cards
 Phase 5: Historical Analytics        5/5    PASSED  3.19 s    Analytics & Presets
 Phase 5 Thorough: Ground Truth      70/70   PASSED  5.16 s    Mathematical Ground-Truth
 Phase 6: Electrical Alerts Engine    7/7    PASSED  7.43 s    8-Anomaly State Machine
 Phase 7: Cost Calculation Model      7/7    PASSED  4.83 s    Two-Part Tariff Formulas
 Phase 8: Reports, CSV & Printable    4/4    PASSED  4.55 s    16 Metrics & CSV Stream
 Phase 10: End-to-End User Journey   10/10   PASSED  7.87 s    Full Workflow Sequence
 Phase 9: Multi-Phase Integration     6/6    PASSED  1.17 s    System Integration
 Phase 11: Foreign Key Safety         4/4    PASSED  2.22 s    Blocked & Safe Deletion
 Phase 12: Input Validation & Bounds  4/4    PASSED  1.78 s    Regex, Uniqueness & Range
 Phase 13: CSRF & Secret Key Defense  5/5    PASSED  1.37 s    Origin & Token Security
-------------------------------------------------------------------------------------
 Total Test Execution: 14 / 14 Suites Passed | 142 / 142 Checks Passed (100% Success)
 Total Live HTTP Socket Execution: 11 / 11 Checks Passed | Zero JavaScript Syntax Errors
=====================================================================================
```

---

## 10. EE4207 Marking Rubric Alignment

| Rubric Evaluation Criteria | Target Weight | Implemented Project Features | Verified Evidence in Codebase |
| :--- | :---: | :--- | :--- |
| **1. System Architecture & Tech Stack** | 10% | Decoupled client-server architecture; Flask 3.1 WSGI backend; SQLite 3 WAL database; vanilla HTML5/CSS3/JS. | [`app.py`](app.py), [`simulator.py`](simulator.py), [`style.css`](static/css/style.css). |
| **2. Database Design & Integrity** | 15% | 6 normalized tables, active foreign key constraints (`PRAGMA foreign_keys = ON`), safe deletion dependency guards. | [`database.py`](database.py), [`test_building_deletion.py`](test_building_deletion.py). |
| **3. Core Building CRUD Functionality** | 20% | Full Create, Read, Update, and Safe Delete implementation with modal UI and atomic SQLite commits. | [`app.py`](app.py), [`dashboard.html`](templates/dashboard.html). |
| **4. Input Validation & Error Handling** | 10% | Client & server regex validation for codes (`^[A-Z0-9_-]+$`), finite positive power floats ($>0\text{ kW}$), uniqueness checks. | [`test_validation.py`](test_validation.py), [`app.py`](app.py). |
| **5. Authentication & Role Security (RBAC)** | 10% | PBKDF2 password hashing, `@role_required(["Administrator"])` decorators, distinct Admin vs. Viewer interfaces. | [`test_phase2.py`](test_phase2.py), [`app.py`](app.py). |
| **6. Web Security & CSRF Defense** | 10% | Origin verification, synchronizer token defense (`hmac.compare_digest`), `HttpOnly` and `SameSite=Lax` cookies. | [`test_csrf_security.py`](test_csrf_security.py), [`app.py`](app.py). |
| **7. Domain Features: Modeling & Analytics** | 15% | Balanced 3-phase AC power triangle ($S, P, Q$), 8-condition alert engine, Load Factor, Two-part tariff cost model. | [`simulator.py`](simulator.py), [`FORMULAS.md`](FORMULAS.md), [`database.py`](database.py). |
| **8. Reporting, CSV & Print View** | 5% | 16-parameter summary, raw CSV streaming export, printable audit report with `@media print` CSS. | [`test_phase8.py`](test_phase8.py), [`printable_report.html`](templates/printable_report.html). |
| **9. Testing & Quality Assurance** | 5% | 14 test modules, 142 assertions passing (100%), live HTTP socket verification suite. | [`run_all_tests.py`](run_all_tests.py). |

---

## 11. Real-World Limitations & Future Work

While the system is fully functional for local demonstration and academic evaluation, real-world deployment across the university would require addressing several engineering limitations:
1. **Physical Meter Hardware Integration**: The prototype uses software-generated telemetry. In a permanent deployment, digital multi-function meters (e.g. Schneider PM5000 or Janitza) with split-core Current Transformers (CTs) and an industrial IoT gateway (Raspberry Pi / MOXA with RS-485 Modbus RTU) would be required to transmit physical readings.
2. **Phase Unbalance & Harmonics (THD)**: The mathematical model assumes balanced three-phase loads. Real university buildings have single-phase office and computer loads distributed unevenly across phases, producing neutral currents and harmonic distortion from non-linear power supplies.
3. **Automated Remote Alert Dispatch**: Currently, electrical alerts appear within the web console. A production upgrade would incorporate automated SMS dispatch (via Twilio) or SMTP email notifications for critical overvoltage and overload events.
4. **Production Deployment (HTTPS & WSGI)**: The demonstration server runs on Flask's internal WSGI server over HTTP. In production, the system should be deployed behind a reverse proxy (Nginx) using Gunicorn, with TLS/SSL certificates to enable `SESSION_COOKIE_SECURE=True`.

---

## 12. Conclusion

The **Ruhuna Smart Energy System** successfully addresses the operational challenges of campus energy monitoring for the Faculty of Engineering, University of Ruhuna. By integrating real-time telemetry supervision, three-phase power modeling, automated anomaly alerting, institutional cost estimation, and complete building inventory CRUD management with foreign key safeguards, the project provides a comprehensive software engineering solution. 

The application adheres to modern web engineering principles, demonstrating robust server-side validation, role-based security, timing-safe CSRF protection, and responsive dark-themed styling. Rigorous testing—comprising 142 automated checks across 14 test suites and 11 live HTTP socket workflow tests—confirms that the system is fully functional, secure, and ready for university evaluation and demonstration.

---

### Instructions for Final Document Export to PDF
1. **Open** this file (`EE4207_FINAL_PROJECT_REPORT.md`) in VS Code or any Markdown editor.
2. **Capture the 3 Specified Screenshots**:
   - **Screenshot 1**: Manage Buildings Modal showing validation error and blocked deletion alert.
   - **Screenshot 2**: Live Monitoring Dashboard (`/dashboard`) showing KPI cards and Chart.js line graphs.
   - **Screenshot 3**: Reports Page (`/reports`) showing 16 metrics and action buttons.
3. **Replace the 3 Screenshot Placeholder Boxes** with the captured image files using Markdown syntax:
   `![Figure 1: Building Management Modal](screenshots/fig1_crud_modal.png)`
4. **Insert Your Personal Details**: Replace `[Your Full Name]`, `[EG/202X/XXXX]`, `https://github.com/...`, and `https://youtu.be/...`.
5. **Export to PDF**: Use VS Code's "Markdown PDF: Export (pdf)" extension or print from your browser to PDF. The resulting document formats cleanly within the 8–10 page limit.
