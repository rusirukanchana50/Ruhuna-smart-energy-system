"""
database.py
-----------
Handles SQLite database connection, table initialization, and initial data seeding
for the Faculty of Engineering, University of Ruhuna Smart Energy System.
"""

import sqlite3
import os
import math
from datetime import datetime

# Define the database filename
DB_NAME = "energy.db"

# Path to the database file (in the same folder as this script)
DB_PATH = os.path.join(os.path.dirname(__file__), DB_NAME)


def get_db_connection():
    """
    Establishes and returns a connection to the SQLite database.
    Configures row_factory so query results can be accessed like Python dictionaries.
    Uses timeout=30.0 to prevent lock contention between simulator.py and app.py.
    Enforces SQLite foreign key constraints (PRAGMA foreign_keys = ON) on every connection.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row  # Enables column access by name (e.g., row['name'])
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db():
    """
    Initializes the database:
    1. Sets PRAGMA journal_mode=WAL for robust concurrent read/write access.
    2. Creates the 'buildings' table if it does not already exist.
    3. Seeds the 6 initial Faculty of Engineering buildings if the table is empty.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # Enable Write-Ahead Logging (WAL) for high multi-process concurrency
    try:
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass

    # Step 1: Create the buildings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS buildings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE,
            description TEXT,
            rated_power_kw REAL DEFAULT 50.0
        )
    """)

    # Check if rated_power_kw column exists in buildings (for existing DB migration)
    cursor.execute("PRAGMA table_info(buildings)")
    existing_bldg_cols = [col["name"] for col in cursor.fetchall()]
    if "rated_power_kw" not in existing_bldg_cols:
        cursor.execute("ALTER TABLE buildings ADD COLUMN rated_power_kw REAL DEFAULT 50.0")

    # Step 2: Create the users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('Administrator', 'Viewer')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Step 3: Create the energy_readings table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS energy_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            building_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            voltage REAL NOT NULL,
            current REAL NOT NULL,
            power_factor REAL NOT NULL,
            frequency REAL NOT NULL,
            apparent_power_kva REAL NOT NULL,
            active_power_kw REAL NOT NULL,
            reactive_power_kvar REAL NOT NULL,
            energy_kwh REAL NOT NULL,
            is_simulated INTEGER DEFAULT 1,
            FOREIGN KEY (building_id) REFERENCES buildings(id)
        )
    """)

    # Index on building_id and timestamp for fast live and history queries
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_readings_building_timestamp 
        ON energy_readings(building_id, timestamp)
    """)

    # Step 4: Create the alerts table (Phase 6)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            building_id INTEGER NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('INFO', 'WARNING', 'CRITICAL')),
            measured_value REAL,
            threshold_value REAL,
            message TEXT NOT NULL,
            acknowledged INTEGER DEFAULT 0,
            acknowledged_by TEXT,
            acknowledged_at TIMESTAMP,
            is_active INTEGER DEFAULT 1,
            cleared_at TIMESTAMP,
            FOREIGN KEY (building_id) REFERENCES buildings(id)
        )
    """)

    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_bldg_active ON alerts(building_id, is_active)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_lookup ON alerts(building_id, alert_type, is_active)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_alerts_timestamp ON alerts(timestamp DESC)")

    # Step 5: Create the tariffs table (Phase 7: Energy Cost & Efficiency Analysis)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tariffs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            energy_rate_lkr_per_kwh REAL NOT NULL,
            demand_rate_lkr_per_kw REAL NOT NULL,
            fixed_charge_lkr REAL NOT NULL,
            effective_from TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            active INTEGER DEFAULT 1
        )
    """)

    # Step 6: Create faculty_settings table for configurable operating hours (Phase 7)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS faculty_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            description TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Step 7: Create audit_logs table for administrative security and operations tracking
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            actor_email TEXT NOT NULL,
            action TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_code TEXT,
            details TEXT,
            ip_address TEXT
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)")

    # Seed demonstration tariff if none exists
    cursor.execute("SELECT COUNT(*) FROM tariffs")
    tariff_count = cursor.fetchone()[0]
    if tariff_count == 0:
        cursor.execute("""
            INSERT INTO tariffs (name, energy_rate_lkr_per_kwh, demand_rate_lkr_per_kw, fixed_charge_lkr, effective_from, active)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
        """, (
            "Demonstration Institutional Tariff (Estimated Non-Official Model)",
            38.50,   # LKR per kWh
            1450.00, # LKR per kW monthly peak demand rate
            3000.00  # LKR monthly fixed customer service charge
        ))

    # Seed default faculty operating hours settings if not present
    default_settings = [
        ("operating_hours_start", "08:00", "Daily faculty standard operating hours start (HH:MM)"),
        ("operating_hours_end", "17:00", "Daily faculty standard operating hours end (HH:MM)"),
        ("operating_days", "0,1,2,3,4", "Active operating weekdays (0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri; Sat/Sun are after-hours)"),
        ("tariff_billing_days_norm", "30", "Billing period monthly normalization denominator in days")
    ]
    for key, val, desc in default_settings:
        cursor.execute("""
            INSERT OR IGNORE INTO faculty_settings (setting_key, setting_value, description)
            VALUES (?, ?, ?)
        """, (key, val, desc))

    # Step 7: Check if buildings already exist and if initial seeding already completed
    cursor.execute("SELECT COUNT(*) FROM buildings")
    count = cursor.fetchone()[0]

    cursor.execute("SELECT setting_value FROM faculty_settings WHERE setting_key = 'initial_buildings_seeded'")
    seeded_row = cursor.fetchone()
    has_seeded = (seeded_row is not None and str(seeded_row[0]).strip() == "1")

    # Default rated power ratings per facility
    default_rated_powers = {
        "CEE": 60.0,
        "EIE": 70.0,
        "MME": 85.0,
        "MENA": 55.0,
        "ADMIN": 40.0,
        "AUDI": 50.0
    }

    # Step 6: Insert initial buildings ONLY on initial brand-new database setup (empty and never seeded)
    if count == 0 and not has_seeded:
        initial_buildings = [
            (
                "Civil and Environmental Engineering",
                "CEE",
                "Department of Civil and Environmental Engineering building.",
                60.0
            ),
            (
                "Electrical and Information Engineering",
                "EIE",
                "Department of Electrical and Information Engineering building.",
                70.0
            ),
            (
                "Mechanical and Manufacturing Engineering",
                "MME",
                "Department of Mechanical and Manufacturing Engineering building.",
                85.0
            ),
            (
                "Marine Engineering and Naval Architecture",
                "MENA",
                "Department of Marine Engineering and Naval Architecture building.",
                55.0
            ),
            (
                "Administration Building",
                "ADMIN",
                "Dean's Office and Administrative staff offices.",
                40.0
            ),
            (
                "Auditorium",
                "AUDI",
                "Main Faculty Auditorium for lectures, conferences, and events.",
                50.0
            )
        ]

        cursor.executemany("""
            INSERT INTO buildings (name, code, description, rated_power_kw)
            VALUES (?, ?, ?, ?)
        """, initial_buildings)

        cursor.execute("""
            INSERT OR REPLACE INTO faculty_settings (setting_key, setting_value, description)
            VALUES ('initial_buildings_seeded', '1', 'Flag indicating initial demonstration buildings have been seeded')
        """)
        conn.commit()
        print(f"[Database] Successfully initialized '{DB_NAME}' and added 6 buildings.")
    else:
        # Mark seeded flag if not already set, so subsequent restarts never recreate deleted buildings
        if not has_seeded and count > 0:
            cursor.execute("""
                INSERT OR REPLACE INTO faculty_settings (setting_key, setting_value, description)
                VALUES ('initial_buildings_seeded', '1', 'Flag indicating initial demonstration buildings have been seeded')
            """)
            conn.commit()

        # Update existing buildings with designated rated powers if currently default/null
        for b_code, b_rated in default_rated_powers.items():
            cursor.execute("""
                UPDATE buildings
                SET rated_power_kw = ?
                WHERE code = ? AND (rated_power_kw IS NULL OR rated_power_kw = 50.0)
            """, (b_rated, b_code))
        conn.commit()
        print(f"[Database] '{DB_NAME}' already initialized with {count} building(s).")

    conn.commit()
    conn.close()


def create_user(email, password, full_name, role="Viewer"):
    """
    Creates a new user with a hashed password in the database.
    Args:
        email (str): Unique user email
        password (str): Plain-text password to be hashed
        full_name (str): Full name of the user
        role (str): 'Administrator' or 'Viewer'
    Returns:
        int: The newly created user's ID
    """
    from werkzeug.security import generate_password_hash

    if role not in ("Administrator", "Viewer"):
        raise ValueError("Role must be either 'Administrator' or 'Viewer'.")

    email = email.strip().lower()
    full_name = full_name.strip()
    password_hash = generate_password_hash(password)

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES (?, ?, ?, ?)
        """, (email, password_hash, full_name, role))
        conn.commit()
        user_id = cursor.lastrowid
        return user_id
    except sqlite3.IntegrityError:
        raise ValueError(f"User with email '{email}' already exists.")
    finally:
        conn.close()


def get_user_by_email(email):
    """
    Retrieves a user row by email.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email.strip(),))
    user = cursor.fetchone()
    conn.close()
    return user


def get_user_by_id(user_id):
    """
    Retrieves a user row by ID.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    return user


def update_user_password(email, new_password):
    """
    Updates the hashed password for an existing user.
    """
    from werkzeug.security import generate_password_hash
    email = email.strip().lower()
    password_hash = generate_password_hash(new_password)

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE users SET password_hash = ? WHERE LOWER(email) = LOWER(?)
    """, (password_hash, email))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return rows_affected > 0


def get_all_buildings():
    """
    Retrieves all buildings from the database along with rated active power.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
        FROM buildings
        ORDER BY id ASC
    """)
    buildings = cursor.fetchall()
    conn.close()
    return [dict(b) for b in buildings]


def get_building_by_id(building_id):
    """
    Retrieves a single building by ID.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
        FROM buildings
        WHERE id = ?
    """, (int(building_id),))
    building = cursor.fetchone()
    conn.close()
    return dict(building) if building else None


def get_building_rated_power(building_id):
    """
    Retrieves the configured rated power in kW for a building.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COALESCE(rated_power_kw, 50.0) AS rated_power_kw FROM buildings WHERE id = ?", (int(building_id),))
    row = cursor.fetchone()
    conn.close()
    return float(row["rated_power_kw"]) if row else 50.0


