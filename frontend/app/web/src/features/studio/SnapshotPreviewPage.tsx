// Preview mode for a saved snapshot: the wireframe as it stood when the
// snapshot was taken, without restoring anything. The server rebuilds the
// snapshot's pages into renderable documents in one request, so every page
// this preview can reach is already in hand — the page source below resolves
// from that map instead of the network, and PreviewShell never learns the
// difference.
import { useCallback, useMemo } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { useProject } from "../project/ProjectLayout";
import { snapshotTitle } from "../project/wireframes/snapshots";
import { getWireframeVersionPreview } from "../project/wireframes/wireframesApi";
import { byPos } from "./model/positions";
import { PageRecord } from "./model/types";
import { PreviewShell } from "./PreviewShell";
import { PageFetcher } from "./usePageDocument";

export function SnapshotPreviewPage() {
  const { wireframeId = "", versionId = "" } = useParams();
  // Remount per snapshot: the open page and the back/forward trail belong to
  // the snapshot they were built from.
  return <SnapshotPreviewView key={versionId} wireframeId={wireframeId} versionId={versionId} />;
}

function SnapshotPreviewView({ wireframeId, versionId }: { wireframeId: string; versionId: string }) {
  const { project, orgId } = useProject();
  const projectId = project.id;
  // The snapshots drawer knows the number ("v3") — it is a position in the
  // list, not a stored field — and hands it over on the way here. Opened cold
  // (a shared link, a reload) the title falls back to the label.
  const handedTitle = (useLocation().state as { snapshotTitle?: string } | null)?.snapshotTitle;
  const snapshot = useLoad(
    () => getWireframeVersionPreview(projectId, wireframeId, versionId),
    [projectId, wireframeId, versionId],
  );

  // The snapshot's pages as page records, keyed for the fetcher below. They
  // carry no version: nothing here is editable, and the studio's write path
  // is never reached from preview mode.
  const records = useMemo(() => {
    const taken = snapshot.data?.created_at ?? new Date().toISOString();
    return new Map<string, PageRecord>(
      (snapshot.data?.pages ?? []).map((p) => [
        p.id,
        { ...p, project_id: projectId, entity_versions: {}, version: 0, updated_at: taken },
      ]),
    );
  }, [snapshot.data, projectId]);

  const pages = useMemo(() => byPos([...records.values()]), [records]);

  const fetchPage = useCallback<PageFetcher>(
    (pageId) => {
      const record = records.get(pageId);
      return record ? Promise.resolve(record) : Promise.reject(new Error("That page is not in this snapshot"));
    },
    [records],
  );

  if (snapshot.loading) return <div className="page muted">Loading…</div>;
  if (snapshot.error || !snapshot.data) return <div className="page error">{snapshot.error ?? "Not found"}</div>;

  const base = `/orgs/${orgId}/projects/${projectId}/wireframes`;
  const title = handedTitle ?? snapshotTitle(snapshot.data);

  return (
    <PreviewShell
      interfaceType={snapshot.data.interface_type}
      pages={pages}
      landingPageId={snapshot.data.landing_page_id}
      fetchPage={fetchPage}
      emptyHint="This snapshot captured no pages."
      chrome={
        <>
          {/* Back to the list with this wireframe's snapshots reopened, so
              the next one is a click away. */}
          <Link className="btn ghost" to={base} state={{ snapshotsFor: wireframeId }}>
            ‹ Exit preview
          </Link>
          <div className="brand">Snapshot preview</div>
        </>
      }
      banner={
        <div className="status-banner">
          <b>{snapshot.data.wireframe_name}</b> · {title} · saved {formatDateTime(snapshot.data.created_at)}. The live
          wireframe is unchanged.
        </div>
      }
    />
  );
}
