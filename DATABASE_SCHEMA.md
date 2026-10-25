# Database Schema Documentation

## Faculty of Engineering, University of Ruhuna
### Smart Energy Monitoring and Analytics System (`energy.db`)

---

## 1. Entity Relationship (ER) Diagram

```
+--------------------------------------------------------------------+
|                             buildings                              |
|--------------------------------------------------------------------|
| id              INTEGER PRIMARY KEY AUTOINCREMENT                  |
| name            TEXT NOT NULL UNIQUE                               |
| code            TEXT NOT NULL UNIQUE                               |
| description     TEXT                                               |
| rated_power_kw  REAL DEFAULT 50.0                                  |
+--------------------------------------------------------------------+
       |                                   |
       | 1:N                               | 1:N
       v                                   v
+-------------------------------+   +------------------------------------+
|        energy_readings        |   |               alerts               |
|-------------------------------|   |------------------------------------|
| id                 INTEGER PK |   | id               INTEGER PK        |
| building_id        INTEGER FK |   | building_id      INTEGER FK        |
| timestamp          TIMESTAMP  |   | timestamp        TIMESTAMP         |
| voltage            REAL       |   | alert_type       TEXT              |
| current            REAL       |   | severity         TEXT ('CRITICAL', |
| power_factor       REAL       |   |                         'WARNING', |
| frequency          REAL       |   |                         'INFO')    |
| apparent_power_kva REAL       |   | measured_value   REAL              |
| active_power_kw    REAL       |   | threshold_value  REAL              |
| reactive_power_kvar REAL      |   | message          TEXT              |
| energy_kwh         REAL       |   | acknowledged     INTEGER (0 or 1)  |
| is_simulated       INTEGER    |   | acknowledged_by  TEXT              |
+-------------------------------+   | acknowledged_at  TIMESTAMP         |
                                    | is_active        INTEGER (0 or 1)  |
                                    | cleared_at       TIMESTAMP         |
                                    +------------------------------------+

+--------------------------------------------------------------------+
|                               users                                |
|--------------------------------------------------------------------|
| id            INTEGER PRIMARY KEY AUTOINCREMENT                    |
| email         TEXT NOT NULL UNIQUE                                 |
| password_hash TEXT NOT NULL                                        |
| full_name     TEXT NOT NULL                                        |
| role          TEXT NOT NULL CHECK(role IN ('Administrator',        |
|                                            'Viewer'))              |
| created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP                  |
+--------------------------------------------------------------------+

+--------------------------------------------------------------------+
|                              tariffs                               |
|--------------------------------------------------------------------|
| id                      INTEGER PRIMARY KEY AUTOINCREMENT          |
| name                    TEXT NOT NULL                              |
| energy_rate_lkr_per_kwh REAL NOT NULL                              |
| demand_rate_lkr_per_kw  REAL NOT NULL                              |
| fixed_charge_lkr        REAL NOT NULL                              |
| effective_from          TIMESTAMP DEFAULT CURRENT_TIMESTAMP        |
| active                  INTEGER DEFAULT 1                          |
+--------------------------------------------------------------------+

+--------------------------------------------------------------------+
|                          faculty_settings                          |
|--------------------------------------------------------------------|
| id            INTEGER PRIMARY KEY AUTOINCREMENT                    |
| setting_key   TEXT NOT NULL UNIQUE                                 |
| setting_value TEXT NOT NULL                                        |
| description   TEXT                                                 |
| updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP                  |
+--------------------------------------------------------------------+
```

---

## 2. Table Specifications

### A. `buildings`
Stores metadata and maximum capacity limits for the six engineering facilities.
- `id` (INTEGER, PK, AI): Unique building ID.
- `name` (TEXT, UNIQUE): Full building title (e.g., "Electrical and Information Engineering").
- `code` (TEXT, UNIQUE): Building code (e.g., "EIE", "CEE", "MME", "MENA", "ADMIN", "AUDI").
- `description` (TEXT): Building description and department role.
- `rated_power_kw` (REAL): Feeder rating used to detect high load (>90%) and overload (>100%) conditions.

