import { Design, DESIGN_STATE_LABEL, designState } from "./designModel";

/** "Not generated" until the design has a revision on show; "Synced" after. */
export function DesignStatusBadge({ design }: { design: Pick<Design, "current_revision_id"> }) {
  const state = designState(design);
  return <span className={state === "synced" ? "badge good" : "badge muted"}>{DESIGN_STATE_LABEL[state]}</span>;
}
