# University of Ruhuna — Smart Energy Monitoring & Analytics System
## Project Repository Structure (`PROJECT_STRUCTURE.md`)

This document details the architectural layout, directory organization, and specific role of every file and folder in the **Smart Energy Monitoring and Analytics System** codebase for the Faculty of Engineering, University of Ruhuna.

---

## 🌳 Directory Tree Overview

```text
Ruhuna Smart Energy System/
├── app.py                      # Main Flask application, routing & protected REST API endpoints
├── database.py                 # SQLite schema, data models, calculations & DB operations
├── simulator.py                # Three-phase electrical telemetry simulator (400V/50Hz)
├── create_user.py              # CLI user provisioning tool (Administrator & Viewer)
├── configure_system.py         # CLI configuration utility (rated power, hours, tariffs)
├── requirements.txt            # Python runtime dependencies
├── energy.db                   # SQLite database file storing telemetry, users, tariffs & alerts
├── .env.example                # Environment variables configuration template
│
├── static/                     # Frontend static assets
│   ├── css/
│   │   └── style.css           # Premium dark theme stylesheet, responsive layout & print rules
│   └── js/
│       ├── auth.js             # Client-side form validation & password visibility toggle
│       ├── dashboard.js        # Real-time 5s polling, KPI aggregation & Chart.js live charts
│       ├── analytics.js        # Historical analytics controller, presets & comparative charts
│       ├── alerts.js           # Real-time electrical anomaly tracker & RBAC acknowledgment
│       ├── cost_efficiency.js  # Two-part tariff cost calculator, ranking cards & bar charts
│       └── reports.js          # 16-parameter audit reports, CSV streaming & tariff update modal
│
├── templates/                  # Jinja2 HTML templates
│   ├── login.html              # University branded authentication portal
│   ├── dashboard.html          # Substation live monitoring overview with 6 building cards
│   ├── analytics.html          # Historical electrical analytics & departmental comparison
│   ├── alerts.html             # Safety threshold violations portal & event log table
│   ├── cost_efficiency.html    # Energy Cost & Departmental Efficiency portal
│   ├── reports.html            # Audit reporting center with CSV & printable PDF triggers
│   └── printable_report.html   # Official university-branded printable audit report
│
├── run_all_tests.py            # Master automated test runner executing all 11 test suites
├── test_workflow_e2e.py        # Phase 10: Complete end-to-end user journey workflow test
├── test_app.py                 # Phase 1: Database connection & Buildings API test
├── test_phase2.py              # Phase 2: Authentication, RBAC & Session security test
├── test_phase3.py              # Phase 3: Three-phase electrical calculations & missing data test
├── test_phase4.py              # Phase 4: Live dashboard DOM, polling & schema test
├── test_phase5.py              # Phase 5: Historical analytics & Load Factor test
├── test_phase5_thorough.py     # Phase 5: 70-check mathematical ground-truth validation
├── test_phase6.py              # Phase 6: Electrical anomaly detection & alert life cycle test
├── test_phase7.py              # Phase 7: Two-part tariff cost calculations & efficiency test
├── test_phase8.py              # Phase 8: Comprehensive audit reports, CSV export & RBAC test
├── verify_phase9.py            # Phase 9: Multi-phase system integration verification
│
├── README.md                   # Primary project documentation, setup & viva guide
├── DEMO_MODE.md                # Step-by-step viva presentation guide
├── PROJECT_STRUCTURE.md        # Comprehensive file and folder catalog (this file)
├── FORMULAS.md                 # Mathematical formulations for all electrical & cost metrics
├── LIMITATIONS_AND_FUTURE_WORK.md # Prototype boundaries & engineering expansion roadmap
├── DATABASE_SCHEMA.md          # SQLite database schema, table definitions & index documentation
├── DEMO_CHECKLIST.md           # Quick reference checklist for demonstrations
├── SYSTEM_ARCHITECTURE.md      # Multi-tier system architecture diagrams & data flow
└── VIVA_NOTES.md               # Extensive viva examination preparation questions & answers
```

---

## 📄 Core Application & Backend Modules

