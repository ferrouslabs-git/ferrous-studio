// Page → export shape for the inspector's JSON view. Mirrors the server's
// export_page: lists in pos order, `pos` and nulls stripped, so what the
// inspector shows is exactly what Copy JSON produces.
import { byPos, PageLike } from "./applyOps";
import { ComponentNode, REGION_ORDER } from "./types";

function stripCmp(c: ComponentNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: c.id, type: c.type, label: c.label };
  if (c.customId) out.customId = c.customId;
  if (c.props && Object.keys(c.props).length) out.props = c.props;
  return out;
}

export function serializePage(page: PageLike & { id?: string }): Record<string, unknown> {
  return {
    id: page.id,
    name: page.name,
    route: page.route,
    frames: byPos(page.document.frames).map((f) => {
      if (f.layoutMode === "regions") {
        const regions: Record<string, unknown[]> = {};
        for (const r of REGION_ORDER) regions[r] = byPos(f.layout.regions[r]).map(stripCmp);
        return { id: f.id, label: f.label, layoutMode: "regions", layout: { regions, options: f.layout.options } };
      }
      return { id: f.id, label: f.label, layout: { components: byPos(f.layout.components).map(stripCmp) } };
    }),
  };
}
