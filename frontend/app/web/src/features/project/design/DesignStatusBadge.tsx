import { Design, designState, designStateLabel } from "./designModel";

/** "Not generated", then "In Figma" / "In Claude" once it exists in its tool,
 *  then "Published" (a Make site) / "Shared" (a Claude share link). */
export function DesignStatusBadge({ design }: { design: Pick<Design, "figma_url" | "published_url"> & Partial<Pick<Design, "provider">> }) {
  const state = designState(design);
  return (
    <span className={state === "published" ? "badge good" : "badge muted"}>{designStateLabel(state, design.provider)}</span>
  );
}