### 1. `app.py`
The primary entry point of the Flask web server.
- **Responsibilities**:
  * Configures session cryptographic security using `FLASK_SECRET_KEY`.
  * Enables Cross-Origin Resource Sharing (`flask_cors`).
  * Enforces Role-Based Access Control (`@login_required`, `@admin_required`).
  * Serves frontend HTML templates (`/`, `/login`, `/dashboard`, `/analytics`, `/alerts`, `/cost-efficiency`, `/reports`, `/reports/printable`).
  * Exposes authenticated REST API endpoints for telemetry, analytics, tariffs, and CSV exports.

### 2. `database.py`
The data access layer and core analytical computation engine.
- **Responsibilities**:
  * Manages SQLite database connection pool with `timeout=30.0` and `PRAGMA journal_mode=WAL` for high concurrency.
  * Creates and migrates database tables (`buildings`, `users`, `energy_readings`, `alerts`, `tariffs`, `faculty_settings`).
  * Seeds the 6 initial Faculty of Engineering buildings and demonstration institutional tariffs.
  * Calculates three-phase power parameters ($S, P, Q$) and integrates energy ($kWh$) using consecutive timestamps with missing data protection.
  * Evaluates electrical readings against configurable thresholds (`ELECTRICAL_THRESHOLDS`).
  * Implements the two-part institutional electricity tariff cost model.
  * Computes departmental efficiency scores, load factors, and automated engineering observations.

### 3. `simulator.py`
The Three-Phase Electrical Energy Monitoring Simulator.
- **Responsibilities**:
  * Simulates balanced three-phase 400 V line-to-line, 50 Hz electrical power for all 6 university complexes.
  * Incorporates diurnal campus load curves (higher during university daytime hours, lower at night/weekends).
  * Calculates apparent, active, and reactive power per cycle based on line current and power factor.
  * Supports CLI interval tuning (`--interval`), single cycles (`--once`), and controlled electrical anomaly injection (`--anomaly LOW_PF`, `LOW_VOLTAGE`, `HIGH_LOAD`, etc.).

### 4. `create_user.py`
Command-line administrative utility for user provisioning.
- **Responsibilities**:
  * Allows creating new `Administrator` and `Viewer` accounts without manual SQL queries.
  * Uses Python's standard `getpass` module for secure, masked password input.
  * Hashes passwords securely using Werkzeug PBKDF2/scrypt before storage.
  * Can also update passwords for existing user accounts.

### 5. `configure_system.py`
Command-line configuration tool for rapid runtime tuning.
- **Responsibilities**:
  * Inspects current database parameters (`--show`).
  * Adjusts building rated power capacities (`--building CEE --rated-power 65.0`).
  * Adjusts faculty standard operating hours (`--hours-start 08:30 --hours-end 16:30`).
  * Adjusts demonstration tariff rates (`--energy-rate`, `--demand-rate`, `--fixed-charge`).

---

## 🎨 Frontend Templates (`templates/`)

All templates are built with semantic HTML5, Jinja2 template tags, university branding, and dark-theme UI components.

| File | Route | Description |
|---|---|---|
| `login.html` | `/login` | Branded login page with email validation, password toggle, and security badges. |
| `dashboard.html` | `/dashboard` | Live substation monitoring overview; 6 building cards, real-time KPI aggregates, and 5s Chart.js graphs. |
| `analytics.html` | `/analytics` | Historical energy analytics hub; single-facility parameter drill-downs, time presets, and campus comparison. |
| `alerts.html` | `/alerts` | Real-time electrical anomaly detection portal; event log table, severity filters, and Admin acknowledgment. |
| `cost_efficiency.html` | `/cost-efficiency` | Institutional energy cost breakdown, two-part tariff calculations, after-hours tracking, and efficiency rankings. |
| `reports.html` | `/reports` | Comprehensive energy audit reporting center; 16-parameter metrics, CSV telemetry export, and tariff configuration modal. |
| `printable_report.html` | `/reports/printable` | Formal university-formatted printable audit report; optimized for browser PDF export with official header. |

---

