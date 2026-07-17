"""
Task Manager Backend
---------------------
Flask + SQLite REST API with token-based authentication.
Each task belongs to exactly one user; users can only see/modify their own.

Auth endpoints:
    POST /api/register  -> create account          body: {username, password}
    POST /api/login      -> verify credentials      body: {username, password}
                             returns {token, username}
    POST /api/logout     -> invalidate current session (requires auth header)

Task endpoints (ALL require "Authorization: Bearer <token>"):
    GET    /api/tasks          -> list only the caller's tasks
    POST   /api/tasks          -> create a task owned by the caller
    PUT    /api/tasks/:id      -> update a task, only if it belongs to the caller
    DELETE /api/tasks/:id      -> delete a task, only if it belongs to the caller

Run:
    pip3 install flask flask-cors werkzeug
    python3 app.py
    -> server listens on http://localhost:5001
"""

import os
import re
import secrets
import sqlite3
from functools import wraps

from flask import Flask, g, jsonify, request
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.db")
VALID_PRIORITIES = {"Low", "Medium", "High"}
MIN_USERNAME_LEN = 3
MIN_PASSWORD_LEN = 8
# A plain (non-raw) string, deliberately: each character here is exactly
# the character it looks like, including the one literal backslash and one
# literal double-quote via normal Python escaping. re.escape() below does
# all the regex-metacharacter escaping needed when this is compiled into a
# character class -- no manual backslash-escaping should be added here.
SPECIAL_CHARS = "!@#$%^&*()_+-=[]{};':\"\\|,.<>/?"

app = Flask(__name__)
CORS(app, expose_headers=["Content-Type", "Authorization"])


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """
    Create tables if missing, and migrate an older tasks table (from before
    auth existed) by adding user_id if it isn't there yet. Idempotent either
    way: safe to call on every startup.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            priority TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
        """
    )

    # Migration path: if tasks.db already existed from before auth was added,
    # CREATE TABLE IF NOT EXISTS above is a no-op on it, and it won't have
    # user_id. Add it if missing so old databases don't crash on startup.
    existing_cols = {row["name"] for row in conn.execute("PRAGMA table_info(tasks)")}
    if "user_id" not in existing_cols:
        conn.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER REFERENCES users(id)")
        # Any pre-auth tasks now have user_id = NULL and are permanently
        # unreachable through the API (every query below filters by a real
        # user_id). That's intentional -- there's no correct owner to assign
        # them to -- but worth knowing if old data "disappears" after this
        # update: it isn't deleted, just orphaned. Delete tasks.db and let
        # it regenerate empty if you'd rather start clean.

    conn.commit()
    conn.close()


def row_to_task(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "priority": row["priority"],
        "completed": bool(row["completed"]),
        "created_at": row["created_at"],
    }


