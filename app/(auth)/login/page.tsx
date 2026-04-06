"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(result.error === "CredentialsSignin" 
          ? "Invalid email or password" 
          : result.error);
        setLoading(false);
        return;
      }

      // Fetch the session to determine redirect
      const res = await fetch("/api/auth/session");
      const session = await res.json();
      
      if (session?.user?.role === "SUPER_ADMIN" || session?.user?.role === "OPS_VIEWER") {
        router.push("/ops/dashboard");
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch {
      setError("An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg-app flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-accent/10 rounded-lg mb-4">
            <span className="text-accent font-bold text-lg">SG</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">SAFEGUARD</h1>
          <p className="text-sm text-text-muted mt-1">School Security Platform</p>
        </div>

        {/* Login Card */}
        <div className="bg-bg-panel border border-border rounded-card p-6">
          <h2 className="text-sm font-medium text-text-secondary mb-6">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 bg-status-alert/10 border border-status-alert/20 rounded-md">
              <p className="text-sm text-status-alert">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-text-muted mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2 bg-bg-app border border-border rounded-md text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors"
                placeholder="you@school.edu"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-text-muted mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 bg-bg-app border border-border rounded-md text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-colors"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                "Sign in"
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-2xs text-text-muted mt-6">
          Infoiles Security © 2026
        </p>
      </div>
    </div>
  );
}
