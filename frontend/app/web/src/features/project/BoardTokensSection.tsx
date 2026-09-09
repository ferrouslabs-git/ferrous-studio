// The Board tokens section of the project details page: credentials that let
// the MCP server or an agent reach this project's board without a browser.
//
// Admin-only (board:tokens). A token resolves to board:read/board:write on
// this one board and nothing else, so a leak cannot reach personas,
// wireframes, diagrams, or another project's board.
//
// Like Environments beside it, a token belongs to the project *lineage*
// rather than to a version -- the backend resolves the board through
// get_project, not get_writable_project -- so this section stays usable on a
// frozen version. It uses the organisation role, not useProject().canWrite,
// which the lock narrows.
import { FormEvent, useState } from "react";
import { useSession } from "../../app/session";
import { ConfirmDrawer } from "../../components/ConfirmDrawer";
import { Drawer, Field } from "../../components/Drawer";
import { errorMessage } from "../../core/api";
import { formatDateTime } from "../../core/format";
import { useLoad } from "../../core/useLoad";
import { BoardToken, BoardTokenIssued, createBoardToken, listBoardTokens, revokeBoardToken } from "./boardTokensApi";
import { useProject } from "./ProjectLayout";

export function BoardTokensSection() {
  const { project } = useProject();
  const { canManageBoardTokens } = useSession();

  const tokens = useLoad(() => (canManageBoardTokens ? listBoardTokens(project.id) : Promise.resolve([])), [
    project.id,
    canManageBoardTokens,
  ]);

  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Held only until the drawer closes: the raw value exists nowhere else.
  const [issued, setIssued] = useState<BoardTokenIssued | null>(null);
  const [copied, setCopied] = useState<"token" | "config" | null>(null);
  const [revoking, setRevoking] = useState<BoardToken | null>(null);

  // Nothing to show, and listing would 403 anyway.
  if (!canManageBoardTokens) return null;

  const rows = tokens.data ?? [];
  const live = rows.filter((t) => !t.revoked_at);

  const openCreate = () => {
    setLabel("");
    setFormError(null);
    setCreating(true);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const token = await createBoardToken(project.id, label.trim());
      setCreating(false);
      setCopied(null);
      setIssued(token);
      await tokens.reload();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = async (value: string, what: "token" | "config") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      // Clipboard access can be refused; both values stay selectable.
      setCopied(null);
    }
  };

  /** The three variables board_mcp.py reads, as a ready .mcp.json block.
   *  Assembled here because this drawer is the only place all three exist at
   *  once -- the token is never retrievable again, and pairing it with the
   *  project UUID is otherwise a manual dig through the address bar. */
  const mcpConfig = (token: string) =>
    JSON.stringify(
      {
        mcpServers: {
          "ferrous-board": {
            command: "uv",
            args: ["run", "--with", "mcp", "python", "board_mcp.py"],
            env: {
              FERROUS_STUDIO_URL: window.location.origin,
              FERROUS_STUDIO_PROJECT: project.id,
              FERROUS_BOARD_TOKEN: token,
            },
          },
        },
      },
      null,
      2,
    );

  return (
    <section className="section">
      <div className="section-head">
        <h2>Board tokens</h2>
        <span className="shell-spacer" />
        <button className="btn small ghost" onClick={openCreate}>
          + New token
        </button>
      </div>

      <div className="section-body stack">
        {tokens.error ? (
          <div className="status-banner warn">{tokens.error}</div>
        ) : tokens.loading && rows.length === 0 ? (
          <span className="muted">Loading…</span>
        ) : rows.length === 0 ? (
          <span className="muted">No tokens.</span>
        ) : (
          rows.map((t) => (
            <div key={t.id} className="list-editor-row">
              <span>{t.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>
                {t.revoked_at
                  ? `revoked ${formatDateTime(t.revoked_at)}`
                  : t.last_used_at
                    ? `last used ${formatDateTime(t.last_used_at)}`
                    : "never used"}
              </span>
              {!t.revoked_at && (
                <button type="button" className="btn small ghost" onClick={() => setRevoking(t)}>
                  Revoke
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <Drawer
        open={creating}
        title="New board token"
        onClose={() => setCreating(false)}
        onSubmit={create}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn primary" disabled={saving || !label.trim()}>
              {saving ? "Creating…" : "Create token"}
            </button>
          </>
        }
      >
        <Field label="Label">
          <input
            className="input"
            placeholder="Claude Code on my laptop"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        {formError && <div className="status-banner warn">{formError}</div>}
      </Drawer>

      <Drawer
        open={issued !== null}
        title={issued ? `Token — ${issued.label}` : ""}
        onClose={() => setIssued(null)}
        width={620}
        footer={
          <button type="button" className="btn primary" onClick={() => setIssued(null)}>
            Done
          </button>
        }
      >
        {issued && (
          <>
            <div className="status-banner warn">
              Copy this now. It is stored only as a hash and cannot be shown again — if you lose it, revoke it and
              create another.
            </div>
            <Field label="Token">
              <input className="input" readOnly value={issued.token} onFocus={(e) => e.currentTarget.select()} />
            </Field>
            <button type="button" className="btn small ghost" onClick={() => void copy(issued.token, "token")}>
              {copied === "token" ? "Copied" : "Copy token"}
            </button>

            <Field label=".mcp.json">
              <textarea
                className="input"
                readOnly
                rows={16}
                value={mcpConfig(issued.token)}
                onFocus={(e) => e.currentTarget.select()}
              />
            </Field>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => void copy(mcpConfig(issued.token), "config")}
            >
              {copied === "config" ? "Copied" : "Copy .mcp.json"}
            </button>
          </>
        )}
      </Drawer>

      <ConfirmDrawer
        open={revoking !== null}
        title="Revoke token"
        confirmLabel="Revoke"
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          await revokeBoardToken(project.id, revoking.id);
          await tokens.reload();
        }}
      >
        <p>
          Revoke <b>{revoking?.label}</b>? Anything using it loses access to this board immediately.
          {live.length === 1 && revoking && !revoking.revoked_at ? " This is the only token still live." : ""}
        </p>
      </ConfirmDrawer>
    </section>
  );
}
