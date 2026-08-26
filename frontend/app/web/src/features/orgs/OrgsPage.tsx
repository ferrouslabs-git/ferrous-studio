// Organisation switcher. Most users belong to one organisation and will
// rarely see this; platform admins use it to jump into any organisation
// they have been added to.
import { Link } from "react-router-dom";
import { useSession } from "../../app/session";
import { RoleName } from "./roleLabels";

export function OrgsPage() {
  const { orgs, user } = useSession();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Organisations</h1>
        <span className="sub">{orgs.length} you belong to</span>
        <span className="shell-spacer" />
        {user?.is_platform_admin && (
          <Link to="/admin/orgs" className="btn">
            Manage all organisations
          </Link>
        )}
      </div>

      {orgs.length === 0 ? (
        <div className="empty">
          {user?.is_platform_admin ? (
            <>
              You are not a member of any organisation. Create one under <b>Admin</b>.
            </>
          ) : (
            <>You are not a member of any organisation yet.</>
          )}
        </div>
      ) : (
        <div className="card-grid">
          {orgs.map((o) => (
            <Link key={o.id} to={`/orgs/${o.id}/projects`} className="card">
              <h3>{o.name}</h3>
              <p>{o.plan} plan</p>
              <div className="meta">
                <span className="badge accent">
                  <RoleName name={o.role} />
                </span>
                {o.status !== "active" && <span className="badge">{o.status}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
