// Route guard. Renders nested routes via <Outlet/> once the session is ready;
// otherwise redirects. This is UX only -- the server enforces every permission.
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "./session";

interface Props {
  /** Only platform admins may pass. */
  requirePlatformAdmin?: boolean;
}

export function ProtectedRoute({ requirePlatformAdmin = false }: Props) {
  const session = useSession();
  const location = useLocation();

  if (session.status === "loading") {
    return <div className="page muted">Loading…</div>;
  }
  if (session.status === "anonymous") {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }
  if (requirePlatformAdmin && !session.user?.is_platform_admin) {
    return <Navigate to="/orgs" replace />;
  }
  if (session.isPending && location.pathname !== "/pending") {
    return <Navigate to="/pending" replace />;
  }
  return <Outlet />;
}