### B. `energy_readings`
High-volume time-series table storing three-phase telemetry readings.
- `id` (INTEGER, PK, AI): Unique telemetry sequence ID.
- `building_id` (INTEGER, FK): References `buildings(id)`.
- `timestamp` (TIMESTAMP): Reading timestamp (`YYYY-MM-DD HH:MM:SS`).
- `voltage` (REAL): Line-to-line RMS voltage ($V_L \approx 400\text{ V}$).
- `current` (REAL): Line RMS current ($I_L\text{ Amperes}$).
- `power_factor` (REAL): Measured power factor ($\cos \phi \in [0.70, 0.98]$).
- `frequency` (REAL): Grid frequency ($f \approx 50.0\text{ Hz}$).
- `apparent_power_kva` (REAL): Apparent power ($S = \sqrt{3} V_L I_L / 1000$).
- `active_power_kw` (REAL): Active working power ($P = S \times PF$).
- `reactive_power_kvar` (REAL): Reactive power ($Q = \sqrt{S^2 - P^2}$).
- `energy_kwh` (REAL): Integrated cumulative active energy.
- `is_simulated` (INTEGER): Flag (`1`) identifying simulated test readings.

### C. `alerts`
Stores electrical abnormal events and operational tracking states.
- `id` (INTEGER, PK, AI): Unique alert ID.
- `building_id` (INTEGER, FK): References `buildings(id)`.
- `timestamp` (TIMESTAMP): Time condition occurred.
- `alert_type` (TEXT): Anomaly code (`LOW_PF`, `LOW_VOLTAGE`, `HIGH_VOLTAGE`, `LOW_FREQ`, `HIGH_FREQ`, `HIGH_LOAD`, `OVERLOAD`, `SENSOR_OFFLINE`).
- `severity` (TEXT): Urgency level (`INFO`, `WARNING`, `CRITICAL`).
- `measured_value` (REAL): Reading that triggered the alert.
- `threshold_value` (REAL): Safety threshold exceeded.
- `message` (TEXT): Descriptive diagnostic text.
- `acknowledged` (INTEGER): Acknowledgment flag (`0` = unacknowledged, `1` = acknowledged).
- `acknowledged_by` (TEXT): Username of the Administrator who acknowledged the alert.
- `acknowledged_at` (TIMESTAMP): Timestamp of acknowledgment.
- `is_active` (INTEGER): Active flag (`1` = active abnormal condition, `0` = cleared).
- `cleared_at` (TIMESTAMP): Time condition returned to normal.

### D. `users`
User accounts with secure SHA-256 hashed credentials.
- `id` (INTEGER, PK, AI): Unique user identifier.
- `email` (TEXT, UNIQUE): Login email address.
- `password_hash` (TEXT): Werkzeug PBKDF2/SHA-256 salted password hash.
- `full_name` (TEXT): User's display name.
- `role` (TEXT): Access tier (`Administrator` or `Viewer`).
- `created_at` (TIMESTAMP): Account provisioning date.

### E. `tariffs`
Stores configurable demonstration institutional utility rate schedules.
- `id` (INTEGER, PK, AI): Tariff identifier.
- `name` (TEXT): Tariff label (e.g., "Demonstration Institutional Tariff (Estimated Non-Official Model)").
- `energy_rate_lkr_per_kwh` (REAL): Active energy rate in Sri Lankan Rupees (default: 38.50).
- `demand_rate_lkr_per_kw` (REAL): Maximum demand rate in Sri Lankan Rupees per kW/month (default: 1450.00).
- `fixed_charge_lkr` (REAL): Customer monthly connection charge (default: 3000.00).
- `effective_from` (TIMESTAMP): Date tariff became active.
- `active` (INTEGER): Active flag (`1` = active, `0` = historical).

### F. `faculty_settings`
Key-value store for operational scheduling configurations.
- `id` (INTEGER, PK, AI): Primary key.
- `setting_key` (TEXT, UNIQUE): Configuration identifier (e.g., `operating_hours_start`, `operating_hours_end`, `operating_days`, `tariff_billing_days_norm`).
- `setting_value` (TEXT): Operational setting value (e.g., `"08:00"`, `"17:00"`, `"0,1,2,3,4"`).
- `description` (TEXT): Human-readable purpose of the configuration.
- `updated_at` (TIMESTAMP): Last modified timestamp.

---

## 3. Database Indexes

To maintain sub-50ms query responses with thousands of stored readings, the following indexes are configured:
```sql
CREATE INDEX idx_readings_building_timestamp ON energy_readings(building_id, timestamp);
CREATE INDEX idx_alerts_bldg_active ON alerts(building_id, is_active);
CREATE INDEX idx_alerts_lookup ON alerts(building_id, alert_type, is_active);
CREATE INDEX idx_alerts_timestamp ON alerts(timestamp DESC);
```
