import { useState, useEffect } from "react";
import "./App.css";

const PRIORITIES = ["Low", "Medium", "High"];
const STATUS_FILTERS = ["All", "Active", "Completed"];
const PRIORITY_FILTERS = ["All", "High", "Medium", "Low"];

// Base URL of the Flask API. Port 5001, not 5000 — macOS's AirPlay
// Receiver squats on 5000 by default and can silently intercept requests.
// Change this if the backend runs on a different host/port (e.g. deployed).
const API_BASE = "http://localhost:5001/api/tasks";

function formatDate(isoString) {
  // SQLite's CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" (UTC, no "Z"),
  // which Safari/older engines can fail to parse. Normalizing to ISO-8601
  // first makes the date parse reliably everywhere.
  const normalized = isoString.includes("T") ? isoString : isoString.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // ---- Load all tasks from the backend on first render ----
  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    try {
      setLoading(true);
      const res = await fetch(API_BASE);
      if (!res.ok) throw new Error(`GET /api/tasks failed (${res.status})`);
      const data = await res.json();
      setTasks(data);
      setError("");
    } catch (err) {
      setError("Could not reach the server. Is the Flask backend running on port 5000?");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // ---- Create ----
  async function addTask() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Task title can't be empty.");
      return;
    }
    try {
      const res = await fetch(API_BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, priority }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `POST /api/tasks failed (${res.status})`);
      }
      const newTask = await res.json();
      setTasks((prev) => [newTask, ...prev]);
      setTitle("");
      setPriority("Medium");
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  // ---- Update (toggle complete) ----
  async function toggleComplete(task) {
    // Optimistic update so the UI feels instant; rolled back on failure.
    const previous = tasks;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t))
    );
    try {
      const res = await fetch(`${API_BASE}/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !task.completed }),
      });
      if (!res.ok) throw new Error(`PUT /api/tasks/${task.id} failed (${res.status})`);
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setTasks(previous); // rollback
      setError(err.message);
    }
  }

  // ---- Delete ----
  async function deleteTask(id, taskTitle) {
    if (!window.confirm(`Delete "${taskTitle}"?`)) return;
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id)); // optimistic
    try {
      const res = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`DELETE /api/tasks/${id} failed (${res.status})`);
    } catch (err) {
      setTasks(previous); // rollback
      setError(err.message);
    }
  }

  const filtered = tasks.filter((t) => {
    const statusOk =
      statusFilter === "All" ? true : statusFilter === "Active" ? !t.completed : t.completed;
    const priorityOk =
      priorityFilter === "All" ? true : t.priority === priorityFilter;
    return statusOk && priorityOk;
  });

  const counts = {
    All: tasks.length,
    Active: tasks.filter((t) => !t.completed).length,
    Completed: tasks.filter((t) => t.completed).length,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">✓</span>
            <span className="logo-text">TaskFlow</span>
          </div>
          <span className="header-sub">{counts.Active} task{counts.Active !== 1 ? "s" : ""} remaining</span>
        </div>
      </header>

      <main className="main">
        <section className="add-section">
          <div className="add-row">
            <div className="input-wrap">
              <input
                className="task-input"
                type="text"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && addTask()}
                aria-label="Task title"
              />
              {error && <p className="error-msg" role="alert">{error}</p>}
            </div>
            <select
              className="priority-select"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button className="add-btn" onClick={addTask}>+ Add</button>
          </div>
        </section>

        <section className="filters-section">
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <div className="filter-pills">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`pill ${statusFilter === f ? "pill--active" : ""}`}
                  onClick={() => setStatusFilter(f)}
                >
                  {f}
                  <span className="pill-count">{f === "All" ? counts.All : counts[f]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Priority</span>
            <div className="filter-pills">
              {PRIORITY_FILTERS.map((f) => (
                <button
                  key={f}
                  className={`pill ${priorityFilter === f ? "pill--active" : ""}`}
                  onClick={() => setPriorityFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="task-list-section">
          {loading ? (
            <div className="empty-state">
              <p className="empty-title">Loading tasks…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📋</span>
              <p className="empty-title">
                {tasks.length === 0 ? "No tasks yet" : "No tasks match your filters"}
              </p>
              <p className="empty-sub">
                {tasks.length === 0
                  ? "Add your first task above to get started."
                  : "Try changing the status or priority filter."}
              </p>
            </div>
          ) : (
            <ul className="task-list">
              {filtered.map((task) => (
                <li
                  key={task.id}
                  className={`task-card priority-${task.priority.toLowerCase()} ${task.completed ? "task-card--done" : ""}`}
                >
                  <button
                    className={`check-btn ${task.completed ? "check-btn--checked" : ""}`}
                    onClick={() => toggleComplete(task)}
                    aria-label={task.completed ? "Mark as active" : "Mark as complete"}
                  >
                    {task.completed && <span>✓</span>}
                  </button>

                  <div className="task-body">
                    <p className="task-title">{task.title}</p>
                    <div className="task-meta">
                      <span className={`badge badge--${task.priority.toLowerCase()}`}>
                        {task.priority}
                      </span>
                      <span className="task-date">{formatDate(task.created_at)}</span>
                      <span className={`task-status ${task.completed ? "task-status--done" : "task-status--active"}`}>
                        {task.completed ? "Completed" : "Active"}
                      </span>
                    </div>
                  </div>

                  <button
                    className="delete-btn"
                    onClick={() => deleteTask(task.id, task.title)}
                    aria-label={`Delete ${task.title}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {tasks.length > 0 && (
          <div className="summary">{counts.Completed} of {counts.All} tasks completed</div>
        )}
      </main>
    </div>
  );
}