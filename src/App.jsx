import { useState, useEffect } from "react";
import "./App.css";

const PRIORITIES = ["Low", "Medium", "High"];
const STATUS_FILTERS = ["All", "Active", "Completed"];
const PRIORITY_FILTERS = ["All", "High", "Medium", "Low"];

const API_BASE = "http://localhost:5001/api";
const SPECIAL_CHARS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

function formatDate(isoString) {
  const normalized = isoString.includes("T") ? isoString : isoString.replace(" ", "T") + "Z";
  return new Date(normalized).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Password strength -- mirrors the backend's password_policy_error exactly,
// so what the UI allows is what the server will actually accept. This is
// UX only, though: the server re-checks independently and is the real gate,
// since anyone can bypass client-side JS entirely.
// ---------------------------------------------------------------------------

function evaluatePassword(password) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: SPECIAL_CHARS.test(password),
  };
  const passedCount = Object.values(checks).filter(Boolean).length;
  const isStrong = Object.values(checks).every(Boolean);
  const isMedium = !isStrong && checks.length && passedCount >= 3;
  const level = isStrong ? "strong" : isMedium ? "medium" : "weak";
  return { checks, level, isStrong };
}

function PasswordStrengthMeter({ password }) {
  if (!password) return null;
  const { checks, level } = evaluatePassword(password);
  const filledBars = level === "weak" ? 1 : level === "medium" ? 2 : 3;

  const requirements = [
    ["length", "8+ characters"],
    ["uppercase", "1 uppercase letter"],
    ["lowercase", "1 lowercase letter"],
    ["number", "1 number"],
    ["special", "1 special character"],
  ];

  return (
    <div className="pw-strength">
      <div className="pw-strength-bars">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`pw-strength-bar ${i < filledBars ? `pw-strength-bar--filled-${level}` : ""}`}
          />
        ))}
      </div>
      <span className={`pw-strength-label pw-strength-label--${level}`}>
        {level === "strong" ? "Strong password" : level === "medium" ? "Medium strength" : "Weak password"}
      </span>
      <ul className="pw-requirements">
        {requirements.map(([key, label]) => (
          <li key={key} className={checks[key] ? "pw-req--met" : ""}>
            <span className="pw-req-icon">{checks[key] ? "✓" : "○"}</span>{label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Theme toggle -- explicit, user-controlled, persisted. Rendered on every
// screen (auth and task app both) via the root App component below.
// ---------------------------------------------------------------------------

function ThemeToggle({ theme, onToggle }) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
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
  const strength = evaluatePassword(password);
  // Gate registration client-side too, purely for UX (instant feedback,
  // no wasted round trip) -- the server enforces the same rule regardless.
  const canSubmit = !isRegister || strength.isStrong;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (isRegister && !strength.isStrong) {
      setError("Please choose a strong password before registering.");
      return;
    }
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

        {isRegister && <PasswordStrengthMeter password={password} />}

        {error && <p className="error-msg" role="alert">{error}</p>}

        <button className="add-btn auth-submit" type="submit" disabled={submitting || !canSubmit}>
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

  async function handleAuthedResponse(res) {
    if (res.status === 401) {
      onLogout();
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
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("taskflow_token"));
  const [username, setUsername] = useState(() => localStorage.getItem("taskflow_username"));
  const [authMode, setAuthMode] = useState("login");
  const [theme, setTheme] = useState(() => localStorage.getItem("taskflow_theme") || "light");

  // Applied to <html>, not <body> -- keeps it above everything, including
  // the fixed-position theme toggle button itself, with no cascade surprises.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("taskflow_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  function handleAuthSuccess(newToken, newUsername) {
    localStorage.setItem("taskflow_token", newToken);
    localStorage.setItem("taskflow_username", newUsername);
    setToken(newToken);
    setUsername(newUsername);
  }

  async function handleLogout() {
    try {
      await fetch(`${API_BASE}/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort server-side invalidation -- local logout must still
      // succeed even if the network call fails.
    }
    localStorage.removeItem("taskflow_token");
    localStorage.removeItem("taskflow_username");
    setToken(null);
    setUsername(null);
    setAuthMode("login");
  }

  return (
    <>
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      {!token ? (
        <AuthForm
          mode={authMode}
          onSuccess={handleAuthSuccess}
          onSwitchMode={() => setAuthMode((m) => (m === "login" ? "register" : "login"))}
        />
      ) : (
        <TaskApp token={token} username={username} onLogout={handleLogout} />
      )}
    </>
  );
}