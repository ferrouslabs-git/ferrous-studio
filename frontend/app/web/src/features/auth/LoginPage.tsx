import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authService } from "../../core/auth";

/** sessionStorage key holding an invitation token across the hosted-UI round trip. */
export const PENDING_INVITE_KEY = "ferrous-pending-invite";

export function LoginPage() {
  const onSignIn = () => {
    window.location.href = authService.getLoginUrl();
  };

  const onSignUp = () => {
    window.location.href = authService.getSignupUrl();
  };

  const onForgot = () => {
    window.location.href = authService.getForgotPasswordUrl();
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Sign in</h1>
        <p>Sign in to your Ferrous Studio account.</p>
        <button className="btn primary" onClick={onSignIn}>
          Sign in
        </button>
        <button className="btn" onClick={onSignUp}>
          Create account
        </button>
        <button className="btn" onClick={onForgot}>
          Forgot password
        </button>
      </div>
    </div>
  );
}

export function ForgotPasswordPage() {
  const onForgot = () => {
    window.location.href = authService.getForgotPasswordUrl();
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Forgot password</h1>
        <p>Open the AWS hosted flow to receive your reset code and set a new password.</p>
        <button className="btn primary" onClick={onForgot}>
          Open reset flow
        </button>
        <Link to="/signin" className="auth-link">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const error = params.get("error");

      if (error || !code) {
        if (error) console.error("Auth error:", error);
        navigate("/signin");
        return;
      }

      try {
        await authService.handleCallback(code);
        await authService.fetchUserInfo();
        // An invitation link opened while signed out stashes its token so the
        // user lands back on it after the hosted-UI round trip.
        const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
        if (pendingInvite) {
          sessionStorage.removeItem(PENDING_INVITE_KEY);
          navigate(`/invite/${pendingInvite}`);
          return;
        }
        navigate("/orgs");
      } catch (err) {
        console.error("Callback error:", err);
        navigate("/signin");
      }
    };

    run();
  }, [navigate]);

  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      <h1>Completing sign-in…</h1>
      <p>Please wait while we complete your sign-in process.</p>
    </div>
  );
}