## 💻 Frontend Assets (`static/`)

### Stylesheets (`static/css/`)
- **`style.css`**: Complete design system with CSS custom properties (variables), modern dark theme (#0b1121 background), responsive CSS grid/flexbox layouts, glassmorphic card designs, alert banners, tables, and print stylesheets (`@media print`).

### Client JavaScript Modules (`static/js/`)
- **`auth.js`**: Password visibility toggle and client-side form validation.
- **`dashboard.js`**: 5-second automatic polling of `/api/energy/live`, animated KPI counters, dynamic status badges, and Chart.js real-time line/bar updates.
- **`analytics.js`**: Time-series historical data filtering (`1h`, `today`, `24h`, `7d`), Chart.js canvas rendering, and six-building campus comparisons.
- **`alerts.js`**: Fetches active/cleared electrical alerts from `/api/alerts`, formats threshold violations, and triggers administrator acknowledgment POST requests.
- **`cost_efficiency.js`**: Renders two-part tariff cost breakdowns, departmental rankings, and automated engineering observations.
- **`reports.js`**: Generates comprehensive 16-parameter energy audit summaries, triggers CSV downloads, and handles Administrator demonstration tariff updates.

---

## 🧪 Automated Test Suite

The project includes 11 dedicated automated test modules totaling **129 verification checks**:

| Test File | Target Scope | Checks | Status |
|---|---|---|---|
| `test_app.py` | Phase 1: Database connection & Buildings REST API | 5 | ✅ 100% Passed |
| `test_phase2.py` | Phase 2: Authentication, RBAC, Sessions & Route Protection | 8 | ✅ 100% Passed |
| `test_phase3.py` | Phase 3: Three-Phase Simulator, Formulas & Discontinuous Data | 4 | ✅ 100% Passed |
| `test_phase4.py` | Phase 4: Live Monitoring Dashboard & Real-Time Telemetry | 3 | ✅ 100% Passed |
| `test_phase5.py` | Phase 5: Historical Analytics & Load Factor Calculations | 5 | ✅ 100% Passed |
| `test_phase5_thorough.py` | Phase 5 Thorough: Mathematical Ground-Truth & Edge Cases | 70 | ✅ 100% Passed |
| `test_phase6.py` | Phase 6: Electrical Alerts, Anomaly Engine & RBAC Acknowledge | 7 | ✅ 100% Passed |
| `test_phase7.py` | Phase 7: Energy Cost, Two-Part Tariff & Efficiency Rankings | 7 | ✅ 100% Passed |
| `test_phase8.py` | Phase 8: 16-Metric Audit Reports, CSV Export & RBAC Tariff | 4 | ✅ 100% Passed |
| `test_workflow_e2e.py` | Phase 10: Complete End-to-End User Journey Workflow | 10 | ✅ 100% Passed |
| `verify_phase9.py` | Phase 9: Multi-Phase System Integration Verification | 6 | ✅ 100% Passed |
| **`run_all_tests.py`** | **Master Test Runner: Executes all 11 suites and outputs unified scorecard** | **129** | **✅ 129/129 Passed** |

---

## 📚 Documentation Files

- **`README.md`**: Master project documentation covering objective, installation, execution, architecture, and demonstration guidelines.
- **`DEMO_MODE.md`**: Step-by-step 10-minute viva presentation walkthrough with questions and model answers.
- **`PROJECT_STRUCTURE.md`**: Complete repository catalog (this file).
- **`FORMULAS.md`**: Engineering reference document containing formal mathematical equations and derivations.
- **`LIMITATIONS_AND_FUTURE_WORK.md`**: Academic reflection on prototype boundaries and roadmap for physical hardware integration.
- **`DATABASE_SCHEMA.md`**: Detailed SQLite table structures, data types, primary/foreign keys, and indexes.
- **`DEMO_CHECKLIST.md`**: Compact quick-reference checklist for live demonstrations.
- **`SYSTEM_ARCHITECTURE.md`**: Architecture diagrams and data pipeline specifications.
- **`VIVA_NOTES.md`**: Comprehensive technical revision notes for university oral examinations.
