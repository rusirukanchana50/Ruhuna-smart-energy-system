# University of Ruhuna — Faculty of Engineering
## Electrical Engineering Mathematical Formulations (`FORMULAS.md`)

This document details the mathematical models, electrical formulas, derivations, and units implemented across the **Smart Energy Monitoring and Analytics System** (Hapugala, Galle).

---

## 1. Apparent Power ($S$)

### Definition
Apparent power represents the total power flowing in an alternating current (AC) circuit, comprising both energy-consuming active power and stored reactive power. In a balanced three-phase AC power system, apparent power is determined from the root-mean-square (RMS) line-to-line voltage ($V_L$) and line current ($I_L$).

### Formula
$$S = \sqrt{3} \times V_L \times I_L \quad [\text{VA}]$$

To express in kilovolt-amperes ($\text{kVA}$):
$$S_{\text{kVA}} = \frac{\sqrt{3} \times V_L \times I_L}{1000} \quad [\text{kVA}]$$

### Parameters & Units
| Symbol | Parameter | Nominal System Value | Unit |
|---|---|---|---|
| $V_L$ | RMS Line-to-Line Voltage | $400.0\text{ V}$ | Volts ($\text{V}$) |
| $I_L$ | RMS Line Current | Department-dependent ($10\text{ A} - 125\text{ A}$) | Amperes ($\text{A}$) |
| $\sqrt{3}$ | Three-phase geometric constant | $\approx 1.7320508$ | Dimensionless |
| $S$ | Apparent Power | Monitored | Kilovolt-Amperes ($\text{kVA}$) |

### Implementation Reference
- `simulator.py`: `calculate_electrical_parameters()`
- `test_phase3.py`: `test_1_three_phase_electrical_calculations()`

---

## 2. Active Power ($P$)

### Definition
Active power (also termed real power or true power) is the actual electrical power converted into useful work (such as mechanical torque, thermal energy, computing power, or lighting) in an AC circuit.

### Formula
$$P = S \times \cos(\theta) = \sqrt{3} \times V_L \times I_L \times \text{PF} \quad [\text{W}]$$

To express in kilowatts ($\text{kW}$):
$$P_{\text{kW}} = \frac{\sqrt{3} \times V_L \times I_L \times \text{PF}}{1000} = S_{\text{kVA}} \times \text{PF} \quad [\text{kW}]$$

### Parameters & Units
| Symbol | Parameter | Typical Range | Unit |
|---|---|---|---|
| $P$ | Active (Real) Power | $10.0 - 90.0$ | Kilowatts ($\text{kW}$) |
| $\text{PF}$ | Displacement Power Factor ($\cos\theta$) | $0.80 - 0.95$ | Dimensionless |
| $\theta$ | Phase angle between voltage and current | $18^\circ - 36^\circ$ | Degrees ($^\circ$) |

### Implementation Reference
- `simulator.py`: Line 206
- `database.py`: `get_energy_analytics()`, `get_comprehensive_energy_report()`

---

## 3. Reactive Power ($Q$)

### Definition
Reactive power represents the electrical power oscillating between the source and inductive or capacitive magnetic/electric fields. In university engineering facilities, reactive power is primarily drawn by inductive motor loads (pumps, compressors, machining tools, ventilation fans) and inductive ballasts.

### Formula
Using trigonometric identity $\sin(\theta) = \sqrt{1 - \cos^2(\theta)} = \sqrt{1 - \text{PF}^2}$:

$$Q = S \times \sin(\theta) = S \times \sqrt{1 - \text{PF}^2} \quad [\text{VAr}]$$

To express in kilovolt-amperes reactive ($\text{kVAr}$):
$$Q_{\text{kVAr}} = S_{\text{kVA}} \times \sqrt{1 - \text{PF}^2} \quad [\text{kVAr}]$$

### Power Triangle Validation
The fundamental AC power triangle relationship is rigorously enforced:
$$S^2 = P^2 + Q^2 \implies S = \sqrt{P^2 + Q^2}$$