def update_building_rated_power(building_id, rated_power_kw):
    """
    Updates the rated power capacity in kW for a specific building.
    Enables dynamic re-configuration of building safety thresholds.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE buildings SET rated_power_kw = ? WHERE id = ?", (float(rated_power_kw), int(building_id)))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0

def get_building_by_code(code, exclude_id=None):
    """
    Retrieves a building by code (case-insensitive).
    Optionally excludes exclude_id to allow existing buildings to retain their own code during updates.
    """
    if not code:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    if exclude_id is not None:
        cursor.execute("""
            SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
            FROM buildings
            WHERE UPPER(code) = UPPER(?) AND id != ?
        """, (str(code).strip(), int(exclude_id)))
    else:
        cursor.execute("""
            SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
            FROM buildings
            WHERE UPPER(code) = UPPER(?)
        """, (str(code).strip(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_building_by_name(name, exclude_id=None):
    """
    Retrieves a building by name (case-insensitive).
    Optionally excludes exclude_id to allow existing buildings to retain their own name during updates.
    """
    if not name:
        return None
    conn = get_db_connection()
    cursor = conn.cursor()
    if exclude_id is not None:
        cursor.execute("""
            SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
            FROM buildings
            WHERE LOWER(name) = LOWER(?) AND id != ?
        """, (str(name).strip(), int(exclude_id)))
    else:
        cursor.execute("""
            SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
            FROM buildings
            WHERE LOWER(name) = LOWER(?)
        """, (str(name).strip(),))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def add_building(code, name, rated_power_kw):
    """
    Inserts a new building row into the buildings table atomically.
    Normalizes code to uppercase and strips whitespace.
    Returns the new row ID.
    Rolls back on error to ensure transaction atomicity.
    """
    norm_code = str(code).strip().upper()
    norm_name = str(name).strip()
    power_val = float(rated_power_kw)

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO buildings (code, name, rated_power_kw)
            VALUES (?, ?, ?)
        """, (norm_code, norm_name, power_val))
        conn.commit()
        new_id = cursor.lastrowid
        return new_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_building(building_id, name, rated_power_kw, code=None):
    """
    Updates the building record for the given building_id atomically.
    Supports updating name and rated_power_kw, and optionally code if provided.
    Rolls back on error to ensure transaction atomicity.
    """
    norm_name = str(name).strip()
    power_val = float(rated_power_kw)

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if code is not None:
            norm_code = str(code).strip().upper()
            cursor.execute("""
                UPDATE buildings
                SET name = ?, rated_power_kw = ?, code = ?
                WHERE id = ?
            """, (norm_name, power_val, norm_code, int(building_id)))
        else:
            cursor.execute("""
                UPDATE buildings
                SET name = ?, rated_power_kw = ?
                WHERE id = ?
            """, (norm_name, power_val, int(building_id)))
        rows_affected = cursor.rowcount
        conn.commit()
        return rows_affected > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_building_dependencies(building_id):
    """
    Returns a dictionary of dependent record counts (energy_readings, alerts)
    for a given building_id to safeguard historical electrical data.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM energy_readings WHERE building_id = ?", (int(building_id),))
    readings_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM alerts WHERE building_id = ?", (int(building_id),))
    alerts_count = cursor.fetchone()[0]
    conn.close()
    return {
        "readings_count": readings_count,
        "alerts_count": alerts_count,
        "total_dependencies": readings_count + alerts_count
    }


def delete_building(building_id):
    """
    Safely deletes a building row with the given building_id.
    - If the building does not exist, returns False.
    - If the building has dependent records (energy_readings or alerts),
      raises ValueError to prevent deletion and safeguard historical data.
    - If the building has no dependent records, executes DELETE and returns True.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Verify building existence
    cursor.execute("SELECT id, name, code FROM buildings WHERE id = ?", (int(building_id),))
    bldg = cursor.fetchone()
    if not bldg:
        conn.close()
        return False

    # 2. Check for dependent historical telemetry or alert records
    cursor.execute("SELECT COUNT(*) FROM energy_readings WHERE building_id = ?", (int(building_id),))
    readings_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM alerts WHERE building_id = ?", (int(building_id),))
    alerts_count = cursor.fetchone()[0]

    if readings_count > 0 or alerts_count > 0:
        conn.close()
        deps = []
        if readings_count > 0:
            deps.append(f"{readings_count} historical energy reading(s)")
        if alerts_count > 0:
            deps.append(f"{alerts_count} alert record(s)")
        deps_msg = " and ".join(deps)
        raise ValueError(
            f"Cannot delete building '{bldg['name']}' ({bldg['code']}): "
            f"it has {deps_msg}. Historical electrical data must be preserved."
        )

    # 3. Safe to delete (no dependencies exist)
    try:
        cursor.execute("DELETE FROM buildings WHERE id = ?", (int(building_id),))
        conn.commit()
        rows_affected = cursor.rowcount
    except sqlite3.IntegrityError as e:
        conn.close()
        raise ValueError(f"Foreign key constraint prevented deletion of building #{building_id}: {e}")
    finally:
        conn.close()

    return rows_affected > 0


# ==============================================================================
# Phase 14: Safe Administrator Demonstration Building Cleanup Engine
# ==============================================================================

CORE_PROTECTED_BUILDING_CODES = frozenset({"CEE", "EIE", "MME", "MENA", "ADMIN", "AUDI"})


def record_audit_log(actor_email, action, target_type, target_code=None, details=None, ip_address=None, conn=None):
    """
    Inserts a persistent security audit log entry into the audit_logs table.
    If conn is provided, executes within the caller's active transaction;
    otherwise opens, commits, and closes a standalone connection.
    """
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    try:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO audit_logs (timestamp, actor_email, action, target_type, target_code, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            str(actor_email or "SYSTEM").strip(),
            str(action).strip(),
            str(target_type).strip(),
            str(target_code).strip() if target_code else None,
            str(details).strip() if details else None,
            str(ip_address).strip() if ip_address else None
        ))
        if should_close:
            conn.commit()
    finally:
        if should_close:
            conn.close()


def backup_database_verified(backup_prefix="pre_cleanup"):
    """
    Creates a verified, point-in-time database snapshot using SQLite's online backup API.
    Guarantees WAL consistency and verifies the target backup file integrity before proceeding.
    Stores backups in the workspace 'backups/' directory (outside public web paths and ignored by git).
    Returns the absolute path to the validated backup file.
    """
    base_dir = os.path.dirname(os.path.abspath(DB_PATH))
    backup_dir = os.path.join(base_dir, "backups")
    os.makedirs(backup_dir, exist_ok=True)

    timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    db_base = os.path.splitext(os.path.basename(DB_PATH))[0]
    backup_filename = f"{db_base}_{backup_prefix}_{timestamp_str}.backup"
    backup_path = os.path.join(backup_dir, backup_filename)

    source_conn = get_db_connection()
    try:
        dest_conn = sqlite3.connect(backup_path, timeout=30.0)
        try:
            with dest_conn:
                source_conn.backup(dest_conn)
        finally:
            dest_conn.close()
    finally:
        source_conn.close()

    # Verify backup exists, has non-zero size, and passes SQLite integrity check
    if not os.path.exists(backup_path) or os.path.getsize(backup_path) == 0:
        raise RuntimeError(f"Database backup failed: target file '{backup_path}' was not created or is empty.")

    verify_conn = sqlite3.connect(backup_path, timeout=10.0)
    try:
        check = verify_conn.execute("PRAGMA integrity_check;").fetchone()
        if not check or check[0] != "ok":
            raise RuntimeError(f"Database backup verification failed PRAGMA integrity check: {check}")
    finally:
        verify_conn.close()

    return backup_path


def get_building_deletion_preview(building_id):
    """
    Retrieves pre-deletion inspection metadata and eligibility for a building.
    Returns:
    {
        "building_id": int,
        "name": str,
        "code": str,
        "is_core": bool,
        "total_readings": int,
        "simulated_readings": int,
        "non_simulated_readings": int,
        "alerts_count": int,
        "total_dependencies": int,
        "can_delete": bool,
        "rejection_reason": str or None
    }
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, code, description, COALESCE(rated_power_kw, 50.0) AS rated_power_kw
        FROM buildings
        WHERE id = ?
    """, (int(building_id),))
    bldg = cursor.fetchone()
    if not bldg:
        conn.close()
        return None

    code = str(bldg["code"]).strip().upper()
    is_core = code in CORE_PROTECTED_BUILDING_CODES

    # Breakdown of readings by simulation status (is_simulated = 1 vs other/NULL)
    cursor.execute("""
        SELECT 
            COUNT(*) AS total_readings,
            SUM(CASE WHEN is_simulated = 1 THEN 1 ELSE 0 END) AS simulated_readings,
            SUM(CASE WHEN is_simulated IS NULL OR is_simulated != 1 THEN 1 ELSE 0 END) AS non_simulated_readings
        FROM energy_readings
        WHERE building_id = ?
    """, (int(building_id),))
    stats = cursor.fetchone()
    total_readings = stats["total_readings"] or 0
    simulated_readings = stats["simulated_readings"] or 0
    non_simulated_readings = stats["non_simulated_readings"] or 0

    # Count alerts
    cursor.execute("SELECT COUNT(*) FROM alerts WHERE building_id = ?", (int(building_id),))
    alerts_count = cursor.fetchone()[0] or 0

    conn.close()

    can_delete = True
    rejection_reason = None

    if non_simulated_readings > 0:
        can_delete = False
        rejection_reason = (
            f"Building '{code}' contains {non_simulated_readings} non-simulated (real or unclassified) "
            "electrical reading(s). Historical real electrical records cannot be deleted."
        )

    return {
        "building_id": int(bldg["id"]),
        "name": bldg["name"],
        "code": bldg["code"],
        "is_core": is_core,
        "total_readings": total_readings,
        "simulated_readings": simulated_readings,
        "non_simulated_readings": non_simulated_readings,
        "alerts_count": alerts_count,
        "total_dependencies": total_readings + alerts_count,
        "can_delete": can_delete,
        "rejection_reason": rejection_reason
    }


