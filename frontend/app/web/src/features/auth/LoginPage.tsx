// The app's own sign-in and password-reset pages. Email + password go to the
// backend (/api/um/custom/login), which signs in against Cognito server-side
// and returns the same tokens the hosted UI would have -- so nothing
// downstream changes, and the user never leaves our domain or sees the
// amazoncognito.com page. Accounts are created by invitation only
// (features/onboarding/InvitePage.tsx), so there is no sign-up form here.
import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { authService } from "../../core/auth";
import { errorMessage } from "../../core/api";
import { confirmForgotPassword, customLogin, forgotPassword } from "../../core/umApi";
import { useSession } from "../../app/session";

/** sessionStorage key holding an invitation token across a sign-in. */
export const PENDING_INVITE_KEY = "ferrous-pending-invite";

/** Where to send someone who has just signed in. */
function landingPath(from?: string | null): string {
  const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
  if (pendingInvite) {
    sessionStorage.removeItem(PENDING_INVITE_KEY);
    return `/invite/${pendingInvite}`;
  }
  if (from && from !== "/signin" && !from.startsWith("/auth/")) return from;
  // Super admins administer the platform rather than belonging to an
  // organisation, so their home is the admin area.
  return authService.isPlatformAdmin() ? "/admin/orgs" : "/orgs";
}

function AuthMark() {
  return (
    <div className="auth-mark">
      <span className="brand-symbol" aria-hidden="true" />
      <span>Ferrous Studio</span>
    </div>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (e.g. pressed back after login): skip the form.
  useEffect(() => {
    if (session.status === "ready") navigate(landingPath(), { replace: true });
  }, [session.status, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await customLogin(email.trim(), password);
      await authService.completeSignIn(tokens, { sync: true });
      await session.refresh();
      const from = (location.state as { from?: string } | null)?.from;
      navigate(landingPath(from), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <AuthMark />
        <p className="auth-eyebrow">Sign in</p>
        <h1>Welcome back.</h1>
        <p>Sign in with the email address you were invited with.</p>
        <div className="field stacked">
          <label htmlFor="signin-email">Email</label>
          <input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        <div className="field stacked">
          <label htmlFor="signin-password">Password</label>
          <input
            id="signin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !email.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <Link to="/forgot-password" className="auth-link">
          Forgot password
        </Link>
      </form>
    </div>
  );
}

/** Two steps: request a reset code by email, then enter the code with a new
 * password. Cognito emails the code; the backend never learns whether the
 * address exists. */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"request" | "confirm" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await forgotPassword(email.trim());
      setStep("confirm");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await confirmForgotPassword(email.trim(), code.trim(), password);
      setStep("done");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === "done") {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <AuthMark />
          <p className="auth-eyebrow">Password reset</p>
          <h1>Your password has been changed.</h1>
          <p>Sign in with your new password to continue.</p>
          <button className="btn primary" onClick={() => navigate("/signin")}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  if (step === "confirm") {
    return (
      <div className="auth-wrap">
        <form className="auth-card" onSubmit={(e) => void confirm(e)}>
          <AuthMark />
          <p className="auth-eyebrow">Password reset</p>
          <h1>Check your email.</h1>
          <p>
            If <b>{email}</b> has an account, a reset code is on its way. Enter it below with your new
            password.
          </p>
          <div className="field stacked">
            <label htmlFor="reset-code">Reset code</label>
            <input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field stacked">
            <label htmlFor="reset-password">New password</label>
            <input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            At least 8 characters with upper- and lower-case letters and a number.
          </p>
          {error && <p className="error">{error}</p>}
          <button className="btn primary" disabled={busy || !code.trim() || !password}>
            {busy ? "Saving…" : "Set new password"}
          </button>
          <button type="button" className="auth-link btn-link" onClick={() => setStep("request")}>
            Send a new code
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={(e) => void request(e)}>
        <AuthMark />
        <p className="auth-eyebrow">Password reset</p>
        <h1>Forgot your password?</h1>
        <p>Enter your email address and we will send you a reset code.</p>
        <div className="field stacked">
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Send reset code"}
        </button>
        <Link to="/signin" className="auth-link">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}

/** Legacy hosted-UI return leg (/auth/callback?code=...). Kept so any
 * bookmarked or in-flight hosted-UI sign-in still completes. */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  // An authorisation code is single-use. React StrictMode runs effects twice
  // in development, and a second exchange not only fails (invalid_grant) but
  // revokes the tokens the first one issued -- so exchange each code once.
  const handledCode = useRef<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error");
      if (code && handledCode.current === code) return;
      handledCode.current = code;

      if (error || !code) {
        if (error) console.error("Auth error:", error);
        navigate("/signin");
        return;
      }

      try {
        await authService.handleCallback(code);
        await authService.fetchUserInfo();
        // SessionProvider loaded once on mount, before the tokens existed, and
        // settled as anonymous -- reload it now or the guarded routes bounce
        // straight back to /signin.
        await refresh();
        navigate(landingPath());
      } catch (err) {
        console.error("Callback error:", err);
        navigate("/signin");
      }
    };

    run();
  }, [navigate, refresh]);

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <AuthMark />
        <h1>Completing sign-in…</h1>
        <p>Please wait while we complete your sign-in.</p>
      </div>
    </div>
  );
}
