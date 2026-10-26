"""
app.py
------
Main Flask backend application for the Smart Energy Monitoring and Analytics System
(Faculty of Engineering, University of Ruhuna).

Phase 2: Authentication, Role-based Access Control (Administrator & Viewer),
Session Management, and Protected Energy API Endpoints.
"""

import os
import sqlite3
from functools import wraps
from flask import (
    Flask,
    jsonify,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    Response
)
import csv
import io
import math
import re
import sys
from flask_cors import CORS
from werkzeug.security import check_password_hash

# Ensure backend directory and project root are in sys.path
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
for path in (BACKEND_DIR, PROJECT_ROOT):
    if path not in sys.path:
        sys.path.insert(0, path)

from database import (
    init_db,
    get_db_connection,
    get_all_buildings,
    get_building_by_id,
    get_building_by_code,
    get_building_by_name,
    add_building,
    update_building,
    delete_building,
    get_building_deletion_preview,
    delete_building_and_simulated_data,
    get_user_by_email,
    get_user_by_id,
    get_live_energy_readings,
    get_building_energy_history,
    get_filtered_energy_history,
    get_energy_analytics,
    get_filtered_alerts,
    get_alerts_summary,
    acknowledge_alert,
    check_sensor_offline_alerts,
    get_active_tariff,
    get_tariff_by_id,
    get_faculty_settings,
    get_cost_and_efficiency_analytics,
    get_comprehensive_energy_report,
    update_tariff_configuration
)

# Initialize Flask web application with frontend template and static paths
app = Flask(
    __name__,
    template_folder=os.path.join(PROJECT_ROOT, "frontend", "templates"),
    static_folder=os.path.join(PROJECT_ROOT, "frontend", "static")
)

def get_or_create_secret_key():
    """
    Retrieves or provisions a stable, private cryptographic secret key for Flask session signing.
    1. Reads from FLASK_SECRET_KEY environment variable if defined.
    2. Reads from a local private .secret_key file (excluded from git).
    3. If neither exists, generates a secure random 256-bit token (secrets.token_hex(32)),
       persists it to .secret_key for restart stability, and returns it.
    """
    env_key = os.environ.get("FLASK_SECRET_KEY")
    if env_key and env_key.strip():
        return env_key.strip()

    secret_file_path = os.environ.get(
        "FLASK_SECRET_KEY_PATH",
        os.path.join(PROJECT_ROOT, ".secret_key")
    )
    if os.path.exists(secret_file_path):
        try:
            with open(secret_file_path, "r", encoding="utf-8") as f:
                saved_key = f.read().strip()
                if saved_key:
                    return saved_key
        except Exception:
            pass

    import secrets
    new_key = secrets.token_hex(32)
    try:
        with open(secret_file_path, "w", encoding="utf-8") as f:
            f.write(new_key)
    except Exception:
        pass
    return new_key

# Configure private, persistent cryptographic session signing key
app.secret_key = get_or_create_secret_key()

# Security hardening: Prevent client-side script cookie theft (XSS mitigation) and configure CSRF defense
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax"
)

# Trusted origins permitted to send cross-origin requests
TRUSTED_ORIGINS = {
    "http://127.0.0.1:5000",
    "http://localhost:5000"
}

# Restrict Cross-Origin Resource Sharing (CORS) to trusted local origins
CORS(app, origins=list(TRUSTED_ORIGINS), supports_credentials=True)

# Ensure the database tables exist upon server startup
init_db()


# ==========================================================================
# CSRF Token Management & Origin Defense
# ==========================================================================

@app.before_request
def ensure_csrf_token():
    """Ensures an authenticated user session always possesses a unique CSRF token."""
    if session.get("user_id") and not session.get("csrf_token"):
        import secrets
        session["csrf_token"] = secrets.token_hex(16)


@app.context_processor
def inject_csrf_token():
    """Exposes csrf_token to all Jinja2 HTML templates."""
    return dict(csrf_token=session.get("csrf_token", ""))


@app.before_request
def verify_csrf():
    """
    CSRF Defense for state-changing HTTP requests (POST, PUT, DELETE, PATCH).
    1. Skips safe read-only methods (GET, HEAD, OPTIONS).
    2. Skips public unauthenticated routes (e.g. /login, /static/).
    3. For authenticated mutation requests:
       - Checks Origin/Referer header: if present, must match trusted local prototype origins.
       - Validates CSRF token if provided via X-CSRF-Token header or request body.
       - Rejects untrusted foreign origins or invalid tokens with HTTP 403 Forbidden.
    """
    if request.method not in ("POST", "PUT", "DELETE", "PATCH"):
        return None

    # Skip unauthenticated / public endpoints
    if request.path in ("/login",) or request.path.startswith("/static/"):
        return None

    # 1. Origin header defense: If sent by a cross-site attacker, browser enforces Origin header
    origin = request.headers.get("Origin")
    if origin and origin not in TRUSTED_ORIGINS:
        return jsonify({
            "status": "error",
            "message": f"CSRF validation failed: Cross-origin request from '{origin}' is forbidden."
        }), 403

    # 2. Token verification: If user is authenticated, verify token when provided
    if session.get("user_id"):
        expected_token = session.get("csrf_token")
        received_token = request.headers.get("X-CSRF-Token")

        # Also check request body if not in header
        if not received_token:
            if request.is_json:
                data = request.get_json(silent=True) or {}
                received_token = data.get("csrf_token")
            elif request.form:
                received_token = request.form.get("csrf_token")

        if received_token:
            import hmac
            if not expected_token or not hmac.compare_digest(str(received_token), str(expected_token)):
                return jsonify({
                    "status": "error",
                    "message": "CSRF validation failed: Invalid or tampered CSRF token."
                }), 403