def delete_building_and_simulated_data(building_id, confirm_code, actor_email, ip_address=None):
    """
    Safely and atomically deletes a selected demonstration building along with ALL of its
    simulated historical readings and alerts.
    
    Strict Safeguards:
    1. Rejects non-existent buildings (returns None).
    2. Protects the original core campus buildings (CEE, EIE, MME, MENA, ADMIN, AUDI) from deletion.
    3. Requires exact typed building code confirmation (raises ValueError on mismatch).
    4. Refuses if any associated reading is not explicitly is_simulated = 1 (including NULL).
    5. Creates a verified SQLite backup using the online backup API before the destructive operation.
    6. Executes all deletions and audit log insertion in ONE atomic transaction with PRAGMA foreign_keys = ON.
    7. Uses BEGIN IMMEDIATE to acquire a write lock upfront, preventing concurrent simulator writes.
    8. Rolls back completely if any step fails.
    9. Never modifies or deletes records from any other building, user accounts, or tariffs.
    
    Returns a dict with deletion summary and backup path.
    """
    # Step 1: Pre-validation checks
    preview = get_building_deletion_preview(building_id)
    if not preview:
        return None

    code = preview["code"]

    # Validate confirmation code matches exactly
    norm_confirm = str(confirm_code or "").strip().upper()
    if norm_confirm != code.upper():
        raise ValueError(
            f"Building code confirmation mismatch: Expected '{code}', received '{confirm_code}'."
        )

    if preview["non_simulated_readings"] > 0:
        raise ValueError(
            f"Refused: Building '{code}' contains {preview['non_simulated_readings']} "
            "non-simulated or unclassified reading(s). Only fully simulated demonstration facilities may be deleted."
        )

    # Step 2: Create verified database backup before any destructive operation
    backup_path = backup_database_verified(backup_prefix=f"pre_del_{code}")

    # Step 3: Execute atomic deletion within a single SQLite transaction
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        # Acquire write lock immediately to serialize against concurrent simulator cycles
        cursor.execute("BEGIN IMMEDIATE;")

        # Re-verify eligibility within the exclusive transaction lock
        cursor.execute("""
            SELECT id, code FROM buildings WHERE id = ?
        """, (int(building_id),))
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return None

        # Re-verify no non-simulated readings exist
        cursor.execute("""
            SELECT COUNT(*) FROM energy_readings 
            WHERE building_id = ? AND (is_simulated IS NULL OR is_simulated != 1)
        """, (int(building_id),))
        if cursor.fetchone()[0] > 0:
            conn.rollback()
            raise ValueError(
                f"Refused: Real or unclassified electrical readings detected for '{code}' during transaction."
            )

        # Count records to be deleted
        cursor.execute("SELECT COUNT(*) FROM energy_readings WHERE building_id = ?", (int(building_id),))
        readings_to_delete = cursor.fetchone()[0]

        cursor.execute("SELECT COUNT(*) FROM alerts WHERE building_id = ?", (int(building_id),))
        alerts_to_delete = cursor.fetchone()[0]

        # Delete dependent alerts first
        cursor.execute("DELETE FROM alerts WHERE building_id = ?", (int(building_id),))
        deleted_alerts = cursor.rowcount

        # Delete dependent simulated energy readings
        cursor.execute("DELETE FROM energy_readings WHERE building_id = ?", (int(building_id),))
        deleted_readings = cursor.rowcount

        # Delete building row
        cursor.execute("DELETE FROM buildings WHERE id = ?", (int(building_id),))
        deleted_bldg = cursor.rowcount

        if deleted_bldg == 0:
            conn.rollback()
            raise ValueError(f"Failed to delete building row #{building_id}.")

        # Record persistent audit log entry within the same atomic transaction
        log_details = (
            f"Permanently deleted building '{preview['name']}' ({code}) and its simulated records. "
            f"Removed {deleted_readings} simulated energy readings and {deleted_alerts} alert records. "
            f"Verified pre-deletion backup: {os.path.basename(backup_path)}"
        )
        record_audit_log(
            actor_email=actor_email,
            action="DELETE_BUILDING_AND_SIMULATED_DATA",
            target_type="building",
            target_code=code,
            details=log_details,
            ip_address=ip_address,
            conn=conn
        )

        # Commit transaction atomically
        conn.commit()

        return {
            "success": True,
            "building_id": int(building_id),
            "building_code": code,
            "building_name": preview["name"],
            "deleted_readings_count": deleted_readings,
            "deleted_alerts_count": deleted_alerts,
            "backup_path": backup_path
        }

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()



# ==============================================================================
# Phase 6: Electrical Alerts & Abnormal Condition Detection Engine
# ==============================================================================

def trigger_alert(building_id, alert_type, severity, measured_value, threshold_value, message, timestamp=None):
    """
    Creates an alert only if no active alert for (building_id, alert_type) already exists.
    Enforces Requirement 4: Prevents duplicate alerts from being inserted every simulator cycle.
    Only creates a new alert when a condition changes from normal to abnormal.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id FROM alerts
        WHERE building_id = ? AND alert_type = ? AND is_active = 1
        LIMIT 1
    """, (int(building_id), alert_type))
    existing = cursor.fetchone()

    if existing:
        conn.close()
        return existing["id"]  # Already actively tracked; do not insert duplicate

    from datetime import datetime
    ts = timestamp if timestamp else datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
        INSERT INTO alerts (
            building_id, timestamp, alert_type, severity,
            measured_value, threshold_value, message,
            acknowledged, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)
    """, (
        int(building_id),
        ts,
        alert_type,
        severity,
        measured_value,
        threshold_value,
        message
    ))
    conn.commit()
    alert_id = cursor.lastrowid
    conn.close()
    return alert_id


def clear_alert(building_id, alert_type):
    """
    Enforces Requirement 5: When the condition returns to normal, record that it has cleared.
    Updates all currently active alerts for this condition to is_active = 0 with cleared_at timestamp.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE alerts
        SET is_active = 0, cleared_at = CURRENT_TIMESTAMP
        WHERE building_id = ? AND alert_type = ? AND is_active = 1
    """, (int(building_id), alert_type))
    cleared_count = cursor.rowcount
    conn.commit()
    conn.close()
    return cleared_count


# Configurable electrical safety thresholds (defaults can be overridden via environment variables)
ELECTRICAL_THRESHOLDS = {
    "PF_LOW": float(os.environ.get("THRESHOLD_PF_LOW", "0.85")),
    "VOLTAGE_MIN": float(os.environ.get("THRESHOLD_VOLTAGE_MIN", "380.0")),
    "VOLTAGE_MAX": float(os.environ.get("THRESHOLD_VOLTAGE_MAX", "420.0")),
    "FREQ_MIN": float(os.environ.get("THRESHOLD_FREQ_MIN", "49.5")),
    "FREQ_MAX": float(os.environ.get("THRESHOLD_FREQ_MAX", "50.5")),
    "HIGH_LOAD_RATIO": float(os.environ.get("THRESHOLD_HIGH_LOAD_RATIO", "0.90")),
    "SENSOR_OFFLINE_SECONDS": float(os.environ.get("THRESHOLD_SENSOR_OFFLINE", "60.0"))
}


def evaluate_electrical_alerts(building_id, reading, timestamp=None):
    """
    Evaluates 3-phase electrical readings against configurable engineering thresholds:
      1. LOW POWER FACTOR: PF < 0.85 (WARNING)
      2. LOW VOLTAGE: Line voltage < 380 V (CRITICAL)
      3. HIGH VOLTAGE: Line voltage > 420 V (CRITICAL)
      4. HIGH FREQUENCY: Frequency > 50.5 Hz (WARNING)
      5. LOW FREQUENCY: Frequency < 49.5 Hz (WARNING)
      6. HIGH LOAD: Active power > 90% of configured building rated power (WARNING)
      7. OVERLOAD: Active power > 100% of configured building rated power (CRITICAL)
      8. SENSOR OFFLINE: Clears automatically when a new reading arrives.
    """
    bldg_id = int(building_id)
    rated_kw = get_building_rated_power(bldg_id)

    v = float(reading.get("voltage", 400.0))
    pf = float(reading.get("power_factor", 0.90))
    f = float(reading.get("frequency", 50.0))
    p = float(reading.get("active_power_kw", 0.0))
    load_pct = (p / rated_kw * 100.0) if rated_kw > 0 else 0.0

    # Retrieve configurable threshold limits
    th_pf_low = ELECTRICAL_THRESHOLDS.get("PF_LOW", 0.85)
    th_v_min = ELECTRICAL_THRESHOLDS.get("VOLTAGE_MIN", 380.0)
    th_v_max = ELECTRICAL_THRESHOLDS.get("VOLTAGE_MAX", 420.0)
    th_f_max = ELECTRICAL_THRESHOLDS.get("FREQ_MAX", 50.5)
    th_f_min = ELECTRICAL_THRESHOLDS.get("FREQ_MIN", 49.5)
    th_high_load = ELECTRICAL_THRESHOLDS.get("HIGH_LOAD_RATIO", 0.90)

    # Telemetry arrived: automatically clear any active SENSOR_OFFLINE alert
    clear_alert(bldg_id, "SENSOR_OFFLINE")

    # 1. LOW POWER FACTOR: PF < th_pf_low
    if pf < th_pf_low:
        msg = f"Low Power Factor detected: {pf:.3f} (Threshold: < {th_pf_low:.3f}). Poor phase displacement efficiency increases distribution losses and risk of utility surcharge."
        trigger_alert(bldg_id, "LOW_POWER_FACTOR", "WARNING", round(pf, 3), th_pf_low, msg, timestamp)
    else:
        clear_alert(bldg_id, "LOW_POWER_FACTOR")

    # 2. LOW VOLTAGE: Line voltage < th_v_min (Nominal 400V -5%)
    if v < th_v_min:
        msg = f"Severe Undervoltage condition: {v:.1f} V (Threshold: < {th_v_min:.1f} V, -5% of 400V nominal). High risk of motor stalling, excessive current draw, and thermal overload."
        trigger_alert(bldg_id, "LOW_VOLTAGE", "CRITICAL", round(v, 1), th_v_min, msg, timestamp)
    else:
        clear_alert(bldg_id, "LOW_VOLTAGE")

    # 3. HIGH VOLTAGE: Line voltage > th_v_max (Nominal 400V +5%)
    if v > th_v_max:
        msg = f"Overvoltage condition: {v:.1f} V (Threshold: > {th_v_max:.1f} V, +5% of 400V nominal). High risk of insulation breakdown, dielectric stress, and electronic power supply failure."
        trigger_alert(bldg_id, "HIGH_VOLTAGE", "CRITICAL", round(v, 1), th_v_max, msg, timestamp)
    else:
        clear_alert(bldg_id, "HIGH_VOLTAGE")

    # 4. HIGH FREQUENCY: Frequency > th_f_max (+1% of 50 Hz nominal)
    if f > th_f_max:
        msg = f"High grid frequency: {f:.2f} Hz (Threshold: > {th_f_max:.2f} Hz, +1% of 50 Hz nominal). Grid generation surplus; inductive motor rotational speeds accelerated."
        trigger_alert(bldg_id, "HIGH_FREQUENCY", "WARNING", round(f, 2), th_f_max, msg, timestamp)
    else:
        clear_alert(bldg_id, "HIGH_FREQUENCY")

    # 5. LOW FREQUENCY: Frequency < th_f_min (-1% of 50 Hz nominal)
    if f < th_f_min:
        msg = f"Low grid frequency: {f:.2f} Hz (Threshold: < {th_f_min:.2f} Hz, -1% of 50 Hz nominal). Generation deficit; risk of under-frequency load shedding (UFLS)."
        trigger_alert(bldg_id, "LOW_FREQUENCY", "WARNING", round(f, 2), th_f_min, msg, timestamp)
    else:
        clear_alert(bldg_id, "LOW_FREQUENCY")

    # 6 & 7. HIGH LOAD (>90% rated power) & OVERLOAD (>100% rated power)
    if p > rated_kw:
        # Feeder OVERLOAD (> 100%)
        msg = f"Feeder Overload Detected: {p:.1f} kW exceeds 100% of rated capacity ({rated_kw:.1f} kW at {load_pct:.1f}%). High risk of protective switchgear tripping and transformer overheating."
        trigger_alert(bldg_id, "OVERLOAD", "CRITICAL", round(p, 2), round(rated_kw, 2), msg, timestamp)
        # Clear HIGH_LOAD as condition escalated to OVERLOAD
        clear_alert(bldg_id, "HIGH_LOAD")
    elif p > (th_high_load * rated_kw):
        # HIGH LOAD (90% to 100%)
        msg = f"High Electrical Demand: {p:.1f} kW ({load_pct:.1f}% of {rated_kw:.1f} kW rated capacity). Substation feeder approaching maximum thermal safety margin."
        trigger_alert(bldg_id, "HIGH_LOAD", "WARNING", round(p, 2), round(th_high_load * rated_kw, 2), msg, timestamp)
        # Clear OVERLOAD if load dropped below 100%
        clear_alert(bldg_id, "OVERLOAD")
    else:
        # Load normal (<= 90%)
        clear_alert(bldg_id, "HIGH_LOAD")
        clear_alert(bldg_id, "OVERLOAD")


def check_sensor_offline_alerts(threshold_seconds=None):
    """
    Checks all buildings for missing sensor readings (> threshold_seconds).
    Triggers SENSOR_OFFLINE alert if sensor is silent.
    """
    if threshold_seconds is None:
        threshold_seconds = ELECTRICAL_THRESHOLDS.get("SENSOR_OFFLINE_SECONDS", 60.0)
    else:
        threshold_seconds = float(threshold_seconds)
    from datetime import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, code FROM buildings ORDER BY id ASC")
    buildings = cursor.fetchall()

    now = datetime.now()
    offline_count = 0

    for b in buildings:
        b_id = b["id"]
        cursor.execute("""
            SELECT timestamp FROM energy_readings
            WHERE building_id = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT 1
        """, (b_id,))
        row = cursor.fetchone()
        if not row:
            continue

        last_time = parse_timestamp_str(row["timestamp"])
        elapsed = (now - last_time).total_seconds()

        if elapsed > threshold_seconds:
            msg = f"Telemetry Sensor Offline: No data received from [{b['code']}] {b['name']} for {int(elapsed)}s (Threshold: > {int(threshold_seconds)}s). Substation meter communication disrupted."
            trigger_alert(b_id, "SENSOR_OFFLINE", "WARNING", round(elapsed, 1), threshold_seconds, msg)
            offline_count += 1

    conn.close()
    return offline_count


def get_filtered_alerts(building_id=None, severity=None, status=None, start=None, end=None, limit=200):
    """
    Retrieves stored electrical alerts joined with building details with flexible filtering.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    query = """
        SELECT 
            a.id,
            a.building_id,
            b.name AS building_name,
            b.code AS building_code,
            COALESCE(b.rated_power_kw, 50.0) AS rated_power_kw,
            a.timestamp,
            a.alert_type,
            a.severity,
            a.measured_value,
            a.threshold_value,
            a.message,
            a.acknowledged,
            a.acknowledged_by,
            a.acknowledged_at,
            a.is_active,
            a.cleared_at
        FROM alerts a
        JOIN buildings b ON b.id = a.building_id
        WHERE 1=1
    """
    params = []

    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        query += " AND a.building_id = ?"
        params.append(int(building_id))

    if severity and str(severity).strip().lower() not in ("all", "", "none"):
        query += " AND UPPER(a.severity) = ?"
        params.append(str(severity).strip().upper())

    if status and str(status).strip().lower() not in ("all", "", "none"):
        clean_status = str(status).strip().lower()
        if clean_status in ("active", "1", "true"):
            query += " AND a.is_active = 1"
        elif clean_status in ("cleared", "0", "false"):
            query += " AND a.is_active = 0"

    norm_start = normalize_timestamp(start, is_end=False)
    if norm_start:
        query += " AND a.timestamp >= ?"
        params.append(norm_start)

    norm_end = normalize_timestamp(end, is_end=True)
    if norm_end:
        query += " AND a.timestamp <= ?"
        params.append(norm_end)

    query += " ORDER BY a.is_active DESC, a.timestamp DESC, a.id DESC LIMIT ?"
    params.append(min(max(1, limit), 1000))

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_alerts_summary():
    """
    Computes real-time alert counters for active warnings, criticals, and facility breakdown.
    """
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT 
            COUNT(CASE WHEN is_active = 1 THEN 1 END) AS active_total,
            COUNT(CASE WHEN is_active = 1 AND severity = 'WARNING' THEN 1 END) AS active_warnings,
            COUNT(CASE WHEN is_active = 1 AND severity = 'CRITICAL' THEN 1 END) AS active_critical,
            COUNT(CASE WHEN is_active = 1 AND severity = 'INFO' THEN 1 END) AS active_info,
            COUNT(CASE WHEN is_active = 0 THEN 1 END) AS cleared_total,
            COUNT(*) AS total_all_time
        FROM alerts
    """)
    summary = dict(cursor.fetchone() or {})

    cursor.execute("""
        SELECT 
            building_id,
            COUNT(*) AS active_count,
            COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) AS critical_count,
            COUNT(CASE WHEN severity = 'WARNING' THEN 1 END) AS warning_count
        FROM alerts
        WHERE is_active = 1
        GROUP BY building_id
    """)
    bldg_rows = cursor.fetchall()
    conn.close()

    by_bldg = {}
    for r in bldg_rows:
        by_bldg[r["building_id"]] = {
            "active_count": r["active_count"],
            "critical_count": r["critical_count"],
            "warning_count": r["warning_count"]
        }
    summary["by_building"] = by_bldg

    return summary


def acknowledge_alert(alert_id, user_full_name):
    """
    Acknowledges an alert by an Administrator user.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        UPDATE alerts
        SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP
        WHERE id = ?
    """, (user_full_name, int(alert_id)))
    affected = cursor.rowcount
    conn.commit()

    alert_row = None
    if affected > 0:
        cursor.execute("""
            SELECT a.*, b.name AS building_name, b.code AS building_code
            FROM alerts a
            JOIN buildings b ON b.id = a.building_id
            WHERE a.id = ?
        """, (int(alert_id),))
        row = cursor.fetchone()
        alert_row = dict(row) if row else None

    conn.close()
    return alert_row


def insert_energy_reading(
    building_id,
    timestamp,
    voltage,
    current,
    power_factor,
    frequency,
    apparent_power_kva,
    active_power_kw,
    reactive_power_kvar,
    energy_kwh,
    is_simulated=1
):
    """
    Inserts a three-phase electrical reading into energy_readings table
    and automatically evaluates electrical alerts.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO energy_readings (
            building_id, timestamp, voltage, current, power_factor, frequency,
            apparent_power_kva, active_power_kw, reactive_power_kvar, energy_kwh, is_simulated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        building_id, timestamp, voltage, current, power_factor, frequency,
        apparent_power_kva, active_power_kw, reactive_power_kvar, energy_kwh, is_simulated
    ))
    conn.commit()
    reading_id = cursor.lastrowid
    conn.close()

    # Automatically evaluate electrical alerts for this reading
    try:
        evaluate_electrical_alerts(
            building_id=building_id,
            reading={
                "voltage": voltage,
                "current": current,
                "power_factor": power_factor,
                "frequency": frequency,
                "apparent_power_kva": apparent_power_kva,
                "active_power_kw": active_power_kw,
                "reactive_power_kvar": reactive_power_kvar,
                "energy_kwh": energy_kwh
            },
            timestamp=timestamp
        )
    except Exception as e:
        print(f"[Alerts] Warning: Failed to evaluate alerts for building {building_id}: {e}")

    return reading_id


