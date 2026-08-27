import { useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { isAuthenticated, setAuthSession } from "../auth";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", { username, password });
      setAuthSession(data.token, data.user);
      const state = location.state as { from?: string } | null;
      navigate(state?.from || "/", { replace: true });
    } catch (err: unknown) {
      const message = isAxiosError<{ error?: unknown }>(err) ? err.response?.data?.error : undefined;
      setError(typeof message === "string" && message ? message : "Credenziali non valide");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Accesso Idromardi</h1>
          <p className="mt-1 text-sm text-slate-500">Inserisci le credenziali operatore.</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Username
        </label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="mb-4 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          autoComplete="username"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
          Password
        </label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          className="mb-5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          autoComplete="current-password"
          autoFocus
        />

        <button
          type="submit"
          disabled={loading}
          className="h-11 w-full rounded-xl bg-blue-600 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {loading ? "Accesso..." : "Accedi"}
        </button>
        <p className="mt-5 text-center text-xs text-slate-500">
          <a href="/privacy" className="rounded underline underline-offset-4 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">
            Informativa sulla privacy
          </a>
        </p>
      </form>
    </div>
  );
}
