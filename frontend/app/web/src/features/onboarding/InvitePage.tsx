// Invitation landing: /invite/:token. Public so the preview works while
// signed out; accepting needs a session, so a signed-out visitor is sent
// through the hosted sign-in and brought straight back here afterwards.
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSession } from "../../app/session";
import { errorMessage } from "../../core/api";
import { authService } from "../../core/auth";
import { acceptInvite, getInvitePreview } from "../../core/umApi";
import { useLoad } from "../../core/useLoad";
import { PENDING_INVITE_KEY } from "../auth/LoginPage";
import { RoleName } from "../orgs/roleLabels";

export function InvitePage() {
  const { token = "" } = useParams();
  const preview = useLoad(() => getInvitePreview(token), [token]);
  const session = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const signInThenReturn = () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, token);
    window.location.href = authService.getLoginUrl();
  };

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptInvite(token);
      await session.refresh();
      navigate(`/orgs/${result.tenant_id}/projects`);
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
            <p>This invitation to {preview.data.tenant_name} has already been used.</p>
          </>
        ) : preview.data.is_expired || preview.data.status !== "pending" ? (
          <>
            <h1>Invitation {preview.data.status}</h1>
            <p>Ask the person who invited you to send a new one.</p>
          </>
        ) : (
          <>
            <h1>Join {preview.data.tenant_name}</h1>
            <p>
              You have been invited as{" "}
              <b>{preview.data.role ? <RoleName name={preview.data.role} /> : "a member"}</b> using the
              address <b>{preview.data.email}</b>.
            </p>
            {session.status === "loading" ? (
              <p>Loading…</p>
            ) : session.status === "anonymous" ? (
              <button className="btn primary" onClick={signInThenReturn}>
                Sign in to accept
              </button>
            ) : (
              <>
                {session.user?.email.toLowerCase() !== preview.data.email.toLowerCase() && (
                  <p className="error">
                    You are signed in as {session.user?.email}, which does not match this invitation.
                  </p>
                )}
                <button className="btn primary" disabled={accepting} onClick={() => void accept()}>
                  Accept invitation
                </button>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
