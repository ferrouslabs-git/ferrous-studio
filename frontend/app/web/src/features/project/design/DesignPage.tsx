// One high-fidelity design: a read-only mirror of the prototype held in its
// Figma Make file. The revision on show is drawn in a sandboxed frame on a
// stage the size of the wireframe's device; the switcher only chooses which
// revision to look at. There is nothing here that changes the design --
// changes are made in Figma Make (docs/high-fidelity-design.md).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { errorMessage } from "../../../core/api";
import { formatDateTime } from "../../../core/format";
import { useLoad } from "../../../core/useLoad";
import { Stage, useStageFit } from "../../studio/stage";
import { useFillViewport } from "../epics/useFillViewport";
import { useProject } from "../ProjectLayout";
import { InterfaceType, listWireframes } from "../wireframes/wireframesApi";
import {
  DesignRevision,
  figmaHref,
  getDesign,
  getRevisionViewUrl,
  listDesignRevisions,
  revisionLabel,
  shownRevision,
} from "./designsApi";
import { DesignStatusBadge } from "./DesignStatusBadge";
import { PrototypeFrame } from "./PrototypeFrame";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

/** The frame's URL for one revision. Keyed on the revision alone, so a
 *  refetch that finds nothing new does not reload a prototype someone is
 *  halfway through clicking around. */
function useRevisionUrl(projectId: string, designId: string, revision: DesignRevision | null) {
  const [state, setState] = useState<{ id: string; url: string | null; error: string | null } | null>(null);
  const revisionId = revision?.id ?? null;

  useEffect(() => {
    if (!revisionId) return;
    let live = true;
    getRevisionViewUrl(projectId, designId, revisionId)
      .then((view) => live && setState({ id: revisionId, url: view.url, error: null }))
      .catch((err) => live && setState({ id: revisionId, url: null, error: errorMessage(err) }));
    return () => {
      live = false;
    };
  }, [projectId, designId, revisionId]);

  return state && state.id === revisionId ? state : null;
}

export function DesignPage() {
  const { designId = "" } = useParams();
  const { project, orgId } = useProject();
  const data = useLoad(
    () =>
      Promise.all([
        getDesign(project.id, designId),
        listDesignRevisions(project.id, designId),
        listWireframes(project.id),
      ]),
    [project.id, designId],
  );
  // A sync lands from outside the app; coming back to the tab shows it.
  useRefetchOnFocus(data.reload);

  /** The revision picked in the switcher; null follows the current one. */
  const [pickedId, setPickedId] = useState<string | null>(null);

  const [design, revisions, wireframes] = data.data ?? [null, [], []];
  const wireframe = design ? wireframes.find((w) => w.id === design.wireframe_id) : undefined;
  const interfaceType: InterfaceType = wireframe?.interface_type ?? "desktop";
  const revision = shownRevision(revisions, pickedId, design?.current_revision_id ?? null);
  const view = useRevisionUrl(project.id, designId, revision);
  const figma = figmaHref(design?.figma_url ?? null);

  const mat = useRef<HTMLDivElement | null>(null);
  const fill = useFillViewport<HTMLDivElement>(0);
  const matRef = useCallback(
    (el: HTMLDivElement | null) => {
      mat.current = el;
      fill(el);
    },
    [fill],
  );
  const fit = useStageFit(mat, interfaceType);
  const listPath = `/orgs/${orgId}/projects/${project.id}/high-fidelity-design`;

  if (!design) {
    return (
      <div className="page stack">
        <div className="page-head">
          <h1>High fidelity design</h1>
        </div>
        <div className={data.error ? "empty error" : "empty"}>{data.error ?? "Loading…"}</div>
      </div>
    );
  }

  return (
    <div className="page stack design-page">
      <div className="page-head">
        <div>
          <Link to={listPath} className="muted design-back">
            High fidelity design
          </Link>
          <h1>{design.name}</h1>
        </div>
        <span className="chips">
          <DesignStatusBadge design={design} />
          {design.status === "archived" && <span className="badge">Archived</span>}
        </span>
        <span className="shell-spacer" />
        {design.synced_at && <span className="muted design-synced">Last synced {formatDateTime(design.synced_at)}</span>}
        {revisions.length > 0 && revision && (
          <select
            className="select"
            aria-label="Revision"
            value={revision.id}
            onChange={(e) => setPickedId(e.target.value)}
          >
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {revisionLabel(r, design.current_revision_id)}
              </option>
            ))}
          </select>
        )}
        {figma && (
          <a className="btn" href={figma} target="_blank" rel="noopener noreferrer">
            Open in Figma
          </a>
        )}
      </div>

      {!wireframe && wireframes.length > 0 && (
        <div className="status-banner warn">The wireframe this design was made from no longer exists.</div>
      )}
      {revision?.summary && <p className="muted design-summary">{revision.summary}</p>}

      {!revision ? (
        // No mat without a sheet to lie on it: an empty state reads as one.
        <section className="section">
          <div className="empty">
            <b>Not generated yet.</b> Run <code>/studio-design generate "{design.name}"</code> in Claude Code.
          </div>
        </section>
      ) : (
        <div className={`design-mat${fit ? " framed" : ""}`} ref={matRef}>
          {view?.error ? (
            <div className="empty error design-empty">{view.error}</div>
          ) : (
            <Stage fit={fit}>
              <div className={`design-device ${interfaceType}`} style={fit?.device}>
                {view?.url && (
                  <PrototypeFrame key={revision.id} url={view.url} title={`${design.name}, revision ${revision.revision_no}`} />
                )}
              </div>
            </Stage>
          )}
        </div>
      )}
    </div>
  );
}
