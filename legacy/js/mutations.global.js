// All state mutations: applyPattern, appendComponent, move, remove, page/frame CRUD, setLayoutMode.
(() => {
  const api = window.VSUB = window.VSUB || {};

  function serializeFrame(frame) {
    const stripCmp = component => {
      const out = { id: component.id, type: component.type, label: component.label };
      if (component.customId) out.customId = component.customId;
      if (component.props && Object.keys(component.props).length) out.props = component.props;
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

  function createEditableDefinition(seedLabel = 'Editable component') {
    const base = (seedLabel || 'Editable component').trim() || 'Editable component';
    const taken = new Set(api.state.customComponents.map(d => (d.name || '').toLowerCase()));
    let name = base;
    let n = 2;
    while (taken.has(name.toLowerCase())) {
      name = `${base} ${n++}`;
    }
    return {
      id: api.uid('cdef'),
      name,
      desc: 'Editable custom block',
      icon: 'EDT',
      color: '#6aa0ff',
      rootLayout: 'col',
      rootAlign: 'start',
      rootGridCols: 2,
      rootGap: 8,
      rootPadding: 8,
      slots: [
        { id: api.uid('sl'), type: 'heading', label: 'Section title' },
        { id: api.uid('sl'), type: 'text', label: 'Helper text' },
        { id: api.uid('sl'), type: 'input', label: '' },
        { id: api.uid('sl'), type: 'button-row', label: 'Cancel, Save' },
      ],
    };
  }

  function ensureEditableComponentLink(cmp) {
    if (!cmp || cmp.type !== 'editable-component') return null;
    if (cmp.customId) {
      const existing = api.state.customComponents.find(d => d.id === cmp.customId);
      if (existing) return existing;
    }
    const created = createEditableDefinition(cmp.label || api.DEFAULT_LABELS['editable-component']);
    api.state.customComponents.push(created);
    cmp.customId = created.id;
    if (!cmp.label || cmp.label === api.DEFAULT_LABELS['editable-component']) cmp.label = created.name;
    return created;
  }

  function editEditableComponentByCmpId(cmpId) {
    const hit = getCmpById(cmpId);
    if (!hit) return;
    const { cmp } = hit;
    if (cmp.type !== 'editable-component' && cmp.type !== 'custom') return;
    if (cmp.type === 'custom') {
      if (cmp.customId) api.openBuilder(cmp.customId);
      return;
    }
    const def = ensureEditableComponentLink(cmp);
    if (!def) return;
    api.openBuilder(def.id);
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
    const newCmps = pattern.components.map(type => {
      const cmp = { id: api.uid('c'), type, label: api.DEFAULT_LABELS[type] || type };
      const defaults = api.getDefaultProps(type);
      if (Object.keys(defaults).length) cmp.props = JSON.parse(JSON.stringify(defaults));
      return cmp;
    });

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
    if (type === 'editable-component') {
      const created = createEditableDefinition(label);
      api.state.customComponents.push(created);
      component.customId = created.id;
      component.label = created.name;
    }
    const defaults = api.getDefaultProps(type);
    if (Object.keys(defaults).length) component.props = JSON.parse(JSON.stringify(defaults));

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
      const dup = arr => arr.map(c => ({
        ...c,
        id: api.uid('c'),
        props: c.props ? JSON.parse(JSON.stringify(c.props)) : c.props,
      }));
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

  function getCmpById(id) {
    const frame = api.getActiveFrame();
    if (!frame) return null;
    const loc = api.locateCmp(frame, id);
    if (!loc) return null;
    return { frame, loc, cmp: loc.list[loc.index] };
  }

  function ensureCmpProps(cmp) {
    if (cmp.props && typeof cmp.props === 'object') return cmp.props;
    const defaults = api.getDefaultProps(cmp.type);
    cmp.props = Object.keys(defaults).length ? JSON.parse(JSON.stringify(defaults)) : {};
    return cmp.props;
  }

  function addComponentPropItem(id, key = 'items') {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const props = ensureCmpProps(cmp);
    if (!Array.isArray(props[key])) {
      const defaults = api.getDefaultProps(cmp.type);
      props[key] = Array.isArray(defaults[key]) ? [...defaults[key]] : [];
    }
    const next = `Item ${props[key].length + 1}`;
    props[key].push(next);
    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function renameComponentPropItem(id, key, itemIndex, nextText) {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const props = ensureCmpProps(cmp);
    if (!Array.isArray(props[key])) return;
    if (itemIndex < 0 || itemIndex >= props[key].length) return;
    const value = (nextText || '').trim();
    if (!value) return;
    props[key][itemIndex] = value;
    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function setComponentPropValue(id, key, nextText) {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const value = (nextText || '').trim();
    const props = ensureCmpProps(cmp);
    props[key] = value;
    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function setComponentPropPathValue(id, path, nextText) {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const props = ensureCmpProps(cmp);
    const parts = String(path || '').split('.').filter(Boolean);
    if (!parts.length) return;

    let node = props;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
      if (node[key] == null) return;
      node = node[key];
    }
    const last = parts[parts.length - 1];
    const finalKey = /^\d+$/.test(last) ? Number(last) : last;
    node[finalKey] = (nextText || '').trim();

    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function addComponentPropRow(id, key = 'rows') {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const props = ensureCmpProps(cmp);
    const rows = Array.isArray(props[key]) ? props[key] : [];
    props[key] = rows;

    const cols = Array.isArray(props.columns) ? props.columns.length : 3;
    rows.push(Array.from({ length: Math.max(1, cols) }, (_, i) => `Value ${rows.length + 1}.${i + 1}`));

    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function addComponentPropColumn(id, columnsKey = 'columns', rowsKey = 'rows') {
    const hit = getCmpById(id);
    if (!hit) return;
    const { cmp } = hit;
    const props = ensureCmpProps(cmp);

    const columns = Array.isArray(props[columnsKey]) ? props[columnsKey] : [];
    const rows = Array.isArray(props[rowsKey]) ? props[rowsKey] : [];
    props[columnsKey] = columns;
    props[rowsKey] = rows;

    const nextColIndex = columns.length + 1;
    columns.push(`Column ${nextColIndex}`);

    rows.forEach((row, ri) => {
      if (!Array.isArray(row)) {
        rows[ri] = [];
      }
      rows[ri].push(`Value ${ri + 1}.${nextColIndex}`);
    });

    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function renameShellGroupTitle(id, groupIndex, nextText) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const loc = api.locateCmp(frame, id);
    if (!loc) return;
    const cmp = loc.list[loc.index];
    if (!cmp.props || !Array.isArray(cmp.props.groups)) return;
    if (groupIndex < 0 || groupIndex >= cmp.props.groups.length) return;
    const value = (nextText || '').trim();
    cmp.props.groups[groupIndex].title = value;
    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function addShellItem(id, groupIndex = null) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const loc = api.locateCmp(frame, id);
    if (!loc) return;
    const cmp = loc.list[loc.index];
    const defaults = api.getDefaultProps(cmp.type);
    cmp.props = cmp.props || (Object.keys(defaults).length ? JSON.parse(JSON.stringify(defaults)) : {});

    if (cmp.type === 'sidenav-grouped') {
      const groups = Array.isArray(cmp.props.groups) ? cmp.props.groups : [];
      const idx = Number.isInteger(groupIndex) ? groupIndex : 0;
      if (!groups[idx]) return;
      const nextLabel = `Item ${groups[idx].items.length + 1}`;
      groups[idx].items.push(nextLabel);
    } else {
      addComponentPropItem(id, 'items');
      return;
    }

    api.state.selectedCmpId = cmp.id;
    api.renderAll();
  }

  function renameShellItem(id, itemIndex, nextText, groupIndex = null) {
    const frame = api.getActiveFrame();
    if (!frame) return;
    const loc = api.locateCmp(frame, id);
    if (!loc) return;
    const cmp = loc.list[loc.index];
    const value = (nextText || '').trim();
    if (!value) return;

    if (cmp.type === 'sidenav-grouped') {
      if (!cmp.props || !Array.isArray(cmp.props.groups)) return;
      const g = cmp.props.groups[groupIndex];
      if (!g || !Array.isArray(g.items)) return;
      if (itemIndex < 0 || itemIndex >= g.items.length) return;
      g.items[itemIndex] = value;
    } else {
      renameComponentPropItem(id, 'items', itemIndex, value);
      return;
    }

    api.state.selectedCmpId = cmp.id;
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
    ensureEditableComponentLink,
    editEditableComponentByCmpId,
    addPage,
    deletePage,
    switchPage,
    addFrame,
    deleteFrame,
    addComponentPropItem,
    renameComponentPropItem,
    setComponentPropValue,
    setComponentPropPathValue,
    addComponentPropRow,
    addComponentPropColumn,
    renameShellGroupTitle,
    addShellItem,
    renameShellItem,
  });
})();