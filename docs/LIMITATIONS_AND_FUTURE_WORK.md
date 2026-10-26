# University of Ruhuna — Faculty of Engineering
## System Limitations and Future Work Roadmap (`LIMITATIONS_AND_FUTURE_WORK.md`)

This document critically evaluates the current technical boundaries of the **University of Ruhuna Smart Energy Monitoring and Analytics System** (Prototype Phase 10) and outlines the engineering roadmap for transitioning the system into a physical, hardware-integrated campus smart grid infrastructure.

---

## 🛑 1. Current Prototype Limitations

While the software architecture implements full three-phase power mathematics, real-time telemetry streaming, anomaly detection state machines, and institutional tariff calculations, several boundaries exist in the prototype:

### 1.1 Simulated Electrical Telemetry
- **Status**: All electrical measurements (Line Voltage $V_L$, Line Current $I_L$, Power Factor $\text{PF}$, Active Power $P$, Reactive Power $Q$, and Frequency $f$) are generated in software by `simulator.py`.
- **Constraint**: The readings follow stochastic equations with realistic diurnal university patterns, but do not capture real-world electrical transients, noise, voltage sags, switching surges, or real phase imbalance.
- **Academic Disclosure**: Every page, API endpoint, CSV telemetry export, and printable audit report explicitly labels the data as **`SIMULATED`** to preserve scientific and academic integrity.

### 1.2 No Physical Smart Meters on University Buildings
- **Status**: The prototype does not yet interface with physical digital energy meters installed in the substation switchrooms of the 6 faculty complexes:
  * Civil and Environmental Engineering (`CEE`)
  * Electrical and Information Engineering (`EIE`)
  * Mechanical and Manufacturing Engineering (`MME`)
  * Marine Engineering and Naval Architecture (`MENA`)
  * Administration Building (`ADMIN`)
  * Auditorium (`AUDI`)
- **Constraint**: Communication drivers for physical hardware protocols (e.g., Modbus RTU / TCP, DLMS/COSEM, or DNP3) have not yet been deployed in physical substations.

### 1.3 Balanced Three-Phase Assumption (No Per-Phase Measurements)
- **Status**: The current simulator assumes balanced three-phase operation across phases $R$, $Y$, and $B$ (where $V_{RN} = V_{YN} = V_{BN}$ and $I_R = I_Y = I_B$).
- **Constraint**: Real academic buildings frequently experience phase imbalance due to uneven distribution of single-phase office loads, split air conditioners, and lighting circuits across the three phases. Neutral current is not currently modeled or measured.

### 1.4 Prototype Embedded SQLite Database
- **Status**: Data persistence uses a single-file SQLite database (`energy.db`) configured with Write-Ahead Logging (`WAL` mode).
- **Constraint**: While SQLite handles concurrent demonstration loads effectively, it is not optimized for multi-year high-frequency sub-second telemetry ingestion across dozens of physical substations or distributed multi-node clustering.

### 1.5 Demonstration Tariff Model is Not Official University Bill
- **Status**: Cost estimates use a configurable two-part demonstration institutional tariff model (Energy Rate: LKR 38.50/kWh, Demand Rate: LKR 1,450.00/kW, Fixed Charge: LKR 3,000.00/month).
- **Constraint**: University of Ruhuna's actual monthly electricity billing is managed centrally by the Ceylon Electricity Board (CEB) under bulk supply tariffs, which may include time-of-use (TOU) peak/off-peak/day tiers, fuel adjustment charges (FAC), and contractual maximum demand limits that differ from the educational demonstration rates.

### 1.6 Passive Monitoring Without Automatic Load Control
- **Status**: The system is an analytics and supervisory monitoring platform.
- **Constraint**: When an overload ($> 100\%$ feeder capacity) or low power factor ($< 0.85$) is detected, the platform triggers visual alerts and records threshold events, but does not autonomously trip shunt circuit breakers, shed non-critical HVAC loads, or switch capacitor banks.

---

## 🚀 2. Future Work & Engineering Expansion Roadmap

To transition this software prototype into an industrial-grade campus energy management system (CEMS), the following enhancements are planned:

```text
               CAMPUS SMART ENERGY SYSTEM: FUTURE ARCHITECTURE
               
+-------------------------------------------------------------------------+
|                        Physical Substation Layer                        |
|                                                                         |
|  [Substation CEE]     [Substation EIE]     [Substation MME]    ...      |
|  Digital Multifunction Meters (Schneider / ABB / Janitza / Selec)       |
|  Per-Phase V_R, V_Y, V_B | I_R, I_Y, I_B | I_Neutral | THD% | Harmonics |
+-------------------------------------------------------------------------+
                                    │ RS-485 Serial Bus (Modbus RTU)
                                    ▼
+-------------------------------------------------------------------------+
|                       IoT Substation Gateway Layer                      |
|                                                                         |
|  Raspberry Pi / ESP32 Industrial Gateway running MQTT / Modbus TCP      |
|  Local circular buffer for zero data loss during network outages        |
+-------------------------------------------------------------------------+
                                    │ TLS-Encrypted Wi-Fi / Ethernet
                                    ▼
+-------------------------------------------------------------------------+
|                        Cloud Ingestion & Storage                        |
|                                                                         |
|  TimescaleDB / PostgreSQL Time-Series Engine                            |
|  Fast hypertable partitioning & automated data rollup retention         |
+-------------------------------------------------------------------------+
                                    │ REST / WebSockets
                                    ▼
+-------------------------------------------------------------------------+
|                  Analytics, AI & Automatic Control                      |
|                                                                         |
|  - LSTM / XGBoost Load Forecasting & Solar PV Yield Prediction          |
|  - Automatic Power Factor Correction (APFC) Capacitor Bank Switching   |
|  - Demand Response: Modbus relay shedding of non-critical HVAC          |
+-------------------------------------------------------------------------+
```

### 2.1 Physical Multifunction Energy Meters (MFM)
- Install DIN-rail multifunction digital energy meters (e.g., Schneider Electric PM5000 series, ABB M4M, or Selec MFM384) at the main low-voltage (400V) distribution switchboards of each department.
- Capture Class 0.5S or Class 0.2S revenue-grade active and reactive electrical energy.

### 2.2 Industrial IoT Gateway & Modbus/RS485 Integration
- Equip each substation with an industrial edge gateway (such as a DIN-rail Raspberry Pi CM4 or ESP32-based industrial controller).
- Implement Modbus RTU over RS-485 serial communication daisy-chained across meters.
- Transmit readings to the central server via MQTT over campus fiber-optic LAN or Wi-Fi with TLS encryption.
- Implement edge caching to prevent data gaps during campus network disruptions.

### 2.3 Comprehensive Three-Phase Per-Phase Telemetry
- Expand telemetry schema to record individual phase metrics:
  * Phase voltages ($V_{RN}, V_{YN}, V_{BN}$) and line-to-line voltages ($V_{RY}, V_{YB}, V_{BR}$).
  * Phase currents ($I_R, I_Y, I_B$) and neutral current ($I_N$).
  * Per-phase active power ($P_R, P_Y, P_B$), reactive power, and phase angle displacement.
- Detect phase current unbalance percentage according to IEEE/IEC standards.

### 2.4 Power Quality & Harmonic Monitoring
- Measure Total Harmonic Distortion (THD) for voltage ($\text{THD}_V\%$) and current ($\text{THD}_I\%$) up to the 31st harmonic.
- Track harmonic pollution generated by non-linear loads (variable frequency drives, laboratory computers, uninterruptible power supplies).
- Monitor voltage sags, swells, and transient flickers.

### 2.5 Rooftop Solar PV Generation & Microgrid Integration
- Integrate telemetry from the Faculty of Engineering’s existing or planned rooftop solar photovoltaic (PV) inverters.
- Monitor bidirectional active power flow (import vs. export to grid).
- Track net energy consumption, solar self-consumption ratio, and avoided carbon dioxide emissions ($kg\text{ CO}_2\text{ equivalent}$).

### 2.6 Automated Demand Response & Load Control
- Integrate programmable relay output modules (e.g., Modbus relay boards or BACnet actuators) for automated load management:
  * **Automatic Power Factor Correction (APFC)**: Automatically switch capacitor bank steps when power factor falls below $0.90$.
  * **Peak Demand Limiting**: Automatically trim or duty-cycle central chiller plants and corridor lighting when campus active power approaches the utility feeder capacity ceiling.

### 2.7 Production Cloud Time-Series Database
- Migrate from SQLite to **TimescaleDB** (built on PostgreSQL) or **InfluxDB**.
- Leverage hypertable chunking for high write throughput (millions of readings/day) and automated downsampling continuous aggregates (1-minute, 1-hour, 1-day rollups) for sub-second analytical queries.

### 2.8 Machine Learning & Predictive Energy Forecasting
- Implement predictive machine learning models (e.g., Long Short-Term Memory [LSTM] neural networks or XGBoost regressors).
- Forecast building load demand 24 hours in advance using historical patterns, academic calendar events, and weather forecasts.
- Provide early warning before monthly maximum demand records are breached.
