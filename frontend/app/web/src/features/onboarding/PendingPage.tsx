// Shown to a signed-in user who has no organisation membership yet.
// Organisations are invite-only, so there is nothing to do here but wait.
import { authService } from "../../core/auth";
import { useSession } from "../../app/session";

export function PendingPage() {
  const { user, refresh } = useSession();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Waiting for an invitation</h1>
        <p>
          You're signed in as <b>{user?.email}</b>, but you're not a member of an organisation yet.
          Ask an organisation admin to invite you, then open the link in that email. If you already
          have one, opening it will bring you straight in.
        </p>
        <button className="btn primary" onClick={() => void refresh()}>
          Check again
        </button>
        <button className="btn" onClick={() => authService.logout()}>
          Sign out
        </button>
      </div>
    </div>
  );
}
