// One high-fidelity design. A Figma design is the site published from its
// Make file, framed on a stage the size of its wireframes' device (with a
// choice when they differ); Sync reloads the site, so whatever was last
// published in Make is what is on show. A Claude design cannot be framed
// (claude.ai refuses other sites), so its public share link is shown to open
// instead. There is nothing here that changes the design -- changes are made
// in its tool (docs/high-fidelity-design.md).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLoad } from "../../../core/useLoad";
import { Stage, useStageFit } from "../../studio/stage";
import { useFillViewport } from "../epics/useFillViewport";
import { useProject } from "../ProjectLayout";
import { deviceClass, INTERFACE_TYPES, InterfaceType, listWireframes } from "../wireframes/wireframesApi";
import {
  claudeHref,
  designWireframes,
  figmaHref,
  freshSiteUrl,
  getDesign,
  interfaceTypesOf,
  publishedSite,
} from "./designsApi";
import { DesignStatusBadge } from "./DesignStatusBadge";
import { PrototypeFrame } from "./PrototypeFrame";
import { useRefetchOnFocus } from "./useRefetchOnFocus";

/** Whether `el` is the element the browser is showing full screen, kept in
 *  step with Esc and the browser's own controls. */
function useFullscreen(el: React.RefObject<HTMLElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(document.fullscreenElement !== null && document.fullscreenElement === el.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [el]);
  const toggle = useCallback(() => {
    // A browser may refuse (no user gesture, a policy); the button then just
    // does nothing rather than throwing.
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.current?.requestFullscreen().catch(() => {});
  }, [el]);
  return { on, toggle, supported: typeof document !== "undefined" && document.fullscreenEnabled };
}

export function DesignPage() {
  const { designId = "" } = useParams();
  const { project, orgId } = useProject();
  const data = useLoad(
    () => Promise.all([getDesign(project.id, designId), listWireframes(project.id)]),
    [project.id, designId],
  );
  // The published address can be recorded from outside the app; coming back
  // to the tab shows it.
  useRefetchOnFocus(data.reload);

  /** The device picked when the wireframes are drawn on more than one. */
  const [pickedDevice, setPickedDevice] = useState<InterfaceType | null>(null);
  /** Bumped by Sync: a fresh fetch of the published site. */
  const [syncedAt, setSyncedAt] = useState(() => Date.now());

  const [design, wireframes] = data.data ?? [null, []];
  const resolved = design ? designWireframes(design, wireframes) : { wireframes: [], missing: 0 };
  const devices = interfaceTypesOf(resolved.wireframes);
  const interfaceType: InterfaceType =
    pickedDevice && devices.includes(pickedDevice) ? pickedDevice : devices[0] ?? "desktop";
  const claude = design?.provider === "claude";
  // A Claude design is never framed: only a figma.site page can be.
  const site = claude ? null : publishedSite(design?.published_url ?? null);
  const figma = claude ? null : figmaHref(design?.figma_url ?? null);
  const shareLink = claude ? claudeHref(design?.published_url ?? null) : null;
  const claudeEdit = claude ? claudeHref(design?.figma_url ?? null) : null;

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
  const fullscreen = useFullscreen(mat);
  const listPath = `/orgs/${orgId}/projects/${project.id}/high-fidelity-design`;

  const sync = () => {
    setSyncedAt(Date.now());
    void data.reload();
  };

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
        {devices.length > 1 && site && (
          <select
            className="select"
            aria-label="Device"
            value={interfaceType}
            onChange={(e) => setPickedDevice(e.target.value as InterfaceType)}
          >
            {INTERFACE_TYPES.filter((t) => devices.includes(t.value)).map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        {site && (
          <button type="button" className="btn" onClick={sync}>
            Sync
          </button>
        )}
        {site && fullscreen.supported && (
          <button type="button" className="btn" onClick={fullscreen.toggle} aria-pressed={fullscreen.on}>
            {fullscreen.on ? "Exit full screen" : "Full screen"}
          </button>
        )}
        {figma && (
          <a className="btn" href={figma} target="_blank" rel="noopener noreferrer">
            Open in Figma
          </a>
        )}
        {claude && (shareLink ?? claudeEdit) && (
          <a className="btn primary" href={(shareLink ?? claudeEdit)!} target="_blank" rel="noopener noreferrer">
            Open in Claude Design
          </a>
        )}
      </div>

      {data.data && resolved.wireframes.length === 0 && (
        <div className="status-banner warn">
          {design.all_wireframes
            ? "This project has no active wireframes."
            : "The wireframes this design was made from no longer exist."}
        </div>
      )}
      {resolved.missing > 0 && resolved.wireframes.length > 0 && (
        <div className="status-banner warn">
          {resolved.missing === 1
            ? "One of this design's wireframes no longer exists."
            : `${resolved.missing} of this design's wireframes no longer exist.`}
        </div>
      )}

      {claude ? (
        <section className="section">
          {shareLink ? (
            <div className="design-share">
              <span className="muted">Public link</span>
              <a href={shareLink} target="_blank" rel="noopener noreferrer">
                {shareLink}
              </a>
            </div>
          ) : (
            <div className="empty">
              {claudeEdit ? (
                <>
                  <b>Not shared yet.</b> Share it publicly in Claude Design and record the link.
                </>
              ) : (
                <>
                  <b>Not generated yet.</b> Run <code>/studio-design generate "{design.name}"</code> in Claude Code.
                </>
              )}
            </div>
          )}
        </section>
      ) : !site ? (
        // No mat without a sheet to lie on it: an empty state reads as one.
        <section className="section">
          <div className="empty">
            {figma ? (
              <>
                <b>Not published yet.</b> Publish it in Figma Make.
              </>
            ) : (
              <>
                <b>Not generated yet.</b> Run <code>/studio-design generate "{design.name}"</code> in Claude Code.
              </>
            )}
          </div>
        </section>
      ) : (
        <div className={`design-mat${fit ? " framed" : ""}`} ref={matRef}>
          <Stage fit={fit}>
            <div className={`design-device ${deviceClass(interfaceType)}`} style={fit?.device}>
              <PrototypeFrame key={syncedAt} url={freshSiteUrl(site, syncedAt)} title={design.name} />
            </div>
          </Stage>
        </div>
      )}
    </div>
  );
}
