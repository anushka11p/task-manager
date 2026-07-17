import { useState, useEffect } from "react";
import "./App.css";

const PRIORITIES = ["Low", "Medium", "High"];
const STATUS_FILTERS = ["All", "Active", "Completed"];
const PRIORITY_FILTERS = ["All", "High", "Medium", "Low"];

const API_BASE = "http://localhost:5001/api";

function formatDate(isoString) {
  const normalized = isoString.includes("T") ? isoString : isoString.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Auth screens
// ---------------------------------------------------------------------------

function AuthForm({ mode, onSuccess, onSwitchMode }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const endpoint = isRegister ? "register" : "login";
      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `${endpoint} failed (${res.status})`);

      if (isRegister) {
        // Registration succeeded but doesn't return a session token by
        // design (register and login are separate concerns) -- log them
        // in immediately behind the scenes so it feels like one step.
        const loginRes = await fetch(`${API_BASE}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: username.trim(), password }),
        });
        const loginBody = await loginRes.json().catch(() => ({}));
        if (!loginRes.ok) throw new Error(loginBody.error || "auto-login after register failed");
        onSuccess(loginBody.token, loginBody.username);
      } else {
        onSuccess(body.token, body.username);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="logo auth-logo">
          <span className="logo-icon">✓</span>
          <span className="logo-text">TaskFlow</span>
        </div>
        <h2 className="auth-title">{isRegister ? "Create an account" : "Welcome back"}</h2>

        <label className="auth-label">
          Username
          <input
            className="task-input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="auth-label">
          Password
          <input
            className="task-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
          />
        </label>

        {error && <p className="error-msg" role="alert">{error}</p>}

        <button className="add-btn auth-submit" type="submit" disabled={submitting}>
          {submitting ? "Please wait…" : isRegister ? "Register" : "Log in"}
        </button>

        <p className="auth-switch">
          {isRegister ? "Already have an account?" : "Need an account?"}{" "}
          <button type="button" className="auth-switch-btn" onClick={onSwitchMode}>
            {isRegister ? "Log in" : "Register"}
          </button>
        </p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main task app (shown only once logged in)
// ---------------------------------------------------------------------------

function TaskApp({ token, username, onLogout }) {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("Medium");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any task call can come back 401 if the token expired or was revoked
  // (e.g. logged out in another tab). Centralize that handling so every
  // call site doesn't need to repeat it.
  async function handleAuthedResponse(res) {
    if (res.status === 401) {
      onLogout(); // force back to login; the stored token is no longer valid
      throw new Error("Session expired. Please log in again.");
    }
    return res;
  }

  async function fetchTasks() {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/tasks`, { headers: authHeaders });
      await handleAuthedResponse(res);
      if (!res.ok) throw new Error(`GET /api/tasks failed (${res.status})`);
      setTasks(await res.json());
      setError("");
    } catch (err) {
      setError(err.message.includes("Session expired") ? "" : "Could not reach the server. Is the Flask backend running on port 5001?");
    } finally {
      setLoading(false);
    }
  }

  async function addTask() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("Task title can't be empty.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title: trimmed, priority }),
      });
      await handleAuthedResponse(res);
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

  async function toggleComplete(task) {
    const previous = tasks;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, completed: !t.completed } : t)));
    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ completed: !task.completed }),
      });
      await handleAuthedResponse(res);
      if (!res.ok) throw new Error(`PUT /api/tasks/${task.id} failed (${res.status})`);
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)));
    } catch (err) {
      setTasks(previous);
      setError(err.message);
    }
  }

  async function deleteTask(id, taskTitle) {
    if (!window.confirm(`Delete "${taskTitle}"?`)) return;
    const previous = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, { method: "DELETE", headers: authHeaders });
      await handleAuthedResponse(res);
      if (!res.ok) throw new Error(`DELETE /api/tasks/${id} failed (${res.status})`);
    } catch (err) {
      setTasks(previous);
      setError(err.message);
    }
  }

  const filtered = tasks.filter((t) => {
    const statusOk = statusFilter === "All" ? true : statusFilter === "Active" ? !t.completed : t.completed;
    const priorityOk = priorityFilter === "All" ? true : t.priority === priorityFilter;
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
          <div className="header-right">
            <span className="header-sub">{counts.Active} task{counts.Active !== 1 ? "s" : ""} remaining</span>
            <span className="header-user">👤 {username}</span>
            <button className="logout-btn" onClick={onLogout}>Log out</button>
          </div>
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
            <select className="priority-select" value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="add-btn" onClick={addTask}>+ Add</button>
          </div>
        </section>

        <section className="filters-section">
          <div className="filter-group">
            <span className="filter-label">Status</span>
            <div className="filter-pills">
              {STATUS_FILTERS.map((f) => (
                <button key={f} className={`pill ${statusFilter === f ? "pill--active" : ""}`} onClick={() => setStatusFilter(f)}>
                  {f}<span className="pill-count">{f === "All" ? counts.All : counts[f]}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">Priority</span>
            <div className="filter-pills">
              {PRIORITY_FILTERS.map((f) => (
                <button key={f} className={`pill ${priorityFilter === f ? "pill--active" : ""}`} onClick={() => setPriorityFilter(f)}>{f}</button>
              ))}
            </div>
          </div>
        </section>

        <section className="task-list-section">
          {loading ? (
            <div className="empty-state"><p className="empty-title">Loading tasks…</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📋</span>
              <p className="empty-title">{tasks.length === 0 ? "No tasks yet" : "No tasks match your filters"}</p>
              <p className="empty-sub">{tasks.length === 0 ? "Add your first task above to get started." : "Try changing the status or priority filter."}</p>
            </div>
          ) : (
            <ul className="task-list">
              {filtered.map((task) => (
                <li key={task.id} className={`task-card priority-${task.priority.toLowerCase()} ${task.completed ? "task-card--done" : ""}`}>
                  <button className={`check-btn ${task.completed ? "check-btn--checked" : ""}`} onClick={() => toggleComplete(task)} aria-label={task.completed ? "Mark as active" : "Mark as complete"}>
                    {task.completed && <span>✓</span>}
                  </button>
                  <div className="task-body">
                    <p className="task-title">{task.title}</p>
                    <div className="task-meta">
                      <span className={`badge badge--${task.priority.toLowerCase()}`}>{task.priority}</span>
                      <span className="task-date">{formatDate(task.created_at)}</span>
                      <span className={`task-status ${task.completed ? "task-status--done" : "task-status--active"}`}>{task.completed ? "Completed" : "Active"}</span>
                    </div>
                  </div>
                  <button className="delete-btn" onClick={() => deleteTask(task.id, task.title)} aria-label={`Delete ${task.title}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {tasks.length > 0 && <div className="summary">{counts.Completed} of {counts.All} tasks completed</div>}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root component: decides auth screen vs. task app, owns the token
// ---------------------------------------------------------------------------

export default function App() {
  // Session persists across refresh because the token is read from
  // localStorage on first render. Only the token/username live here --
  // task data itself is never cached client-side, only fetched live.
  const [token, setToken] = useState(() => localStorage.getItem("taskflow_token"));
  const [username, setUsername] = useState(() => localStorage.getItem("taskflow_username"));
  const [authMode, setAuthMode] = useState("login");

  function handleAuthSuccess(newToken, newUsername) {
    localStorage.setItem("taskflow_token", newToken);
    localStorage.setItem("taskflow_username", newUsername);
    setToken(newToken);
    setUsername(newUsername);
  }

  async function handleLogout() {
    // Best-effort: tell the server to invalidate the session row. Even if
    // this fails (server down, network drop), we still clear local state --
    // the user's intent to log out locally should never be blocked by a
    // network call.
    try {
      await fetch(`${API_BASE}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // ignored deliberately -- see comment above
    }
    localStorage.removeItem("taskflow_token");
    localStorage.removeItem("taskflow_username");
    setToken(null);
    setUsername(null);
    setAuthMode("login");
  }

  if (!token) {
    return (
      <AuthForm
        mode={authMode}
        onSuccess={handleAuthSuccess}
        onSwitchMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))}
      />
    );
  }

  return <TaskApp token={token} username={username} onLogout={handleLogout} />;
}