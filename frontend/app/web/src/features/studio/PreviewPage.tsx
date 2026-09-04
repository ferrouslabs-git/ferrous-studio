// Preview mode for a wireframe's live pages: the wireframe rendered as the
// system it describes. The top bar's dropdown switches between the project's
// wireframes; everything else — navigation, overlays, the canvas — lives in
// PreviewShell, which snapshot preview shares.
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLoad } from "../../core/useLoad";
import { useProject } from "../project/ProjectLayout";
import { getWireframe, listWireframes } from "../project/wireframes/wireframesApi";
import { byPos } from "./model/positions";
import { PreviewShell } from "./PreviewShell";
import { useLivePages } from "./usePageDocument";

export function PreviewPage() {
  const { wireframeId = "" } = useParams();
  // Remount per wireframe: the open page and the back/forward trail belong
  // to one wireframe and must not leak across a dropdown switch.
  return <PreviewView key={wireframeId} wireframeId={wireframeId} />;
}

function PreviewView({ wireframeId }: { wireframeId: string }) {
  const { project, orgId } = useProject();
  const projectId = project.id;
  const navigate = useNavigate();
  const wireframe = useLoad(() => getWireframe(projectId, wireframeId), [projectId, wireframeId]);
  const siblings = useLoad(() => listWireframes(projectId), [projectId]);
  const fetchPage = useLivePages(projectId, wireframeId);

  const pages = useMemo(() => byPos(wireframe.data?.pages ?? []), [wireframe.data]);

  if (wireframe.loading) return <div className="page muted">Loading…</div>;
  if (wireframe.error || !wireframe.data) return <div className="page error">{wireframe.error ?? "Not found"}</div>;

  const base = `/orgs/${orgId}/projects/${projectId}/wireframes`;
  const wireframes = siblings.data ?? [wireframe.data];

  return (
    <PreviewShell
      interfaceType={wireframe.data.interface_type}
      pages={pages}
      landingPageId={wireframe.data.landing_page_id}
      fetchPage={fetchPage}
      chrome={
        <>
          <Link className="btn ghost" to={base}>
            ‹ Exit preview
          </Link>
          <div className="brand">Preview</div>
          <select
            className="select preview-wireframe"
            aria-label="Wireframe"
            value={wireframeId}
            onChange={(e) => navigate(`${base}/${e.target.value}/preview`)}
          >
            {wireframes.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </>
      }
    />
  );
}
