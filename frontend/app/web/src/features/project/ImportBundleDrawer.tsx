// Import a project bundle: pick a file, see what it contains, import it.
// backend/app/studio/importing.py does the real validation and creation --
// this only previews what a well-formed-looking file contains client-side,
// and renders the server's verdict (every error, or the counts) back.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, Field } from "../../components/Drawer";
import { ApiError, errorMessage } from "../../core/api";
import { BundleError, BundleValidationFailure, ImportResult, importBundle } from "./importApi";

interface ParsedBundle {
  raw: unknown;
  wireframeCount: number;
  pageCount: number;
  diagramCount: number;
  actorCount: number;
  useCaseCount: number;
  repoFullName: string | null;
  commitSha: string | null;
}

/** A light client-side read, mirroring wrap_bare_envelope closely enough
 *  for a preview -- the server's validate_bundle is the real authority. */
function summarise(raw: unknown): ParsedBundle | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const wireframes = Array.isArray(body.wireframes)
    ? (body.wireframes as Record<string, unknown>[])
    : Array.isArray(body.pages)
      ? [body]
      : [];
  if (wireframes.length === 0 && !Array.isArray(body.diagrams) && !Array.isArray(body.actors) && !Array.isArray(body.useCases)) {
    return null;
  }
  const pageCount = wireframes.reduce((n, w) => n + (Array.isArray(w.pages) ? w.pages.length : 0), 0);
  const source = (body.source && typeof body.source === "object" ? body.source : {}) as Record<string, unknown>;
  return {
    raw,
    wireframeCount: wireframes.length,
    pageCount,
    diagramCount: Array.isArray(body.diagrams) ? body.diagrams.length : 0,
    actorCount: Array.isArray(body.actors) ? body.actors.length : 0,
    useCaseCount: Array.isArray(body.useCases) ? body.useCases.length : 0,
    repoFullName: typeof source.repo_full_name === "string" ? source.repo_full_name : null,
    commitSha: typeof source.commit_sha === "string" ? source.commit_sha : null,
  };
}

function isBundleValidationFailure(body: unknown): body is BundleValidationFailure {
  return !!body && typeof body === "object" && Array.isArray((body as { errors?: unknown }).errors);
}

export function ImportBundleDrawer({
  projectId,
  orgId,
  onClose,
  onImported,
}: {
  projectId: string;
  orgId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<BundleError[] | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = async (file: File) => {
    setFileName(file.name);
    setParsed(null);
    setParseError(null);
    setErrors(null);
    setError(null);
    try {
      const summary = summarise(JSON.parse(await file.text()));
      if (!summary) {
        setParseError("That file doesn't look like a bundle -- no wireframes, diagrams, actors or use cases in it.");
        return;
      }
      setParsed(summary);
    } catch {
      setParseError("Could not read that file as JSON.");
    }
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    setErrors(null);
    setError(null);
    try {
      setResult(await importBundle(projectId, parsed.raw));
      onImported();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && isBundleValidationFailure(err.body)) {
        setErrors(err.body.errors);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      title="Import bundle"
      description={result ? undefined : "A project or wireframe export, or a bundle generated from an existing codebase."}
      onClose={onClose}
      width={480}
      footer={
        result ? (
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={!parsed || busy} onClick={doImport}>
              {busy ? "Importing…" : "Import"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <div className="status-banner">
            Imported {result.wireframes.length} wireframe{result.wireframes.length === 1 ? "" : "s"} and{" "}
            {result.diagrams.length} diagram{result.diagrams.length === 1 ? "" : "s"}.
          </div>
          <div className="details-grid">
            <div className="details-label">Actors</div>
            <div className="details-value">
              {result.actors.created} created, {result.actors.matched} matched
            </div>
            <div className="details-label">Use cases</div>
            <div className="details-value">
              {result.use_cases.created} created, {result.use_cases.matched} matched
            </div>
            <div className="details-label">Datasets</div>
            <div className="details-value">
              {result.datasets.created} created, {result.datasets.matched} matched
            </div>
          </div>
          {result.warnings.map((w, i) => (
            <div key={i} className="status-banner warn">
              {w}
            </div>
          ))}
          {result.wireframes[0] && (
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                onClose();
                navigate(`/orgs/${orgId}/projects/${projectId}/wireframes/${result.wireframes[0].id}`);
              }}
            >
              Open {result.wireframes[0].name}
            </button>
          )}
        </div>
      ) : (
        <div className="stack">
          <Field label="Bundle file">
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickFile(file);
              }}
            />
          </Field>

          {fileName && !parsed && !parseError && <span className="muted">Reading {fileName}…</span>}
          {parseError && <div className="status-banner warn">{parseError}</div>}

          {parsed && (
            <div className="details-grid">
              <div className="details-label">Wireframes</div>
              <div className="details-value">{parsed.wireframeCount}</div>
              <div className="details-label">Pages</div>
              <div className="details-value">{parsed.pageCount}</div>
              <div className="details-label">Diagrams</div>
              <div className="details-value">{parsed.diagramCount}</div>
              <div className="details-label">Actors</div>
              <div className="details-value">{parsed.actorCount}</div>
              <div className="details-label">Use cases</div>
              <div className="details-value">{parsed.useCaseCount}</div>
              {parsed.repoFullName && (
                <>
                  <div className="details-label">Source</div>
                  <div className="details-value">{parsed.repoFullName}</div>
                </>
              )}
              {parsed.commitSha && (
                <>
                  <div className="details-label">Commit</div>
                  <div className="details-value repo-sha">{parsed.commitSha}</div>
                </>
              )}
            </div>
          )}

          {error && <div className="status-banner warn">{error}</div>}

          {errors && errors.length > 0 && (
            <div className="stack">
              <div className="status-banner warn">
                {errors.length} problem{errors.length === 1 ? "" : "s"} found. Nothing was imported.
              </div>
              <div className="bundle-error-list">
                {errors.map((e, i) => (
                  <div key={i} className="bundle-error-row">
                    <span className="bundle-error-path">{e.path || "(bundle)"}</span>
                    <span>{e.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
