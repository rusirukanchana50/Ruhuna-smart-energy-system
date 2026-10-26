# University Viva Preparation Notes & Examiner Q&A Guide

## Smart Energy Monitoring and Analytics System
### Faculty of Engineering, University of Ruhuna (Hapugala, Galle)

---

## 1. Project Background & Engineering Rationale

### A. Project Problem
University campuses and large academic institutions consume massive amounts of electrical power across lecture complexes, computer laboratories, heavy workshop equipment, and administrative offices. However, traditional utility billing (a single monthly bulk electricity bill from the Ceylon Electricity Board — CEB) provides **no departmental granularity**, **no real-time visibility into power quality**, and **no immediate warning of abnormal grid conditions** such as dangerous undervoltage, severe equipment overload, or penalty-inducing low power factor.

### B. Project Objective
To develop a centralized, full-stack Smart Energy Monitoring and Analytics platform specifically engineered for the Faculty of Engineering, University of Ruhuna. The system provides real-time three-phase telemetry, historical load-curve integration, automated electrical anomaly detection, two-part demonstration tariff cost modeling, after-hours usage tracking, and formal audit reporting.

### C. Why This System is Useful for University of Ruhuna
1. **Departmental Accountability**: Identifies which engineering complex consumes the most power and causes peak demand spikes.
2. **Protection of Sensitive Lab Equipment**: Detects voltage surges ($> 420\text{ V}$) and drops ($< 380\text{ V}$) that could damage precision research instruments.
3. **CEB Tariff Optimization**: Highlights low power factor ($PF < 0.85$) to avoid utility penalty surcharges and guides the installation of automated capacitor banks (APFC).
4. **Energy Conservation**: Quantifies energy consumed after hours ($17:00\text{ to }08:00$ and weekends) to catch lighting, HVAC, and computer equipment left on unnecessarily.

---

## 2. Technical Concepts & Mathematical Explanations

### D. Complete System Architecture
The system uses a four-tier architecture:
1. **Physical Simulation Layer** (`simulator.py`): Models three-phase electrical behavior at $400\text{ V} / 50\text{ Hz}$ across all 6 complexes.
2. **Storage Layer** (`energy.db`): SQLite database with tables for telemetry, alerts, users, tariffs, and faculty operating schedules.
3. **Application & API Layer** (`app.py`): Python Flask backend managing authentication, REST endpoints, and report generation.
4. **Presentation Layer**: Dark-mode web interface (`HTML5`, `Vanilla CSS`, `Chart.js`, and vanilla `JavaScript`) with unified navigation across 6 distinct views.

### E. Data Flow
$$\text{Simulator} \longrightarrow \text{SQLite (energy.db)} \longrightarrow \text{Flask REST API} \longrightarrow \text{Browser Dashboard / Charts}$$
- Every 15 seconds, the simulator inserts new readings into SQLite.
- The browser polls `/api/energy/live` every 5 seconds.
- Historical queries and reports pull data directly from SQLite via SQL queries.

### F. Why the Current Prototype Uses Simulated Data
Deploying physical smart meters across all faculty substations requires hardware procurement, Modbus RS-485 cabling, CT/PT transformer installations, and physical power shutdowns. The mathematical simulator models realistic load profiles, voltage noise, and electrical anomalies so the software, detection logic, and analytics can be developed and verified before hardware deployment.

### G. How Real Energy Meters Could Replace the Simulator
Real three-phase multi-function digital meters (e.g., Schneider PM5000, Socomec Diris, or Carlo Gavazzi EM24) communicate via Modbus RTU (RS-485) or Modbus TCP. A lightweight edge gateway (e.g., Raspberry Pi or ESP32 gateway) can read the Modbus registers and publish JSON telemetry to the Flask API via HTTP POST or MQTT. The backend database schema and web dashboard require no architectural changes.

### H. Why Flask?
Flask is a lightweight Python WSGI micro-framework. It offers minimal overhead, flexible route decorators for session authentication, and direct integration with scientific Python libraries, making it suitable for IoT telemetry backends.