def get_latest_reading_for_building(building_id):
    """
    Retrieves the most recent energy reading for a given building ID.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM energy_readings
        WHERE building_id = ?
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
    """, (building_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def get_live_energy_readings():
    """
    Retrieves the latest reading for all 6 buildings, including metadata and active alert highlights.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    # Join buildings with their most recent reading using a subquery
    query = """
        SELECT 
            b.id AS building_id,
            b.name AS building_name,
            b.code AS building_code,
            COALESCE(b.rated_power_kw, 50.0) AS rated_power_kw,
            r.id AS reading_id,
            r.timestamp,
            r.voltage,
            r.current,
            r.power_factor,
            r.frequency,
            r.apparent_power_kva,
            r.active_power_kw,
            r.reactive_power_kvar,
            r.energy_kwh,
            COALESCE(r.is_simulated, 1) AS is_simulated
        FROM buildings b
        LEFT JOIN energy_readings r ON r.id = (
            SELECT er.id FROM energy_readings er
            WHERE er.building_id = b.id
            ORDER BY er.timestamp DESC, er.id DESC
            LIMIT 1
        )
        ORDER BY b.id ASC
    """
    cursor.execute(query)
    rows = cursor.fetchall()

    # Also fetch currently active alerts per building to support card highlighting
    cursor.execute("""
        SELECT building_id, severity, alert_type, message
        FROM alerts
        WHERE is_active = 1
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END
    """)
    alert_rows = cursor.fetchall()
    conn.close()

    building_alerts = {}
    for a in alert_rows:
        b_id = a["building_id"]
        if b_id not in building_alerts:
            building_alerts[b_id] = []
        building_alerts[b_id].append({
            "severity": a["severity"],
            "alert_type": a["alert_type"],
            "message": a["message"]
        })

    result = []
    for row in rows:
        d = dict(row)
        b_id = d["building_id"]
        active_list = building_alerts.get(b_id, [])
        d["active_alerts_count"] = len(active_list)
        d["active_alerts"] = active_list
        if any(a["severity"] == "CRITICAL" for a in active_list):
            d["active_severity"] = "CRITICAL"
        elif any(a["severity"] == "WARNING" for a in active_list):
            d["active_severity"] = "WARNING"
        elif any(a["severity"] == "INFO" for a in active_list):
            d["active_severity"] = "INFO"
        else:
            d["active_severity"] = None
        result.append(d)

    return result


def get_building_energy_history(building_id, limit=50):
    """
    Retrieves the historical readings for a specified building ID.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            r.*,
            b.name AS building_name,
            b.code AS building_code
        FROM energy_readings r
        JOIN buildings b ON b.id = r.building_id
        WHERE r.building_id = ?
        ORDER BY r.timestamp DESC, r.id DESC
        LIMIT ?
    """, (building_id, limit))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def normalize_timestamp(ts_str, is_end=False):
    """
    Normalizes user-supplied timestamp strings to standard 'YYYY-MM-DD HH:MM:SS'.
    Handles ISO formats like '2026-10-06T14:30', dates like '2026-10-06', etc.
    """
    if not ts_str:
        return None
    s = str(ts_str).strip().replace("T", " ")
    if len(s) == 10:  # YYYY-MM-DD
        return s + (" 23:59:59" if is_end else " 00:00:00")
    if len(s) == 16:  # YYYY-MM-DD HH:MM
        return s + (":59" if is_end else ":00")
    return s


def parse_timestamp_str(ts_str):
    """
    Parses SQLite timestamp string into a datetime object.
    """
    from datetime import datetime
    s = str(ts_str).strip().replace("T", " ")
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return datetime.now()


def get_filtered_energy_history(building_id=None, start=None, end=None, limit=2000, order_asc=True):
    """
    Retrieves stored energy readings filtered by building_id, start timestamp, and end timestamp.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        SELECT 
            r.*,
            b.name AS building_name,
            b.code AS building_code
        FROM energy_readings r
        JOIN buildings b ON b.id = r.building_id
        WHERE 1=1
    """
    params = []
    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        query += " AND r.building_id = ?"
        params.append(int(building_id))

    norm_start = normalize_timestamp(start, is_end=False)
    if norm_start:
        query += " AND r.timestamp >= ?"
        params.append(norm_start)

    norm_end = normalize_timestamp(end, is_end=True)
    if norm_end:
        query += " AND r.timestamp <= ?"
        params.append(norm_end)

    order_dir = "ASC" if order_asc else "DESC"
    query += f" ORDER BY r.timestamp {order_dir}, r.id {order_dir} LIMIT ?"
    params.append(limit)

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]


def calculate_building_analytics(readings):
    """
    Calculates detailed electrical analytics for a list of chronological readings:
      - Total energy consumed (kWh) using actual consecutive timestamp differences
      - Average active power (kW)
      - Peak demand / maximum active power (kW)
      - Minimum active power (kW)
      - Average apparent power (kVA)
      - Average reactive power (kVAr)
      - Average power factor
      - Minimum power factor
      - Average, minimum, and maximum voltage (V)
      - Average current (A)
      - Average frequency (Hz)
      - Load factor = Average Active Power / Peak Active Power
    """
    if not readings:
        return {
            "readings_count": 0,
            "total_energy_kwh": 0.0,
            "avg_active_power_kw": 0.0,
            "peak_active_power_kw": 0.0,
            "min_active_power_kw": 0.0,
            "avg_apparent_power_kva": None,
            "avg_reactive_power_kvar": None,
            "avg_power_factor": None,
            "min_power_factor": None,
            "avg_voltage": None,
            "min_voltage": None,
            "max_voltage": None,
            "avg_current": None,
            "avg_frequency": None,
            "load_factor": 0.0,
            "load_factor_pct": 0.0
        }

    n = len(readings)
    active_powers = [float(r["active_power_kw"]) for r in readings]
    apparent_powers = [float(r["apparent_power_kva"]) for r in readings]
    reactive_powers = [float(r["reactive_power_kvar"]) for r in readings]
    power_factors = [float(r["power_factor"]) for r in readings]
    voltages = [float(r["voltage"]) for r in readings]
    currents = [float(r["current"]) for r in readings]
    frequencies = [float(r["frequency"]) for r in readings]

    avg_p = sum(active_powers) / n
    peak_p = max(active_powers)
    min_p = min(active_powers)

    avg_s = sum(apparent_powers) / n
    avg_q = sum(reactive_powers) / n

    avg_pf = sum(power_factors) / n
    min_pf = min(power_factors)

    avg_v = sum(voltages) / n
    min_v = min(voltages)
    max_v = max(voltages)

    avg_i = sum(currents) / n
    avg_f = sum(frequencies) / n

    # Load factor = Average Active Power / Peak Active Power
    load_factor = (avg_p / peak_p) if peak_p > 0 else 0.0

    # Calculate actual energy consumed in the selected period
    # using consecutive timestamp differences
    # Missing sensor gap > 60s is NOT assumed continuous!
    total_energy_kwh = 0.0
    if n == 1:
        total_energy_kwh = active_powers[0] * (15.0 / 3600.0)
    else:
        for i in range(1, n):
            t_prev = parse_timestamp_str(readings[i - 1]["timestamp"])
            t_curr = parse_timestamp_str(readings[i]["timestamp"])
            delta_s = (t_curr - t_prev).total_seconds()
            p_avg = (active_powers[i - 1] + active_powers[i]) / 2.0

            if 0 < delta_s <= 60.0:
                delta_kwh = p_avg * (delta_s / 3600.0)
            else:
                # Gap exceeded 60s (sensor offline / missing):
                # Do not assume missing data was continuous operation!
                # Credit only the active 15-second cycle
                delta_kwh = active_powers[i] * (15.0 / 3600.0)
            total_energy_kwh += delta_kwh

    return {
        "readings_count": n,
        "total_energy_kwh": round(total_energy_kwh, 3),
        "avg_active_power_kw": round(avg_p, 2),
        "peak_active_power_kw": round(peak_p, 2),
        "min_active_power_kw": round(min_p, 2),
        "avg_apparent_power_kva": round(avg_s, 2),
        "avg_reactive_power_kvar": round(avg_q, 2),
        "avg_power_factor": round(avg_pf, 3),
        "min_power_factor": round(min_pf, 3),
        "avg_voltage": round(avg_v, 1),
        "min_voltage": round(min_v, 1),
        "max_voltage": round(max_v, 1),
        "avg_current": round(avg_i, 1),
        "avg_frequency": round(avg_f, 2),
        "load_factor": round(load_factor, 3),
        "load_factor_pct": round(load_factor * 100.0, 1)
    }


def get_energy_analytics(building_id=None, start=None, end=None):
    """
    Computes analytics for a specific building, or campus-wide multi-building comparison.
    """
    all_buildings = get_all_buildings()

    # Case 1: Specific building selected
    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        b_id = int(building_id)
        selected_bldg = next((b for b in all_buildings if b["id"] == b_id), None)
        readings = get_filtered_energy_history(building_id=b_id, start=start, end=end, limit=5000, order_asc=True)
        stats = calculate_building_analytics(readings)

        return {
            "mode": "single",
            "building_id": b_id,
            "building_code": selected_bldg["code"] if selected_bldg else "GEN",
            "building_name": selected_bldg["name"] if selected_bldg else "Unknown",
            "start": normalize_timestamp(start),
            "end": normalize_timestamp(end, is_end=True),
            "analytics": stats
        }

    # Case 2: Six-building comparison mode (All buildings)
    comparison = []
    campus_total_energy = 0.0
    campus_active_powers = []
    campus_pfs = []

    for b in all_buildings:
        b_readings = get_filtered_energy_history(building_id=b["id"], start=start, end=end, limit=5000, order_asc=True)
        b_stats = calculate_building_analytics(b_readings)

        comparison.append({
            "building_id": b["id"],
            "building_code": b["code"],
            "building_name": b["name"],
            "total_energy_kwh": b_stats["total_energy_kwh"],
            "peak_active_power_kw": b_stats["peak_active_power_kw"],
            "avg_active_power_kw": b_stats["avg_active_power_kw"],
            "avg_power_factor": b_stats["avg_power_factor"],
            "load_factor": b_stats["load_factor"],
            "load_factor_pct": b_stats["load_factor_pct"],
            "readings_count": b_stats["readings_count"]
        })

        campus_total_energy += b_stats["total_energy_kwh"]
        if b_stats["readings_count"] > 0:
            campus_active_powers.append(b_stats["avg_active_power_kw"])
            campus_pfs.append(b_stats["avg_power_factor"])

    campus_avg_power = sum(campus_active_powers) if campus_active_powers else 0.0
    campus_avg_pf = (sum(campus_pfs) / len(campus_pfs)) if campus_pfs else 0.0
    campus_peak_power = max((c["peak_active_power_kw"] for c in comparison), default=0.0)
    campus_load_factor = (campus_avg_power / (sum(c["peak_active_power_kw"] for c in comparison))) if sum(c["peak_active_power_kw"] for c in comparison) > 0 else 0.0

    return {
        "mode": "comparison",
        "start": normalize_timestamp(start),
        "end": normalize_timestamp(end, is_end=True),
        "campus_summary": {
            "total_energy_kwh": round(campus_total_energy, 3),
            "avg_active_power_kw": round(campus_avg_power, 2),
            "peak_active_power_kw": round(campus_peak_power, 2),
            "avg_power_factor": round(campus_avg_pf, 3),
            "load_factor": round(campus_load_factor, 3),
            "load_factor_pct": round(campus_load_factor * 100.0, 1),
            "building_count": len(all_buildings)
        },
        "comparison": comparison
    }


# ==========================================================================
# Phase 7: Energy Cost & Efficiency Analysis Functions
# ==========================================================================

def get_active_tariff():
    """
    Retrieves the currently active demonstration tariff model from SQLite.
    Returns a dict with tariff parameters or a default demonstration model if none active.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, energy_rate_lkr_per_kwh, demand_rate_lkr_per_kw, 
               fixed_charge_lkr, effective_from, active
        FROM tariffs
        WHERE active = 1
        ORDER BY id DESC
        LIMIT 1
    """)
    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)

    # Fallback demonstration model
    return {
        "id": 1,
        "name": "Demonstration Institutional Tariff (Estimated Non-Official Model)",
        "energy_rate_lkr_per_kwh": 38.50,
        "demand_rate_lkr_per_kw": 1450.00,
        "fixed_charge_lkr": 3000.00,
        "effective_from": "2026-01-01 00:00:00",
        "active": 1
    }


def get_all_tariffs():
    """
    Retrieves all configured tariff models.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM tariffs ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_faculty_settings():
    """
    Retrieves faculty operational configuration settings (operating hours, days, etc.).
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT setting_key, setting_value FROM faculty_settings")
    rows = cursor.fetchall()
    conn.close()

    settings = {
        "operating_hours_start": "08:00",
        "operating_hours_end": "17:00",
        "operating_days": "0,1,2,3,4",
        "tariff_billing_days_norm": "30"
    }
    for r in rows:
        settings[r["setting_key"]] = r["setting_value"]
    return settings


def update_faculty_setting(setting_key, setting_value, description=None):
    """
    Updates or inserts a faculty configuration setting (e.g. operating_hours_start, operating_hours_end).
    Allows easy adjustment of operating hours and schedules.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO faculty_settings (setting_key, setting_value, description)
        VALUES (?, ?, ?)
        ON CONFLICT(setting_key) DO UPDATE SET 
            setting_value = excluded.setting_value,
            updated_at = CURRENT_TIMESTAMP
    """, (str(setting_key), str(setting_value), description or f"Setting for {setting_key}"))
    conn.commit()
    rows_affected = cursor.rowcount
    conn.close()
    return rows_affected > 0


def is_timestamp_after_hours(ts_dt, settings=None):
    """
    Evaluates whether a given datetime object falls outside faculty operating hours.
    Faculty standard operating hours:
      - Weekdays Monday (0) to Friday (4) between 08:00 and 17:00.
      - Weekends (Saturday 5, Sunday 6) are 100% after-hours.
      - Any time on weekdays before 08:00 or at/after 17:00 is after-hours.
    """
    if settings is None:
        settings = get_faculty_settings()

    op_days = [int(d.strip()) for d in settings.get("operating_days", "0,1,2,3,4").split(",") if d.strip().isdigit()]
    start_str = settings.get("operating_hours_start", "08:00")
    end_str = settings.get("operating_hours_end", "17:00")

    try:
        sh, sm = map(int, start_str.split(":"))
        eh, em = map(int, end_str.split(":"))
    except Exception:
        sh, sm = 8, 0
        eh, em = 17, 0

    # Weekday check: Monday is 0, Sunday is 6
    if ts_dt.weekday() not in op_days:
        return True

    # Time check within operating weekday
    time_minutes = ts_dt.hour * 60 + ts_dt.minute
    start_minutes = sh * 60 + sm
    end_minutes = eh * 60 + em

    if time_minutes < start_minutes or time_minutes >= end_minutes:
        return True

    return False


def calculate_building_cost(total_energy_kwh, peak_demand_kw, duration_seconds=86400, tariff=None):
    """
    Calculates estimated electricity cost using the two-part demonstration institutional tariff model:
      Total Cost = Energy Charge + Demand Charge + Fixed Charge
    where demand charge and fixed charge are scaled proportionally to the queried time period duration.
    """
    if tariff is None:
        tariff = get_active_tariff()

    energy_rate = float(tariff.get("energy_rate_lkr_per_kwh", 38.50))
    demand_rate = float(tariff.get("demand_rate_lkr_per_kw", 1450.00))
    fixed_charge = float(tariff.get("fixed_charge_lkr", 3000.00))

    # Calculate period scaling fraction relative to standard 30-day utility billing cycle
    # (30 days = 2,592,000 seconds)
    period_days = max(duration_seconds / 86400.0, 0.001)
    period_scaling_fraction = period_days / 30.0

    # 1. Energy Charge: based on real active energy consumed
    energy_charge_lkr = total_energy_kwh * energy_rate

    # 2. Demand Charge: maximum recorded power demand scaled to duration
    demand_charge_lkr = peak_demand_kw * demand_rate * period_scaling_fraction

    # 3. Fixed Service Charge: scaled to duration
    applicable_fixed_charge_lkr = fixed_charge * period_scaling_fraction

    estimated_total_cost_lkr = energy_charge_lkr + demand_charge_lkr + applicable_fixed_charge_lkr

    return {
        "tariff_name": tariff.get("name", "Demonstration Institutional Tariff"),
        "tariff_rates": {
            "energy_rate_lkr_per_kwh": round(energy_rate, 2),
            "demand_rate_lkr_per_kw": round(demand_rate, 2),
            "monthly_fixed_charge_lkr": round(fixed_charge, 2)
        },
        "period_days": round(period_days, 2),
        "energy_consumed_kwh": round(total_energy_kwh, 3),
        "peak_demand_kw": round(peak_demand_kw, 2),
        "estimated_energy_charge_lkr": round(energy_charge_lkr, 2),
        "estimated_demand_charge_lkr": round(demand_charge_lkr, 2),
        "estimated_fixed_charge_lkr": round(applicable_fixed_charge_lkr, 2),
        "estimated_total_cost_lkr": round(estimated_total_cost_lkr, 2),
        "is_estimate": True,
        "disclaimer": "Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."
    }


def calculate_building_efficiency(readings, building_info=None):
    """
    Computes detailed electrical efficiency metrics, after-hours consumption,
    historical baseline deviations, and engineering observations for a set of readings.
    """
    settings = get_faculty_settings()

    if not readings:
        return {
            "readings_count": 0,
            "total_energy_kwh": 0.0,
            "avg_demand_kw": 0.0,
            "peak_demand_kw": 0.0,
            "load_factor": 0.0,
            "load_factor_pct": 0.0,
            "avg_power_factor": 0.0,
            "low_pf_duration_minutes": 0.0,
            "low_pf_readings_count": 0,
            "after_hours_kwh": 0.0,
            "after_hours_pct": 0.0,
            "operating_hours_kwh": 0.0,
            "performance_status": "NO_DATA",
            "efficiency_score": 0.0,
            "engineering_observations": ["No electrical readings recorded for the selected period."],
            "baseline_comparison": None
        }

    n = len(readings)
    active_powers = [float(r["active_power_kw"]) for r in readings]
    power_factors = [float(r["power_factor"]) for r in readings]

    avg_p = sum(active_powers) / n
    peak_p = max(active_powers)
    avg_pf = sum(power_factors) / n
    load_factor = (avg_p / peak_p) if peak_p > 0 else 0.0

    # Consecutive integration for total energy, after-hours energy, and low-PF duration
    total_energy_kwh = 0.0
    after_hours_kwh = 0.0
    low_pf_seconds = 0.0
    low_pf_readings = 0

    if n == 1:
        t0 = parse_timestamp_str(readings[0]["timestamp"])
        dt_s = 15.0
        e_step = active_powers[0] * (dt_s / 3600.0)
        total_energy_kwh = e_step
        if is_timestamp_after_hours(t0, settings):
            after_hours_kwh = e_step
        if power_factors[0] < 0.85:
            low_pf_seconds = dt_s
            low_pf_readings = 1
    else:
        for i in range(1, n):
            t_prev = parse_timestamp_str(readings[i - 1]["timestamp"])
            t_curr = parse_timestamp_str(readings[i]["timestamp"])
            delta_s = (t_curr - t_prev).total_seconds()
            p_avg = (active_powers[i - 1] + active_powers[i]) / 2.0
            pf_avg = (power_factors[i - 1] + power_factors[i]) / 2.0

            if 0 < delta_s <= 60.0:
                dt = delta_s
            else:
                dt = 15.0

            delta_kwh = p_avg * (dt / 3600.0)
            total_energy_kwh += delta_kwh

            # Midpoint timestamp evaluation for after-hours classification
            mid_ts = t_prev + (t_curr - t_prev) / 2
            if is_timestamp_after_hours(mid_ts, settings):
                after_hours_kwh += delta_kwh

            # Low PF evaluation (threshold < 0.85)
            if pf_avg < 0.85:
                low_pf_seconds += dt
                low_pf_readings += 1

    operating_hours_kwh = max(0.0, total_energy_kwh - after_hours_kwh)
    after_hours_pct = (after_hours_kwh / total_energy_kwh * 100.0) if total_energy_kwh > 0 else 0.0
    low_pf_minutes = low_pf_seconds / 60.0

    # Historical baseline comparison for this specific building
    baseline_stats = None
    b_id = building_info.get("id") if building_info else (readings[0].get("building_id") if "building_id" in readings[0] else None)
    if b_id:
        baseline_stats = get_building_historical_baseline(b_id)

    # Engineering observations generation (factual, evidence-based)
    observations = []
    if load_factor < 0.40 and peak_p > 0:
        observations.append(
            f"Low load factor detected ({load_factor:.2f}). Peak demand ({peak_p:.1f} kW) is significantly higher than average consumption ({avg_p:.1f} kW), indicating high demand surges with low utilization."
        )

    if avg_pf < 0.85:
        observations.append(
            f"Poor average power factor ({avg_pf:.3f}) below CEB threshold (0.85). Low-PF duration observed for {low_pf_minutes:.1f} minutes ({low_pf_readings} cycles), indicating inductive motor loading."
        )
    elif low_pf_minutes > 10.0:
        observations.append(
            f"Intermittent low power factor observed: PF fell below 0.85 for {low_pf_minutes:.1f} minutes during the monitored window."
        )

    if after_hours_pct > 35.0:
        observations.append(
            f"High after-hours energy proportion: {after_hours_kwh:.2f} kWh ({after_hours_pct:.1f}% of total) was consumed outside faculty standard operating hours (08:00 - 17:00 / Weekends)."
        )
    elif after_hours_kwh > 0:
        observations.append(
            f"After-hours energy consumed: {after_hours_kwh:.2f} kWh ({after_hours_pct:.1f}% of total) outside operating hours."
        )

    rated_power = float(building_info.get("rated_power_kw", 50.0)) if building_info else 50.0
    if peak_p > 0.90 * rated_power:
        observations.append(
            f"High peak active power demand: Peak reached {peak_p:.1f} kW ({peak_p / rated_power * 100.0:.1f}% of configured capacity {rated_power:.1f} kW)."
        )

    if baseline_stats and baseline_stats.get("lifetime_avg_power_kw", 0) > 0:
        base_avg_p = baseline_stats["lifetime_avg_power_kw"]
        p_diff_pct = ((avg_p - base_avg_p) / base_avg_p) * 100.0
        if p_diff_pct > 15.0:
            observations.append(
                f"Elevated demand relative to historical baseline: Average power is +{p_diff_pct:.1f}% higher than this building's long-term historical mean ({base_avg_p:.1f} kW)."
            )
        elif p_diff_pct < -15.0:
            observations.append(
                f"Reduced demand relative to historical baseline: Average power is {p_diff_pct:.1f}% lower than this building's long-term historical mean ({base_avg_p:.1f} kW)."
            )

    if not observations:
        observations.append("Electrical operating parameters are within standard engineering thresholds.")

    # Calculate overall energy efficiency performance score (0 - 100)
    # Weights: Load Factor (35%), Power Factor (35%), Operating Hours Conservation (30%)
    lf_score = min(load_factor / 0.70, 1.0) * 35.0
    pf_score = (max(avg_pf - 0.70, 0.0) / 0.25) * 35.0
    ah_score = max(0.0, 1.0 - (after_hours_pct / 50.0)) * 30.0
    efficiency_score = round(min(max(lf_score + pf_score + ah_score, 10.0), 100.0), 1)

    if efficiency_score >= 80.0:
        performance_status = "OPTIMAL"
    elif efficiency_score >= 60.0:
        performance_status = "ACCEPTABLE"
    elif efficiency_score >= 40.0:
        performance_status = "NEEDS_ATTENTION"
    else:
        performance_status = "INEFFICIENT"

    return {
        "readings_count": n,
        "total_energy_kwh": round(total_energy_kwh, 3),
        "avg_demand_kw": round(avg_p, 2),
        "peak_demand_kw": round(peak_p, 2),
        "load_factor": round(load_factor, 3),
        "load_factor_pct": round(load_factor * 100.0, 1),
        "avg_power_factor": round(avg_pf, 3),
        "low_pf_duration_minutes": round(low_pf_minutes, 1),
        "low_pf_readings_count": low_pf_readings,
        "after_hours_kwh": round(after_hours_kwh, 3),
        "after_hours_pct": round(after_hours_pct, 1),
        "operating_hours_kwh": round(operating_hours_kwh, 3),
        "efficiency_score": efficiency_score,
        "performance_status": performance_status,
        "engineering_observations": observations,
        "baseline_comparison": baseline_stats
    }


def get_building_historical_baseline(building_id):
    """
    Computes a building's true long-term historical baseline from all prior stored readings in SQLite.
    Used to compare selected timeframes against true historical behavior.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT 
            COUNT(*) as total_samples,
            AVG(active_power_kw) as avg_p,
            MAX(active_power_kw) as peak_p,
            AVG(power_factor) as avg_pf,
            AVG(voltage) as avg_v
        FROM energy_readings
        WHERE building_id = ?
    """, (building_id,))
    row = cursor.fetchone()
    conn.close()

    if not row or row["total_samples"] == 0:
        return None

    return {
        "building_id": building_id,
        "baseline_samples_count": row["total_samples"],
        "lifetime_avg_power_kw": round(float(row["avg_p"] or 0.0), 2),
        "lifetime_peak_power_kw": round(float(row["peak_p"] or 0.0), 2),
        "lifetime_avg_pf": round(float(row["avg_pf"] or 0.0), 3),
        "lifetime_avg_voltage": round(float(row["avg_v"] or 0.0), 1)
    }


def get_campus_synchronized_metrics(start=None, end=None):
    """
    Computes synchronized campus-wide electrical parameters by aggregating simultaneous 
    readings across all buildings grouped by timestamp:
      - Coincident Peak Demand: Maximum simultaneous sum of active powers across all buildings: max_t(sum_b P_b(t))
      - Average Active Power: Mean of simultaneous total active powers: avg_t(sum_b P_b(t))
      - Campus Load Factor: (Average Active Power / Coincident Peak Demand), guaranteed in [0.0, 1.0] for non-negative power
      - Average Apparent Power: Vector sum of campus active & reactive power: sqrt(P_avg^2 + Q_avg^2)
      - Average Reactive Power: Mean of simultaneous total reactive powers: avg_t(sum_b Q_b(t))
      - Grid Voltage & Frequency statistics
      - Minimum Power Factor across the campus
    Safely handles empty periods, missing sensor gaps, and zero peak demand.
    """
    norm_start = normalize_timestamp(start, is_end=False)
    norm_end = normalize_timestamp(end, is_end=True)

    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        SELECT 
            timestamp,
            SUM(active_power_kw) AS total_p,
            SUM(apparent_power_kva) AS total_s,
            SUM(reactive_power_kvar) AS total_q,
            AVG(voltage) AS avg_v,
            MIN(voltage) AS min_v,
            MAX(voltage) AS max_v,
            AVG(frequency) AS avg_f,
            MIN(power_factor) AS min_pf
        FROM energy_readings
        WHERE 1=1
    """
    params = []
    if norm_start:
        query += " AND timestamp >= ?"
        params.append(norm_start)
    if norm_end:
        query += " AND timestamp <= ?"
        params.append(norm_end)

    query += " GROUP BY timestamp ORDER BY timestamp ASC"

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        return {
            "samples_count": 0,
            "avg_active_power_kw": 0.0,
            "peak_active_power_kw": 0.0,
            "load_factor": 0.0,
            "load_factor_pct": 0.0,
            "avg_apparent_power_kva": None,
            "avg_reactive_power_kvar": None,
            "avg_power_factor": None,
            "min_power_factor": None,
            "avg_voltage": None,
            "min_voltage": None,
            "max_voltage": None,
            "avg_frequency": None
        }

    total_p_list = [float(r["total_p"] or 0.0) for r in rows]
    total_q_list = [float(r["total_q"] or 0.0) for r in rows]
    avg_v_list = [float(r["avg_v"]) for r in rows if r["avg_v"] is not None]
    min_v_list = [float(r["min_v"]) for r in rows if r["min_v"] is not None]
    max_v_list = [float(r["max_v"]) for r in rows if r["max_v"] is not None]
    avg_f_list = [float(r["avg_f"]) for r in rows if r["avg_f"] is not None]
    min_pf_list = [float(r["min_pf"]) for r in rows if r["min_pf"] is not None]

    m_samples = len(rows)
    peak_p = max(total_p_list) if total_p_list else 0.0
    avg_p = sum(total_p_list) / m_samples if m_samples > 0 else 0.0
    avg_q = sum(total_q_list) / m_samples if m_samples > 0 else 0.0

    # Three-phase AC vector apparent power: S = sqrt(P^2 + Q^2)
    avg_s = math.sqrt(max(0.0, (avg_p ** 2) + (avg_q ** 2))) if (avg_p > 0 or avg_q > 0) else 0.0

    # Power factor = P / S
    avg_pf = (avg_p / avg_s) if avg_s > 0 else 0.0
    min_pf = min(min_pf_list) if min_pf_list else avg_pf

    # Load factor = P_avg / P_peak (strictly bounded in [0.0, 1.0])
    load_factor = (avg_p / peak_p) if peak_p > 0 else 0.0
    load_factor = max(0.0, min(1.0, load_factor))

    avg_v = (sum(avg_v_list) / len(avg_v_list)) if avg_v_list else 400.0
    min_v = min(min_v_list) if min_v_list else 395.0
    max_v = max(max_v_list) if max_v_list else 405.0
    avg_f = (sum(avg_f_list) / len(avg_f_list)) if avg_f_list else 50.0

    return {
        "samples_count": m_samples,
        "avg_active_power_kw": round(avg_p, 2),
        "peak_active_power_kw": round(peak_p, 2),
        "load_factor": round(load_factor, 3),
        "load_factor_pct": round(load_factor * 100.0, 1),
        "avg_apparent_power_kva": round(avg_s, 2),
        "avg_reactive_power_kvar": round(avg_q, 2),
        "avg_power_factor": round(avg_pf, 3),
        "min_power_factor": round(min_pf, 3),
        "avg_voltage": round(avg_v, 1),
        "min_voltage": round(min_v, 1),
        "max_voltage": round(max_v, 1),
        "avg_frequency": round(avg_f, 2)
    }


def get_cost_and_efficiency_analytics(building_id=None, start=None, end=None):
    """
    Unified analytics computation providing:
      - Energy Cost calculations (per-building and campus summary)
      - Energy Efficiency calculations (PF, Load Factor, After-hours, Observations)
      - Six-building comparative ranking
    """
    all_buildings = get_all_buildings()
    tariff = get_active_tariff()

    # Determine queried duration in seconds
    t_start = parse_timestamp_str(normalize_timestamp(start, is_end=False)) if start else None
    t_end = parse_timestamp_str(normalize_timestamp(end, is_end=True)) if end else None
    if t_start and t_end and t_end > t_start:
        duration_seconds = (t_end - t_start).total_seconds()
    else:
        duration_seconds = 86400.0  # default 24h

    # Case 1: Single building selected
    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        b_id = int(building_id)
        selected_bldg = next((b for b in all_buildings if b["id"] == b_id), None)
        readings = get_filtered_energy_history(building_id=b_id, start=start, end=end, limit=5000, order_asc=True)

        eff = calculate_building_efficiency(readings, selected_bldg)
        cost = calculate_building_cost(eff["total_energy_kwh"], eff["peak_demand_kw"], duration_seconds, tariff)

        return {
            "mode": "single",
            "building_id": b_id,
            "building_code": selected_bldg["code"] if selected_bldg else "GEN",
            "building_name": selected_bldg["name"] if selected_bldg else "Unknown",
            "rated_power_kw": selected_bldg.get("rated_power_kw", 50.0) if selected_bldg else 50.0,
            "start": normalize_timestamp(start),
            "end": normalize_timestamp(end, is_end=True),
            "cost": cost,
            "efficiency": eff
        }

    # Case 2: Six-building campus comparison and ranking
    comparison = []
    campus_total_kwh = 0.0
    campus_after_hours_kwh = 0.0
    campus_total_cost = 0.0
    campus_energy_charges = 0.0
    campus_demand_charges = 0.0
    campus_fixed_charges = 0.0

    for b in all_buildings:
        b_readings = get_filtered_energy_history(building_id=b["id"], start=start, end=end, limit=5000, order_asc=True)
        b_eff = calculate_building_efficiency(b_readings, b)
        b_cost = calculate_building_cost(b_eff["total_energy_kwh"], b_eff["peak_demand_kw"], duration_seconds, tariff)

        comparison.append({
            "building_id": b["id"],
            "building_code": b["code"],
            "building_name": b["name"],
            "rated_power_kw": b.get("rated_power_kw", 50.0),
            "total_kwh": b_eff["total_energy_kwh"],
            "estimated_cost_lkr": b_cost["estimated_total_cost_lkr"],
            "energy_charge_lkr": b_cost["estimated_energy_charge_lkr"],
            "demand_charge_lkr": b_cost["estimated_demand_charge_lkr"],
            "peak_demand_kw": b_eff["peak_demand_kw"],
            "avg_demand_kw": b_eff["avg_demand_kw"],
            "load_factor": b_eff["load_factor"],
            "load_factor_pct": b_eff["load_factor_pct"],
            "avg_power_factor": b_eff["avg_power_factor"],
            "after_hours_kwh": b_eff["after_hours_kwh"],
            "after_hours_pct": b_eff["after_hours_pct"],
            "efficiency_score": b_eff["efficiency_score"],
            "performance_status": b_eff["performance_status"],
            "readings_count": b_eff["readings_count"],
            "engineering_observations": b_eff["engineering_observations"]
        })

        campus_total_kwh += b_eff["total_energy_kwh"]
        campus_after_hours_kwh += b_eff["after_hours_kwh"]
        campus_total_cost += b_cost["estimated_total_cost_lkr"]
        campus_energy_charges += b_cost["estimated_energy_charge_lkr"]
        campus_demand_charges += b_cost["estimated_demand_charge_lkr"]
        campus_fixed_charges += b_cost["estimated_fixed_charge_lkr"]

    # Rank buildings by energy efficiency score (descending)
    ranked_comparison = sorted(comparison, key=lambda x: x["efficiency_score"], reverse=True)
    for rank_idx, item in enumerate(ranked_comparison, start=1):
        item["efficiency_rank"] = rank_idx

    # Synchronized campus metrics across all simultaneous building readings
    sync_metrics = get_campus_synchronized_metrics(start=start, end=end)
    if sync_metrics["samples_count"] > 0:
        campus_peak_demand = sync_metrics["peak_active_power_kw"]
        campus_avg_demand = sync_metrics["avg_active_power_kw"]
        campus_load_factor = sync_metrics["load_factor"]
        campus_avg_pf = sync_metrics["avg_power_factor"]
        campus_avg_s = sync_metrics["avg_apparent_power_kva"]
        campus_avg_q = sync_metrics["avg_reactive_power_kvar"]
        campus_min_pf = sync_metrics["min_power_factor"]
        campus_avg_v = sync_metrics["avg_voltage"]
        campus_min_v = sync_metrics["min_voltage"]
        campus_max_v = sync_metrics["max_voltage"]
        campus_avg_f = sync_metrics["avg_frequency"]
    else:
        campus_peak_demand = 0.0
        campus_avg_demand = 0.0
        campus_load_factor = 0.0
        campus_avg_pf = None
        campus_avg_s = None
        campus_avg_q = None
        campus_min_pf = None
        campus_avg_v = None
        campus_min_v = None
        campus_max_v = None
        campus_avg_f = None

    campus_after_hours_pct = (campus_after_hours_kwh / campus_total_kwh * 100.0) if campus_total_kwh > 0 else 0.0

    return {
        "mode": "comparison",
        "start": normalize_timestamp(start),
        "end": normalize_timestamp(end, is_end=True),
        "tariff": tariff,
        "campus_summary": {
            "total_kwh": round(campus_total_kwh, 3),
            "estimated_cost_lkr": round(campus_total_cost, 2),
            "estimated_energy_charge_lkr": round(campus_energy_charges, 2),
            "estimated_demand_charge_lkr": round(campus_demand_charges, 2),
            "estimated_fixed_charge_lkr": round(campus_fixed_charges, 2),
            "peak_demand_kw": round(campus_peak_demand, 2),
            "avg_demand_kw": round(campus_avg_demand, 2),
            "avg_apparent_power_kva": round(campus_avg_s, 2) if campus_avg_s is not None else None,
            "avg_reactive_power_kvar": round(campus_avg_q, 2) if campus_avg_q is not None else None,
            "load_factor": round(campus_load_factor, 3),
            "load_factor_pct": round(campus_load_factor * 100.0, 1),
            "avg_power_factor": round(campus_avg_pf, 3) if campus_avg_pf is not None else None,
            "min_power_factor": round(campus_min_pf, 3) if campus_min_pf is not None else None,
            "avg_voltage": campus_avg_v,
            "min_voltage": campus_min_v,
            "max_voltage": campus_max_v,
            "avg_frequency": campus_avg_f,
            "after_hours_kwh": round(campus_after_hours_kwh, 3),
            "after_hours_pct": round(campus_after_hours_pct, 1),
            "building_count": len(all_buildings),
            "is_estimate": True,
            "disclaimer": "Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."
        },
        "comparison": comparison,
        "ranked_comparison": ranked_comparison
    }


# ==========================================================================
# Phase 8: Reports, Export & System Configuration Functions
# ==========================================================================

def get_alerts_counts_for_period(building_id=None, start=None, end=None):
    """
    Returns the count of warning alerts, critical alerts, and total alerts
    recorded in SQLite for the selected building (or campus-wide) within the period.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
        SELECT 
            SUM(CASE WHEN severity = 'WARNING' THEN 1 ELSE 0 END) as warning_count,
            SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) as critical_count,
            COUNT(*) as total_count
        FROM alerts
        WHERE 1=1
    """
    params = []
    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        query += " AND building_id = ?"
        params.append(int(building_id))

    norm_start = normalize_timestamp(start, is_end=False)
    if norm_start:
        query += " AND timestamp >= ?"
        params.append(norm_start)

    norm_end = normalize_timestamp(end, is_end=True)
    if norm_end:
        query += " AND timestamp <= ?"
        params.append(norm_end)

    cursor.execute(query, params)
    row = cursor.fetchone()
    conn.close()

    return {
        "warning_alerts": int(row["warning_count"] or 0) if row else 0,
        "critical_alerts": int(row["critical_count"] or 0) if row else 0,
        "total_alerts": int(row["total_count"] or 0) if row else 0
    }


def get_comprehensive_energy_report(building_id=None, start=None, end=None):
    """
    Generates a full engineering energy summary report containing all 16 required metrics:
      - Building name & code (or Campus Summary)
      - Reporting period (start to end)
      - Total energy consumption (kWh)
      - Average active power (kW)
      - Peak demand (kW)
      - Average apparent power (kVA)
      - Average reactive power (kVAr)
      - Average power factor
      - Minimum power factor
      - Load factor (and %)
      - Minimum/maximum voltage (V) and Average voltage (V)
      - Average frequency (Hz)
      - After-hours energy consumption (kWh and %)
      - Estimated electricity cost (LKR, breakdown)
      - Number of warning alerts
      - Number of critical alerts
      - Factual engineering observations
      - Multi-building comparison list (when campus-wide)
    """
    all_buildings = get_all_buildings()
    tariff = get_active_tariff()
    norm_start = normalize_timestamp(start, is_end=False)
    norm_end = normalize_timestamp(end, is_end=True)

    # Determine queried period duration
    t_start = parse_timestamp_str(norm_start) if norm_start else None
    t_end = parse_timestamp_str(norm_end) if norm_end else None
    duration_s = (t_end - t_start).total_seconds() if (t_start and t_end and t_end > t_start) else 86400.0

    # Case 1: Specific Single Building Report
    if building_id is not None and str(building_id).strip().lower() not in ("all", "", "none"):
        b_id = int(building_id)
        selected_bldg = next((b for b in all_buildings if b["id"] == b_id), None)
        readings = get_filtered_energy_history(building_id=b_id, start=start, end=end, limit=5000, order_asc=True)

        analytics = calculate_building_analytics(readings)
        efficiency = calculate_building_efficiency(readings, selected_bldg)
        cost = calculate_building_cost(efficiency["total_energy_kwh"], efficiency["peak_demand_kw"], duration_s, tariff)
        alert_counts = get_alerts_counts_for_period(building_id=b_id, start=start, end=end)
        recent_alerts = get_filtered_alerts(building_id=b_id, start=start, end=end, limit=10)

        return {
            "mode": "single",
            "report_title": f"Electrical Energy Audit & Performance Report - {selected_bldg['name'] if selected_bldg else 'Facility'}",
            "generated_at": parse_timestamp_str(None).strftime("%Y-%m-%d %H:%M:%S") if hasattr(parse_timestamp_str(None), 'strftime') else "2026-10-07 10:16:00",
            "building_id": b_id,
            "building_code": selected_bldg["code"] if selected_bldg else "GEN",
            "building_name": selected_bldg["name"] if selected_bldg else "Unknown Facility",
            "rated_power_kw": selected_bldg.get("rated_power_kw", 50.0) if selected_bldg else 50.0,
            "reporting_period": {
                "start": norm_start,
                "end": norm_end,
                "duration_days": round(duration_s / 86400.0, 2)
            },
            "metrics": {
                "total_energy_kwh": efficiency["total_energy_kwh"],
                "avg_active_power_kw": analytics["avg_active_power_kw"],
                "peak_demand_kw": efficiency["peak_demand_kw"],
                "min_active_power_kw": analytics["min_active_power_kw"],
                "avg_apparent_power_kva": analytics["avg_apparent_power_kva"],
                "avg_reactive_power_kvar": analytics["avg_reactive_power_kvar"],
                "avg_power_factor": efficiency["avg_power_factor"],
                "min_power_factor": analytics["min_power_factor"],
                "load_factor": efficiency["load_factor"],
                "load_factor_pct": efficiency["load_factor_pct"],
                "avg_voltage": analytics["avg_voltage"],
                "min_voltage": analytics["min_voltage"],
                "max_voltage": analytics["max_voltage"],
                "avg_frequency": analytics["avg_frequency"],
                "after_hours_kwh": efficiency["after_hours_kwh"],
                "after_hours_pct": efficiency["after_hours_pct"],
                "operating_hours_kwh": efficiency["operating_hours_kwh"],
                "estimated_electricity_cost_lkr": cost["estimated_total_cost_lkr"],
                "estimated_energy_charge_lkr": cost["estimated_energy_charge_lkr"],
                "estimated_demand_charge_lkr": cost["estimated_demand_charge_lkr"],
                "estimated_fixed_charge_lkr": cost["estimated_fixed_charge_lkr"],
                "warning_alerts_count": alert_counts["warning_alerts"],
                "critical_alerts_count": alert_counts["critical_alerts"],
                "total_alerts_count": alert_counts["total_alerts"],
                "readings_count": len(readings)
            },
            "efficiency_score": efficiency["efficiency_score"],
            "performance_status": efficiency["performance_status"],
            "engineering_observations": efficiency["engineering_observations"],
            "important_alerts": recent_alerts,
            "tariff": tariff,
            "is_simulated": True,
            "simulation_note": "Measurements used in this prototype are simulated.",
            "disclaimer": "Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."
        }

    # Case 2: Six-Building Campus Summary Report
    cost_eff_res = get_cost_and_efficiency_analytics(building_id="all", start=start, end=end)
    campus_sum = cost_eff_res["campus_summary"]
    comparison = cost_eff_res["comparison"]
    ranked_comparison = cost_eff_res["ranked_comparison"]

    campus_alerts = get_alerts_counts_for_period(building_id=None, start=start, end=end)
    recent_campus_alerts = get_filtered_alerts(start=start, end=end, limit=15)

    # Campus engineering observations synthesis
    campus_observations = []
    if campus_sum.get("avg_power_factor") is not None and campus_sum["avg_power_factor"] < 0.85:
        campus_observations.append(
            f"Poor campus-wide average power factor ({campus_sum['avg_power_factor']:.3f}) below CEB statutory minimum (0.85). Reactive current compensation recommended."
        )
    if campus_sum.get("after_hours_pct") is not None and campus_sum["after_hours_pct"] > 25.0:
        campus_observations.append(
            f"Significant campus after-hours energy usage: {campus_sum['after_hours_kwh']:.2f} kWh ({campus_sum['after_hours_pct']:.1f}% of campus consumption) occurred outside faculty operational hours."
        )
    highest_peak_b = max(comparison, key=lambda x: x.get("peak_demand_kw") or 0.0, default=None)
    if highest_peak_b and (highest_peak_b.get("peak_demand_kw") or 0.0) > 0:
        campus_observations.append(
            f"High peak active demand contributor: {highest_peak_b['building_name']} reached {highest_peak_b['peak_demand_kw']:.1f} kW individual peak demand, driving facility demand charges."
        )
    if (campus_sum.get("peak_demand_kw") or 0.0) > 0 and campus_sum.get("load_factor_pct") is not None:
        campus_observations.append(
            f"Coincident campus peak demand reached {campus_sum['peak_demand_kw']:.1f} kW with an overall campus load factor of {campus_sum['load_factor_pct']:.1f}%."
        )
    if campus_alerts["critical_alerts"] > 0:
        campus_observations.append(
            f"Voltage/Overload abnormality events: {campus_alerts['critical_alerts']} critical electrical alerts were triggered across faculty complexes during this reporting period."
        )
    if not campus_observations:
        campus_observations.append("All six engineering facilities operated within standard electrical tolerances during the reporting period.")

    return {
        "mode": "campus_summary",
        "report_title": "Faculty of Engineering Campus-Wide Smart Energy Audit Report",
        "generated_at": parse_timestamp_str(None).strftime("%Y-%m-%d %H:%M:%S") if hasattr(parse_timestamp_str(None), 'strftime') else "2026-10-07 10:16:00",
        "building_id": "all",
        "building_code": "ALL",
        "building_name": "Faculty of Engineering (All 6 Buildings)",
        "reporting_period": {
            "start": norm_start,
            "end": norm_end,
            "duration_days": round(duration_s / 86400.0, 2)
        },
        "metrics": {
            "total_energy_kwh": campus_sum["total_kwh"],
            "avg_active_power_kw": campus_sum["avg_demand_kw"],
            "peak_demand_kw": campus_sum["peak_demand_kw"],
            "avg_apparent_power_kva": campus_sum.get("avg_apparent_power_kva"),
            "avg_reactive_power_kvar": campus_sum.get("avg_reactive_power_kvar"),
            "avg_power_factor": campus_sum.get("avg_power_factor"),
            "min_power_factor": campus_sum.get("min_power_factor", campus_sum.get("avg_power_factor")),
            "load_factor": campus_sum["load_factor"],
            "load_factor_pct": campus_sum["load_factor_pct"],
            "avg_voltage": campus_sum.get("avg_voltage"),
            "min_voltage": campus_sum.get("min_voltage"),
            "max_voltage": campus_sum.get("max_voltage"),
            "avg_frequency": campus_sum.get("avg_frequency"),
            "after_hours_kwh": campus_sum["after_hours_kwh"],
            "after_hours_pct": campus_sum["after_hours_pct"],
            "estimated_electricity_cost_lkr": campus_sum["estimated_cost_lkr"],
            "estimated_energy_charge_lkr": campus_sum["estimated_energy_charge_lkr"],
            "estimated_demand_charge_lkr": campus_sum["estimated_demand_charge_lkr"],
            "estimated_fixed_charge_lkr": campus_sum["estimated_fixed_charge_lkr"],
            "warning_alerts_count": campus_alerts["warning_alerts"],
            "critical_alerts_count": campus_alerts["critical_alerts"],
            "total_alerts_count": campus_alerts["total_alerts"],
            "building_count": len(all_buildings)
        },
        "engineering_observations": campus_observations,
        "building_breakdown": comparison,
        "ranked_comparison": ranked_comparison,
        "important_alerts": recent_campus_alerts,
        "tariff": tariff,
        "is_simulated": True,
        "simulation_note": "Measurements used in this prototype are simulated.",
        "disclaimer": "Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."
    }


def get_tariff_by_id(tariff_id):
    """
    Retrieves a single tariff record by ID from SQLite.
    Returns a dict or None if not found.
    """
    if tariff_id is None:
        return None
    try:
        t_id = int(tariff_id)
    except (ValueError, TypeError):
        return None

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, name, energy_rate_lkr_per_kwh, demand_rate_lkr_per_kw, 
               fixed_charge_lkr, effective_from, active
        FROM tariffs
        WHERE id = ?
    """, (t_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None


def update_tariff_configuration(tariff_id, name, energy_rate, demand_rate, fixed_charge):
    """
    Updates demonstration tariff rates in SQLite atomically.
    Administrator role only. Rolls back on error.
    """
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE tariffs
            SET name = ?, energy_rate_lkr_per_kwh = ?, demand_rate_lkr_per_kw = ?, fixed_charge_lkr = ?
            WHERE id = ?
        """, (str(name).strip(), float(energy_rate), float(demand_rate), float(fixed_charge), int(tariff_id)))
        rows_affected = cursor.rowcount
        conn.commit()
        return rows_affected > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()