### Parameters & Units
| Symbol | Parameter | Meaning | Unit |
|---|---|---|---|
| $Q$ | Reactive Power | Magnetic field sustaining power | Kilovolt-Amperes Reactive ($\text{kVAr}$) |
| $S$ | Apparent Power | Vector sum of active and reactive power | $\text{kVA}$ |
| $P$ | Active Power | Useful working power | $\text{kW}$ |

### Implementation Reference
- `simulator.py`: Line 210
- `test_phase3.py`: Power triangle validation assertion

---

## 4. Power Factor ($\text{PF}$)

### Definition
The power factor is the ratio of real active power to apparent power. It is an index of how effectively electrical current is being converted into useful work output.

### Formula
$$\text{PF} = \frac{P}{S} = \cos(\theta) \quad [\text{Dimensionless, } 0.0 \le \text{PF} \le 1.0]$$

For a collection of $N$ discrete historical telemetry samples:
$$\text{PF}_{\text{avg}} = \frac{1}{N} \sum_{i=1}^{N} \text{PF}_i$$

### Utility Penalty & Engineering Significance
- **Optimal Range**: $\text{PF} \ge 0.90$
- **Regulatory Threshold**: The Ceylon Electricity Board (CEB) industrial tariff imposes severe surcharges when average power factor falls below **$0.85$**.
- When $\text{PF} < 0.85$, larger line currents are required to deliver the same active power, causing higher $I^2 R$ transmission losses, voltage drops, and transformer thermal stress.
- The system automatically triggers a `LOW_POWER_FACTOR` **WARNING** alert whenever $\text{PF} < 0.850$.

### Implementation Reference
- `database.py`: `evaluate_electrical_alerts()`, `calculate_building_analytics()`

---

## 5. Electrical Energy Consumption ($E$)

### Definition
Energy is the integral of active power over elapsed time. In the monitoring system, energy consumption is computed incrementally based on discrete timestamp intervals between consecutive telemetry readings.

### Continuous Time Integral
$$E = \int_{t_1}^{t_2} P(t) \, dt \quad [\text{kWh}]$$

### Discrete Trapezoidal Numerical Integration
For discrete readings $(t_{i-1}, P_{i-1})$ and $(t_i, P_i)$ separated by elapsed time $\Delta t_i = t_i - t_{i-1}$ seconds:

$$\Delta E_i = \left( \frac{P_{i-1} + P_i}{2} \right) \times \frac{\Delta t_i}{3600} \quad [\text{kWh}]$$

$$E_{\text{total}} = \sum_{i=1}^{N} \Delta E_i \quad [\text{kWh}]$$

### Discontinuous Telemetry & Missing Sensor Gap Protection
If sensor transmission is interrupted such that:
$$\Delta t_i > \Delta t_{\text{max}} \quad (\Delta t_{\text{max}} = 60.0\text{ seconds})$$

The system assumes telemetry communication was lost. In order to prevent false energy inflation across downtime:
$$\Delta E_i = P_i \times \frac{\Delta t_{\text{nominal}}}{3600} \quad (\Delta t_{\text{nominal}} = 15.0\text{ seconds})$$

### Implementation Reference
- `simulator.py`: `calculate_cumulative_energy()`
- `database.py`: `calculate_building_analytics()`
- `test_phase5_thorough.py`: Scenarios A, B, and C

---

## 6. Peak Demand ($P_{\text{peak}}$)

### Definition
Peak active demand is the maximum active electrical power recorded by a building or substation feeder across the queried monitoring window.

### Formula
$$P_{\text{peak}} = \max_{i=1 \dots N} \left( P_i \right) \quad [\text{kW}]$$

For campus-wide aggregate demand across $M = 6$ buildings:
$$P_{\text{peak, campus}} = \max \left( P_{\text{peak}, 1}, P_{\text{peak}, 2}, \dots, P_{\text{peak}, M} \right) \quad [\text{kW}]$$

### Engineering Significance
Peak demand determines the physical sizing of substation switchgear, underground feeder cables, and power transformers. In university energy management, reducing peak demand through load shifting lowers institutional maximum demand charges.

