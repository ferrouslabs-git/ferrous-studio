// All state mutations: applyPattern, appendComponent, move, remove, page/frame CRUD, setLayoutMode.
import { state, getActivePage, getActiveFrame, uid, classifyRegion,
         flatToRegions, regionsToFlat, emptyRegions, REGION_ORDER,
         locateCmp, isSmartDock, STRUCTURAL_TYPES, ensureRegionOptions,
         makeFrame, page as mkPage } from './state.js';
import { PATTERNS, DEFAULT_LABELS } from './data.js';
import { renderAll, renderCanvas, renderJson, renderPageTabs, toast, $ } from './render.js';

// ── Serialization ──────────────────────────────────────────────────────────
export function serializeFrame(f) {
  const stripCmp = c => {
    const o = { id: c.id, type: c.type, label: c.label };
    if (c.customId) o.customId = c.customId;
    return o;
  };
  if (f.layoutMode === 'regions') {
    const regions = {};
    REGION_ORDER.forEach(r => { regions[r] = (f.layout.regions[r] || []).map(stripCmp); });
    const opts = ensureRegionOptions(f);
    return { id: f.id, label: f.label, layoutMode: 'regions',
             layout: { regions, options: { smartDock: opts.smartDock, mainFlow: opts.mainFlow } } };
  }
  return { id: f.id, label: f.label, layout: { components: f.layout.components.map(stripCmp) } };
}

export function serializePage(p) {
  return { id: p.id, name: p.name, route: p.route, frames: p.frames.map(serializeFrame) };
}

// ── Layout mode switch ─────────────────────────────────────────────────────
export function setLayoutMode(mode) {
  const frame = getActiveFrame(); if (!frame || frame.layoutMode === mode) return;
  if (mode === 'regions') {
    const cmps = frame.layout.components || [];
    frame.layout = { regions: flatToRegions(cmps), options: { smartDock: true, mainFlow: 'stack' } };
  } else {
    const flat = regionsToFlat(frame.layout.regions || emptyRegions());
    frame.layout = { components: flat };
  }
  frame.layoutMode = mode;
  renderAll();
}

// ── Patterns ───────────────────────────────────────────────────────────────
export function applyPattern(patternId, region = null, atIndex = null) {
  const pat = PATTERNS.find(p => p.id === patternId); if (!pat) return;
  const frame = getActiveFrame(); if (!frame) return;
  const newCmps = pat.components.map(t => ({ id: uid('c'), type: t, label: DEFAULT_LABELS[t] || t }));

  if (frame.layoutMode === 'regions') {
    if (region == null && atIndex == null) {
      frame.layout.regions = flatToRegions(newCmps);
      toast(`Applied pattern: ${pat.name}`);
    } else {
      const list = frame.layout.regions[region];
      const fits     = newCmps.filter(c => classifyRegion(c.type) === region);
      const overflow = newCmps.filter(c => classifyRegion(c.type) !== region);
      list.splice(atIndex == null ? list.length : atIndex, 0, ...fits);
      overflow.forEach(c => frame.layout.regions[classifyRegion(c.type)].push(c));
      toast(`Inserted pattern: ${pat.name}`);
    }
  } else {
    const arr = frame.layout.components;
    if (atIndex == null) { frame.layout.components = newCmps; toast(`Applied pattern: ${pat.name}`); }
    else { arr.splice(atIndex, 0, ...newCmps); toast(`Inserted pattern: ${pat.name}`); }
  }
  state.selectedCmpId = null;
  renderAll();
}

// ── Components ─────────────────────────────────────────────────────────────
export function appendComponent(type, region = null, atIndex = null, customId = null) {
  const frame = getActiveFrame(); if (!frame) return;
  const def = type === 'custom' && customId ? state.customComponents.find(d => d.id === customId) : null;
  const label = def ? def.name : (DEFAULT_LABELS[type] || type);
  const c = { id: uid('c'), type, label };
  if (type === 'custom' && customId) c.customId = customId;

  const wantsRegions = frame.layoutMode === 'regions' || region != null;
  if (wantsRegions && frame.layoutMode !== 'regions') {
    frame.layout = { regions: flatToRegions(frame.layout.components || []),
                     options: { smartDock: true, mainFlow: 'stack' } };
    frame.layoutMode = 'regions';
    toast('Auto layout: switched to Regions');
  }

  if (frame.layoutMode === 'regions') {
    const targetRegion = (isSmartDock(frame) && STRUCTURAL_TYPES.has(type))
      ? classifyRegion(type) : (region || classifyRegion(type));
    const list = frame.layout.regions[targetRegion];
    if (atIndex == null) list.push(c); else list.splice(atIndex, 0, c);
  } else {
    const arr = frame.layout.components;
    if (atIndex == null) arr.push(c); else arr.splice(atIndex, 0, c);
  }
  state.selectedCmpId = c.id;
  renderAll();
}

