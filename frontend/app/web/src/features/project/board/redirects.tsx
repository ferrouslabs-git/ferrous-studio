// Older board links: the release "plan" page and the "unscheduled" bucket
// were folded into the release page and the roadmap. Resolved from the URL
// params rather than a relative `..`, which react-router reads against the
// route tree rather than the path segments.
import { Navigate, useParams } from "react-router-dom";
import { boardPaths } from "./paths";

export function PlanRedirect() {
  const { orgId = "", projectId = "", releaseId = "" } = useParams();
  const paths = boardPaths(orgId, projectId);
  return <Navigate to={releaseId ? paths.release(releaseId) : paths.roadmap} replace />;
}

export function UnscheduledRedirect() {
  const { orgId = "", projectId = "" } = useParams();
  return <Navigate to={boardPaths(orgId, projectId).roadmap} replace />;
}
