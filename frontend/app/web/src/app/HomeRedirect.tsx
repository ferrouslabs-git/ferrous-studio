// Signed-in landing. A member belongs to exactly one organisation, so there is
// nothing to choose: they go straight to its projects. Platform admins belong
// to none and land on the platform's organisation list instead.
import { Navigate } from "react-router-dom";
import { useSession } from "./session";

export function HomeRedirect() {
  const { user, activeOrg } = useSession();

  if (user?.is_platform_admin) return <Navigate to="/admin/orgs" replace />;
  if (activeOrg) return <Navigate to={`/orgs/${activeOrg.id}/projects`} replace />;
  // No membership yet: ProtectedRoute normally catches this, but be explicit.
  return <Navigate to="/pending" replace />;
}