def password_policy_error(password):
    """
    Returns an error message string if the password fails the strength
    policy, or None if it passes. Mirrors the client-side checklist exactly
    so the two never disagree -- but this is the check that actually
    matters, since the frontend one can be bypassed entirely (devtools,
    curl, Postman) and this cannot.
    """
    if len(password) < MIN_PASSWORD_LEN:
        return f"password must be at least {MIN_PASSWORD_LEN} characters"
    if not re.search(r"[A-Z]", password):
        return "password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return "password must contain at least one lowercase letter"
    if not re.search(r"[0-9]", password):
        return "password must contain at least one number"
    if not re.search(f"[{re.escape(SPECIAL_CHARS)}]", password):
        return "password must contain at least one special character"
    return None


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def require_auth(view_func):
    """
    Decorator for any route that needs a logged-in user.
    Reads "Authorization: Bearer <token>", looks it up in the sessions
    table, and stashes the owning user_id on `g.user_id` for the view to use.
    """
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "missing or malformed Authorization header"}), 401

        token = auth_header[len("Bearer "):].strip()
        db = get_db()
        session_row = db.execute(
            "SELECT user_id FROM sessions WHERE token = ?", (token,)
        ).fetchone()

        if session_row is None:
            return jsonify({"error": "invalid or expired session"}), 401

        g.user_id = session_row["user_id"]
        g.token = token
        return view_func(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if len(username) < MIN_USERNAME_LEN:
        return jsonify({"error": f"username must be at least {MIN_USERNAME_LEN} characters"}), 400

    policy_error = password_policy_error(password)
    if policy_error is not None:
        return jsonify({"error": policy_error}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing is not None:
        return jsonify({"error": "username already taken"}), 409

    # generate_password_hash salts automatically (a random salt per call),
    # so two users with the same password get different stored hashes --
    # this defeats precomputed rainbow-table attacks. See explanation below.
    hashed = generate_password_hash(password)
    cursor = db.execute(
        "INSERT INTO users (username, password) VALUES (?, ?)", (username, hashed)
    )
    db.commit()
    return jsonify({"id": cursor.lastrowid, "username": username}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    # Deliberately the SAME error message and status for "no such user" and
    # "wrong password" -- a different message for each would let an
    # attacker enumerate valid usernames just by watching which error comes
    # back, one login attempt at a time.
    if user is None or not check_password_hash(user["password"], password):
        return jsonify({"error": "invalid username or password"}), 401

    token = secrets.token_hex(32)  # 256 bits of randomness, not guessable
    db.execute(
        "INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"])
    )
    db.commit()
    return jsonify({"token": token, "username": user["username"]}), 200


@app.route("/api/logout", methods=["POST"])
@require_auth
def logout():
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (g.token,))
    db.commit()
    return jsonify({"message": "logged out"}), 200


# ---------------------------------------------------------------------------
# Task routes -- all scoped to g.user_id via require_auth
# ---------------------------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
@require_auth
def get_tasks():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC", (g.user_id,)
    ).fetchall()
    return jsonify([row_to_task(r) for r in rows]), 200


@app.route("/api/tasks", methods=["POST"])
@require_auth
def create_task():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    priority = data.get("priority", "Medium")

    if not title:
        return jsonify({"error": "title is required and cannot be empty"}), 400
    if priority not in VALID_PRIORITIES:
        return jsonify({"error": f"priority must be one of {sorted(VALID_PRIORITIES)}"}), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO tasks (title, priority, completed, user_id) VALUES (?, ?, 0, ?)",
        (title, priority, g.user_id),
    )
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(row_to_task(new_row)), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
@require_auth
def update_task(task_id):
    db = get_db()
    # The WHERE clause includes user_id, not just id. If the task exists
    # but belongs to someone else, this returns None -- identical to it not
    # existing at all. We deliberately return the same 404 either way so a
    # user can't probe which task IDs belong to other people.
    existing = db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, g.user_id)
    ).fetchone()
    if existing is None:
        return jsonify({"error": f"task {task_id} not found"}), 404

    data = request.get_json(silent=True) or {}
    title = data.get("title", existing["title"])
    priority = data.get("priority", existing["priority"])
    completed = data.get("completed", bool(existing["completed"]))

    if not str(title).strip():
        return jsonify({"error": "title cannot be empty"}), 400
    if priority not in VALID_PRIORITIES:
        return jsonify({"error": f"priority must be one of {sorted(VALID_PRIORITIES)}"}), 400

    db.execute(
        "UPDATE tasks SET title = ?, priority = ?, completed = ? WHERE id = ? AND user_id = ?",
        (str(title).strip(), priority, int(bool(completed)), task_id, g.user_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify(row_to_task(updated)), 200


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@require_auth
def delete_task(task_id):
    db = get_db()
    existing = db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, g.user_id)
    ).fetchone()
    if existing is None:
        return jsonify({"error": f"task {task_id} not found"}), 404

    db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, g.user_id))
    db.commit()
    return jsonify({"message": f"task {task_id} deleted"}), 200


if __name__ == "__main__":
    init_db()
    # Port 5000 is reserved by macOS's AirPlay Receiver (ControlCenter)
    # since Monterey, and requests can be silently routed to it instead of
    # this server. Using 5001 avoids that conflict entirely, on any OS.
    app.run(debug=True, port=5001)