# ==========================================================================
# Authentication & Role Authorization Decorators
# ==========================================================================

def login_required(f):
    """
    Decorator to protect routes from unauthenticated access.
    - If accessed by an API client (accepts JSON or starts with /api/), returns 401 JSON.
    - If accessed by a web browser, redirects to /login with a flash notification.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get("user_id"):
            # Check if this is an API route or expects JSON
            if request.path.startswith("/api/") or request.is_json:
                return jsonify({
                    "status": "error",
                    "message": "Unauthorized access. Please log in first."
                }), 401
            flash("Please log in to access this page.", "error")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function


def role_required(allowed_roles):
    """
    Decorator to enforce role permissions on the server (e.g. Administrator only).
    """
    def decorator(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if not session.get("user_id"):
                if request.path.startswith("/api/") or request.is_json:
                    return jsonify({"status": "error", "message": "Unauthorized access."}), 401
                return redirect(url_for("login"))

            user_role = session.get("role")
            if user_role not in allowed_roles:
                if request.path.startswith("/api/") or request.is_json:
                    return jsonify({
                        "status": "error",
                        "message": f"Forbidden. Requires one of the following roles: {allowed_roles}"
                    }), 403
                flash("You do not have permission to access that resource.", "error")
                return redirect(url_for("dashboard"))

            return f(*args, **kwargs)
        return decorated_function
    return decorator


# ==========================================================================
# Web Page Routes
# ==========================================================================

@app.route("/", methods=["GET"])
def home():
    """
    Root route: Redirects authenticated users to /dashboard, otherwise /login.
    """
    if session.get("user_id"):
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    """
    GET:  Renders the University of Ruhuna dark-themed login page.
    POST: Authenticates user credentials using secure password hash comparison.
          Supports both standard HTML form submissions and JSON API requests.
    """
    # If user is already logged in, redirect directly to dashboard
    if request.method == "GET" and session.get("user_id"):
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        # Extract credentials from JSON or Form submission
        if request.is_json:
            data = request.get_json() or {}
            email = data.get("email", "").strip()
            password = data.get("password", "")
        else:
            email = request.form.get("email", "").strip()
            password = request.form.get("password", "")

        # Validation: Check required fields
        if not email or not password:
            error_msg = "Please provide both email and password."
            if request.is_json:
                return jsonify({"status": "error", "message": error_msg}), 400
            flash(error_msg, "error")
            return render_template("login.html", email=email), 400

        # Query user from SQLite database
        user = get_user_by_email(email)

        # Secure password verification
        if not user or not check_password_hash(user["password_hash"], password):
            error_msg = "Invalid email or password. Please try again."
            if request.is_json:
                return jsonify({"status": "error", "message": error_msg}), 401
            flash(error_msg, "error")
            return render_template("login.html", email=email), 401

        # Credentials are valid: establish server-side Flask session
        import secrets
        session.clear()
        session["user_id"] = user["id"]
        session["email"] = user["email"]
        session["full_name"] = user["full_name"]
        session["role"] = user["role"]
        session["csrf_token"] = secrets.token_hex(16)

        if request.is_json:
            return jsonify({
                "status": "success",
                "message": "Login successful.",
                "user": {
                    "id": user["id"],
                    "email": user["email"],
                    "full_name": user["full_name"],
                    "role": user["role"]
                },
                "redirect": url_for("dashboard")
            }), 200

        flash(f"Welcome back, {user['full_name']}!", "success")
        return redirect(url_for("dashboard"))

    # Render GET /login
    return render_template("login.html")


@app.route("/logout", methods=["GET", "POST"])
def logout():
    """
    POST/GET /logout
    Clears the active session and redirects the user back to the login page.
    """
    session.clear()
    flash("You have been logged out successfully.", "success")
    if request.is_json:
        return jsonify({"status": "success", "message": "Logged out successfully."}), 200
    return redirect(url_for("login"))


@app.route("/dashboard", methods=["GET"])
@login_required
def dashboard():
    """
    GET /dashboard
    Protected route: Displays the welcome dashboard for authenticated users
    along with faculty buildings overview and a working Logout button.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, code, description FROM buildings ORDER BY id ASC")
    buildings = cursor.fetchall()
    conn.close()

    return render_template("dashboard.html", buildings=buildings)


# ==========================================================================
# Protected Energy & User REST API Endpoints
# ==========================================================================

@app.route("/api/auth/me", methods=["GET"])
@login_required
def get_current_user():
    """
    GET /api/auth/me
    Returns current authenticated session user information.
    """
    return jsonify({
        "status": "success",
        "user": {
            "id": session.get("user_id"),
            "email": session.get("email"),
            "full_name": session.get("full_name"),
            "role": session.get("role")
        }
    }), 200


