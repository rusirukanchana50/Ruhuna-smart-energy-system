# University of Ruhuna — Faculty of Engineering
# Smart Energy Monitoring and Analytics System

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue.svg)](https://www.python.org/)
[![Flask 3.0+](https://img.shields.io/badge/Flask-3.0%2B-green.svg)](https://flask.palletsprojects.com/)
[![SQLite 3](https://img.shields.io/badge/Database-SQLite%20WAL-orange.svg)](https://www.sqlite.org/)
[![Tests Passing](https://img.shields.io/badge/Tests-129%2F129%20Passed-brightgreen.svg)](run_all_tests.py)
[![Academic License](https://img.shields.io/badge/License-Academic%20Project-purple.svg)]()

A centralized, real-time three-phase electrical energy monitoring, anomaly detection, and analytics web portal developed for the **Faculty of Engineering, University of Ruhuna** (Hapugala, Galle, Sri Lanka).

---

## 🎯 1. Project Objective

The primary objective of this project is to develop and demonstrate a centralized Smart Energy Monitoring and Analytics platform to supervise electrical consumption, power quality, and operational costs across the academic and administrative complexes of the Faculty of Engineering, University of Ruhuna.

### Specific Engineering Objectives:
1. **Real-Time Telemetry Supervision**: Monitor balanced three-phase electrical parameters ($400\text{ V Line-to-Line}$, $50.0\text{ Hz}$) for 6 major campus complexes with continuous 5-second dashboard updates.
2. **Accurate Electrical Power Modeling**: Implement three-phase AC power triangle calculations ($S = \sqrt{3} V_L I_L$, $P = S \times \text{PF}$, $Q = \sqrt{S^2 - P^2}$) and discrete trapezoidal energy integration with missing sensor data credit protection.
3. **Automated Anomaly & Safety Alerting**: Maintain a state-machine tracking engine for 8 critical electrical abnormal conditions (Low Power Factor, Undervoltage, Overvoltage, Frequency Excursions, Feeder High Load, Feeder Overload, and Sensor Offline).
4. **Energy Cost & Institutional Tariff Analysis**: Model electricity expenditures using a configurable two-part industrial/commercial tariff (energy charge, peak demand charge, and fixed monthly charge) with automated after-hours energy tracking (08:00–17:00 weekdays).
5. **Role-Based Access Control (RBAC)**: Secure access using cryptographically signed sessions and hashed passwords, separating administrative functions from read-only viewers.
6. **Formal Audit Reporting & Export**: Generate 16-parameter energy audit summaries, stream raw telemetry CSV exports, and provide an official university-formatted printable PDF report.
7. **Academic Transparency**: Explicitly label all simulated telemetry as `SIMULATED` across user interfaces, API responses, CSV downloads, and reports to preserve scientific honesty.

---

## 🛠️ 2. Technologies Used

### Backend Stack
- **Python 3.10+**: Core programming language.
- **Flask (v3.1+)**: WSGI web application framework and RESTful API router.
- **Werkzeug (v3.1+)**: Secure password hashing via PBKDF2/scrypt (`generate_password_hash`, `check_password_hash`) and cryptographic utilities.
- **Flask-CORS (v6.0+)**: Cross-Origin Resource Sharing handling with credentials support.
- **SQLite 3**: Embedded relational database configured with **Write-Ahead Logging (`WAL` mode)** and `timeout=30.0` for high multi-process concurrency between server and simulator.

### Frontend Stack
- **HTML5 (Semantic)**: Accessible document structure with Jinja2 server-side rendering.
- **Vanilla CSS3**: Tailored dark-mode theme (`#0b1121`), glassmorphism, responsive CSS Grid/Flexbox layouts, and `@media print` print styling.
- **Vanilla JavaScript (ES6+)**: Asynchronous fetch API, real-time 5-second polling, dynamic DOM updates, and client-side form validation.
- **Chart.js (v4.4+)**: Interactive client-side canvas charts (time-series line charts, multi-department comparative bar charts).

---

## 🏗️ 3. System Architecture

The system utilizes a multi-tier, decoupled architecture designed for concurrent data simulation and web serving:

```text
  +-------------------------------------------------------------------------+
  |                     Three-Phase Telemetry Simulator                     |
  |                              (simulator.py)                             |
  |  - Balanced 400V / 50Hz Generator                                       |
  |  - Diurnal Load Curves (08:00-17:00 Working Peak vs Night Baseline)     |
  |  - Apparent (kVA), Active (kW), Reactive (kVAr) & Incremental kWh       |
  |  - Controlled Anomaly Injection (--anomaly LOW_PF, LOW_VOLTAGE, etc.)   |
  +-------------------------------------------------------------------------+
                                       │
                                       ▼ (Direct Transactional Writes)
  +-------------------------------------------------------------------------+
  |                      SQLite Database (energy.db)                        |
  |                       Configured with WAL Mode                          |
  |  - buildings (6 Faculty Complexes)                                      |
  |  - users (Administrator / Viewer with hashed credentials)               |
  |  - energy_readings (Timestamped 3-phase records, marked SIMULATED)      |
  |  - alerts (Active / Cleared State-Machine Anomaly Log)                  |
  |  - tariffs (Demonstration Two-Part Institutional Tariff Model)          |
  |  - faculty_settings (Operating Hours & Schedule Parameters)             |
  +-------------------------------------------------------------------------+
                     ▲                                   ▲
                     │ (Reads Telemetry)                 │ (Writes / Ack)
  +-------------------------------------------------------------------------+
  |                         Flask Web Backend (app.py)                      |
  |  - Cryptographic Session Management (FLASK_SECRET_KEY)                  |
  |  - Role-Based Access Control (@login_required, @admin_required)         |
  |  - Analytical Computation Engine (database.py)                          |
  |  - REST APIs: /api/energy/live, /api/energy/analytics, /api/alerts,     |
  |               /api/energy/cost, /api/reports/summary, CSV export        |
  +-------------------------------------------------------------------------+
                                       │
                                       ▼ (JSON / HTML Server-Side Render)
  +-------------------------------------------------------------------------+
  |                       Web Browser User Interface                        |
  |  - /dashboard        : Live Substation Monitor & 5s Chart.js Polling    |
  |  - /analytics        : Historical Electrical Hub & Load Factor Analysis |
  |  - /alerts           : Safety Violations Log & Admin Acknowledgment     |
  |  - /cost-efficiency  : Two-Part Tariff Cost Model & Rankings            |
  |  - /reports          : 16-Metric Audit Summaries & CSV Download         |
  |  - /reports/printable: Official University PDF Print Document           |
  +-------------------------------------------------------------------------+
```

---

## 📥 4. Installation & Database Setup Instructions

### Prerequisites
- Python 3.10, 3.11, or 3.12 installed on your system.
- Git installed on your system.

### Step-by-Step Setup
1. **Clone the repository** and navigate to the project root:
   ```bash
   git clone https://github.com/rusirukanchana50/Ruhuna-smart-energy-system.git
   cd Ruhuna-smart-energy-system
   ```

2. **Create and activate a Python virtual environment** (recommended):
   - **Windows (PowerShell)**:
     ```powershell
     python -m venv .venv
     .\.venv\Scripts\Activate.ps1
     ```
   - **Linux / macOS**:
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     ```

3. **Install required Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Verify that dependencies are satisfied**:
   ```bash
   python -c "import flask, flask_cors, werkzeug, sqlite3; print('All dependencies verified successfully!')"
   ```

5. **Initialize the SQLite Database**:
   - The application uses an embedded SQLite database (`energy.db`) with Write-Ahead Logging (`WAL`).
   - The database file and all required tables (6 campus complex buildings, tariffs, faculty operating schedules) initialize automatically when `app.py`, `create_user.py`, or `simulator.py` is first run.
   - You can also explicitly initialize the database schema at any time with:
     ```bash
     python -c "import database; database.init_db(); print('Database schema and faculty buildings initialized.')"
     ```

6. **(Optional) Configure Environment Variables**:
   - Copy the `.env.example` template if you wish to customize port, session secrets, or electrical thresholds:
     ```bash
     # Windows (PowerShell)
     Copy-Item .env.example .env
     # Linux / macOS
     cp .env.example .env
     ```

---

## 👤 5. How to Create Demonstration Accounts Securely

User accounts can be created either interactively or non-interactively using the secure `create_user.py` utility. Passwords are masked using Python's standard `getpass` module and stored securely with Werkzeug PBKDF2 cryptographic hashing.

### Interactive Mode:
```bash
python create_user.py
```
Follow the on-screen prompts to enter Full Name, University Email, Role (`1` for Administrator, `2` for Viewer), and Password (masked).

### Non-Interactive (Command-Line) Mode:
```bash
# Provision a Primary Administrator Account:
python create_user.py --email admin@eng.ruh.ac.lk --name "Faculty Administrator" --role Administrator --password "AdminSecretPassword123!"

# Provision a Read-Only Viewer Account:
python create_user.py --email viewer@eng.ruh.ac.lk --name "Student Viewer" --role Viewer --password "ViewerSecretPassword123!"
```

> **Note on Fresh Clones**: Since `energy.db` is ignored by Git to prevent exposing telemetry and sensitive data, create your initial Administrator account using `create_user.py` before logging into the web portal for the first time.

---

## 🚀 6. How to Run `app.py` (Flask Web Application)

In your first terminal, launch the web application server:

```powershell
python app.py
```

- Flask starts on `http://127.0.0.1:5000`.
- The database connection automatically initializes `energy.db` with WAL mode.
- Access the web application in any modern browser at `http://127.0.0.1:5000`.

---

## ⚡ 7. How to Run `simulator.py` (Telemetry Simulator)

In a **separate second terminal**, run the three-phase electrical simulator:

```powershell
# Run with standard 15-second sampling interval:
python simulator.py

# Run with fast 5-second interval (recommended for live viva demonstrations):
python simulator.py --interval 5.0

# Run a single cycle and exit (useful for quick database population):
python simulator.py --once

# Run with live anomaly injection (for testing alerts):
python simulator.py --interval 5.0 --anomaly LOW_PF --building-id 1
```

Supported anomaly injection types:
- `LOW_PF`: Drops Power Factor below $0.85$ to trigger a Low PF warning.
- `LOW_VOLTAGE`: Drops Line Voltage below $380\text{ V}$ to trigger an Undervoltage critical alert.
- `HIGH_VOLTAGE`: Spikes Line Voltage above $420\text{ V}$ to trigger an Overvoltage critical alert.
- `HIGH_LOAD`: Drives Active Power $> 90\%$ of feeder rated capacity to trigger High Demand warning.
- `OVERLOAD`: Drives Active Power $> 100\%$ of feeder rated capacity to trigger Overload critical alert.
- `HIGH_FREQ` / `LOW_FREQ`: Grid frequency deviations ($> 50.5\text{ Hz}$ or $< 49.5\text{ Hz}$).

---

## 🌐 8. How to Access the Application

1. Open your web browser (Chrome, Edge, Firefox, or Safari).
2. Visit:
   ```text
   http://127.0.0.1:5000
   ```
3. You will be greeted by the branded **Sign In** screen.
4. Enter credentials (e.g., `admin@ruh.ac.lk` / `AdminSecretPassword123!`).
5. After authentication, you will be redirected to the **Live Monitor Dashboard**.

---

## 📋 9. Step-by-Step Demonstration Procedure (Viva Walkthrough)

Follow this verified sequence during viva evaluations:

| Step | Page / Action | Demonstration Focus |
|---|---|---|
| **1** | `/login` | Show dark-themed faculty crest, form validation, show/hide password toggle, and RBAC authentication. |
| **2** | `/dashboard` | View 6 building substation cards, 5-second real-time polling, and sliding-window Chart.js graphs. Point out the `SIMULATED DATA` disclaimer badge. |
| **3** | `/analytics` | Filter historical telemetry by department (e.g. `CEE`), test presets (`1h`, `today`, `24h`, `7d`), and explain **Load Factor** ($\text{LF} = P_{\text{avg}} / P_{\text{peak}}$). Show the 6-building comparative graphs. |
| **4** | `/alerts` | Observe active electrical threshold violations. Switch to Terminal 2, inject an anomaly (`--anomaly LOW_PF`), and watch the alert banner appear live. Demonstrate **Administrator Acknowledgment**. |
| **5** | `/cost-efficiency` | Explain the two-part demonstration institutional tariff (Energy + Peak Demand + Fixed), after-hours consumption detection (08:00–17:00 weekdays), and departmental efficiency rankings. |
| **6** | `/reports` | Generate a 16-parameter summary audit report, download the timestamped raw telemetry CSV export, and open the `/reports/printable` official PDF print view. |
| **7** | `/logout` | Log out and verify that unauthorized requests back to `/dashboard` or `/api/energy/live` are blocked with HTTP 302 / 401. |

For detailed speaking notes and examiner Q&A answers, refer to [DEMO_MODE.md](DEMO_MODE.md).

---

## ⚙️ 10. System Configuration & Tuning

Configuration parameters can be adjusted easily without modifying source code:

### Environment Variables (`.env.example`):
- `FLASK_SECRET_KEY`: Cryptographic session key (e.g., `export FLASK_SECRET_KEY="my-key"`).
- `SIMULATOR_INTERVAL`: Default telemetry sampling interval in seconds (default: `15.0`).
- `THRESHOLD_PF_LOW`: Power factor warning limit (default: `0.85`).
- `THRESHOLD_VOLTAGE_MIN`: Minimum line voltage in Volts (default: `380.0`).
- `THRESHOLD_VOLTAGE_MAX`: Maximum line voltage in Volts (default: `420.0`).
- `THRESHOLD_FREQ_MIN`: Minimum frequency in Hz (default: `49.5`).
- `THRESHOLD_FREQ_MAX`: Maximum frequency in Hz (default: `50.5`).
- `THRESHOLD_HIGH_LOAD_RATIO`: High load warning ratio (default: `0.90` = 90% of rated capacity).
- `THRESHOLD_SENSOR_OFFLINE`: Sensor silence alert threshold in seconds (default: `60.0`).

### Command-Line Tuning Tool (`configure_system.py`):
```powershell
# View all active system parameters:
python configure_system.py --show

# Change building rated capacity:
python configure_system.py --building CEE --rated-power 65.0

# Adjust faculty standard operating hours:
python configure_system.py --hours-start 08:30 --hours-end 16:30

# Adjust demonstration tariff rates:
python configure_system.py --energy-rate 42.0 --demand-rate 1500.0 --fixed-charge 3500.0
```

---

## 🧪 11. Automated Test Suite

Run the master automated test runner to verify complete system integrity:

```powershell
python run_all_tests.py
```

### Test Suite Scorecard:
```text
=====================================================================================
 MASTER TEST EXECUTION SUMMARY TABLE
=====================================================================================
 #   | Test Script              | Status   | Checks   | Time     | Description
-------------------------------------------------------------------------------------
 1   | test_app.py              | [PASS]   | 5/5      | 0.57s    | Phase 1: Database & Buildings REST API
 2   | test_phase2.py           | [PASS]   | 8/8      | 0.63s    | Phase 2: Authentication, RBAC & Session Protection
 3   | test_phase3.py           | [PASS]   | 4/4      | 1.78s    | Phase 3: Three-Phase Simulator & Electrical Math
 4   | test_phase4.py           | [PASS]   | 3/3      | 1.17s    | Phase 4: Live Telemetry Dashboard & Polling
 5   | test_phase5.py           | [PASS]   | 5/5      | 0.94s    | Phase 5: Historical Analytics & Load Factor
 6   | test_phase5_thorough.py  | [PASS]   | 70/70    | 1.96s    | Phase 5 Thorough: Mathematical Ground-Truth & Edge Cases
 7   | test_phase6.py           | [PASS]   | 7/7      | 1.31s    | Phase 6: Electrical Alerts & Anomaly Detection
 8   | test_phase7.py           | [PASS]   | 7/7      | 1.14s    | Phase 7: Cost Calculation & Efficiency Analysis
 9   | test_phase8.py           | [PASS]   | 4/4      | 1.33s    | Phase 8: Comprehensive Reports, CSV Export & RBAC
 10  | test_workflow_e2e.py     | [PASS]   | 10/10    | 1.27s    | Phase 10: End-to-End Workflow (Login->Reports->Logout)
 11  | verify_phase9.py         | [PASS]   | 6/6      | 0.42s    | Phase 9: Comprehensive System Integration Verification
=====================================================================================
 Total Test Suites   : 11 (11 Passed, 0 Failed)
 Total Checks/Tests  : 129 Passed, 0 Failed (100% Success Rate)
=====================================================================================
```

---

## ⚠️ 12. Current Limitations

1. **Simulated Measurements**: All telemetry values are generated in software using mathematical models; no physical smart meters are currently installed on university distribution switchboards.
2. **Balanced Load Model**: Telemetry currently assumes balanced three-phase operation ($V_{RN} = V_{YN} = V_{BN}$); per-phase unbalance and neutral currents are not monitored.
3. **Prototype SQLite Database**: Uses an embedded SQLite file (`energy.db`); future physical deployment requires a high-throughput time-series database (TimescaleDB / PostgreSQL).
4. **Demonstration Tariff**: The two-part cost calculation is an engineering demonstration model and does not represent the official bulk electricity billing from the Ceylon Electricity Board (CEB).
5. **No Autonomous Load Control**: The system performs supervisory monitoring and anomaly alerting but does not autonomously trip circuit breakers or shed electrical loads.

For details on the engineering roadmap (Modbus/RS485 gateways, solar PV integration, harmonics/THD, and predictive forecasting), refer to [LIMITATIONS_AND_FUTURE_WORK.md](LIMITATIONS_AND_FUTURE_WORK.md).

---

## 🏛️ Acknowledgments & Faculty
- **Institution**: Faculty of Engineering, University of Ruhuna, Hapugala, Galle, Sri Lanka.
- **Departments Monitored**:
  - Civil and Environmental Engineering (`CEE`)
  - Electrical and Information Engineering (`EIE`)
  - Mechanical and Manufacturing Engineering (`MME`)
  - Marine Engineering and Naval Architecture (`MENA`)
  - Administration Complex (`ADMIN`)
  - Main Auditorium (`AUDI`)
