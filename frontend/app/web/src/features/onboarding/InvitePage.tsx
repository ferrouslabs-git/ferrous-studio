// Invitation landing: /invite/:token — the page the emailed link opens.
//
// Public, so the preview loads while signed out. A signed-out visitor sees a
// sign-up form -- email (prefilled, fixed), set password, confirm password.
// Submitting creates the account (or, for an address that already has one,
// sets its password: the emailed link proves ownership just like a reset
// link), signs the user in and joins the organisation in one backend call.
// A visitor already signed in as the invited address just accepts.
//
// A super admin invitation has no organisation (tenant fields null):
// accepting it grants platform admin access and lands on the admin pages.
import { FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { authService } from "../../core/auth";
import { acceptInvite, completeInvite, getInvitePreview, InvitePreview } from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { PENDING_INVITE_KEY } from "../auth/LoginPage";
import { RoleName } from "../orgs/roleLabels";

/** Mirrors the Cognito pool password policy (infra/terraform/cognito.tf) so
 * the user hears about a weak password before the round trip, not after. */
/** Where to go once accepted: into the organisation, or, for a super admin
 * invitation (no organisation), to the platform admin pages. */
function landingFor(tenantId: string | null): string {
  return tenantId ? `/orgs/${tenantId}/projects` : "/admin/orgs";
}

function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Include a lower-case letter.";
  if (!/[A-Z]/.test(password)) return "Include an upper-case letter.";
  if (!/[0-9]/.test(password)) return "Include a number.";
  return null;
}

export function InvitePage() {
  const { token = "" } = useParams();
  const preview = useLoad(() => getInvitePreview(token), [token]);
  const session = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const switchAccountThenReturn = () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
    void authService.switchAccount();
  };

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptInvite(token);
      await session.refresh();
      navigate(landingFor(result.tenant_id));
    } catch (err) {
      setError(errorMessage(err));
      setAccepting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {preview.loading ? (
          <p>Checking invitation…</p>
        ) : preview.error || !preview.data ? (
          <>
            <h1>Invitation not found</h1>
            <p>{preview.error ?? "This link is not valid."}</p>
          </>
        ) : preview.data.is_accepted ? (
          <>
            <h1>Already accepted</h1>
            <p>This invitation{preview.data.tenant_name ? ` to ${preview.data.tenant_name}` : ""} has already been used.</p>
          </>
        ) : preview.data.is_expired || preview.data.status !== "pending" ? (
          <>
            <h1>Invitation {preview.data.status}</h1>
            <p>Ask the person who invited you to send a new one.</p>
          </>
        ) : (
          <>
            <h1>{preview.data.tenant_name ? `Join ${preview.data.tenant_name}` : "Become a super admin"}</h1>
            <p>
              You have been invited as{" "}
              <b>
                {!preview.data.tenant_name ? (
                  "Super admin"
                ) : preview.data.role ? (
                  <RoleName name={preview.data.role} />
                ) : (
                  "a member"
                )}
              </b>{" "}
              using the address <b>{preview.data.email}</b>.
            </p>
            {session.status === "loading" ? (
              <p>Loading…</p>
            ) : session.status === "anonymous" ? (
              <SetPasswordForm token={token} preview={preview.data} />
            ) : session.user?.email.toLowerCase() !== preview.data.email.toLowerCase() ? (
              <>
                <p className="error">
                  You are signed in as <b>{session.user?.email}</b>. This invitation can only be accepted by{" "}
                  <b>{preview.data.email}</b>.
                </p>
                <button className="btn primary" onClick={switchAccountThenReturn}>
                  Sign in as {preview.data.email}
                </button>
                <p className="muted" style={{ fontSize: 12 }}>
                  You will be signed out first and brought back here to set a password.
                </p>
              </>
            ) : (
              <button className="btn primary" disabled={accepting} onClick={() => void accept()}>
                Accept invitation
              </button>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** Create the account for a brand-new invitee: email fixed to the invited
 * address, choose a password, then land in the organisation signed in. */
function SetPasswordForm({ token, preview }: { token: string; preview: InvitePreview }) {
  const session = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await completeInvite(token, password);
      await authService.completeSignIn(result);
      await session.refresh();
      navigate(landingFor(result.tenant_id), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)}>
      <p>Set a password for your account to accept the invitation.</p>
      <div className="field stacked">
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" value={preview.email} disabled autoComplete="username" />
      </div>
      <div className="field stacked">
        <label htmlFor="invite-password">Password</label>
        <input
          id="invite-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
        />
      </div>
      <div className="field stacked">
        <label htmlFor="invite-confirm">Confirm</label>
        <input
          id="invite-confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        At least 8 characters with upper- and lower-case letters and a number.
      </p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={submitting || !password || !confirm}>
        {submitting ? "Creating account…" : preview.tenant_name ? "Set password and join" : "Set password and accept"}
      </button>
    </form>
  );
}