### I. Why SQLite?
SQLite is a serverless, zero-configuration, ACID-compliant relational database. It stores the entire state in a single file (`energy.db`), requiring no separate database server process. With appropriate B-tree indexing on `(building_id, timestamp)`, SQLite easily handles hundreds of thousands of readings with sub-50ms query latency.

### J. REST API Design
The backend exposes JSON endpoints adhering to REST principles:
- Predictable HTTP verbs (`GET` for fetching, `POST` for mutations/actions).
- Standard HTTP status codes (`200 OK`, `400 Bad Request`, `401 Unauthorized`, `403 Forbidden`, `404 Not Found`, `500 Server Error`).

### K. Authentication & Flask Sessions
Sessions are managed using cryptographically signed client cookies (`flask.session`). The server signs the session cookie using an HMAC signature with `app.secret_key`. When a user logs in, their `user_id`, `role`, and `email` are stored in the session. Unauthenticated requests are rejected.

### L. Password Hashing
Passwords are never stored in plain text. They are hashed using **PBKDF2 with SHA-256** and random cryptographic salting via `werkzeug.security.generate_password_hash()`. When logging in, `check_password_hash()` hashes the input password with the stored salt and verifies the result in constant time to prevent timing attacks.

---

## 3. Power Engineering Concepts

### M. Three-Phase Power Triangle: Active, Apparent, and Reactive Power
1. **Apparent Power ($S$, kVA)**:
   $$S = \frac{\sqrt{3} \times V_L \times I_L}{1000}$$
   The total vector power supplied by the grid. Equipment (transformers, cables, switchgear) must be sized to handle $S$.
2. **Active (Real) Power ($P$, kW)**:
   $$P = \frac{\sqrt{3} \times V_L \times I_L \times \cos \phi}{1000} = S \times PF$$
   The actual working power converted into useful heat, light, computation, and mechanical shaft rotation.
3. **Reactive Power ($Q$, kVAr)**:
   $$Q = \sqrt{S^2 - P^2}$$
   The magnetizing power exchanged between inductive components (motor windings, transformers) and the AC grid. It performs no net work but causes current to flow and generates $I^2 R$ heat losses.

### N. Power Factor ($PF = \cos \phi$)
$$PF = \frac{P}{S} = \frac{\text{Active Power (kW)}}{\text{Apparent Power (kVA)}}$$
- **Ideal**: $1.0$ (Unity power factor — purely resistive load).
- **Sub-optimal**: $PF < 0.85$.
- **Consequences of Low PF**: Excess current draw, higher cable voltage drop, increased $I^2 R$ heat losses, and CEB tariff surcharge penalties.
- **Solution**: Automatic Power Factor Correction (APFC) capacitor banks connected across the substation busbars.

### O. Energy ($kWh$) Integration
Energy is the time integral of active power:
$$E = \int P(t) \, dt \approx \sum_{i=1}^{n} \left(\frac{P_{i-1} + P_i}{2}\right) \times \left(\frac{t_i - t_{i-1}}{3600}\right) \quad (\text{kWh})$$
- The system uses **Riemann trapezoidal numerical integration** with consecutive timestamps.
- If the time delta $\Delta t > 60\text{ s}$ (indicating sensor downtime or an outage), the system caps $\Delta t$ at 15 seconds to avoid inflating energy calculations during missing-data gaps.

### P. Peak Demand ($kW$)
The highest instantaneous active power draw recorded during the evaluation window. Utilities charge for peak demand to cover the capital costs of sizing transmission lines and step-down transformers.

### Q. Load Factor ($LF$)
$$\text{Load Factor} = \frac{\text{Average Active Power }(kW)}{\text{Peak Active Power }(kW)} = \frac{E_{\text{total}} (kWh)}{P_{\text{peak}} (kW) \times T (h)}$$
- Measures electrical asset utilization efficiency ($0 \le LF \le 1$).
- **High LF ($> 0.70$)**: Steady, consistent energy usage, maximizing equipment utilization.
- **Low LF ($< 0.40$)**: Intermittent demand spikes with low average utilization, resulting in higher peak demand charges.

