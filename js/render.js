// All DOM render functions and the toast helper.
// Circular imports with mutations.js, dnd.js, and builder.js are intentional —
// ES module live bindings resolve them safely at call time.
import { state, getActivePage, getActiveFrame, REGION_ORDER, REGION_LABEL,
         getMainFlow, locateCmp, ensureRegionOptions } from './state.js';
import { COMPONENT_TYPES, PATTERNS } from './data.js';
import { renderSchematic } from './schematics.js';

// Resolved at call time (circular — mutations/dnd/builder import renderAll from here).
import { applyPattern, appendComponent, moveComponent, removeComponent,
         addPage, deletePage, switchPage, addFrame, deleteFrame, setLayoutMode,
         serializePage } from './mutations.js';
import { clearDropIndicators, onCanvasDragOver, onCanvasDrop,
         attachEmptyDrop, attachRegionDrop } from './dnd.js';
import { openBuilder } from './builder.js';

export const $ = sel => document.querySelector(sel);

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
export function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ── Master re-render ───────────────────────────────────────────────────────
export function renderAll() {
  renderLibrary();
  renderPageTabs();
  renderFrameTabs();
  renderCanvas();
  renderInspector();
}

// ── Library panel ──────────────────────────────────────────────────────────
export function renderLibrary() {
  document.querySelectorAll('.tab[data-libtab]').forEach(t =>
    t.classList.toggle('active', t.dataset.libtab === state.libTab));

  const libBody = $('#libraryBody');
  libBody.innerHTML = '';

  if (state.libTab === 'patterns') {
    const title = document.createElement('div');
    title.className = 'group-title'; title.textContent = 'Page presets';
    libBody.appendChild(title);
    PATTERNS.forEach(p => libBody.appendChild(libItem({
      icon: p.icon, name: p.name, desc: p.desc, meta: p.components.join(' · '),
      drag: { kind: 'pattern', id: p.id }, click: () => applyPattern(p.id),
    })));

  } else if (state.libTab === 'components') {
    const groups = {};
    Object.entries(COMPONENT_TYPES).forEach(([type, info]) => {
      (groups[info.group] = groups[info.group] || []).push([type, info]);
    });
    Object.entries(groups).forEach(([g, items]) => {
      const t = document.createElement('div'); t.className = 'group-title'; t.textContent = g;
      libBody.appendChild(t);
      items.forEach(([type, info]) => libBody.appendChild(libItem({
        icon: type.slice(0, 3).toUpperCase(), name: info.label, desc: info.desc, meta: type,
        drag: { kind: 'component', type }, click: () => appendComponent(type),
      })));
    });

  } else { // 'custom'
    const addWrap = document.createElement('div'); addWrap.style.cssText = 'padding:10px 8px 4px;';
    const addBtn = document.createElement('button'); addBtn.className = 'btn';
    addBtn.textContent = '+ New component'; addBtn.style.width = '100%';
    addBtn.addEventListener('click', () => openBuilder(null));
    addWrap.appendChild(addBtn); libBody.appendChild(addWrap);

    if (!state.customComponents.length) {
      const hint = document.createElement('div'); hint.className = 'empty-hint'; hint.style.margin = '8px';
      hint.textContent = 'No custom components yet. Build one above.';
      libBody.appendChild(hint);
    } else {
      state.customComponents.forEach(def => {
        const wrap = document.createElement('div'); wrap.style.cssText = 'position:relative;';
        const item = libItem({
          icon: (def.icon || 'CMP').slice(0, 3).toUpperCase(),
          name: def.name, desc: def.desc || '',
          meta: `${def.slots.length} slot${def.slots.length !== 1 ? 's' : ''}`,
          drag: { kind: 'component', type: 'custom', customId: def.id },
          click: () => appendComponent('custom', null, null, def.id),
        });
        const ic = item.querySelector('.lib-icon');
        if (ic && def.color) {
          ic.style.color = def.color; ic.style.borderColor = def.color;
          ic.style.background = def.color + '22';
        }
        const editBtn = document.createElement('button'); editBtn.className = 'btn';
        editBtn.textContent = '✎'; editBtn.title = 'Edit';
        editBtn.style.cssText = 'position:absolute;top:6px;right:6px;height:20px;width:20px;padding:0;font-size:11px;';
        editBtn.addEventListener('click', e => { e.stopPropagation(); openBuilder(def.id); });
        item.appendChild(editBtn); wrap.appendChild(item); libBody.appendChild(wrap);
      });
    }
  }
}

