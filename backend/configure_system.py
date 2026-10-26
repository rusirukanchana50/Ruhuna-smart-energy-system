"""
configure_system.py
-------------------
Command-line configuration tool for the Ruhuna Smart Energy System.
Allows fast inspection and adjustment of:
  1. Building rated power capacities (kW)
  2. Faculty standard operating hours (start/end)
  3. Demonstration institutional tariff rates (LKR/kWh, LKR/kW, fixed charge)

Usage:
  # View current configuration:
  python configure_system.py --show

  # Update building rated power:
  python configure_system.py --building CEE --rated-power 65.0

  # Update operating hours:
  python configure_system.py --hours-start 08:30 --hours-end 16:30

  # Update demonstration tariff:
  python configure_system.py --energy-rate 42.0 --demand-rate 1500.0 --fixed-charge 3500.0
"""

import os
import sys
import argparse

# Ensure backend directory and project root are in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
for path in (BACKEND_DIR, PROJECT_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)

from database import (
    init_db,
    get_all_buildings,
    get_faculty_settings,
    get_active_tariff,
    update_building_rated_power,
    update_faculty_setting,
    update_tariff_configuration
)


def show_configurations():
    """Prints all active system configurations cleanly."""
    init_db()
    print("=" * 75)
    print(" University of Ruhuna - Faculty of Engineering")
    print(" Smart Energy System : Current Active Configurations")
    print("=" * 75)

    # 1. Buildings & Rated Power
    buildings = get_all_buildings()
    print("\n[1] Monitored Buildings & Configured Rated Power:")
    print("-" * 75)
    print(f" {'ID':<4} | {'Code':<7} | {'Name':<42} | {'Rated Power (kW)':<16}")
    print("-" * 75)
    for b in buildings:
        print(f" {b['id']:<4} | {b['code']:<7} | {b['name']:<42} | {b.get('rated_power_kw', 50.0):<16.1f}")

    # 2. Faculty Operating Hours
    settings = get_faculty_settings()
    print("\n[2] Faculty Operational Schedule Settings:")
    print("-" * 75)
    print(f" Standard Operating Hours Start : {settings.get('operating_hours_start', '08:00')}")
    print(f" Standard Operating Hours End   : {settings.get('operating_hours_end', '17:00')}")
    print(f" Monitored Operating Weekdays   : {settings.get('operating_days', '0,1,2,3,4')} (Mon-Fri)")
    print(f" Billing Normalization Period   : {settings.get('tariff_billing_days_norm', '30')} days")

    # 3. Demonstration Tariff
    tariff = get_active_tariff()
    print("\n[3] Demonstration Institutional Tariff Model:")
    print("-" * 75)
    print(f" Tariff Model Name    : {tariff.get('name')}")
    print(f" Energy Rate (LKR/kWh): Rs. {tariff.get('energy_rate_lkr_per_kwh', 0.0):.2f}")
    print(f" Demand Rate (LKR/kW) : Rs. {tariff.get('demand_rate_lkr_per_kw', 0.0):.2f}/kW monthly peak")
    print(f" Monthly Fixed Charge : Rs. {tariff.get('fixed_charge_lkr', 0.0):.2f}")
    print("=" * 75)


def main():
    parser = argparse.ArgumentParser(description="Configure Ruhuna Smart Energy System settings.")
    parser.add_argument("--show", action="store_true", help="Display all active configuration parameters")
    parser.add_argument("--building", type=str, help="Building code (e.g., CEE, EIE, MME, MENA, ADMIN, AUDI) or ID")
    parser.add_argument("--rated-power", type=float, help="New rated power capacity in kW")
    parser.add_argument("--hours-start", type=str, help="Operating hours start (HH:MM format, e.g., 08:00)")
    parser.add_argument("--hours-end", type=str, help="Operating hours end (HH:MM format, e.g., 17:00)")
    parser.add_argument("--energy-rate", type=float, help="Demonstration energy rate (LKR/kWh)")
    parser.add_argument("--demand-rate", type=float, help="Demonstration monthly peak demand rate (LKR/kW)")
    parser.add_argument("--fixed-charge", type=float, help="Demonstration monthly fixed charge (LKR)")

    args = parser.parse_args()
    init_db()

    made_changes = False

    # 1. Update building rated power
    if args.building and args.rated_power is not None:
        buildings = get_all_buildings()
        target_bldg = None
        for b in buildings:
            if str(b["id"]) == args.building or b["code"].upper() == args.building.upper():
                target_bldg = b
                break

        if not target_bldg:
            print(f"[Error] Building '{args.building}' not found.")
            sys.exit(1)

        update_building_rated_power(target_bldg["id"], args.rated_power)
        print(f"[Success] Updated [{target_bldg['code']}] rated capacity to {args.rated_power:.1f} kW.")
        made_changes = True

    # 2. Update operating hours
    if args.hours_start:
        update_faculty_setting("operating_hours_start", args.hours_start.strip())
        print(f"[Success] Updated faculty operating hours start to {args.hours_start.strip()}.")
        made_changes = True

    if args.hours_end:
        update_faculty_setting("operating_hours_end", args.hours_end.strip())
        print(f"[Success] Updated faculty operating hours end to {args.hours_end.strip()}.")
        made_changes = True

    # 3. Update tariff
    if args.energy_rate is not None or args.demand_rate is not None or args.fixed_charge is not None:
        current_tariff = get_active_tariff()
        new_energy = args.energy_rate if args.energy_rate is not None else current_tariff["energy_rate_lkr_per_kwh"]
        new_demand = args.demand_rate if args.demand_rate is not None else current_tariff["demand_rate_lkr_per_kw"]
        new_fixed = args.fixed_charge if args.fixed_charge is not None else current_tariff["fixed_charge_lkr"]

        update_tariff_configuration(
            tariff_id=current_tariff["id"],
            name=current_tariff["name"],
            energy_rate=new_energy,
            demand_rate=new_demand,
            fixed_charge=new_fixed
        )
        print(f"[Success] Updated Demonstration Tariff: Energy=Rs. {new_energy:.2f}/kWh, Demand=Rs. {new_demand:.2f}/kW, Fixed=Rs. {new_fixed:.2f}.")
        made_changes = True

    if args.show or not made_changes:
        show_configurations()


if __name__ == "__main__":
    main()
