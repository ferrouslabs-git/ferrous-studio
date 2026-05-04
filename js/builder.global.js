// Component Builder — interactive canvas with tree-based slots, grouping, and reordering.
(() => {
  const api = window.VSUB = window.VSUB || {};

  // Leaf slot types (cannot have children).
  const LEAF_TYPES = ['heading', 'text', 'label', 'badge', 'button', 'button-row', 'input', 'image', 'divider'];
  const PALETTE = [
    { type: 'heading',    label: 'Heading',    icon: 'H' },
    { type: 'text',       label: 'Text',       icon: 'T' },
    { type: 'label',      label: 'Label',      icon: 'L' },
    { type: 'badge',      label: 'Badge',      icon: 'B' },
    { type: 'button',     label: 'Button',     icon: '◉' },
    { type: 'button-row', label: 'Button row', icon: '◉◉' },
    { type: 'input',      label: 'Input',      icon: '▭' },
    { type: 'image',      label: 'Image',      icon: '🖼' },
    { type: 'divider',    label: 'Divider',    icon: '—' },
  ];
  const ICON_COLORS = ['#6aa0ff', '#58c08d', '#e0b341', '#e06060', '#a080ff', '#60c0e0', '#e0a060'];
  const HISTORY_LIMIT = 120;

  let draft = null;          // current edited def
  let selection = [];        // array of slot ids
  let listenersAttached = false;
  let dragSource = null;     // { kind: 'node', id } or { kind: 'palette', type }
  let lastDropTarget = null; // DOM element currently styled as drop target
  let lastDropMode = null;   // 'before' | 'after' | 'into'
  let marquee = null;        // selection rectangle state
  let marqueeEl = null;      // marquee DOM element (recreated after canvas rerender)
  let historyPast = [];      // stack of prior draft snapshots
  let historyFuture = [];    // stack of redo draft snapshots

  // ── Open / close ──────────────────────────────────────────────
  function openBuilder(existingId) {
    const existing = existingId ? api.state.customComponents.find(d => d.id === existingId) : null;
    if (existing) {
      draft = JSON.parse(JSON.stringify(existing));
      migrateDraft(draft);
    } else {
      draft = {
        id: api.uid('cdef'),
        name: '',
        desc: '',
        icon: 'CMP',
        color: ICON_COLORS[0],
        rootLayout: 'col',
        rootAlign: 'start',
        rootGridCols: 2,
        rootGap: 8,
        rootPadding: 8,
        slots: [],
      };
    }
    selection = [];
    mountListeners();
    syncFields();
    initHistory();
    renderAll();
    api.$('#builderOverlay').classList.add('open');
  }

  function closeBuilder() {
    api.$('#builderOverlay').classList.remove('open');
    draft = null;
    selection = [];
    historyPast = [];
    historyFuture = [];
  }

  function cloneDraft() {
    return JSON.parse(JSON.stringify(draft));
  }

  function sameDraft(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function initHistory() {
    historyPast = [];
    historyFuture = [];
    if (!draft) return;
    historyPast.push(cloneDraft());
  }

  function captureHistoryIfChanged() {
    if (!draft || !historyPast.length) return;
    const last = historyPast[historyPast.length - 1];
    if (sameDraft(last, draft)) return;
    historyPast.push(cloneDraft());
    if (historyPast.length > HISTORY_LIMIT) historyPast.shift();
    historyFuture = [];
  }

  function undoDraft() {
    if (historyPast.length <= 1) return;
    const current = historyPast.pop();
    historyFuture.push(current);
    draft = JSON.parse(JSON.stringify(historyPast[historyPast.length - 1]));
    selection = [];
    syncFields();
    renderAll();
  }

  function redoDraft() {
    if (!historyFuture.length) return;
    const next = historyFuture.pop();
    historyPast.push(JSON.parse(JSON.stringify(next)));
    draft = JSON.parse(JSON.stringify(next));
    selection = [];
    syncFields();
    renderAll();
  }

  // Migrate any legacy / missing ids.
  function migrateDraft(d) {
    if (!Array.isArray(d.slots)) d.slots = [];
    if (!d.rootLayout) d.rootLayout = 'col';
    if (!d.rootAlign) d.rootAlign = 'start';
    if (!d.rootGridCols) d.rootGridCols = 2;
    if (d.rootGap == null) d.rootGap = 8;
    if (d.rootPadding == null) d.rootPadding = 8;
    walkSlots(d.slots, s => { if (!s.id) s.id = api.uid('sl'); });
  }

  // ── Save / delete ─────────────────────────────────────────────
  function saveBuilder() {
    if (!draft || !draft.name.trim()) {
      api.toast('Give the component a name first');
      return;
    }
    const idx = api.state.customComponents.findIndex(d => d.id === draft.id);
    if (idx >= 0) api.state.customComponents[idx] = draft;
    else api.state.customComponents.push(draft);
    const saved = draft.name;
    closeBuilder();
    api.state.libTab = 'custom';
    api.renderAll();
    api.toast(`Saved "${saved}"`);
  }

  function deleteBuilder() {
    if (!draft || !confirm('Delete this component?')) return;
    const idx = api.state.customComponents.findIndex(d => d.id === draft.id);
    if (idx >= 0) api.state.customComponents.splice(idx, 1);
    closeBuilder();
    api.renderAll();
    api.toast('Component deleted');
  }

  // ── Tree helpers ──────────────────────────────────────────────
  function walkSlots(arr, fn, parent) {
    arr.forEach((s, i) => {
      fn(s, arr, i, parent);
      if (s.type === 'group' && s.children) walkSlots(s.children, fn, s);
    });
  }

  // Find the slot, its parent array, and its index.
  function locate(id, arr = draft.slots, parent = null) {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === id) return { slot: arr[i], parentArr: arr, parent, index: i };
      if (arr[i].type === 'group' && arr[i].children) {
        const hit = locate(id, arr[i].children, arr[i]);
        if (hit) return hit;
      }
    }
    return null;
  }

  function getById(id) { const r = locate(id); return r ? r.slot : null; }

  // All selected nodes; filter out missing.
  function selectedNodes() { return selection.map(id => locate(id)).filter(Boolean); }

  function commonParent() {
    const nodes = selectedNodes();
    if (!nodes.length) return null;
    const first = nodes[0].parentArr;
    return nodes.every(n => n.parentArr === first) ? first : null;
  }

  function isContiguousSelection() {
    const nodes = selectedNodes();
    if (nodes.length <= 1) return nodes.length === 1;
    if (!commonParent()) return false;
    const idx = nodes.map(n => n.index).sort((a, b) => a - b);
    for (let i = 1; i < idx.length; i++) if (idx[i] !== idx[i - 1] + 1) return false;
    return true;
  }

  // ── Operations ────────────────────────────────────────────────
  function addSlot(type) {
    if (!draft) return;
    const slot = makeLeaf(type);
    const target = preferredInsertParent();
    target.push(slot);
    selection = [slot.id];
    renderAll();
  }

  function makeLeaf(type) {
    const defaults = {
      heading: 'Heading',
      text: '',
      label: 'Label',
      badge: 'Badge',
      button: 'Action',
      'button-row': 'Cancel, Save',
      input: '',
      image: '',
      divider: '',
    };
    return { id: api.uid('sl'), type, label: defaults[type] || '' };
  }

  // If a single group is selected, insert into it; else into root.
  function preferredInsertParent() {
    if (selection.length === 1) {
      const r = locate(selection[0]);
      if (r && r.slot.type === 'group') return r.slot.children;
    }
    return draft.slots;
  }

  function groupSelected(layout) {
    if (!isContiguousSelection()) {
      api.toast('Select adjacent siblings to group');
      return;
    }
    const parent = commonParent();
    const indices = selectedNodes().map(n => n.index).sort((a, b) => a - b);
    const start = indices[0];
    const taken = parent.splice(start, indices.length);
    const group = {
      id: api.uid('grp'),
      type: 'group',
      layout,
      gridCols: 2,
      label: '',
      children: taken,
    };
    parent.splice(start, 0, group);
    selection = [group.id];
    renderAll();
  }

  function ungroupSelected() {
    if (selection.length !== 1) {
      api.toast('Select a single group to ungroup');
      return;
    }
    const r = locate(selection[0]);
    if (!r || r.slot.type !== 'group') {
      api.toast('Selection is not a group');
      return;
    }
    const kids = r.slot.children;
    r.parentArr.splice(r.index, 1, ...kids);
    selection = kids.map(k => k.id);
    renderAll();
  }

  function moveSelected(dir) {
    if (selection.length !== 1) return;
    const r = locate(selection[0]);
    if (!r) return;
    const newIdx = r.index + (dir === 'up' ? -1 : 1);
    if (newIdx < 0 || newIdx >= r.parentArr.length) return;
    const [item] = r.parentArr.splice(r.index, 1);
    r.parentArr.splice(newIdx, 0, item);
    renderAll();
  }

  function duplicateSelected() {
    if (selection.length !== 1) return;
    const r = locate(selection[0]);
    if (!r) return;
    const clone = JSON.parse(JSON.stringify(r.slot));
    walkSlots([clone], s => { s.id = api.uid(s.type === 'group' ? 'grp' : 'sl'); });
    r.parentArr.splice(r.index + 1, 0, clone);
    selection = [clone.id];
    renderAll();
  }

  function deleteSelected() {
    if (!selection.length) return;
    // Sort so deeper / later removed first.
    const targets = selectedNodes().sort((a, b) => b.index - a.index);
    targets.forEach(n => n.parentArr.splice(n.index, 1));
    selection = [];
    renderAll();
  }

  // ── Selection ─────────────────────────────────────────────────
  function setSelection(id, ev) {
    if (!id) { selection = []; renderAll(); return; }
    const additive = ev && (ev.shiftKey || ev.ctrlKey || ev.metaKey);
    if (additive) {
      const i = selection.indexOf(id);
      if (i >= 0) selection.splice(i, 1);
      else selection.push(id);
    } else {
      selection = [id];
    }
    renderAll();
  }

  // ── Identity sync ─────────────────────────────────────────────
  function syncFields() {
    if (!draft) return;
    api.$('#bName').value = draft.name || '';
    api.$('#bDesc').value = draft.desc || '';
    api.$('#bIcon').value = draft.icon || 'CMP';
    api.$('#bDelete').style.display = api.state.customComponents.find(x => x.id === draft.id) ? '' : 'none';
  }

  function renderColorPicker() {
    const el = api.$('#bColorPicker');
    if (!el || !draft) return;
    el.innerHTML = '';
    ICON_COLORS.forEach(color => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = color;
      sw.title = color;
      if (color === draft.color) sw.classList.add('active');
      sw.addEventListener('click', () => {
        draft.color = color;
        renderAll();
      });
      el.appendChild(sw);
    });
  }

  function renderIconPreview() {
    const ip = api.$('#bIconPreview');
    if (!ip || !draft) return;
    ip.textContent = (draft.icon || 'CMP').slice(0, 4).toUpperCase();
    ip.style.background = (draft.color || '#6aa0ff') + '22';
    ip.style.color = draft.color || '#6aa0ff';
    ip.style.borderColor = draft.color || '#6aa0ff';
  }

  // ── Palette ───────────────────────────────────────────────────
  function renderPalette() {
    const host = api.$('#bPalette');
    if (!host) return;
    host.innerHTML = '';
    PALETTE.forEach(p => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'bldr-palette-item';
      item.draggable = true;
      item.innerHTML = `<span class="bldr-pal-icon">${p.icon}</span><span class="bldr-pal-name">${p.label}</span>`;
      item.title = `Click to add, or drag onto canvas`;
      item.addEventListener('click', () => addSlot(p.type));
      item.addEventListener('dragstart', e => {
        item.classList.add('dragging');
        dragSource = { kind: 'palette', type: p.type };
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', 'palette:' + p.type);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        clearDragState();
      });
      host.appendChild(item);
    });
  }

  // ── Canvas ────────────────────────────────────────────────────
  function renderCanvas() {
    const host = api.$('#bCanvas');
    if (!host || !draft) return;
    host.innerHTML = '';
    if (!draft.slots.length) {
      const empty = document.createElement('div');
      empty.className = 'bldr-empty';
      empty.textContent = 'Click a palette item or drag one here to start';
      attachRootDropZone(empty);
      host.appendChild(empty);
      return;
    }
    const root = document.createElement('div');
    const rootLayout = draft.rootLayout || 'col';
    const rootAlign = draft.rootAlign || 'start';
    const rootGap = Math.max(0, Number(draft.rootGap ?? 8));
    const rootPadding = Math.max(0, Number(draft.rootPadding ?? 8));
    const rootJustify = rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'flex-end' : 'flex-start';
    root.className = 'bldr-root bldr-layout-' + rootLayout;
    root.dataset.dropParent = 'root';
    root.style.gap = `${rootGap}px`;
    root.style.padding = `${rootPadding}px`;
    if (rootLayout === 'grid') {
      root.style.display = 'grid';
      root.style.gridTemplateColumns = `repeat(${draft.rootGridCols || 2}, minmax(180px, 1fr))`;
      root.style.justifyItems = rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'end' : 'start';
    } else if (rootLayout === 'row') {
      root.style.display = 'flex';
      root.style.flexDirection = 'row';
      root.style.flexWrap = 'wrap';
      root.style.justifyContent = rootJustify;
      root.style.alignItems = 'flex-start';
      root.style.alignContent = 'flex-start';
    } else {
      root.style.display = 'flex';
      root.style.flexDirection = 'column';
      root.style.alignItems = rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'flex-end' : 'flex-start';
    }
    draft.slots.forEach(slot => root.appendChild(renderNode(slot, rootLayout)));
    attachRootDropZone(root);
    host.appendChild(root);
    autoFitOversizedNodes(root);
    captureHistoryIfChanged();
  }

  // Automatically scale oversized leaf previews down to parent width.
  function autoFitOversizedNodes(root) {
    const nodes = root.querySelectorAll('.bldr-node:not(.is-group)');
    nodes.forEach(node => {
      const preview = node.querySelector('.bldr-leaf-render > *');
      if (!preview) return;
      preview.style.transform = '';
      preview.style.transformOrigin = 'left top';
      preview.style.width = preview.style.width || '';
      const available = node.parentElement ? node.parentElement.clientWidth - 20 : 0;
      const natural = preview.scrollWidth;
      if (!available || !natural || natural <= available) {
        node.style.minHeight = '';
        return;
      }
      const scale = Math.max(0.55, Math.min(1, available / natural));
      preview.style.transform = `scale(${scale})`;
      node.style.minHeight = Math.ceil(preview.scrollHeight * scale + 10) + 'px';
    });
  }

  // Drop on the root container itself = append to root.
  function attachRootDropZone(el) {
    el.addEventListener('dragover', e => {
      if (!dragSource) return;
      // Only handle if not over a child node (children handle their own dragover).
      if (e.target !== el) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragSource.kind === 'palette' ? 'copy' : 'move';
      setDropTarget(el, 'root-append');
    });
    el.addEventListener('drop', e => {
      if (!dragSource || e.target !== el) return;
      e.preventDefault();
      performDrop(draft.slots, draft.slots.length, 'append');
    });
  }

  function renderNode(slot, parentLayout) {
    const isGroup = slot.type === 'group';
    const node = document.createElement('div');
    node.className = 'bldr-node' + (isGroup ? ' is-group' : '');
    if (parentLayout === 'row') node.classList.add('in-row-parent');
    if (parentLayout === 'grid') node.classList.add('in-grid-parent');
    if (isGroup) node.classList.add('bldr-layout-' + (slot.layout || 'col'));
    if (selection.includes(slot.id)) node.classList.add('selected');
    node.dataset.slotId = slot.id;
    node.draggable = true;

    node.addEventListener('click', e => {
      e.stopPropagation();
      setSelection(slot.id, e);
    });

    // Drag source
    node.addEventListener('dragstart', e => {
      e.stopPropagation();
      dragSource = { kind: 'node', id: slot.id };
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'node:' + slot.id); } catch (_) {}
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('dragging');
      clearDragState();
    });

    // Drag over self = position relative to this node (before/after/into-group)
    node.addEventListener('dragover', e => {
      if (!dragSource) return;
      // Don't drop onto self or descendants
      if (dragSource.kind === 'node' && (dragSource.id === slot.id || isDescendantOf(slot, dragSource.id))) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = dragSource.kind === 'palette' ? 'copy' : 'move';
      const rect = node.getBoundingClientRect();
      const isRow = parentLayout === 'row';
      const pos = isRow ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height;
      let mode;
      if (isGroup && pos > 0.25 && pos < 0.75) mode = 'into';
      else if (pos < 0.5) mode = 'before';
      else mode = 'after';
      setDropTarget(node, mode);
    });

    node.addEventListener('drop', e => {
      if (!dragSource) return;
      if (dragSource.kind === 'node' && (dragSource.id === slot.id || isDescendantOf(slot, dragSource.id))) return;
      e.preventDefault();
      e.stopPropagation();
      const here = locate(slot.id);
      if (!here) return;
      if (lastDropMode === 'into' && isGroup) {
        performDrop(slot.children = slot.children || [], slot.children.length, 'append');
      } else if (lastDropMode === 'before') {
        performDrop(here.parentArr, here.index, 'insert');
      } else {
        performDrop(here.parentArr, here.index + 1, 'insert');
      }
    });

    if (isGroup) {
      const head = document.createElement('div');
      head.className = 'bldr-group-head';
      const layoutLabel = (slot.layout || 'col').toUpperCase()
        + (slot.layout === 'grid' ? ' · ' + (slot.gridCols || 2) + 'col' : '')
        + (slot.align && slot.align !== 'start' ? ' · ' + slot.align : '');
      head.innerHTML = `<span class="bldr-group-tag">${layoutLabel}</span>`;
      node.appendChild(head);
      const body = document.createElement('div');
      body.className = 'bldr-group-body';
      body.style.width = '100%';
      body.style.minWidth = '0';
      const align = slot.align || 'start';
      const justify = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start';
      const alignItems = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start';
      if (slot.layout === 'grid') {
        body.style.display = 'grid';
        body.style.gridTemplateColumns = `repeat(${slot.gridCols || 2}, minmax(180px, 1fr))`;
        body.style.justifyItems = alignItems;
      } else if (slot.layout === 'row') {
        body.style.display = 'flex';
        body.style.flexDirection = 'row';
        body.style.flexWrap = 'wrap';
        body.style.alignContent = 'flex-start';
        body.style.justifyContent = justify;
        body.style.alignItems = 'center';
      } else {
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.alignItems = alignItems;
      }
      const childLayout = slot.layout === 'grid' ? 'grid' : slot.layout === 'row' ? 'row' : 'col';
      (slot.children || []).forEach(c => body.appendChild(renderNode(c, childLayout)));
      if (!slot.children || !slot.children.length) {
        const ph = document.createElement('div');
        ph.className = 'bldr-empty bldr-empty-sm';
        ph.textContent = 'Empty group — drop something here';
        ph.style.flex = '1';
        body.appendChild(ph);
      }
      node.appendChild(body);
    } else {
      const inner = document.createElement('div');
      inner.className = 'bldr-leaf-render';
      inner.innerHTML = renderLeafPreview(slot);
      node.appendChild(inner);
      const tag = document.createElement('span');
      tag.className = 'bldr-leaf-tag';
      tag.textContent = slot.type;
      node.appendChild(tag);
    }
    return node;
  }

  // ── Drag helpers ──────────────────────────────────────────────
  function setDropTarget(el, mode) {
    if (lastDropTarget === el && lastDropMode === mode) return;
    clearDropClasses();
    lastDropTarget = el;
    lastDropMode = mode;
    if (mode === 'before') el.classList.add('drop-before');
    else if (mode === 'after') el.classList.add('drop-after');
    else if (mode === 'into') el.classList.add('drop-into');
    else if (mode === 'root-append') el.classList.add('drop-target');
  }

  function clearDropClasses() {
    if (!lastDropTarget) return;
    lastDropTarget.classList.remove('drop-before', 'drop-after', 'drop-into', 'drop-target');
    lastDropTarget = null;
    lastDropMode = null;
  }

  function clearDragState() {
    clearDropClasses();
    dragSource = null;
    lastDropMode = null;
  }

  function isDescendantOf(slot, targetId) {
    if (slot.type !== 'group' || !slot.children) return false;
    for (const c of slot.children) {
      if (c.id === targetId) return true;
      if (isDescendantOf(c, targetId)) return true;
    }
    return false;
  }

  function performDrop(targetArr, targetIndex, kind) {
    if (!dragSource) return;
    if (dragSource.kind === 'palette') {
      const slot = makeLeaf(dragSource.type);
      targetArr.splice(targetIndex, 0, slot);
      selection = [slot.id];
    } else {
      const r = locate(dragSource.id);
      if (!r) return;
      const moving = r.parentArr.splice(r.index, 1)[0];
      // After splice, indices in same array may shift; recompute.
      let idx = targetIndex;
      if (r.parentArr === targetArr && r.index < targetIndex) idx = targetIndex - 1;
      targetArr.splice(idx, 0, moving);
      selection = [moving.id];
    }
    clearDragState();
    renderAll();
  }

  function renderLeafPreview(s) {
    const labels = (s.label || '').split(',').map(x => x.trim()).filter(Boolean);
    switch (s.type) {
      case 'heading':    return `<div class="bldr-prev-heading">${esc(s.label || 'Heading')}</div>`;
      case 'text':       return `<div class="bldr-prev-text">${esc(s.label || 'Lorem ipsum dolor sit amet, consectetur adipiscing.')}</div>`;
      case 'label':      return `<div class="bldr-prev-label">${esc(s.label || 'Label')}</div>`;
      case 'badge':      return `<span class="sk-pill">${esc(s.label || 'Badge')}</span>`;
      case 'button':     return `<span class="sk-pill accent">${esc(s.label || 'Action')}</span>`;
      case 'button-row': {
        const ll = labels.length ? labels : ['Cancel', 'Save'];
        return `<div style="display:flex;gap:6px;justify-content:flex-end;">${ll.map((t, i) => `<span class="sk-pill${i === ll.length - 1 ? ' accent' : ''}">${esc(t)}</span>`).join('')}</div>`;
      }
      case 'input':      return `<div class="bldr-prev-input"></div>`;
      case 'image':      return `<div class="bldr-prev-image"></div>`;
      case 'divider':    return `<div class="bldr-prev-divider"></div>`;
      default:           return `<div>${esc(s.type)}</div>`;
    }
  }

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Properties panel ──────────────────────────────────────────
  function renderProps() {
    const host = api.$('#bProps');
    if (!host) return;
    host.innerHTML = '';
    const nodes = selectedNodes();

    const head = document.createElement('div');
    head.className = 'bldr-section-title';
    head.textContent = 'Properties';
    host.appendChild(head);

    if (!nodes.length) {
      const hint = document.createElement('div');
      hint.className = 'bldr-multi-info';
      hint.textContent = 'Canvas container selected (root parent).';
      host.appendChild(hint);
      addField(host, 'Layout', renderRootLayoutSelector());
      addField(host, 'Align', renderRootAlignSelector());
      addField(host, 'Gap', renderRootGapInput());
      addField(host, 'Padding', renderRootPaddingInput());
      if ((draft.rootLayout || 'col') === 'grid') {
        addField(host, 'Columns', renderRootGridColsInput());
      }
      return;
    }

    if (nodes.length > 1) {
      const m = document.createElement('div');
      m.className = 'bldr-multi-info';
      const sameParent = !!commonParent();
      m.innerHTML = `<b>${nodes.length}</b> nodes selected${sameParent ? '' : ' <span style="color:var(--warn)">(different parents — cannot group)</span>'}`;
      host.appendChild(m);
      addActionButtons(host, false);
      return;
    }

    const slot = nodes[0].slot;
    if (slot.type === 'group') {
      addField(host, 'Layout', renderLayoutSelector(slot));
      addField(host, 'Align', renderAlignSelector(slot));
      if (slot.layout === 'grid') {
        addField(host, 'Columns', renderNumberInput(slot, 'gridCols', 2, 6));
      }
      const child = document.createElement('div');
      child.className = 'bldr-empty-sm';
      child.style.fontSize = '11px';
      child.style.color = 'var(--text-mute)';
      child.style.padding = '4px 0';
      child.textContent = `${(slot.children || []).length} child node(s)`;
      host.appendChild(child);
    } else {
      addField(host, 'Type', renderTypeSelector(slot));
      addField(host, 'Label', renderTextInput(slot, 'label'));
    }
    addActionButtons(host, true);
  }

  function addField(host, label, control) {
    const row = document.createElement('div');
    row.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.append(lab, control);
    host.appendChild(row);
  }

  function renderTypeSelector(slot) {
    const sel = document.createElement('select');
    LEAF_TYPES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      if (t === slot.type) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      slot.type = e.target.value;
      renderAll();
    });
    return sel;
  }

  function renderLayoutSelector(slot) {
    const sel = document.createElement('select');
    [
      { v: 'col', t: 'Flex column ⬇' },
      { v: 'row', t: 'Flex row ➡' },
      { v: 'grid', t: 'Grid ▦' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.t;
      if (o.v === (slot.layout || 'col')) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      slot.layout = e.target.value;
      renderAll();
    });
    return sel;
  }

  function renderAlignSelector(slot) {
    const sel = document.createElement('select');
    [
      { v: 'start',  t: 'Start (left/top)' },
      { v: 'center', t: 'Center' },
      { v: 'end',    t: 'End (right/bottom)' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.t;
      if (o.v === (slot.align || 'start')) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      slot.align = e.target.value;
      renderAll();
    });
    return sel;
  }

  function renderRootLayoutSelector() {
    const sel = document.createElement('select');
    [
      { v: 'col', t: 'Flex column ⬇' },
      { v: 'row', t: 'Flex row ➡' },
      { v: 'grid', t: 'Grid ▦' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if (o.v === (draft.rootLayout || 'col')) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      draft.rootLayout = e.target.value;
      renderAll();
    });
    return sel;
  }

  function renderRootAlignSelector() {
    const sel = document.createElement('select');
    [
      { v: 'start', t: 'Start (left/top)' },
      { v: 'center', t: 'Center' },
      { v: 'end', t: 'End (right/bottom)' },
    ].forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v;
      opt.textContent = o.t;
      if (o.v === (draft.rootAlign || 'start')) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', e => {
      draft.rootAlign = e.target.value;
      renderAll();
    });
    return sel;
  }

  function renderRootGridColsInput() {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = 2;
    inp.max = 6;
    inp.value = draft.rootGridCols || 2;
    inp.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      draft.rootGridCols = Math.max(2, Math.min(6, v));
      renderCanvas();
    });
    return inp;
  }

  function renderRootGapInput() {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = 0;
    inp.max = 48;
    inp.value = draft.rootGap ?? 8;
    inp.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      draft.rootGap = Math.max(0, Math.min(48, v));
      renderCanvas();
    });
    return inp;
  }

  function renderRootPaddingInput() {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = 0;
    inp.max = 64;
    inp.value = draft.rootPadding ?? 8;
    inp.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (isNaN(v)) return;
      draft.rootPadding = Math.max(0, Math.min(64, v));
      renderCanvas();
    });
    return inp;
  }

  function renderTextInput(slot, key) {
    const inp = document.createElement('input');
    inp.value = slot[key] || '';
    inp.placeholder = labelPlaceholder(slot.type);
    inp.addEventListener('input', e => {
      slot[key] = e.target.value;
      renderCanvas();
    });
    return inp;
  }

  function renderNumberInput(slot, key, min, max) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = min; inp.max = max;
    inp.value = slot[key] || min;
    inp.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v)) {
        slot[key] = Math.max(min, Math.min(max, v));
        renderCanvas();
      }
    });
    return inp;
  }

  function labelPlaceholder(type) {
    if (type === 'button-row') return 'Comma-separated labels';
    if (type === 'text') return 'Text content';
    return 'Label';
  }

  function addActionButtons(host, single) {
    const wrap = document.createElement('div');
    wrap.className = 'bldr-prop-actions';
    const dup = document.createElement('button');
    dup.className = 'btn small'; dup.textContent = 'Duplicate';
    dup.disabled = !single;
    dup.addEventListener('click', duplicateSelected);
    const del = document.createElement('button');
    del.className = 'btn small'; del.textContent = 'Delete';
    del.style.color = '#e06060'; del.style.borderColor = '#e06060';
    del.addEventListener('click', deleteSelected);
    wrap.append(dup, del);
    host.appendChild(wrap);
  }

  // ── Toolbar / selection info ──────────────────────────────────
  function renderSelectionInfo() {
    const el = api.$('#bSelInfo');
    if (!el) return;
    const n = selection.length;
    if (!n) { el.textContent = 'Nothing selected'; }
    else if (n === 1) {
      const r = locate(selection[0]);
      el.textContent = r ? `Selected: ${r.slot.type === 'group' ? 'group · ' + (r.slot.layout || 'col') : r.slot.type}` : 'Nothing selected';
    } else {
      el.textContent = `${n} nodes selected`;
    }
    // Enable/disable toolbar buttons
    const single = n === 1;
    const isGroup = single && getById(selection[0])?.type === 'group';
    const canGroup = isContiguousSelection() && n >= 1;
    enable('#bGroupCol', canGroup);
    enable('#bGroupRow', canGroup);
    enable('#bGroupGrid', canGroup);
    enable('#bUngroup', !!isGroup);
    enable('#bMoveUp', single);
    enable('#bMoveDown', single);
    enable('#bDuplicate', single);
    enable('#bDeleteNode', n >= 1);
    enable('#bUndo', historyPast.length > 1);
    enable('#bRedo', historyFuture.length > 0);
  }

  function enable(sel, on) {
    const el = api.$(sel);
    if (el) el.disabled = !on;
  }

  function mountCanvasInteractions() {
    const canvas = api.$('#bCanvas');
    if (!canvas) return;

    // renderCanvas() replaces canvas.innerHTML, so ensure marquee element exists each render.
    if (!marqueeEl || !canvas.contains(marqueeEl)) {
      marqueeEl = document.createElement('div');
      marqueeEl.className = 'bldr-marquee';
      canvas.appendChild(marqueeEl);
    }

    if (canvas.dataset.interactionsMounted === '1') return;
    canvas.dataset.interactionsMounted = '1';

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.bldr-node')) return;
      const rect = canvas.getBoundingClientRect();
      const startX = e.clientX - rect.left + canvas.scrollLeft;
      const startY = e.clientY - rect.top + canvas.scrollTop;
      marquee = { startX, startY, endX: startX, endY: startY, moved: false };
      if (!marqueeEl || !canvas.contains(marqueeEl)) {
        marqueeEl = document.createElement('div');
        marqueeEl.className = 'bldr-marquee';
        canvas.appendChild(marqueeEl);
      }
      marqueeEl.style.display = 'block';
      marqueeEl.style.left = `${startX}px`;
      marqueeEl.style.top = `${startY}px`;
      marqueeEl.style.width = '0px';
      marqueeEl.style.height = '0px';
      e.preventDefault();
    });

    canvas.addEventListener('mousemove', e => {
      if (!marquee) return;
      const rect = canvas.getBoundingClientRect();
      marquee.endX = e.clientX - rect.left + canvas.scrollLeft;
      marquee.endY = e.clientY - rect.top + canvas.scrollTop;
      const dx = Math.abs(marquee.endX - marquee.startX);
      const dy = Math.abs(marquee.endY - marquee.startY);
      if (dx > 4 || dy > 4) marquee.moved = true;
      const left = Math.min(marquee.startX, marquee.endX);
      const top = Math.min(marquee.startY, marquee.endY);
      const width = Math.abs(marquee.endX - marquee.startX);
      const height = Math.abs(marquee.endY - marquee.startY);
      marqueeEl.style.left = `${left}px`;
      marqueeEl.style.top = `${top}px`;
      marqueeEl.style.width = `${width}px`;
      marqueeEl.style.height = `${height}px`;
    });

    window.addEventListener('mouseup', e => {
      if (!marquee) return;
      const currentCanvas = api.$('#bCanvas');
      const currentRect = currentCanvas.getBoundingClientRect();
      const left = Math.min(marquee.startX, marquee.endX);
      const top = Math.min(marquee.startY, marquee.endY);
      const width = Math.abs(marquee.endX - marquee.startX);
      const height = Math.abs(marquee.endY - marquee.startY);
      marqueeEl.style.display = 'none';

      if (!marquee.moved || width < 4 || height < 4) {
        // Empty canvas click should always clear selection.
        selection = [];
        renderAll();
        marquee = null;
        return;
      }

      const selRect = {
        left: currentRect.left + left - currentCanvas.scrollLeft,
        top: currentRect.top + top - currentCanvas.scrollTop,
        right: currentRect.left + left - currentCanvas.scrollLeft + width,
        bottom: currentRect.top + top - currentCanvas.scrollTop + height,
      };

      const hitIds = Array.from(currentCanvas.querySelectorAll('.bldr-node[data-slot-id]'))
        .filter(node => {
          const r = node.getBoundingClientRect();
          return r.left >= selRect.left && r.right <= selRect.right && r.top >= selRect.top && r.bottom <= selRect.bottom;
        })
        .map(node => node.dataset.slotId)
        .filter(Boolean);

      selection = hitIds;
      renderAll();
      marquee = null;
    });
  }

  // ── Render orchestration ──────────────────────────────────────
  function renderAll() {
    renderPalette();
    renderColorPicker();
    renderIconPreview();
    renderCanvas();
    mountCanvasInteractions();
    renderProps();
    captureHistoryIfChanged();
    renderSelectionInfo();
  }

  // ── Listeners ─────────────────────────────────────────────────
  function mountListeners() {
    if (listenersAttached) return;
    listenersAttached = true;
    api.$('#bSave').addEventListener('click', saveBuilder);
    api.$('#bCancel').addEventListener('click', closeBuilder);
    api.$('#bDelete').addEventListener('click', deleteBuilder);
    api.$('#bName').addEventListener('input', e => {
      if (draft) draft.name = e.target.value;
    });
    api.$('#bDesc').addEventListener('input', e => {
      if (draft) draft.desc = e.target.value;
    });
    api.$('#bIcon').addEventListener('input', e => {
      if (!draft) return;
      draft.icon = e.target.value.toUpperCase();
      renderIconPreview();
    });

    api.$('#bGroupCol').addEventListener('click', () => groupSelected('col'));
    api.$('#bGroupRow').addEventListener('click', () => groupSelected('row'));
    api.$('#bGroupGrid').addEventListener('click', () => groupSelected('grid'));
    api.$('#bUngroup').addEventListener('click', ungroupSelected);
    api.$('#bMoveUp').addEventListener('click', () => moveSelected('up'));
    api.$('#bMoveDown').addEventListener('click', () => moveSelected('down'));
    api.$('#bDuplicate').addEventListener('click', duplicateSelected);
    api.$('#bDeleteNode').addEventListener('click', deleteSelected);
    api.$('#bUndo').addEventListener('click', undoDraft);
    api.$('#bRedo').addEventListener('click', redoDraft);

    // Keyboard shortcuts when builder is open.
    document.addEventListener('keydown', e => {
      if (!api.$('#builderOverlay').classList.contains('open')) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && e.shiftKey) { redoDraft(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { redoDraft(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undoDraft(); e.preventDefault(); }
      else if (e.key === 'Escape') closeBuilder();
      else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { duplicateSelected(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && (e.ctrlKey || e.metaKey)) { moveSelected('up'); e.preventDefault(); }
      else if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey)) { moveSelected('down'); e.preventDefault(); }
    });
  }

  api.openBuilder = openBuilder;
})();