@app.route("/api/buildings", methods=["GET"])
@login_required
def get_buildings():
    """
    GET /api/buildings
    Protected endpoint: Retrieves all registered faculty buildings from SQLite.
    Requires an authenticated session.
    """
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT id, name, code, description FROM buildings ORDER BY id ASC")
        rows = cursor.fetchall()
        conn.close()

        buildings = []
        for row in rows:
            buildings.append({
                "id": row["id"],
                "name": row["name"],
                "code": row["code"],
                "description": row["description"]
            })

        return jsonify({
            "status": "success",
            "count": len(buildings),
            "data": buildings
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


# ==========================================================================
# Input Validation Utilities (Task 3: Robust Input Validation & Error Handling)
# ==========================================================================

def validate_building_code(code):
    """
    Validates and normalizes building code:
    - Required non-empty string.
    - Stripped and normalized to uppercase.
    - Length between 2 and 10 characters.
    - Allowed characters: alphanumeric, hyphens, and underscores.
    """
    if code is None or not str(code).strip():
        raise ValueError("Building code is required.")
    clean_code = str(code).strip().upper()
    if len(clean_code) < 2 or len(clean_code) > 10:
        raise ValueError(f"Building code must be between 2 and 10 characters (received {len(clean_code)}).")
    if not re.match(r"^[A-Z0-9_-]+$", clean_code):
        raise ValueError("Building code may only contain letters, numbers, hyphens, and underscores.")
    return clean_code


def validate_building_name(name):
    """
    Validates and normalizes building name:
    - Required non-empty string.
    - Stripped.
    - Length between 2 and 100 characters.
    """
    if name is None or not str(name).strip():
        raise ValueError("Building name is required.")
    clean_name = str(name).strip()
    if len(clean_name) < 2 or len(clean_name) > 100:
        raise ValueError(f"Building name must be between 2 and 100 characters (received {len(clean_name)}).")
    return clean_name


def validate_rated_power(val):
    """
    Validates rated active power in kW:
    - Required numeric value.
    - Finite float (strictly rejects NaN, Inf, and -Inf).
    - Greater than 0 kW.
    - Upper bound <= 10,000 kW.
    """
    if val is None or (isinstance(val, str) and not val.strip()):
        raise ValueError("Rated power (kW) is required.")
    try:
        p = float(val)
    except (ValueError, TypeError):
        raise ValueError("Rated power must be a valid numeric value.")
    if math.isnan(p) or math.isinf(p):
        raise ValueError("Rated power must be a finite numeric value (NaN and Infinity are not allowed).")
    if p <= 0:
        raise ValueError("Rated power must be greater than 0 kW.")
    if p > 10000.0:
        raise ValueError("Rated power exceeds maximum allowable limit of 10,000 kW.")
    return p


def validate_tariff_rates(energy_rate, demand_rate, fixed_charge, name=None):
    """
    Validates demonstration institutional tariff rates:
    - energy_rate: required finite float > 0, max 1,000 LKR/kWh.
    - demand_rate: required finite float >= 0, max 50,000 LKR/kW.
    - fixed_charge: required finite float >= 0, max 100,000 LKR.
    - name: optional string, if provided must be 3-100 characters.
    """
    clean_name = None
    if name is not None:
        if not str(name).strip():
            raise ValueError("Tariff name/description cannot be empty.")
        clean_name = str(name).strip()
        if len(clean_name) < 3 or len(clean_name) > 100:
            raise ValueError(f"Tariff name must be between 3 and 100 characters (received {len(clean_name)}).")

    if energy_rate is None or (isinstance(energy_rate, str) and not energy_rate.strip()):
        raise ValueError("Energy rate (LKR/kWh) is required.")
    try:
        e_rate = float(energy_rate)
    except (ValueError, TypeError):
        raise ValueError("Energy rate must be a valid numeric value.")
    if math.isnan(e_rate) or math.isinf(e_rate):
        raise ValueError("Energy rate must be a finite numeric value (NaN and Infinity are not allowed).")
    if e_rate <= 0:
        raise ValueError("Energy rate must be greater than 0 LKR/kWh.")
    if e_rate > 1000.0:
        raise ValueError("Energy rate exceeds maximum allowable rate of 1,000 LKR/kWh.")

    if demand_rate is None or (isinstance(demand_rate, str) and not demand_rate.strip()):
        raise ValueError("Demand rate (LKR/kW) is required.")
    try:
        d_rate = float(demand_rate)
    except (ValueError, TypeError):
        raise ValueError("Demand rate must be a valid numeric value.")
    if math.isnan(d_rate) or math.isinf(d_rate):
        raise ValueError("Demand rate must be a finite numeric value (NaN and Infinity are not allowed).")
    if d_rate < 0:
        raise ValueError("Demand rate cannot be negative (must be >= 0 LKR/kW).")
    if d_rate > 50000.0:
        raise ValueError("Demand rate exceeds maximum allowable rate of 50,000 LKR/kW.")

    if fixed_charge is None or (isinstance(fixed_charge, str) and not fixed_charge.strip()):
        raise ValueError("Monthly fixed charge (LKR) is required.")
    try:
        f_charge = float(fixed_charge)
    except (ValueError, TypeError):
        raise ValueError("Monthly fixed charge must be a valid numeric value.")
    if math.isnan(f_charge) or math.isinf(f_charge):
        raise ValueError("Monthly fixed charge must be a finite numeric value (NaN and Infinity are not allowed).")
    if f_charge < 0:
        raise ValueError("Monthly fixed charge cannot be negative (must be >= 0 LKR).")
    if f_charge > 100000.0:
        raise ValueError("Monthly fixed charge exceeds maximum allowable charge of 100,000 LKR.")

    return clean_name, e_rate, d_rate, f_charge


@app.route("/api/buildings/create", methods=["POST"])
@login_required
@role_required(["Administrator"])
def create_building():
    """
    POST /api/buildings/create
    Requires login (Administrator role).
    Validates JSON payload: code, name, and rated_power_kw (> 0).
    Checks uniqueness for code and name, returning HTTP 409 Conflict if already in use.
    Calls add_building atomically and returns JSON {"status": "success", "id": new_id}.
    """
    data = request.get_json(silent=True) or request.form.to_dict() or {}

    # 1. Input format & range validation
    try:
        code = validate_building_code(data.get("code"))
        name = validate_building_name(data.get("name"))
        power_val = validate_rated_power(data.get("rated_power_kw"))
    except ValueError as ve:
        return jsonify({"status": "error", "message": str(ve)}), 400

    # 2. Uniqueness checks
    existing_code = get_building_by_code(code)
    if existing_code:
        return jsonify({
            "status": "error",
            "message": f"Building code '{code}' already exists (assigned to '{existing_code['name']}')."
        }), 409

    existing_name = get_building_by_name(name)
    if existing_name:
        return jsonify({
            "status": "error",
            "message": f"Building name '{name}' already exists (Code: '{existing_name['code']}')."
        }), 409

    # 3. Database insertion
    try:
        new_id = add_building(code, name, power_val)
        return jsonify({
            "status": "success",
            "id": new_id,
            "message": f"Building '{name}' ({code}) successfully created."
        }), 200
    except sqlite3.IntegrityError as ie:
        return jsonify({"status": "error", "message": f"Database integrity conflict: {str(ie)}"}), 409
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/buildings/<int:id>/update", methods=["POST"])
@login_required
@role_required(["Administrator"])
def update_building_api(id):
    """
    POST /api/buildings/<int:id>/update
    Requires login (Administrator role).
    Validates name, rated_power_kw (> 0), and optional code.
    Verifies building existence (404) and uniqueness (409) while allowing the building to retain its own code/name.
    Calls update_building atomically and returns JSON {"status": "success"}.
    """
    # 1. Existence check
    existing_bldg = get_building_by_id(id)
    if not existing_bldg:
        return jsonify({"status": "error", "message": f"Building with ID {id} not found."}), 404

    data = request.get_json(silent=True) or request.form.to_dict() or {}

    # 2. Input validation
    try:
        name = validate_building_name(data.get("name"))
        power_val = validate_rated_power(data.get("rated_power_kw"))
        raw_code = data.get("code")
        code = validate_building_code(raw_code) if raw_code is not None else None
    except ValueError as ve:
        return jsonify({"status": "error", "message": str(ve)}), 400

    # 3. Uniqueness checks (excluding current building ID to allow retention)
    if code is not None:
        code_conflict = get_building_by_code(code, exclude_id=id)
        if code_conflict:
            return jsonify({
                "status": "error",
                "message": f"Building code '{code}' is already in use by building #{code_conflict['id']} ('{code_conflict['name']}')."
            }), 409

    name_conflict = get_building_by_name(name, exclude_id=id)
    if name_conflict:
        return jsonify({
            "status": "error",
            "message": f"Building name '{name}' is already in use by building [{name_conflict['code']}]."
        }), 409

    # 4. Database update
    try:
        success = update_building(id, name, power_val, code=code)
        if not success:
            return jsonify({"status": "error", "message": f"Building with ID {id} not found."}), 404
        return jsonify({
            "status": "success",
            "message": f"Building #{id} successfully updated."
        }), 200
    except sqlite3.IntegrityError as ie:
        return jsonify({"status": "error", "message": f"Database integrity conflict: {str(ie)}"}), 409
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400



@app.route("/api/buildings/<int:id>/delete", methods=["POST"])
@login_required
@role_required(["Administrator"])
def delete_building_api(id):
    """
    POST /api/buildings/<int:id>/delete
    Requires login (Administrator role).
    Calls delete_building and returns JSON:
      - 200 OK if successfully deleted (when no dependencies exist).
      - 404 Not Found if building does not exist.
      - 409 Conflict if deletion is blocked due to existing historical records or foreign key safety.
    """
    try:
        success = delete_building(id)
        if not success:
            return jsonify({"status": "error", "message": f"Building with ID {id} not found."}), 404
        return jsonify({"status": "success", "message": f"Building #{id} successfully deleted."}), 200
    except (ValueError, sqlite3.IntegrityError) as e:
        return jsonify({"status": "error", "message": str(e)}), 409
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route("/api/buildings/<int:id>/delete-preview", methods=["GET"])
@login_required
@role_required(["Administrator"])
def delete_building_preview_api(id):
    """
    GET /api/buildings/<int:id>/delete-preview
    Protected endpoint: Administrator only.
    Returns pre-deletion metadata, reading counts (simulated vs real), alert counts,
    and deletion eligibility status.
    """
    try:
        preview = get_building_deletion_preview(id)
        if not preview:
            return jsonify({
                "status": "error",
                "message": f"Building with ID {id} not found."
            }), 404

        return jsonify({
            "status": "success",
            "preview": preview
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/buildings/<int:id>/delete-simulated", methods=["POST"])
@login_required
@role_required(["Administrator"])
def delete_building_simulated_api(id):
    """
    POST /api/buildings/<int:id>/delete-simulated
    Protected endpoint: Administrator only with CSRF verification.
    Safely and atomically deletes a selected demonstration building along with all
    associated simulated records.
    
    Payload (JSON or Form):
      {
        "confirm_code": "LIB",
        "csrf_token": "..."
      }
    """
    try:
        data = request.get_json(silent=True) or request.form or {}
        confirm_code = str(data.get("confirm_code", "")).strip()

        if not confirm_code:
            return jsonify({
                "status": "error",
                "message": "Building code confirmation is required to execute deletion."
            }), 400

        actor_email = session.get("email") or "Administrator"
        ip_addr = request.remote_addr

        result = delete_building_and_simulated_data(
            building_id=id,
            confirm_code=confirm_code,
            actor_email=actor_email,
            ip_address=ip_addr
        )

        if not result:
            return jsonify({
                "status": "error",
                "message": f"Building with ID {id} not found."
            }), 404

        return jsonify({
            "status": "success",
            "message": f"Building '{result['building_name']}' ({result['building_code']}) and all simulated records successfully deleted.",
            "details": {
                "building_id": result["building_id"],
                "building_code": result["building_code"],
                "building_name": result["building_name"],
                "deleted_readings": result["deleted_readings_count"],
                "deleted_alerts": result["deleted_alerts_count"],
                "backup_path": os.path.basename(result["backup_path"])
            }
        }), 200

    except ValueError as ve:
        err_msg = str(ve)
        if "mismatch" in err_msg.lower():
            return jsonify({"status": "error", "message": err_msg}), 400
        elif "protected" in err_msg.lower():
            return jsonify({"status": "error", "message": err_msg}), 403
        else:
            return jsonify({"status": "error", "message": err_msg}), 409
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/api/energy/live", methods=["GET"])
@login_required
def get_live_energy():
    """
    GET /api/energy/live
    Protected endpoint: Retrieves the latest three-phase reading for all 6 buildings.
    Clearly indicates readings are SIMULATED.
    """
    try:
        readings = get_live_energy_readings()
        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "timestamp": None if not readings else readings[0].get("timestamp"),
            "count": len(readings),
            "data": readings
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/analytics", methods=["GET"])
@login_required
def analytics_page():
    """
    GET /analytics
    Protected route: Displays the Historical Energy Analytics portal
    with date/time filters, KPI cards, Chart.js time-series graphs, and 6-building comparison.
    """
    buildings = get_all_buildings()
    return render_template("analytics.html", buildings=buildings)


@app.route("/api/energy/history", methods=["GET"])
@login_required
def get_energy_history():
    """
    GET /api/energy/history?building_id=1&start=...&end=...&limit=500
    Protected endpoint: Retrieves stored energy readings filtered by building_id,
    start timestamp, and end timestamp.
    """
    try:
        raw_bldg_id = request.args.get("building_id")
        if not raw_bldg_id:
            return jsonify({
                "status": "error",
                "message": "Query parameter 'building_id' is required (e.g. ?building_id=1 or ?building_id=all)."
            }), 400

        # Validate building_id format if not 'all'
        clean_bldg = str(raw_bldg_id).strip().lower()
        if clean_bldg not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        start = request.args.get("start")
        end = request.args.get("end")
        limit = request.args.get("limit", default=500, type=int)
        # Cap limit between 1 and 5000
        limit = min(max(1, limit), 5000)

        history = get_filtered_energy_history(
            building_id=raw_bldg_id,
            start=start,
            end=end,
            limit=limit,
            order_asc=True
        )

        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "building_id": int(raw_bldg_id) if (raw_bldg_id and str(raw_bldg_id).isdigit()) else (raw_bldg_id if raw_bldg_id else "all"),
            "start": start,
            "end": end,
            "count": len(history),
            "data": history
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/energy/analytics", methods=["GET"])
@login_required
def get_energy_analytics_api():
    """
    GET /api/energy/analytics?building_id=1&start=...&end=...
    Protected endpoint: Computes electrical analytics for the selected building (or campus-wide)
    over the selected time period:
      - Total energy consumed (kWh, trapezoidal consecutive time integration with gap handling)
      - Average, Peak (Max), and Min Active Power (kW)
      - Load Factor = Average Active Power / Peak Active Power
      - Average Apparent Power (kVA), Average Reactive Power (kVAr)
      - Average and Min Power Factor
      - Voltage and Frequency statistics
      - Six-building comparison metrics when building_id=all or omitted
    """
    try:
        raw_bldg_id = request.args.get("building_id", default="all")
        clean_bldg = str(raw_bldg_id).strip().lower()
        if clean_bldg not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        start = request.args.get("start")
        end = request.args.get("end")

        analytics_data = get_energy_analytics(
            building_id=raw_bldg_id,
            start=start,
            end=end
        )

        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            **analytics_data
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


# ==========================================================================
# Phase 6: Electrical Alerts & Abnormal Condition Endpoints
# ==========================================================================

@app.route("/alerts", methods=["GET"])
@login_required
def alerts_page():
    """
    GET /alerts
    Protected route: Displays the Electrical Alerts and Abnormal Condition Detection portal.
    """
    buildings = get_all_buildings()
    return render_template("alerts.html", buildings=buildings)


@app.route("/api/alerts", methods=["GET"])
@login_required
def get_alerts_api():
    """
    GET /api/alerts?building_id=...&severity=...&status=...&start=...&end=...&limit=...
    Protected endpoint: Retrieves stored electrical alerts and summary counters.
    Optional query filters:
      - building_id: filter by specific facility (1..6) or 'all'
      - severity: filter by 'CRITICAL', 'WARNING', 'INFO', or 'all'
      - status: filter by 'active' (active abnormal conditions), 'cleared', or 'all'
      - start / end: date-time boundaries
      - limit: max records (default: 100, clamped to 1000)
    """
    try:
        # Check for any silent/offline sensors in real-time
        check_sensor_offline_alerts(threshold_seconds=60.0)

        raw_bldg_id = request.args.get("building_id")
        if raw_bldg_id and str(raw_bldg_id).strip().lower() not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        severity = request.args.get("severity")
        status = request.args.get("status", default="all")
        start = request.args.get("start")
        end = request.args.get("end")
        limit = request.args.get("limit", default=100, type=int)

        alerts = get_filtered_alerts(
            building_id=raw_bldg_id,
            severity=severity,
            status=status,
            start=start,
            end=end,
            limit=limit
        )

        summary = get_alerts_summary()

        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "count": len(alerts),
            "summary": summary,
            "data": alerts
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/alerts/<int:alert_id>/acknowledge", methods=["POST"])
@login_required
def acknowledge_alert_api(alert_id):
    """
    POST /api/alerts/<id>/acknowledge
    Protected endpoint: Enforces Requirement 7:
    ONLY Administrator users can acknowledge alerts.
    Viewers receive HTTP 403 Forbidden.
    """
    try:
        user_role = session.get("role")
        if user_role != "Administrator":
            return jsonify({
                "status": "error",
                "message": "Access denied: Only Administrator accounts have permission to acknowledge electrical alerts."
            }), 403

        user_name = session.get("full_name", session.get("email", "Faculty Administrator"))
        updated_alert = acknowledge_alert(alert_id, user_name)

        if not updated_alert:
            return jsonify({
                "status": "error",
                "message": f"Electrical alert #{alert_id} not found."
            }), 404

        return jsonify({
            "status": "success",
            "message": f"Alert #{alert_id} ({updated_alert['alert_type']}) successfully acknowledged by {user_name}.",
            "alert": updated_alert
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


# ==========================================================================
# Phase 7: Energy Cost & Efficiency Analysis Endpoints
# ==========================================================================

@app.route("/cost-efficiency", methods=["GET"])
@login_required
def cost_efficiency_page():
    """
    GET /cost-efficiency
    Protected route: Displays the Energy Cost & Efficiency Analysis portal
    with tariff breakdowns, after-hours usage analytics, KPI cards, and 6-building rankings.
    """
    buildings = get_all_buildings()
    tariff = get_active_tariff()
    settings = get_faculty_settings()
    return render_template(
        "cost_efficiency.html",
        buildings=buildings,
        tariff=tariff,
        settings=settings
    )


@app.route("/api/energy/cost", methods=["GET"])
@login_required
def get_energy_cost_api():
    """
    GET /api/energy/cost?building_id=...&start=...&end=...
    Protected endpoint: Computes estimated electricity cost using a demonstration tariff model:
      - energy consumed (kWh)
      - estimated energy charge (LKR)
      - peak demand (kW)
      - estimated demand charge (LKR)
      - fixed charge where applicable (LKR)
      - estimated total cost (LKR)
      - tariff name
      - indication that the value is an estimate (disclaimer)
    """
    try:
        raw_bldg_id = request.args.get("building_id", default="all")
        clean_bldg = str(raw_bldg_id).strip().lower()
        if clean_bldg not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        start = request.args.get("start")
        end = request.args.get("end")

        analytics_res = get_cost_and_efficiency_analytics(
            building_id=raw_bldg_id,
            start=start,
            end=end
        )

        if analytics_res["mode"] == "single":
            cost_data = analytics_res["cost"]
            return jsonify({
                "status": "success",
                "data_source": "SIMULATED",
                "mode": "single",
                "building_id": analytics_res["building_id"],
                "building_code": analytics_res["building_code"],
                "building_name": analytics_res["building_name"],
                "start": analytics_res["start"],
                "end": analytics_res["end"],
                "energy_consumed_kwh": cost_data["energy_consumed_kwh"],
                "estimated_energy_charge_lkr": cost_data["estimated_energy_charge_lkr"],
                "peak_demand_kw": cost_data["peak_demand_kw"],
                "estimated_demand_charge_lkr": cost_data["estimated_demand_charge_lkr"],
                "estimated_fixed_charge_lkr": cost_data["estimated_fixed_charge_lkr"],
                "estimated_total_cost_lkr": cost_data["estimated_total_cost_lkr"],
                "tariff_name": cost_data["tariff_name"],
                "is_estimate": True,
                "disclaimer": cost_data["disclaimer"]
            }), 200

        # Campus-wide multi-building cost summary
        campus_sum = analytics_res["campus_summary"]
        tariff_obj = analytics_res["tariff"]
        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "mode": "campus_summary",
            "start": analytics_res["start"],
            "end": analytics_res["end"],
            "energy_consumed_kwh": campus_sum["total_kwh"],
            "estimated_energy_charge_lkr": campus_sum["estimated_energy_charge_lkr"],
            "peak_demand_kw": campus_sum["peak_demand_kw"],
            "estimated_demand_charge_lkr": campus_sum["estimated_demand_charge_lkr"],
            "estimated_fixed_charge_lkr": campus_sum["estimated_fixed_charge_lkr"],
            "estimated_total_cost_lkr": campus_sum["estimated_cost_lkr"],
            "tariff_name": tariff_obj.get("name", "Demonstration Institutional Tariff"),
            "is_estimate": True,
            "disclaimer": campus_sum["disclaimer"],
            "building_breakdown": [
                {
                    "building_id": b["building_id"],
                    "building_code": b["building_code"],
                    "building_name": b["building_name"],
                    "energy_consumed_kwh": b["total_kwh"],
                    "peak_demand_kw": b["peak_demand_kw"],
                    "estimated_cost_lkr": b["estimated_cost_lkr"]
                }
                for b in analytics_res["comparison"]
            ]
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/energy/efficiency", methods=["GET"])
@login_required
def get_energy_efficiency_api():
    """
    GET /api/energy/efficiency?building_id=...&start=...&end=...
    Protected endpoint: Computes electrical efficiency metrics:
      - average demand (kW)
      - peak demand (kW)
      - load factor (and %)
      - average power factor
      - low-PF duration (minutes)
      - estimated after-hours consumption (kWh and %)
      - energy performance status (OPTIMAL, ACCEPTABLE, NEEDS_ATTENTION, INEFFICIENT)
      - engineering observations
      - baseline comparison against building's historical mean
    """
    try:
        raw_bldg_id = request.args.get("building_id", default="all")
        clean_bldg = str(raw_bldg_id).strip().lower()
        if clean_bldg not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        start = request.args.get("start")
        end = request.args.get("end")

        analytics_res = get_cost_and_efficiency_analytics(
            building_id=raw_bldg_id,
            start=start,
            end=end
        )

        if analytics_res["mode"] == "single":
            eff = analytics_res["efficiency"]
            return jsonify({
                "status": "success",
                "data_source": "SIMULATED",
                "mode": "single",
                "building_id": analytics_res["building_id"],
                "building_code": analytics_res["building_code"],
                "building_name": analytics_res["building_name"],
                "rated_power_kw": analytics_res["rated_power_kw"],
                "start": analytics_res["start"],
                "end": analytics_res["end"],
                "average_demand_kw": eff["avg_demand_kw"],
                "peak_demand_kw": eff["peak_demand_kw"],
                "load_factor": eff["load_factor"],
                "load_factor_pct": eff["load_factor_pct"],
                "average_power_factor": eff["avg_power_factor"],
                "low_pf_duration_minutes": eff["low_pf_duration_minutes"],
                "low_pf_readings_count": eff["low_pf_readings_count"],
                "after_hours_kwh": eff["after_hours_kwh"],
                "after_hours_pct": eff["after_hours_pct"],
                "operating_hours_kwh": eff["operating_hours_kwh"],
                "total_energy_kwh": eff["total_energy_kwh"],
                "efficiency_score": eff["efficiency_score"],
                "energy_performance_status": eff["performance_status"],
                "engineering_observations": eff["engineering_observations"],
                "baseline_comparison": eff["baseline_comparison"]
            }), 200

        # Six-building comparative efficiency
        campus_sum = analytics_res["campus_summary"]
        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "mode": "campus_summary",
            "start": analytics_res["start"],
            "end": analytics_res["end"],
            "campus_summary": campus_sum,
            "comparison": analytics_res["comparison"],
            "ranked_comparison": analytics_res["ranked_comparison"]
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/energy/efficiency/comparison", methods=["GET"])
@login_required
def get_energy_efficiency_comparison_api():
    """
    GET /api/energy/efficiency/comparison?start=...&end=...
    Protected endpoint: Dedicated six-building comparison returning for each facility:
      - total kWh
      - estimated cost (LKR)
      - peak demand (kW)
      - load factor
      - average PF
      - after-hours kWh
      - efficiency ranking
    """
    try:
        start = request.args.get("start")
        end = request.args.get("end")

        analytics_res = get_cost_and_efficiency_analytics(
            building_id="all",
            start=start,
            end=end
        )

        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "start": analytics_res["start"],
            "end": analytics_res["end"],
            "campus_summary": analytics_res["campus_summary"],
            "comparison": analytics_res["comparison"],
            "ranked_comparison": analytics_res["ranked_comparison"],
            "tariff": analytics_res["tariff"],
            "disclaimer": "Cost estimates use a configurable demonstration tariff model and are not an official CEB bill."
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


# ==========================================================================
# Phase 8: Reports, Export & Configuration Endpoints
# ==========================================================================

@app.route("/reports", methods=["GET"])
@login_required
def reports_page():
    """
    GET /reports
    Protected route: Displays the Reports and Export management portal
    with building selection, date filters, presets, printable view trigger, and CSV download.
    Accessible to both Administrator and Viewer users.
    """
    buildings = get_all_buildings()
    tariff = get_active_tariff()
    settings = get_faculty_settings()
    return render_template(
        "reports.html",
        buildings=buildings,
        tariff=tariff,
        settings=settings
    )


@app.route("/reports/printable", methods=["GET"])
@login_required
def printable_report_page():
    """
    GET /reports/printable?building_id=...&start=...&end=...
    Protected route: Displays a clean, formal University of Ruhuna printable audit report
    optimized for saving to PDF using the browser's standard Print / Save as PDF function.
    """
    building_id = request.args.get("building_id", default="all")
    start = request.args.get("start")
    end = request.args.get("end")

    report_data = get_comprehensive_energy_report(
        building_id=building_id,
        start=start,
        end=end
    )

    return render_template(
        "printable_report.html",
        report=report_data
    )


@app.route("/api/reports/summary", methods=["GET"])
@login_required
def get_report_summary_api():
    """
    GET /api/reports/summary?building_id=...&start=...&end=...
    Protected endpoint: Returns full energy summary report JSON.
    Contains all 16 required electrical, financial, alert and efficiency parameters.
    """
    try:
        raw_bldg_id = request.args.get("building_id", default="all")
        clean_bldg = str(raw_bldg_id).strip().lower()
        if clean_bldg not in ("all", "", "none"):
            try:
                int(raw_bldg_id)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": f"Invalid building_id: '{raw_bldg_id}'. Must be an integer ID or 'all'."
                }), 400

        start = request.args.get("start")
        end = request.args.get("end")

        report = get_comprehensive_energy_report(
            building_id=raw_bldg_id,
            start=start,
            end=end
        )

        return jsonify({
            "status": "success",
            "data_source": "SIMULATED",
            "report": report
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/reports/export/csv", methods=["GET"])
@login_required
def export_readings_csv():
    """
    GET /api/reports/export/csv?building_id=...&start=...&end=...
    Protected endpoint: Generates and streams a CSV export file containing detailed historical
    energy telemetry records from SQLite with complete 3-phase electrical parameters.
    """
    try:
        raw_bldg_id = request.args.get("building_id", default="all")
        start = request.args.get("start")
        end = request.args.get("end")

        readings = get_filtered_energy_history(
            building_id=raw_bldg_id,
            start=start,
            end=end,
            limit=5000,
            order_asc=True
        )

        output = io.StringIO()
        writer = csv.writer(output)

        # Write CSV Header
        writer.writerow([
            "Reading ID",
            "Building ID",
            "Building Code",
            "Building Name",
            "Timestamp",
            "Line Voltage (V)",
            "Line Current (A)",
            "Power Factor",
            "Frequency (Hz)",
            "Apparent Power (kVA)",
            "Active Power (kW)",
            "Reactive Power (kVAr)",
            "Cumulative Energy (kWh)",
            "Data Source"
        ])

        # Write Data Rows
        for r in readings:
            writer.writerow([
                r.get("id"),
                r.get("building_id"),
                r.get("building_code", "GEN"),
                r.get("building_name", "General"),
                r.get("timestamp"),
                r.get("voltage"),
                r.get("current"),
                r.get("power_factor"),
                r.get("frequency"),
                r.get("apparent_power_kva"),
                r.get("active_power_kw"),
                r.get("reactive_power_kvar"),
                r.get("energy_kwh"),
                "SIMULATED"
            ])

        output.seek(0)
        filename = f"ruhuna_energy_telemetry_{raw_bldg_id}.csv"

        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


@app.route("/api/config/tariff", methods=["POST"])
@login_required
def update_tariff_config_api():
    """
    POST /api/config/tariff
    Protected endpoint: Allows ONLY Administrator users to update demonstration tariff rates.
    Viewer users receive HTTP 403 Forbidden.
    """
    try:
        user_role = session.get("role")
        if user_role != "Administrator":
            return jsonify({
                "status": "error",
                "message": "Access denied: Administrator role required to modify tariff or system configurations."
            }), 403

        data = request.get_json(silent=True) or request.form.to_dict() or {}
        raw_tariff_id = data.get("tariff_id", 1)

        try:
            tariff_id = int(raw_tariff_id)
        except (ValueError, TypeError):
            return jsonify({
                "status": "error",
                "message": f"Invalid tariff_id '{raw_tariff_id}'. Must be an integer."
            }), 400

        # Verify tariff exists in SQLite
        existing_tariff = get_tariff_by_id(tariff_id)
        if not existing_tariff:
            return jsonify({
                "status": "error",
                "message": f"Tariff #{tariff_id} not found in database."
            }), 404

        name_input = data.get("name", existing_tariff.get("name"))
        energy_rate_input = data.get("energy_rate_lkr_per_kwh")
        demand_rate_input = data.get("demand_rate_lkr_per_kw")
        fixed_charge_input = data.get("fixed_charge_lkr")

        # If rate fields were omitted, fall back to existing tariff values
        if energy_rate_input is None:
            energy_rate_input = existing_tariff.get("energy_rate_lkr_per_kwh", 38.50)
        if demand_rate_input is None:
            demand_rate_input = existing_tariff.get("demand_rate_lkr_per_kw", 1450.00)
        if fixed_charge_input is None:
            fixed_charge_input = existing_tariff.get("fixed_charge_lkr", 3000.00)

        # Validate rates according to electrical and CEB billing semantics
        try:
            clean_name, energy_rate, demand_rate, fixed_charge = validate_tariff_rates(
                energy_rate_input,
                demand_rate_input,
                fixed_charge_input,
                name=name_input
            )
        except ValueError as ve:
            return jsonify({
                "status": "error",
                "message": str(ve)
            }), 400

        success = update_tariff_configuration(
            tariff_id=tariff_id,
            name=clean_name,
            energy_rate=energy_rate,
            demand_rate=demand_rate,
            fixed_charge=fixed_charge
        )

        if not success:
            return jsonify({
                "status": "error",
                "message": f"Tariff #{tariff_id} could not be updated."
            }), 400

        return jsonify({
            "status": "success",
            "message": f"Tariff #{tariff_id} updated successfully.",
            "updated_rates": {
                "name": clean_name,
                "energy_rate_lkr_per_kwh": energy_rate,
                "demand_rate_lkr_per_kw": demand_rate,
                "fixed_charge_lkr": fixed_charge
            }
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500


if __name__ == "__main__":
    # Start the Flask development server on port 5000 with auto-reload enabled
    app.run(host="127.0.0.1", port=5000, debug=True)