### Implementation Reference
- `database.py`: `calculate_building_analytics()`, `get_comprehensive_energy_report()`

---

## 7. Load Factor ($\text{LF}$)

### Definition
Load factor is the dimensionless ratio of average active power consumption over a specific period to the peak demand occurring in that same period.

### Formula
$$\text{LF} = \frac{P_{\text{avg}}}{P_{\text{peak}}} \quad [0.0 \le \text{LF} \le 1.0]$$

Expressed as a percentage:
$$\text{LF}_{\%} = \left( \frac{P_{\text{avg}}}{P_{\text{peak}}} \right) \times 100\%$$

Where average active power is:
$$P_{\text{avg}} = \frac{1}{N} \sum_{i=1}^{N} P_i \quad [\text{kW}]$$

Or alternatively derived from total integrated energy and duration $T$ hours:
$$P_{\text{avg}} = \frac{E_{\text{total}}}{T} \quad [\text{kW}]$$

### Interpretation
| Load Factor | Characterization | Operational Implication |
|---|---|---|
| **$\text{LF} \ge 0.85$** | **High / Optimal** | Steady, consistent load utilization; high return on infrastructure investment. |
| **$0.60 \le \text{LF} < 0.85$** | **Moderate** | Standard academic cycle with clear daytime lecture/lab peaks. |
| **$\text{LF} < 0.60$** | **Low / Peaky** | High peak demand spikes compared to average utilization; high demand charges relative to consumed kWh. |

### Implementation Reference
- `database.py`: `calculate_building_analytics()`
- `test_phase5_thorough.py`: Ground truth validation

---

## 8. Estimated Electricity Cost (Two-Part Institutional Tariff)

### Model Structure
The demonstration electricity cost model reflects standard institutional/industrial utility billing structures (such as CEB Tariff Category I-2 or G-2):

$$\text{Total Cost} = C_{\text{energy}} + C_{\text{demand}} + C_{\text{fixed}} \quad [\text{LKR}]$$

### 1. Energy Charge ($C_{\text{energy}}$)
Based strictly on the active kilowatt-hours consumed:
$$C_{\text{energy}} = E_{\text{total}} \times R_{\text{energy}} \quad [\text{LKR}]$$
- Default Rate: $R_{\text{energy}} = \text{Rs. } 38.50 \text{ per kWh}$

### 2. Maximum Demand Charge ($C_{\text{demand}}$)
Based on the peak active power demand ($P_{\text{peak}}$) recorded during the monitoring period, scaled proportionally to the queried window relative to a standard 30-day utility billing cycle ($T_{\text{norm}} = 30 \text{ days} = 2,592,000\text{ s}$):

$$C_{\text{demand}} = P_{\text{peak}} \times R_{\text{demand}} \times \left( \frac{T_{\text{duration}}}{T_{\text{norm}}} \right) \quad [\text{LKR}]$$
- Default Rate: $R_{\text{demand}} = \text{Rs. } 1,450.00 \text{ per kW monthly peak}$
- Duration fraction: $\frac{T_{\text{duration}}}{30 \times 86400}$

### 3. Customer Fixed Service Charge ($C_{\text{fixed}}$)
Fixed monthly connection and meter administration charge, scaled to duration:

$$C_{\text{fixed}} = R_{\text{fixed}} \times \left( \frac{T_{\text{duration}}}{T_{\text{norm}}} \right) \quad [\text{LKR}]$$
- Default Fixed Rate: $R_{\text{fixed}} = \text{Rs. } 3,000.00 \text{ per month}$

### Complete Formulation
$$\text{Cost}_{\text{total}} = \left( E_{\text{total}} \times R_{\text{energy}} \right) + \left[ \left( P_{\text{peak}} \times R_{\text{demand}} + R_{\text{fixed}} \right) \times \left( \frac{T_{\text{duration}}}{30 \text{ days}} \right) \right] \quad [\text{LKR}]$$

### Implementation Reference
- `database.py`: `calculate_building_cost()`
- `test_phase7.py`: Controlled cost calculation verification