export function libItem({ icon, name, desc, meta, drag, click }) {
  const el = document.createElement('div');
  el.className = 'lib-item';
  el.draggable = true;
  el.innerHTML = `
    <div class="lib-icon">${icon}</div>
    <div>
      <div class="lib-name"></div>
      <div class="lib-desc"></div>
      <div class="lib-meta"></div>
    </div>`;
  el.querySelector('.lib-name').textContent = name;
  el.querySelector('.lib-desc').textContent = desc;
  el.querySelector('.lib-meta').textContent = meta;
  el.addEventListener('click', click);
  el.addEventListener('dragstart', e => {
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-vsub', JSON.stringify(drag));
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  return el;
}

// ── Page tabs ──────────────────────────────────────────────────────────────
export function renderPageTabs() {
  const host = $('#pageTabs'); host.innerHTML = '';
  state.pages.forEach(p => {
    const t = document.createElement('div');
    t.className = 'page-tab' + (p.id === state.activePageId ? ' active' : '');
    const name = document.createElement('span'); name.textContent = p.name;
    const route = document.createElement('span'); route.className = 'route'; route.textContent = p.route;
    t.append(name, route);
    if (state.pages.length > 1) {
      const x = document.createElement('span'); x.className = 'close'; x.textContent = '×';
      x.addEventListener('click', e => { e.stopPropagation(); deletePage(p.id); });
      t.append(x);
    }
    t.addEventListener('click', () => switchPage(p.id));
    host.appendChild(t);
  });
  const add = document.createElement('div'); add.className = 'add-btn'; add.title = 'Add page'; add.textContent = '+';
  add.addEventListener('click', addPage);
  host.appendChild(add);
}

// ── Frame tabs ─────────────────────────────────────────────────────────────
export function renderFrameTabs() {
  const page = getActivePage();
  const host = $('#frameTabs'); host.innerHTML = '';
  const lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:11px;color:var(--text-mute);margin-right:4px;';
  lbl.textContent = 'Frames:';
  host.appendChild(lbl);
  if (!page) return;
  page.frames.forEach(f => {
    const t = document.createElement('div');
    t.className = 'frame-tab' + (f.id === state.activeFrameId ? ' active' : '');
    t.textContent = f.label;
    if (page.frames.length > 1) {
      const x = document.createElement('span'); x.className = 'close'; x.textContent = '×';
      x.addEventListener('click', e => { e.stopPropagation(); deleteFrame(f.id); });
      t.append(x);
    }
    t.addEventListener('click', () => { state.activeFrameId = f.id; state.selectedCmpId = null; renderAll(); });
    host.appendChild(t);
  });
  const add = document.createElement('div'); add.className = 'add-btn';
  add.style.cssText = 'font-size:12px;padding:0 6px;'; add.textContent = '+';
  add.addEventListener('click', addFrame);
  host.appendChild(add);
}

// ── Canvas ─────────────────────────────────────────────────────────────────
export function renderCanvas() {
  const page  = getActivePage();
  const frame = getActiveFrame();
  $('#deviceUrl').textContent = 'acme-admin.app' + (page ? page.route : '/');
  const body = $('#frameBody'); body.innerHTML = '';
  if (!frame) return;

  if (frame.layoutMode === 'regions') {
    const grid = document.createElement('div');
    const regions = frame.layout.regions;
    const hasHeader  = (regions.header  || []).length > 0;
    const hasSidebar = (regions.sidebar || []).length > 0;
    const hasFooter  = (regions.footer  || []).length > 0;
    grid.className = 'regions'
      + (hasHeader  ? ' has-header'  : ' no-header')
      + (hasSidebar ? ' has-sidebar' : ' no-sidebar')
      + (hasFooter  ? ' has-footer'  : ' no-footer');
    REGION_ORDER.forEach(r => grid.appendChild(renderRegion(r, frame)));
    body.appendChild(grid);
    return;
  }

  if (!frame.layout.components.length) {
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Drag a preset or component here';
    body.appendChild(hint);
    attachEmptyDrop(hint, body, null);
    return;
  }
  frame.layout.components.forEach((c, idx) => body.appendChild(renderComponent(c, idx, frame, null)));
}

export function renderRegion(regionName, frame) {
  const wrap = document.createElement('div');
  wrap.className = `region r-${regionName}`;
  wrap.dataset.region = regionName;
  const lbl = document.createElement('span');
  lbl.className = 'region-label'; lbl.textContent = REGION_LABEL[regionName];
  wrap.appendChild(lbl);

  const content = document.createElement('div');
  content.className = 'region-content' + (regionName === 'main' ? ` main-flow-${getMainFlow(frame)}` : '');

  const list = frame.layout.regions[regionName];
  if (!list.length && regionName !== 'main') wrap.classList.add('collapsed');
  if (!list.length) {
    const hint = document.createElement('div'); hint.className = 'region-empty';
    hint.textContent = regionName === 'sidebar' ? 'Drop sidebar here' : `Drop here · ${regionName}`;
    content.appendChild(hint);
  } else {
    list.forEach((c, idx) => content.appendChild(renderComponent(c, idx, frame, regionName)));
  }
  wrap.appendChild(content);
  attachRegionDrop(wrap, regionName);
  return wrap;
}

export function renderComponent(c, idx, frame, region) {
  const el = document.createElement('div');
  el.className = 'cmp' + (c.id === state.selectedCmpId ? ' selected' : '');
  if (c.type === 'sidebar' && region === 'sidebar') el.classList.add('cmp-shell-sidebar');
  if (region === 'main' && ['list','chart','form','detail','modal'].includes(c.type)) el.classList.add('cmp-wide');
  el.dataset.cmpId = c.id;
  if (region) el.dataset.region = region;
  el.draggable = true;

  const tag = document.createElement('span');
  tag.className = 'cmp-tag'; tag.textContent = `${c.type} · "${c.label}"`;
  el.appendChild(tag);

  const actions = document.createElement('div'); actions.className = 'cmp-actions';
  const mk = (txt, title, fn) => {
    const b = document.createElement('button'); b.textContent = txt; b.title = title;
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  };
  actions.append(
    mk('↑', 'Move up',   () => moveComponent(c.id, -1)),
    mk('↓', 'Move down', () => moveComponent(c.id, +1)),
    mk('×', 'Remove',    () => removeComponent(c.id)),
  );
  el.appendChild(actions);
  el.appendChild(renderSchematic(c, region));

  el.addEventListener('click', e => {
    if (e.target.closest('.cmp-actions')) return;
    state.selectedCmpId = c.id; renderAll();
  });
  el.addEventListener('dragstart', e => {
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-vsub', JSON.stringify({ kind: 'reorder', id: c.id }));
  });
  el.addEventListener('dragend', () => { el.classList.remove('dragging'); clearDropIndicators(); });
  el.addEventListener('dragover', e => onCanvasDragOver(e, el));
  el.addEventListener('drop',     e => onCanvasDrop(e, el));
  return el;
}

// ── Inspector ──────────────────────────────────────────────────────────────
export function renderInspector() {
  const page  = getActivePage();
  const frame = getActiveFrame();
  const cmp   = frame && (locateCmp(frame, state.selectedCmpId) || {}).list
                  ?.find(c => c.id === state.selectedCmpId);
  const host = $('#inspectorBody'); host.innerHTML = '';

  // Page section
  const pageSec = document.createElement('div'); pageSec.className = 'insp-section';
  pageSec.innerHTML = `<h4>Page</h4>
    <div class="field"><label>Name</label><input id="pageName" /></div>
    <div class="field"><label>Route</label><input id="pageRoute" /></div>
    <div class="field"><label>Frame</label><select id="frameSelect"></select></div>
    <div class="field"><label>Layout</label>
      <div class="seg" id="layoutModeSeg" role="tablist">
        <button data-mode="flat">Flat</button>
        <button data-mode="regions">Regions</button>
      </div>
    </div>
    <div class="field"><label>Smart dock</label>
      <select id="smartDock">
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </div>
    <div class="field"><label>Main flow</label>
      <select id="mainFlow">
        <option value="stack">Stack</option>
        <option value="two-col">2 columns</option>
        <option value="three-col">3 columns</option>
      </select>
    </div>
    <div style="font-size:11px;color:var(--text-mute);margin-top:4px;">
      <b>Regions</b> previews the future schema (PRD §9):
      <code style="font-family:var(--mono)">layout.regions = { header, sidebar, main, footer }</code>.
    </div>`;
  host.appendChild(pageSec);

  pageSec.querySelector('#pageName').value  = page ? page.name  : '';
  pageSec.querySelector('#pageRoute').value = page ? page.route : '';
  pageSec.querySelector('#pageName').addEventListener('input', e => {
    if (page) { page.name = e.target.value; renderPageTabs(); renderJson(); }
  });
  pageSec.querySelector('#pageRoute').addEventListener('input', e => {
    if (page) {
      page.route = e.target.value; renderPageTabs();
      $('#deviceUrl').textContent = 'acme-admin.app' + page.route;
      renderJson();
    }
  });

  const frameSel = pageSec.querySelector('#frameSelect');
  if (page) page.frames.forEach(f => {
    const o = document.createElement('option');
    o.value = f.id; o.textContent = f.label;
    if (f.id === state.activeFrameId) o.selected = true;
    frameSel.appendChild(o);
  });
  frameSel.addEventListener('change', e => {
    state.activeFrameId = e.target.value; state.selectedCmpId = null; renderAll();
  });

  const seg = pageSec.querySelector('#layoutModeSeg');
  seg.querySelectorAll('button').forEach(b => {
    if (frame && b.dataset.mode === frame.layoutMode) b.classList.add('active');
    b.addEventListener('click', () => setLayoutMode(b.dataset.mode));
  });

  const smartDockSel = pageSec.querySelector('#smartDock');
  const mainFlowSel  = pageSec.querySelector('#mainFlow');
  if (frame && frame.layoutMode === 'regions') {
    const opts = ensureRegionOptions(frame);
    smartDockSel.value = opts.smartDock ? 'on' : 'off';
    mainFlowSel.value  = opts.mainFlow;
    smartDockSel.disabled = false; mainFlowSel.disabled = false;
  } else {
    smartDockSel.value = 'on'; mainFlowSel.value = 'stack';
    smartDockSel.disabled = true; mainFlowSel.disabled = true;
  }
  smartDockSel.addEventListener('change', e => {
    if (!frame || frame.layoutMode !== 'regions') return;
    ensureRegionOptions(frame).smartDock = e.target.value === 'on';
    renderAll();
  });
  mainFlowSel.addEventListener('change', e => {
    if (!frame || frame.layoutMode !== 'regions') return;
    ensureRegionOptions(frame).mainFlow = e.target.value;
    renderCanvas(); renderJson();
  });

  // Component section
  const cmpSec = document.createElement('div'); cmpSec.className = 'insp-section';
  if (cmp) {
    cmpSec.innerHTML = `<h4>Selected component</h4>
      <div class="field"><label>Type</label><select id="cmpType"></select></div>
      <div class="field"><label>Label</label><input id="cmpLabel" /></div>
      <div class="field"><label>ID</label><input id="cmpId" disabled /></div>
      <div style="font-size:11px;color:var(--text-mute);margin-top:6px;">
        V1 schema · only <code style="font-family:var(--mono)">type</code> +
        <code style="font-family:var(--mono)">label</code> are stored.
      </div>`;
    const typeSel = cmpSec.querySelector('#cmpType');
    Object.keys(COMPONENT_TYPES).forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      if (t === cmp.type) o.selected = true; typeSel.appendChild(o);
    });
    typeSel.addEventListener('change', e => { cmp.type = e.target.value; renderCanvas(); renderJson(); });
    const labelInp = cmpSec.querySelector('#cmpLabel');
    labelInp.value = cmp.label;
    labelInp.addEventListener('input', e => { cmp.label = e.target.value; renderCanvas(); renderJson(); });
    cmpSec.querySelector('#cmpId').value = cmp.id;
  } else {
    cmpSec.innerHTML = `<h4>Selected component</h4>
      <div style="font-size:12px;color:var(--text-mute);">Click a component on the canvas to edit it.</div>`;
  }
  host.appendChild(cmpSec);

  // JSON section
  const jsonSec = document.createElement('div');
  jsonSec.className = 'insp-section'; jsonSec.style.borderBottom = '0'; jsonSec.style.paddingBottom = '0';
  jsonSec.innerHTML = `<h4>PageDefinition JSON</h4>`;
  host.appendChild(jsonSec);
  const pre = document.createElement('pre'); pre.className = 'json'; pre.id = 'jsonOut';
  host.appendChild(pre);
  renderJson();
}

// ── JSON output ────────────────────────────────────────────────────────────
export function renderJson() {
  const page = getActivePage();
  const out  = $('#jsonOut');
  if (!page || !out) return;
  out.innerHTML = highlightJson(serializePage(page));
}

export function highlightJson(obj) {
  const s = JSON.stringify(obj, null, 2);
  const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(s)
    .replace(/("(\\.|[^"\\])*")\s*:/g, '<span class="k">$1</span>:')
    .replace(/:\s*("(\\.|[^"\\])*")/g, ': <span class="s">$1</span>')
    .replace(/:\s*(-?\d+(\.\d+)?)/g, ': <span class="n">$1</span>')
    .replace(/([{}\[\],])/g, '<span class="p">$1</span>');
}
