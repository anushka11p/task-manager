import { useState, useEffect } from "react";
import "./App.css";

const PRIORITIES = ["Low", "Medium", "High"];
const STATUS_FILTERS = ["All", "Active", "Completed"];
const PRIORITY_FILTERS = ["All", "High", "Medium", "Low"];

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export default function App() {
  const [tasks, setTasks] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("tasks")) || [];
    } catch {
      return [];
    }
  });
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [error, setError] = useState("");

  useEffect(() => {
    localStorage.setItem("tasks", JSON.stringify(tasks));
  }, [tasks]);

  function addTask() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Task title can't be empty.");
      return;
    }
    setError("");
    setTasks((prev) => [
      {
        id: generateId(),
        title: trimmed,
        priority,
        completed: false,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setTitle("");
    setPriority("Medium");
  }

  function toggleComplete(id) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  }

  function deleteTask(id, title) {
    if (window.confirm(`Delete "${title}"?`)) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
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
          {filtered.length === 0 ? (
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
                    onClick={() => toggleComplete(task.id)}
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
                      <span className="task-date">{formatDate(task.createdAt)}</span>
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