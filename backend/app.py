"""
Task Manager Backend
---------------------
Flask + SQLite REST API replacing the old localStorage persistence layer.

Endpoints:
    GET    /api/tasks       -> list all tasks
    POST   /api/tasks       -> create a task           body: {title, priority}
    PUT    /api/tasks/<id>  -> update a task            body: {completed?, priority?, title?}
    DELETE /api/tasks/<id>  -> delete a task

Run:
    pip3 install flask flask-cors
    python3 app.py
    -> server listens on http://localhost:5000
"""

import os
import sqlite3
from contextlib import contextmanager

from flask import Flask, g, jsonify, request
from flask_cors import CORS

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.db")
VALID_PRIORITIES = {"Low", "Medium", "High"}

app = Flask(__name__)
CORS(app)  # allow the React dev server (different origin/port) to call this API


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    """
    Return a request-scoped SQLite connection.
    Flask's `g` object lives for exactly one request, so this avoids opening
    a fresh connection on every query while still being thread-safe across
    concurrent requests (each request gets its own `g`).
    """
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
    """Create the tasks table if it doesn't already exist. Idempotent."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            priority TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/tasks", methods=["GET"])
def get_tasks():
    db = get_db()
    rows = db.execute("SELECT * FROM tasks ORDER BY id DESC").fetchall()
    return jsonify([row_to_task(r) for r in rows]), 200


@app.route("/api/tasks", methods=["POST"])
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
        "INSERT INTO tasks (title, priority, completed) VALUES (?, ?, 0)",
        (title, priority),
    )
    db.commit()
    new_row = db.execute("SELECT * FROM tasks WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(row_to_task(new_row)), 201


@app.route("/api/tasks/<int:task_id>", methods=["PUT"])
def update_task(task_id):
    db = get_db()
    existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if existing is None:
        return jsonify({"error": f"task {task_id} not found"}), 404

    data = request.get_json(silent=True) or {}

    # Only touch fields that were actually sent, so PUT can be used for a
    # partial update (e.g. just toggling `completed`, or just `priority`).
    title = data.get("title", existing["title"])
    priority = data.get("priority", existing["priority"])
    completed = data.get("completed", bool(existing["completed"]))

    if not str(title).strip():
        return jsonify({"error": "title cannot be empty"}), 400
    if priority not in VALID_PRIORITIES:
        return jsonify({"error": f"priority must be one of {sorted(VALID_PRIORITIES)}"}), 400

    db.execute(
        "UPDATE tasks SET title = ?, priority = ?, completed = ? WHERE id = ?",
        (str(title).strip(), priority, int(bool(completed)), task_id),
    )
    db.commit()
    updated = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return jsonify(row_to_task(updated)), 200


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
def delete_task(task_id):
    db = get_db()
    existing = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if existing is None:
        return jsonify({"error": f"task {task_id} not found"}), 404

    db.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    db.commit()
    return jsonify({"message": f"task {task_id} deleted"}), 200


if __name__ == "__main__":
    init_db()
    # NOTE: port 5000 is reserved by macOS's AirPlay Receiver (ControlCenter)
    # since Monterey, and requests can be silently routed to it instead of
    # this server. Using 5001 avoids that conflict entirely, on any OS.
    app.run(debug=True, port=5001)