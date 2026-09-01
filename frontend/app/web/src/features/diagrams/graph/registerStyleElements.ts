// One-time registration of the maxGraph pieces the editor uses: built-in
// shapes, perimeters, edge markers and styles, the model codecs (needed for
// XML import/export -- not registered by default since 0.6), the UML
// stencils, and the handle/selection colours.
//
// These registries are global singletons, and React StrictMode mounts twice
// in development, so this is guarded to run once per page.
import {
  EdgeHandlerConfig,
  HandleConfig,
  registerDefaultEdgeMarkers,
  registerDefaultEdgeStyles,
  registerDefaultPerimeters,
  registerDefaultShapes,
  registerModelCodecs,
  StencilShape,
  StencilShapeRegistry,
  StyleDefaultsConfig,
  VertexHandlerConfig,
  xmlUtils,
} from "@maxgraph/core";
import { STENCILS_XML } from "./umlStencils";
import { ACCENT, CANVAS_BG, FONT } from "./umlStyles";

let registered = false;

export function registerStyleElements(): void {
  if (registered) return;
  registered = true;

  registerDefaultShapes();
  registerDefaultPerimeters();
  registerDefaultEdgeMarkers();
  registerDefaultEdgeStyles();
  registerModelCodecs();

  const doc = xmlUtils.parseXml(STENCILS_XML);
  for (const node of Array.from(doc.documentElement.childNodes)) {
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const name = el.getAttribute("name");
    if (name) StencilShapeRegistry.add(name, new StencilShape(el));
  }

  VertexHandlerConfig.selectionColor = ACCENT;
  VertexHandlerConfig.rotationEnabled = false;
  EdgeHandlerConfig.selectionColor = ACCENT;
  HandleConfig.fillColor = ACCENT;
  StyleDefaultsConfig.fontFamily = FONT;
  StyleDefaultsConfig.fontSize = 13;

  applyGraphChrome();
}

/** The slice of the global chrome that follows the theme; safe to re-run. */
export function applyGraphChrome(): void {
  // Resize handles are punched out of the canvas so they read as holes in the
  // shape rather than as extra ink.
  HandleConfig.strokeColor = CANVAS_BG;
}