export function moveComponent(id, delta) {
  const frame = getActiveFrame(); if (!frame) return;
  const loc = locateCmp(frame, id); if (!loc) return;
  const j = loc.index + delta; if (j < 0 || j >= loc.list.length) return;
  [loc.list[loc.index], loc.list[j]] = [loc.list[j], loc.list[loc.index]];
  renderAll();
}

export function removeComponent(id) {
  const frame = getActiveFrame(); if (!frame) return;
  const loc = locateCmp(frame, id); if (!loc) return;
  loc.list.splice(loc.index, 1);
  if (state.selectedCmpId === id) state.selectedCmpId = null;
  renderAll();
}

export function reorderById(srcId, targetId, before) {
  const frame = getActiveFrame(); if (!frame) return;
  const src = locateCmp(frame, srcId); if (!src) return;
  const [item] = src.list.splice(src.index, 1);
  if (frame.layoutMode === 'regions' && isSmartDock(frame) && STRUCTURAL_TYPES.has(item.type)) {
    const region = classifyRegion(item.type);
    frame.layout.regions[region].push(item);
    renderAll(); return;
  }
  const tgt = locateCmp(frame, targetId);
  if (!tgt) {
    src.list.push(item);
  } else {
    const insertAt = before ? tgt.index : tgt.index + 1;
    tgt.list.splice(insertAt, 0, item);
  }
  renderAll();
}

export function appendToRegion(type, region) { appendComponent(type, region, null); }

export function moveToRegion(srcId, region) {
  const frame = getActiveFrame(); if (!frame || frame.layoutMode !== 'regions') return;
  const src = locateCmp(frame, srcId); if (!src) return;
  const [item] = src.list.splice(src.index, 1);
  const targetRegion = (isSmartDock(frame) && STRUCTURAL_TYPES.has(item.type))
    ? classifyRegion(item.type) : region;
  frame.layout.regions[targetRegion].push(item);
  renderAll();
}

// ── Pages ──────────────────────────────────────────────────────────────────
export function addPage() {
  const name = prompt('Page name?', 'New page'); if (!name) return;
  const route = prompt('Route?', '/' + name.toLowerCase().replace(/\s+/g, '-')); if (route == null) return;
  const p = mkPage(name, route, [], 'regions');
  state.pages.push(p);
  state.activePageId = p.id; state.activeFrameId = p.frames[0].id; state.selectedCmpId = null;
  renderAll();
}

export function deletePage(id) {
  if (state.pages.length <= 1) return;
  if (!confirm('Delete this page?')) return;
  const idx = state.pages.findIndex(p => p.id === id);
  state.pages.splice(idx, 1);
  if (state.activePageId === id) {
    const next = state.pages[Math.max(0, idx - 1)];
    state.activePageId = next.id; state.activeFrameId = next.frames[0].id; state.selectedCmpId = null;
  }
  renderAll();
}

export function switchPage(id) {
  state.activePageId = id;
  const page = getActivePage();
  state.activeFrameId = page.frames[0].id;
  state.selectedCmpId = null;
  renderAll();
}

// ── Frames ─────────────────────────────────────────────────────────────────
export function addFrame() {
  const page = getActivePage(); if (!page) return;
  const label = prompt('Frame label?', 'Variant ' + (page.frames.length + 1)); if (!label) return;
  const clone = confirm('Clone the current frame? Cancel for an empty frame.');
  const src = getActiveFrame();
  let f;
  if (clone && src) {
    const dup = arr => arr.map(c => ({ ...c, id: uid('c') }));
    if (src.layoutMode === 'regions') {
      const regions = {};
      REGION_ORDER.forEach(r => { regions[r] = dup(src.layout.regions[r] || []); });
      const opts = ensureRegionOptions(src);
      f = { id: uid('frame'), label, layoutMode: 'regions',
            layout: { regions, options: { smartDock: opts.smartDock, mainFlow: opts.mainFlow } } };
    } else {
      f = { id: uid('frame'), label, layoutMode: 'flat',
            layout: { components: dup(src.layout.components) } };
    }
  } else {
    const mode = src ? src.layoutMode : 'flat';
    f = mode === 'regions'
      ? { id: uid('frame'), label, layoutMode: 'regions',
          layout: { regions: emptyRegions(), options: { smartDock: true, mainFlow: 'stack' } } }
      : { id: uid('frame'), label, layoutMode: 'flat', layout: { components: [] } };
  }
  page.frames.push(f); state.activeFrameId = f.id; state.selectedCmpId = null;
  renderAll();
}

export function deleteFrame(id) {
  const page = getActivePage(); if (!page || page.frames.length <= 1) return;
  if (!confirm('Delete this frame?')) return;
  const idx = page.frames.findIndex(f => f.id === id);
  page.frames.splice(idx, 1);
  if (state.activeFrameId === id) {
    state.activeFrameId = page.frames[Math.max(0, idx - 1)].id;
    state.selectedCmpId = null;
  }
  renderAll();
}