### R. Historical Baseline Deviations
Rather than relying on static estimates, each complex is benchmarked against its own historical baseline stored in SQLite (`lifetime_avg_power_kw`, `lifetime_peak_power_kw`, `lifetime_avg_pf`).

### S. Alert Detection & State Machine
The backend evaluates 8 electrical conditions upon reading insertion:
1. Low PF: $PF < 0.85$ (Warning)
2. Low Voltage: $V_L < 380\text{ V}$ (Critical)
3. High Voltage: $V_L > 420\text{ V}$ (Critical)
4. Low Frequency: $f < 49.5\text{ Hz}$ (Warning)
5. High Frequency: $f > 50.5\text{ Hz}$ (Warning)
6. High Load: $P > 90\% P_{\text{rated}}$ (Warning)
7. Overload: $P > 100\% P_{\text{rated}}$ (Critical)
8. Sensor Offline: No reading for $> 60\text{ s}$ (Warning)
- **Duplicate Prevention**: The system checks if `is_active = 1` for that building and alert type before creating a new alert.
- **Auto-Clearing**: When conditions return to normal, `is_active` is updated to `0` and `cleared_at` is stamped.

### T. After-Hours Energy Consumption
Configured in `faculty_settings` table:
- Standard hours: $08:00\text{ to }17:00$ (Monday to Friday).
- Off-hours: Before $08:00$, at/after $17:00$, and all day Saturday and Sunday ($100\%$ after-hours).
- Integrates energy outside these hours to quantify baseline usage.

### U. Two-Part Demonstration Tariff Formulation
$$\text{Estimated Total Cost} = \text{Energy Charge} + \text{Demand Charge} + \text{Fixed Service Charge}$$
- $\text{Energy Charge} = E_{\text{consumed}} \times 38.50\text{ LKR/kWh}$
- $\text{Demand Charge} = P_{\text{peak}} \times 1,450.00\text{ LKR/kW} \times \left(\frac{\text{Days}}{30}\right)$
- $\text{Fixed Charge} = 3,000.00\text{ LKR} \times \left(\frac{\text{Days}}{30}\right)$
- Clearly flagged with the disclaimer: *"Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."*

---

## 4. 40 Frequently Asked Viva Questions & Model Answers

### General & Architecture
1. **Why did you choose this project?**
   *Answer*: Large university campuses lack departmental energy visibility. This system provides sub-metering analytics, power quality tracking, and automated alert detection to help reduce operating costs and protect laboratory equipment.
2. **Why Flask instead of Django or Node.js?**
   *Answer*: Flask is lightweight, has minimal boilerplate, and offers straightforward session authentication. It integrates cleanly with SQLite and scientific Python libraries for electrical calculations.
3. **Why SQLite instead of MySQL or PostgreSQL?**
   *Answer*: SQLite is embedded, serverless, and stores data in a single file (`energy.db`). With compound indexing on `(building_id, timestamp)`, it easily handles our query volumes with sub-50ms response times without the overhead of a separate database server.
4. **Is this real University of Ruhuna energy data?**
   *Answer*: No, all measurements are generated by a three-phase mathematical physics simulator (`simulator.py`) and clearly marked as `SIMULATED DATA`.
5. **Why use simulated readings?**
   *Answer*: Procuring and installing physical smart meters across six substations requires hardware purchases and planned power outages. Simulating data allowed full development and verification of the database, detection algorithms, and dashboards prior to hardware deployment.
6. **How would you connect real hardware?**
   *Answer*: Digital multi-function power meters at the main distribution boards would communicate over Modbus RS-485 or Modbus TCP. An IoT gateway (e.g., Raspberry Pi or ESP32) would query the registers and POST the readings to our Flask API or an MQTT broker.
7. **What happens if the simulator stops running?**
   *Answer*: The system detects the lack of incoming telemetry. Once 60 seconds elapse without a reading from a building, `check_sensor_offline_alerts()` triggers a `SENSOR_OFFLINE` warning alert.
8. **What are the main limitations of this prototype?**
   *Answer*: It currently uses simulated data rather than physical meter hardware, runs on Flask's built-in development WSGI server rather than production Gunicorn/Nginx, and uses a demonstration tariff model rather than a dynamic multi-tier time-of-use tariff.
