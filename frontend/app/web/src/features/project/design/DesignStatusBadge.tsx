import { Design, DESIGN_STATE_LABEL, designState } from "./designModel";

/** "Not generated", then "In Figma" once a Make file exists, then "Published". */
export function DesignStatusBadge({ design }: { design: Pick<Design, "figma_url" | "published_url"> }) {
  const state = designState(design);
  return <span className={state === "published" ? "badge good" : "badge muted"}>{DESIGN_STATE_LABEL[state]}</span>;
}
