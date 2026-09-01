// Page → export shape for the inspector's JSON view. Mirrors the server's
// export_page: components embedded in their region nodes in pos order, `pos`
// and nulls stripped, so what the inspector shows is exactly what Copy JSON
// produces.
import { byPos, PageLike } from "./applyOps";
import { ComponentNode, LayoutNode, PagePlacement } from "./types";

function stripCmp(c: ComponentNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: c.id, type: c.type, label: c.label };
  if (c.shape) out.shape = c.shape;
  if (c.layout) out.layout = c.layout;
  if (c.customId) out.customId = c.customId;
  if (c.elements?.length) {
    out.elements = byPos(c.elements).map((e) => {
      const el: Record<string, unknown> = { id: e.id, type: e.type, label: e.label };
      if (e.data && Object.keys(e.data).length) el.data = e.data;
      return el;
    });
  }
  if (c.props && Object.keys(c.props).length) out.props = c.props;
  return out;
}

export function serializePage(page: PageLike & { id?: string; placement?: PagePlacement | null }): Record<string, unknown> {
  const embed = (node: LayoutNode): Record<string, unknown> => {
    if (node.kind === "region") {
      const out: Record<string, unknown> = { kind: "region", id: node.id, size: node.size };
      if (node.label) out.label = node.label;
      out.components = byPos(page.document.regions[node.id] ?? []).map(stripCmp);
      return out;
    }
    return { kind: "split", id: node.id, dir: node.dir, size: node.size, children: node.children.map(embed) };
  };
  const out: Record<string, unknown> = {
    id: page.id,
    name: page.name,
    route: page.route,
    layout: embed(page.document.root),
  };
  if (page.placement) out.placement = page.placement;
  return out;
}