9. **What improvements would you make in the future?**
   *Answer*: Integrate physical Modbus RS-485 smart meters, deploy behind Gunicorn and Nginx with SSL/TLS, implement automated email/SMS alert notifications, and add AI/machine-learning load forecasting.
10. **Does frontend JavaScript generate any random numbers?**
    *Answer*: No. All electrical measurements, totals, averages, and alert states are computed server-side by Flask from SQLite database records. The frontend handles display, formatting, and Chart.js rendering.

### Electrical Engineering & Mathematics
11. **How is active power calculated in a balanced three-phase system?**
    *Answer*: $P = \sqrt{3} \times V_L \times I_L \times \cos \phi / 1000$ (in kW), where $V_L$ is line-to-line voltage, $I_L$ is line current, and $\cos \phi$ is the power factor.
12. **What is the difference between kW, kVA, and kVAr?**
    *Answer*: kW is active power performing real work; kVA is apparent power representing total capacity drawn from the grid; kVAr is reactive power required to sustain magnetic fields in inductive loads.
13. **What is power factor and why is it important?**
    *Answer*: Power factor ($PF = P/S$) is the ratio of real working power to apparent power. A low PF ($< 0.85$) draws excess reactive current, increases $I^2 R$ heat losses, causes voltage drops, and triggers utility surcharges.
14. **Why is the nominal low-voltage supply in Sri Lanka 400 V / 230 V?**
    *Answer*: The Sri Lankan grid standard is a 400 V three-phase line-to-line, 230 V single-phase line-to-neutral system at 50 Hz, adhering to IEC 60038 standards.
15. **Why are voltage limits set to 380 V and 420 V?**
    *Answer*: They represent a standard $\pm 5\%$ statutory tolerance around nominal $400\text{ V}$. Voltages below 380 V can cause motor overheating; voltages above 420 V risk transformer core saturation and insulation stress.
16. **Why are grid frequency limits set to 49.5 Hz and 50.5 Hz?**
    *Answer*: They represent a $\pm 1\%$ operating band around $50.0\text{ Hz}$. Frequencies below 49.5 Hz indicate a generation deficit (demand exceeding generation), while frequencies above 50.5 Hz indicate excess generation.
17. **How does the system integrate energy?**
    *Answer*: It uses numerical trapezoidal integration over consecutive timestamp deltas: $E = \sum \frac{P_{i-1} + P_i}{2} \times \frac{\Delta t}{3600}\text{ kWh}$.
18. **How do you handle missing data gaps during energy integration?**
    *Answer*: If the time between readings exceeds 60 seconds (due to an outage or sensor disconnection), $\Delta t$ is capped at 15 seconds to prevent falsely assuming uninterrupted power consumption during downtime.
19. **What is peak demand?**
    *Answer*: The maximum instantaneous active power ($kW$) drawn by a facility during a given monitoring period.
20. **What is load factor and what does it tell an electrical engineer?**
    *Answer*: Load Factor is $\frac{P_{\text{avg}}}{P_{\text{peak}}}$. It measures load profile flatness. A low load factor ($< 0.40$) indicates intermittent peak surges with low average utilization, which increases demand charges.

### Alerts & Anomaly Detection
21. **How are duplicate alerts prevented?**
    *Answer*: The detection engine checks SQLite for existing active alerts (`is_active = 1`) matching that building and alert type. If one already exists, no duplicate insert occurs.
22. **How does an alert clear?**
    *Answer*: When incoming telemetry parameters normalize, `clear_alert()` updates the active alert row, setting `is_active = 0` and stamping `cleared_at = CURRENT_TIMESTAMP`.
23. **What is the difference between High Load and Overload?**
    *Answer*: High Load is a Warning triggered when active power exceeds $90\%$ of configured rated power. Overload is a Critical alert triggered when active power exceeds $100\%$ of rated power. When Overload triggers, any active High Load alert is cleared to prevent redundant alarms.
24. **Who can acknowledge alerts?**
    *Answer*: Only users with the `Administrator` role. If a `Viewer` attempts acknowledgment, the API returns HTTP 403 Forbidden.
