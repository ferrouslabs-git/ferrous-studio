// All state mutations: applyPattern, appendComponent, move, remove, page/frame CRUD, setLayoutMode.
(() => {
  const api = window.VSUB = window.VSUB || {};

  function serializeFrame(frame) {
    const stripCmp = component => {
      const out = { id: component.id, type: component.type, label: component.label };
      if (component.customId) out.customId = component.customId;
      return out;
    };
    if (frame.layoutMode === 'regions') {
      const regions = {};
      api.REGION_ORDER.forEach(region => {
        regions[region] = (frame.layout.regions[region] || []).map(stripCmp);
      });
      const opts = api.ensureRegionOptions(frame);
      return {
        id: frame.id,
        label: frame.label,
        layoutMode: 'regions',
        layout: { regions, options: { smartDock: opts.smartDock, mainFlow: opts.mainFlow } },
      };
    }
    return { id: frame.id, label: frame.label, layout: { components: frame.layout.components.map(stripCmp) } };
  }

  function serializePage(page) {
    return { id: page.id, name: page.name, route: page.route, frames: page.frames.map(serializeFrame) };
  }

  function setLayoutMode(mode) {
    const frame = api.getActiveFrame();
    if (!frame || frame.layoutMode === mode) return;
    if (mode === 'regions') {
      const components = frame.layout.components || [];
      frame.layout = { regions: api.flatToRegions(components), options: { smartDock: true, mainFlow: 'stack' } };
    } else {
      frame.layout = { components: api.regionsToFlat(frame.layout.regions || api.emptyRegions()) };
    }
    frame.layoutMode = mode;
    api.renderAll();
  }

  function applyPattern(patternId, region = null, atIndex = null) {
    const pattern = api.PATTERNS.find(p => p.id === patternId);
    if (!pattern) return;
    const frame = api.getActiveFrame();
    if (!frame) return;
    const newCmps = pattern.components.map(type => ({ id: api.uid('c'), type, label: api.DEFAULT_LABELS[type] || type }));

    // Full preset apply is region-first: map each component into its contract slot.
    if (region == null && atIndex == null) {
      const regions = api.emptyRegions();
      newCmps.forEach(component => {
        regions[api.classifyRegion(component.type)].push(component);
      });
      let options = { smartDock: true, mainFlow: 'stack' };
      if (frame.layoutMode === 'regions') {
        const prev = api.ensureRegionOptions(frame);
        options = { smartDock: prev.smartDock, mainFlow: prev.mainFlow };
      }
      frame.layoutMode = 'regions';
      frame.layout = { regions, options };
      api.state.selectedCmpId = null;
      api.toast(`Applied pattern: ${pattern.name}`);
      api.renderAll();
      return;
    }

    if (frame.layoutMode === 'regions') {
      const list = frame.layout.regions[region];
      const fits = newCmps.filter(c => api.classifyRegion(c.type) === region);
      const overflow = newCmps.filter(c => api.classifyRegion(c.type) !== region);
      list.splice(atIndex == null ? list.length : atIndex, 0, ...fits);
      overflow.forEach(c => frame.layout.regions[api.classifyRegion(c.type)].push(c));
      api.toast(`Inserted pattern: ${pattern.name}`);
    } else {
      const list = frame.layout.components;
      list.splice(atIndex, 0, ...newCmps);
      api.toast(`Inserted pattern: ${pattern.name}`);
    }
    api.state.selectedCmpId = null;
    api.renderAll();
  }

  function appendComponent(type, region = null, atIndex = null, customId = null) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const def = type === 'custom' && customId ? api.state.customComponents.find(d => d.id === customId) : null;
    const label = def ? def.name : (api.DEFAULT_LABELS[type] || type);
    const component = { id: api.uid('c'), type, label };
    if (type === 'custom' && customId) component.customId = customId;

    const wantsRegions = frame.layoutMode === 'regions' || region != null;
    if (wantsRegions && frame.layoutMode !== 'regions') {
      frame.layout = { regions: api.flatToRegions(frame.layout.components || []), options: { smartDock: true, mainFlow: 'stack' } };
      frame.layoutMode = 'regions';
      api.toast('Auto layout: switched to Regions');
    }

    if (frame.layoutMode === 'regions') {
      const targetRegion = (api.isSmartDock(frame) && api.STRUCTURAL_TYPES.has(type)) ? api.classifyRegion(type) : (region || api.classifyRegion(type));
      const list = frame.layout.regions[targetRegion];

      // If this is a structural (shell) type and the target region already has a
      // component that owns the same region, swap it rather than stacking.
      const isStructural = api.STRUCTURAL_TYPES.has(type);
      const isExplicitDrop = region != null && atIndex != null; // user explicitly dropped at a position
      if (isStructural && !isExplicitDrop) {
        const existingIdx = list.findIndex(c => api.STRUCTURAL_TYPES.has(c.type) && api.classifyRegion(c.type) === targetRegion);
        if (existingIdx !== -1) {
          // Preserve the label if it hasn't been customised (still equals its default label)
          const defaultLabel = api.DEFAULT_LABELS[type] || type;
          list[existingIdx] = { ...component, label: defaultLabel };
          api.state.selectedCmpId = component.id;
          api.toast(`Swapped to ${defaultLabel}`);
          api.renderAll();
          return;
        }
      }

      if (atIndex == null) list.push(component); else list.splice(atIndex, 0, component);
    } else {
      const list = frame.layout.components;
      if (atIndex == null) list.push(component); else list.splice(atIndex, 0, component);
    }

    api.state.selectedCmpId = component.id;
    api.renderAll();
  }

  function moveComponent(id, delta) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const loc = api.locateCmp(frame, id);
    if (!loc) return;
    const nextIndex = loc.index + delta;
    if (nextIndex < 0 || nextIndex >= loc.list.length) return;
    [loc.list[loc.index], loc.list[nextIndex]] = [loc.list[nextIndex], loc.list[loc.index]];
    api.renderAll();
  }

  function removeComponent(id) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const loc = api.locateCmp(frame, id);
    if (!loc) return;
    loc.list.splice(loc.index, 1);
    if (api.state.selectedCmpId === id) api.state.selectedCmpId = null;
    api.renderAll();
  }

  function reorderById(srcId, targetId, before) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const src = api.locateCmp(frame, srcId);
    if (!src) return;
    const [item] = src.list.splice(src.index, 1);
    if (frame.layoutMode === 'regions' && api.isSmartDock(frame) && api.STRUCTURAL_TYPES.has(item.type)) {
      frame.layout.regions[api.classifyRegion(item.type)].push(item);
      api.renderAll();
      return;
    }
    const target = api.locateCmp(frame, targetId);
    if (!target) src.list.push(item);
    else target.list.splice(before ? target.index : target.index + 1, 0, item);
    api.renderAll();
  }

  function appendToRegion(type, region) {
    appendComponent(type, region, null);
  }

  function moveToRegion(srcId, region) {
    const frame = api.getActiveFrame();
    if (!frame || frame.layoutMode !== 'regions') return;
    const src = api.locateCmp(frame, srcId);
    if (!src) return;
    const [item] = src.list.splice(src.index, 1);
    const targetRegion = (api.isSmartDock(frame) && api.STRUCTURAL_TYPES.has(item.type)) ? api.classifyRegion(item.type) : region;
    frame.layout.regions[targetRegion].push(item);
    api.renderAll();
  }

  function addPage() {
    const name = prompt('Page name?', 'New page');
    if (!name) return;
    const route = prompt('Route?', '/' + name.toLowerCase().replace(/\s+/g, '-'));
    if (route == null) return;
    const page = api.page(name, route, [], 'regions');
    api.state.pages.push(page);
    api.state.activePageId = page.id;
    api.state.activeFrameId = page.frames[0].id;
    api.state.selectedCmpId = null;
    api.renderAll();
  }

  function deletePage(id) {
    if (api.state.pages.length <= 1) return;
    if (!confirm('Delete this page?')) return;
    const idx = api.state.pages.findIndex(p => p.id === id);
    api.state.pages.splice(idx, 1);
    if (api.state.activePageId === id) {
      const next = api.state.pages[Math.max(0, idx - 1)];
      api.state.activePageId = next.id;
      api.state.activeFrameId = next.frames[0].id;
      api.state.selectedCmpId = null;
    }
    api.renderAll();
  }

  function switchPage(id) {
    api.state.activePageId = id;
    const page = api.getActivePage();
    api.state.activeFrameId = page.frames[0].id;
    api.state.selectedCmpId = null;
    api.renderAll();
  }

  function addFrame() {
    const page = api.getActivePage();
    if (!page) return;
    const label = prompt('Frame label?', 'Variant ' + (page.frames.length + 1));
    if (!label) return;
    const clone = confirm('Clone the current frame? Cancel for an empty frame.');
    const src = api.getActiveFrame();
    let frame;
    if (clone && src) {
      const dup = arr => arr.map(c => ({ ...c, id: api.uid('c') }));
      if (src.layoutMode === 'regions') {
        const regions = {};
        api.REGION_ORDER.forEach(region => { regions[region] = dup(src.layout.regions[region] || []); });
        const opts = api.ensureRegionOptions(src);
        frame = { id: api.uid('frame'), label, layoutMode: 'regions', layout: { regions, options: { smartDock: opts.smartDock, mainFlow: opts.mainFlow } } };
      } else {
        frame = { id: api.uid('frame'), label, layoutMode: 'flat', layout: { components: dup(src.layout.components) } };
      }
    } else {
      const mode = src ? src.layoutMode : 'flat';
      frame = mode === 'regions'
        ? { id: api.uid('frame'), label, layoutMode: 'regions', layout: { regions: api.emptyRegions(), options: { smartDock: true, mainFlow: 'stack' } } }
        : { id: api.uid('frame'), label, layoutMode: 'flat', layout: { components: [] } };
    }
    page.frames.push(frame);
    api.state.activeFrameId = frame.id;
    api.state.selectedCmpId = null;
    api.renderAll();
  }

  function deleteFrame(id) {
    const page = api.getActivePage();
    if (!page || page.frames.length <= 1) return;
    if (!confirm('Delete this frame?')) return;
    const idx = page.frames.findIndex(f => f.id === id);
    page.frames.splice(idx, 1);
    if (api.state.activeFrameId === id) {
      api.state.activeFrameId = page.frames[Math.max(0, idx - 1)].id;
      api.state.selectedCmpId = null;
    }
    api.renderAll();
  }

  Object.assign(api, {
    serializeFrame,
    serializePage,
    setLayoutMode,
    applyPattern,
    appendComponent,
    moveComponent,
    removeComponent,
    reorderById,
    appendToRegion,
    moveToRegion,
    addPage,
    deletePage,
    switchPage,
    addFrame,
    deleteFrame,
  });
})();