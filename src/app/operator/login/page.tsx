"use client";

/**
 * /operator/login — Operator Login Page
 *
 * Minimal single-passphrase login for internal operator access.
 * Not a user account system — just an access gate.
 *
 * On success, redirects to the sanitized `from` query param or `/jobs`.
 * Open-redirect prevention: only accepts relative paths starting with
 * a single `/`. Rejects protocol-relative URLs, absolute URLs, and
 * any suspicious values.
 */

import { useState } from "react";

function sanitizeRedirect(from: string | null): string {
  if (!from) return "/jobs";
  // Must start with exactly one /
  if (!from.startsWith("/")) return "/jobs";
  // Reject protocol-relative URLs (//...)
  if (from.startsWith("//")) return "/jobs";
  return from;
}

export default function OperatorLoginPage() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/operator/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Login failed.");
        setLoading(false);
        return;
      }

      const from = new URLSearchParams(window.location.search).get("from");
      window.location.href = sanitizeRedirect(from);
    } catch {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Operator Access</h1>
      <p className="operator-login-intro">
        Enter the operator passphrase to access internal stamping operations.
      </p>

      <form onSubmit={handleSubmit} className="operator-login-form">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Operator passphrase"
          disabled={loading}
          className="operator-login-input"
          autoFocus
        />
        <button type="submit" disabled={loading || !passphrase.trim()}>
          {loading ? "Signing in\u2026" : "Sign In"}
        </button>
      </form>

      {error && <p className="field-error" style={{ marginTop: 12 }}>{error}</p>}
    </main>
  );
}