25. **What happens to alerts during a sensor disconnection?**
    *Answer*: If no reading arrives for $> 60\text{ s}$, `check_sensor_offline_alerts()` creates a `SENSOR_OFFLINE` warning. When fresh readings arrive, it automatically clears.

### Cost & Efficiency
26. **What is a two-part maximum demand tariff?**
    *Answer*: A billing structure used for bulk institutional customers consisting of an energy charge ($LKR / kWh$) for fuel/operating costs and a maximum demand charge ($LKR / kW$) for grid infrastructure/capacity costs.
27. **Why is the tariff labelled as a demonstration tariff?**
    *Answer*: The official Ceylon Electricity Board (CEB) bulk institutional tariff requires verification and can vary. Using a configurable demonstration model ($38.50\text{ LKR/kWh}$ and $1450.00\text{ LKR/kW}$) allows testing without presenting estimates as official bills.
28. **How is the monthly demand charge scaled for shorter time periods?**
    *Answer*: The monthly demand charge is scaled proportionally to the queried duration: $\text{Demand Charge} = P_{\text{peak}} \times \text{Rate} \times \left(\frac{\text{Duration in Days}}{30}\right)$.
29. **What is after-hours energy consumption?**
    *Answer*: Energy consumed outside standard faculty operating hours ($08:00\text{ to }17:00$ Monday–Friday, and all day Saturday and Sunday). Tracking this helps identify equipment left running overnight.
30. **How are departmental efficiency rankings calculated?**
    *Answer*: A composite efficiency score ($0\text{ to }100$) weighted across Load Factor ($35\%$), Power Factor compliance ($35\%$), and operating-hours conservation ($30\%$).

### Reports & Data Export
31. **What parameters are included in the comprehensive summary report?**
    *Answer*: 16 parameters: Building name, reporting period, total energy ($kWh$), average active power ($kW$), peak demand ($kW$), apparent power ($kVA$), reactive power ($kVAr$), average and minimum PF, load factor, voltage range, frequency, after-hours energy, estimated cost, warning alert count, and critical alert count.
32. **How is the printable PDF report generated?**
    *Answer*: A dedicated HTML route (`/reports/printable`) applies print CSS (`@media print`) and clean typography so users can save the report directly to PDF using their browser's print dialog (`Ctrl+P`).
33. **What data is included in the CSV export?**
    *Answer*: Row-by-row telemetry containing reading ID, building ID, building code, building name, timestamp, line voltage, current, PF, frequency, apparent power, active power, reactive power, cumulative energy, and the `SIMULATED` data flag.
34. **Can Viewer accounts export reports and CSV files?**
    *Answer*: Yes, both Administrators and Viewers can view reports and download CSV telemetry. Only configuration changes (like tariff updates) are restricted to Administrators.
35. **How does the system ensure observations are evidence-based?**
    *Answer*: Observations are generated programmatically only when mathematical thresholds are met (e.g., $PF < 0.85$, $LF < 0.40$, or after-hours $> 25\%$), avoiding unsubstantiated claims.

### Security, Database & Engineering Practices
36. **How are passwords stored securely in SQLite?**
    *Answer*: Using PBKDF2/SHA-256 password hashing with unique salts generated via `werkzeug.security.generate_password_hash()`. Plain-text passwords are never stored.
37. **How does the system prevent SQL injection?**
    *Answer*: All database queries use parameterized SQL queries with `?` placeholders (e.g., `cursor.execute("SELECT ... WHERE building_id = ?", (b_id,))`) rather than string interpolation.
38. **What role-based access control (RBAC) levels exist?**
    *Answer*: Two roles: `Administrator` and `Viewer`. Administrators have full operational control; Viewers have read-only access.
39. **What happens if an unauthenticated user enters `/reports` or `/dashboard` in their browser?**
    *Answer*: The `@login_required` decorator intercepts the request and redirects the user to `/login` with an informational flash message.
40. **How many automated tests exist and what do they verify?**
    *Answer*: 63 tests across 8 test suites verifying database tables, simulator physics, live dashboard polling, historical calculations, anomaly detection, tariff modeling, and report generation.
