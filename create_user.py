"""
create_user.py
--------------
Command-line tool to provision or update user accounts (Administrator or Viewer).
Passwords are typed securely and masked via Python's standard `getpass` module
so that no plain-text passwords appear on screen, in source code, or in terminal logs.

Usage:
  Interactive mode:
    python create_user.py

  Non-interactive flag mode:
    python create_user.py --email admin@eng.ruh.ac.lk --name "Faculty Admin" --role Administrator
"""

import sys
import argparse
import getpass
from database import create_user, get_user_by_email, update_user_password, init_db


def prompt_secure_password():
    """Prompt for password and confirmation with masked characters."""
    while True:
        password = getpass.getpass("Enter Password (hidden): ")
        if len(password) < 6:
            print("[Error] Password must be at least 6 characters long. Please try again.\n")
            continue
        confirm = getpass.getpass("Confirm Password (hidden): ")
        if password != confirm:
            print("[Error] Passwords do not match. Please try again.\n")
            continue
        return password


def prompt_for_user():
    print("=" * 60)
    print(" University of Ruhuna - Faculty of Engineering")
    print(" Smart Energy System : User Account Provisioning")
    print("=" * 60)

    # 1. Full Name
    default_name = "Faculty Administrator"
    name_input = input(f"Enter Full Name [{default_name}]: ").strip()
    full_name = name_input if name_input else default_name

    # 2. Email Address
    default_email = "admin@eng.ruh.ac.lk"
    while True:
        email_input = input(f"Enter University Email [{default_email}]: ").strip()
        email = email_input if email_input else default_email

        if "@" not in email:
            print("[Error] Invalid email address format. Please include an '@'.")
            continue
        break

    # Check if user already exists
    existing = get_user_by_email(email)
    if existing:
        print(f"\n[Notice] Account '{email}' already exists ({existing['role']}: {existing['full_name']}).")
        choice = input("Do you wish to reset/update the password for this account? (y/n) [y]: ").strip().lower()
        if choice in ("", "y", "yes"):
            print("\nSet new password:")
            password = prompt_secure_password()
            update_user_password(email, password)
            print("\n" + "-" * 60)
            print(f" Password successfully updated for '{email}'!")
            print(f" Role:      {existing['role']}")
            print(f" Full Name: {existing['full_name']}")
            print("-" * 60)
            sys.exit(0)
        else:
            print("Operation aborted. No changes made.")
            sys.exit(0)

    # 3. Role
    print("\nSelect Role:")
    print("  1. Administrator (Full access)")
    print("  2. Viewer (Read-only access)")
    role_choice = input("Enter choice [1]: ").strip()
    role = "Viewer" if role_choice == "2" else "Administrator"

    # 4. Password securely entered via getpass
    print()
    password = prompt_secure_password()

    return email, password, full_name, role


def main():
    parser = argparse.ArgumentParser(description="Create a user for Ruhuna Smart Energy System.")
    parser.add_argument("--email", help="User email address")
    parser.add_argument("--name", help="User full name")
    parser.add_argument("--role", choices=["Administrator", "Viewer"], default="Administrator", help="User role")
    parser.add_argument("--password", help="Password (optional; if omitted, securely prompted)")

    args = parser.parse_args()

    # Ensure database tables exist (does NOT drop or reset existing data)
    init_db()

    if args.email and args.name:
        email = args.email.strip()
        full_name = args.name.strip()
        role = args.role

        existing = get_user_by_email(email)
        if args.password:
            password = args.password
        else:
            print(f"Setting password for {email} ({role})...")
            password = prompt_secure_password()

        if existing:
            update_user_password(email, password)
            print("\n" + "-" * 60)
            print(f" Password updated for existing account: {email}")
            print("-" * 60)
            return

        try:
            user_id = create_user(email=email, password=password, full_name=full_name, role=role)
            print("\n" + "-" * 60)
            print(f" User created successfully!")
            print(f" ID:        {user_id}")
            print(f" Full Name: {full_name}")
            print(f" Email:     {email}")
            print(f" Role:      {role}")
            print("-" * 60)
        except ValueError as e:
            print(f"\n[Error] {e}")
            sys.exit(1)
    else:
        email, password, full_name, role = prompt_for_user()
        try:
            user_id = create_user(email=email, password=password, full_name=full_name, role=role)
            print("\n" + "-" * 60)
            print(f" User created successfully!")
            print(f" ID:        {user_id}")
            print(f" Full Name: {full_name}")
            print(f" Email:     {email}")
            print(f" Role:      {role}")
            print("-" * 60)
        except ValueError as e:
            print(f"\n[Error] {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
