# University of Ruhuna — Faculty of Engineering
# Smart Energy Monitoring and Analytics System

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express 4.19+](https://img.shields.io/badge/Express-4.19%2B-lightgrey.svg)](https://expressjs.com/)
[![MongoDB 3.4+](https://img.shields.io/badge/Database-MongoDB%203.4%2B-green.svg)](https://www.mongodb.com/)
[![Automated Tests](https://img.shields.io/badge/Node%20Tests-184%2F184%20Passed-brightgreen.svg)](package.json)
[![Python Baseline](https://img.shields.io/badge/Python%20Baseline-159%2F159%20Passed-blue.svg)](run_all_tests.py)
[![Academic License](https://img.shields.io/badge/License-Academic%20Project-purple.svg)]()

A centralized, real-time three-phase electrical energy monitoring, anomaly detection, and analytics web portal developed for the **Faculty of Engineering, University of Ruhuna** (Hapugala, Galle, Sri Lanka).

> **System Status (Post-Migration)**:
> The primary system implementation has been migrated to **Node.js, Express, and MongoDB**, verified through **184/184 automated tests** and **14/14 browser checkpoints**. The original **Python 3 / Flask / SQLite** implementation and database (`energy.db`) are fully preserved side-by-side for reference and backward compatibility.

---

## 🎯 1. Project Objective

The primary objective of this project is to develop and demonstrate a centralized Smart Energy Monitoring and Analytics platform to supervise electrical consumption, power quality, and operational costs across the academic and administrative complexes of the Faculty of Engineering, University of Ruhuna.

### Specific Engineering Objectives:
1. **Real-Time Telemetry Supervision**: Monitor balanced three-phase electrical parameters ($400\text{ V Line-to-Line}$, $50.0\text{ Hz}$). Six original campus buildings are created automatically when the database is initialized, and administrators can dynamically register additional buildings (the total is not fixed at six), supported by continuous 5-second dashboard updates.
2. **Accurate Electrical Power Modeling**: Implement three-phase AC power triangle calculations ($S = \sqrt{3} V_L I_L$, $P = S \times \text{PF}$, $Q = \sqrt{S^2 - P^2}$) and discrete trapezoidal energy integration with missing sensor data credit protection.
3. **Automated Anomaly & Safety Alerting**: Maintain a state-machine tracking engine for 8 critical electrical abnormal conditions (Low Power Factor, Undervoltage, Overvoltage, Frequency Excursions, Feeder High Load, Feeder Overload, and Sensor Offline).
4. **Energy Cost & Institutional Tariff Analysis**: Model electricity expenditures using a configurable two-part industrial/commercial tariff (energy charge, peak demand charge, and fixed monthly charge) with automated after-hours energy tracking (08:00–17:00 weekdays).
5. **Role-Based Access Control (RBAC)**: Secure access using cryptographically signed sessions and hashed passwords, separating administrative functions from read-only viewers.
6. **Formal Audit Reporting & Export**: Generate 16-parameter energy audit summaries, stream raw telemetry CSV exports, and provide an official university-formatted printable PDF report.
7. **Academic Transparency**: Explicitly label all simulated telemetry as `SIMULATED` across user interfaces, API responses, CSV downloads, and reports to preserve scientific honesty.

---

## 🛠️ 2. Technologies Used

### Primary Modern Stack (Node.js + Express + MongoDB)
- **Node.js (v18+)**: High-performance asynchronous JavaScript runtime environment.
- **Express.js (v4.19+)**: Robust web application framework and RESTful API router.
- **MongoDB Server (v3.4+)**: Document database providing flexible, scalable schema storage for telemetry and system state.
- **Mongoose ODM (v5.13+)**: Elegant object modeling for Node.js, managing schemas, validation, and lifecycle hooks.
- **Nunjucks (v3.2+)**: Express server-side templating engine with Jinja2 compatibility hooks for seamless template rendering.
- **express-session & connect-mongo (v3.2+)**: Scalable server-side session management backed directly by MongoDB.
- **bcryptjs (v2.4+)**: Industry-standard cryptographic password hashing with unique salt generation.
- **CORS & Custom CSRF Defense**: Dual cookie/body token verification for state-changing HTTP requests.

### Frontend Presentation Layer
- **HTML5 (Semantic)**: Accessible document structure with server-side template rendering.
- **Vanilla CSS3**: Tailored dark-mode theme (`#0b1121`), glassmorphism, responsive CSS Grid/Flexbox layouts, and `@media print` print styling.
- **Vanilla JavaScript (ES6+)**: Asynchronous fetch API, real-time 5-second polling, dynamic DOM updates, and client-side form validation.
- **Chart.js (v4.4+)**: Interactive client-side canvas charts (time-series line charts, multi-department comparative bar charts).

### Preserved Baseline Stack (Python + Flask + SQLite)
- **Python 3.10+ / Flask (v3.1+) / Werkzeug (v3.1+) / SQLite 3 (WAL mode)**: Fully maintained in `backend/` and root entrypoints for side-by-side verification and baseline benchmarking.

---

## 🏗️ 3. System Architecture

The system utilizes a decoupled multi-tier architecture designed for concurrent telemetry generation, MongoDB persistence, and real-time web serving:

```text
  +-------------------------------------------------------------------------+
  |              Node.js Three-Phase Telemetry Simulator                    |
  |                      (node_backend/simulator.js)                       |
  |  - Balanced 400V / 50Hz Generator                                       |
  |  - Diurnal Load Curves (08:00-17:00 Working Peak vs Night Baseline)     |
  |  - Apparent (kVA), Active (kW), Reactive (kVAr) & Incremental kWh       |
  |  - Automated Alert Evaluation via alertEngine.js                        |
  |  - Controlled Anomaly Injection (--anomaly LOW_PF, LOW_VOLTAGE, etc.)   |
  +-------------------------------------------------------------------------+
                                       │
                                       ▼ (Direct Mongoose Inserts)
  +-------------------------------------------------------------------------+
  |                  MongoDB Database (ruhuna_energy)                       |
  |                       Compatible with MongoDB 3.4+                      |
  |  - buildings       : 6 Core Campus Complexes + Dynamic Admin Facilities |
  |  - users           : Administrator / Viewer with bcrypt hashed passwords|
  |  - energy_readings : Timestamped 3-phase records, marked SIMULATED      |
  |  - alerts          : Active / Cleared State-Machine Anomaly Log         |
  |  - tariffs         : Configurable Demonstration Institutional Tariff    |
  |  - faculty_settings: Operating Hours & Faculty Schedule Parameters      |
  |  - sessions        : MongoStore Server-Side Encrypted Sessions          |
  +-------------------------------------------------------------------------+
                      ▲                                   ▲
                      │ (Reads Telemetry)                 │ (Writes / Ack)
  +-------------------------------------------------------------------------+
  |                   Node.js Express Web Backend                           |
  |             (node_backend/server.js, node_backend/app.js)               |
  |  - MongoStore Session Management (SESSION_SECRET)                       |
  |  - Role-Based Access Control (requireAuth, requireAdmin)                |
  |  - CSRF Token Generation & Dual-Validation Middleware                   |
  |  - Analytics Service & Report Computation (analyticsService.js)        |
  |  - REST APIs: /api/energy/live, /api/energy/analytics, /api/alerts,     |
  |               /api/energy/cost, /api/reports/summary, CSV export        |
  +-------------------------------------------------------------------------+
                                       │
                                       ▼ (JSON / Nunjucks Server-Side Render)
  +-------------------------------------------------------------------------+
  |                       Web Browser User Interface                        |
  |  - /dashboard        : Live Substation Monitor & 5s Chart.js Polling    |
  |  - /analytics        : Historical Electrical Hub & Load Factor Analysis |
  |  - /alerts           : Safety Violations Log & Admin Acknowledgment     |
  |  - /cost-efficiency  : Demonstration Tariff Cost Model & Rankings       |
  |  - /reports          : 16-Metric Audit Summaries & CSV Download         |
  |  - /reports/printable: Official University PDF Print Document           |
  +-------------------------------------------------------------------------+
```

---

## 📥 4. Installation & Windows PowerShell Startup Instructions

### Prerequisites
- **Node.js (v18.0 or newer)**: Verify with `node -v` in PowerShell.
- **MongoDB Server (v3.4 or newer)**: Ensure the MongoDB service is running locally on default port `27017` (`mongodb://127.0.0.1:27017`).
- **PowerShell execution note**: On Windows PowerShell, execute `npm.cmd` rather than `npm` to avoid alias conflicts.

---

### Step 1: Install Node.js Dependencies
In a Windows PowerShell window, navigate to the project directory and install the packages:

```powershell
npm.cmd install
```

---

### Step 2: Initialize the MongoDB Database
Initialize MongoDB with the core Faculty of Engineering buildings and baseline configuration:

```powershell
npm.cmd run init-db
```

- Connects to `mongodb://127.0.0.1:27017/ruhuna_energy`.
- Seeds the 6 original Faculty of Engineering core campus complexes:
  1. `CEE` — Civil and Environmental Engineering ($60\text{ kW}$)
  2. `EIE` — Electrical and Information Engineering ($70\text{ kW}$)
  3. `MME` — Mechanical and Manufacturing Engineering ($85\text{ kW}$)
  4. `MENA` — Marine Engineering and Naval Architecture ($55\text{ kW}$)
  5. `ADMIN` — Administration Complex ($40\text{ kW}$)
  6. `AUDI` — Main Auditorium ($50\text{ kW}$)
- **Idempotent**: Safe to run multiple times without creating duplicate records or overwriting existing data.

---

### Step 3: Create User Accounts Interactively
User accounts must be provisioned interactively using the secure command-line tool. Passwords are typed interactively with masked input (never displayed on screen or stored in shell command history):

```powershell
npm.cmd run create-user
```

Follow the interactive prompts:
1. **Full Name**: Enter display name (e.g., `Faculty Administrator` or `Student Viewer`).
2. **University Email**: Enter login email (e.g., `admin@eng.ruh.ac.lk` or `viewer@eng.ruh.ac.lk`).
3. **Role Selection**: Enter `1` for **Administrator** (full management, building registration, alert acknowledgment) or `2` for **Viewer** (read-only telemetry and reporting).
4. **Password (hidden)**: Enter your chosen password (minimum 6 characters). Input is masked for shoulder-surfing protection.
5. **Confirm Password (hidden)**: Re-enter the password to confirm.

> **Security Note**:
> No demonstration passwords or default credentials are hardcoded into the repository. You must run `npm.cmd run create-user` to set up your administrator and viewer credentials before logging in.

---

### Step 4: Launch the Express Web Server
In **Terminal 1**, start the Express HTTP server:

```powershell
npm.cmd start
```

- Express connects to MongoDB and begins listening on `http://localhost:5000`.
- Health check available at `http://localhost:5000/api/health`.
- Access the web interface in any modern browser at:
  ```text
  http://127.0.0.1:5000
  ```

---

### Step 5: Launch the Telemetry Simulator
In a **separate Windows PowerShell terminal (Terminal 2)**, run the electrical simulator:

```powershell
# Standard continuous simulation (default 15-second sampling interval):
npm.cmd run simulator

# Fast 5-second interval (recommended for live viva demonstrations):
node node_backend/simulator.js --interval 5.0

# Single cycle execution (useful for quick database population):
node node_backend/simulator.js --once

# Live electrical anomaly injection (for demonstrating alert triggers):
node node_backend/simulator.js --interval 5.0 --anomaly LOW_PF --building-id CEE
```

Supported anomaly injection types:
- `LOW_PF`: Drops Power Factor below $0.85$ to trigger a Low Power Factor warning.
- `LOW_VOLTAGE`: Drops Line Voltage below $380\text{ V}$ to trigger an Undervoltage critical alert.
- `HIGH_VOLTAGE`: Spikes Line Voltage above $420\text{ V}$ to trigger an Overvoltage critical alert.
- `HIGH_LOAD`: Drives Active Power $> 90\%$ of building rated capacity for a High Load warning.
- `OVERLOAD`: Drives Active Power $> 100\%$ of building rated capacity for an Overload critical alert.
- `HIGH_FREQ` / `LOW_FREQ`: Grid frequency deviations ($> 50.5\text{ Hz}$ or $< 49.5\text{ Hz}$).

---

## 🐍 5. Preserved Python Alternative Instructions

The original Python/Flask/SQLite implementation remains fully operational and can be executed at any time:

```powershell
# 1. Activate Python virtual environment:
.\.venv\Scripts\Activate.ps1

# 2. Initialize or create user accounts:
python create_user.py

# 3. Launch Flask server:
python app.py

# 4. In a separate terminal, launch Python simulator:
python simulator.py --interval 5.0
```

---

## 🌐 6. How to Access and Navigate the Application

1. Open your browser and navigate to:
   ```text
   http://127.0.0.1:5000
   ```
2. Unauthenticated requests automatically redirect to `/login`.
3. Sign in using the credentials created via `npm.cmd run create-user`.
4. Portal navigation tabs:
   - **`/dashboard`**: Real-time live substation cards with 5-second Chart.js polling, status badges, and dynamic building registration for Administrators.
   - **`/analytics`**: Historical time-series analytics, departmental filtering, date presets (`1h`, `today`, `24h`, `7d`), and Load Factor ($\text{LF} = P_{\text{avg}} / P_{\text{peak}}$).
   - **`/alerts`**: Active and historical electrical threshold safety logs with one-click Administrator acknowledgment and duplicate suppression.
   - **`/cost-efficiency`**: Departmental cost estimation and energy efficiency rankings based on the demonstration institutional tariff.
   - **`/reports`**: 16-parameter energy audit summary, raw telemetry CSV export streaming, and official printable PDF audit report (`/reports/printable`).

---

## 🔬 7. Academic Integrity & Disclaimers

### Simulated Measurements Disclaimer
> **IMPORTANT**:
> All electrical measurements (Line Voltage, Line Current, Active Power, Reactive Power, Apparent Power, Frequency, and Power Factor) are **simulated in software** using mathematical three-phase AC power models. No physical sensors or smart meters are currently connected to the physical electrical distribution switchboards at the University of Ruhuna. To preserve academic integrity, all telemetry records and UI cards are explicitly marked as `[SIMULATED]`.

### Demonstration Tariff Disclaimer
> **IMPORTANT**:
> The electricity cost calculations presented on `/cost-efficiency` and within audit reports utilize an **educational demonstration two-part institutional tariff model** (comprising an energy consumption charge, peak demand charge, and fixed monthly charge). This model serves solely for software modeling and algorithmic validation; it **does not represent official electricity billing from the Ceylon Electricity Board (CEB)**.

---

## ⚠️ 8. Technical Limitations & MongoDB Server 3.4 Notes

1. **MongoDB Server 3.4 Multi-Document Atomicity**:
   - The application supports MongoDB Server 3.4+.
   - Multi-document transactions (`session.withTransaction()`) were introduced in MongoDB 4.0 (for replica sets) and 4.2 (for sharded clusters).
   - In MongoDB Server 3.4 or standalone deployments, **multi-document deletions across collections are not transactionally atomic**.
   - When an Administrator deletes a facility and purges simulated records (`POST /api/buildings/:id/delete-simulated`), deletions are executed sequentially across `energy_readings`, `alerts`, and `buildings`. While individual document writes are atomic, a system crash or power interruption during the multi-collection cascade will not automatically roll back earlier deletions.
2. **Balanced Load Assumption**:
   - The simulator assumes balanced three-phase operation ($V_{RN} = V_{YN} = V_{BN}$, $I_R = I_Y = I_B$). Per-phase harmonic distortion (THD) and neutral conductor currents are not currently modeled.
3. **No Autonomous Actuation**:
   - The system performs supervisory monitoring, automated alerting, and audit logging; it does not trigger physical circuit breakers or shed physical loads.

---

## 🧪 9. Automated Testing & Verification

### Node.js Automated Test Suite (184/184 Passed)
Run the Node.js test runner using `npm.cmd`:

```powershell
npm.cmd test
```

### Node.js Test Execution Breakdown:
| Test Suite | Script | Tests | Description |
|:---|:---|:---:|:---|
| **Phase 2** | `node_backend/tests/phase2.test.js` | **16/16** | Mongoose Models, Schema Constraints & Bcrypt Hashing |
| **Phase 3A** | `node_backend/tests/phase3a.test.js` | **16/16** | Auth Routes, Session Persistence & RBAC Protection |
| **Phase 3B** | `node_backend/tests/phase3b.test.js` | **31/31** | CSRF Protection, Secret Key Handling & Session Store |
| **Phase 4** | `node_backend/tests/phase4.test.js` | **23/23** | Telemetry Simulation, 3-Phase Math & Reading Insertion |
| **Phase 5** | `node_backend/tests/phase5.test.js` | **22/22** | Alert Detection Engine, Anomaly Types & Acknowledgment |
| **Phase 6A** | `node_backend/tests/phase6a.test.js` | **26/26** | Historical Analytics, Load Factor & Aggregation Pipeline |
| **Phase 6B** | `node_backend/tests/phase6b.test.js` | **25/25** | Live Dashboard, Dynamic Building Management & Safeguards |
| **Phase 6C** | `node_backend/tests/phase6c.test.js` | **25/25** | Cost Analytics, Demonstration Tariffs & Audit Reports |
| **TOTAL** | **8 Test Suites** | **184/184** | **100% Passed** |

---

### Preserved Python Test Suite (159/159 Passed)
The baseline Python test suite can be run at any time:

```powershell
python run_all_tests.py
```
- Total Test Suites: 16
- Total Checks Passed: 159/159 (100% Passed)

---

## ⚙️ 10. Environment Variables (`.env.example`)

To customize runtime settings, copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

| Variable | Default Value | Description |
|:---|:---|:---|
| `PORT` | `5000` | Port for Express HTTP server |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/ruhuna_energy` | MongoDB connection URI |
| `SESSION_SECRET` | *(Random 256-bit)* | Private key for cryptographic session signing |
| `SIMULATOR_INTERVAL` | `15.0` | Default telemetry sampling interval in seconds |
| `THRESHOLD_PF_LOW` | `0.85` | Power factor warning limit |
| `THRESHOLD_VOLTAGE_MIN`| `380.0` | Undervoltage threshold in Volts |
| `THRESHOLD_VOLTAGE_MAX`| `420.0` | Overvoltage threshold in Volts |
| `THRESHOLD_FREQ_MIN` | `49.5` | Minimum grid frequency in Hz |
| `THRESHOLD_FREQ_MAX` | `50.5` | Maximum grid frequency in Hz |
| `THRESHOLD_HIGH_LOAD_RATIO` | `0.90` | High load threshold (90% of rated capacity) |
| `THRESHOLD_SENSOR_OFFLINE` | `60.0` | Sensor silence alert threshold in seconds |

---

## 📚 11. Documentation Index

Detailed architectural documentation and theoretical proofs are maintained in [`docs/`](docs/):

| Document | Content Description | Reference |
|:---|:---|:---|
| **System Architecture** | Multi-tier architecture, dataflow diagrams, and concurrency design | [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) |
| **Database Schema** | Detailed schema, document models, indexes, and relations | [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) |
| **Electrical Formulas** | AC power triangle, line/phase equations, and numerical integration | [`docs/FORMULAS.md`](docs/FORMULAS.md) |
| **Viva Examination Notes** | Technical defense talking points, examiner Q&A, and proofs | [`docs/VIVA_NOTES.md`](docs/VIVA_NOTES.md) |
| **Demonstration Mode** | Step-by-step viva presentation guide and anomaly injection procedures | [`docs/DEMO_MODE.md`](docs/DEMO_MODE.md) |
| **Demonstration Checklist**| Pre-demonstration system readiness check and verification commands | [`docs/DEMO_CHECKLIST.md`](docs/DEMO_CHECKLIST.md) |
| **Limitations & Roadmap** | Hardware gateway roadmap (Modbus/RS485), solar PV, and forecasting | [`docs/LIMITATIONS_AND_FUTURE_WORK.md`](docs/LIMITATIONS_AND_FUTURE_WORK.md) |
| **Final Project Report** | Complete academic project report and faculty submission document | [`docs/EE4207_FINAL_PROJECT_REPORT.md`](docs/EE4207_FINAL_PROJECT_REPORT.md) |

---

## 🏛️ Acknowledgments & Faculty
- **Institution**: Faculty of Engineering, University of Ruhuna, Hapugala, Galle, Sri Lanka.
- **Academic Complexes Monitored**:
  - Civil and Environmental Engineering (`CEE`)
  - Electrical and Information Engineering (`EIE`)
  - Mechanical and Manufacturing Engineering (`MME`)
  - Marine Engineering and Naval Architecture (`MENA`)
  - Administration Building (`ADMIN`)
  - Auditorium (`AUDI`)
  *(Additional facilities can be dynamically registered by Administrators)*
