// Component Builder modal — create, edit, and delete custom component definitions.
import { state, uid } from './state.js';
import { renderAll, toast, $ } from './render.js';

const SLOT_TYPES  = ['heading','text','label','badge','button','input','image','row','divider'];
const ICON_COLORS = ['#6aa0ff','#58c08d','#e0b341','#e06060','#a080ff','#60c0e0','#e0a060'];

let builderDraft = null;
let _builderListenersAttached = false;

// ── Public entry point ─────────────────────────────────────────────────────
export function openBuilder(existingId) {
  const ex = existingId ? state.customComponents.find(d => d.id === existingId) : null;
  builderDraft = ex
    ? JSON.parse(JSON.stringify(ex))
    : { id: uid('cdef'), name: '', desc: '', icon: 'CMP', color: ICON_COLORS[0], slots: [] };
  _mountBuilderListeners();
  _syncBuilderFields();
  $('#builderOverlay').classList.add('open');
}

// ── Internal helpers ───────────────────────────────────────────────────────
function closeBuilder() {
  $('#builderOverlay').classList.remove('open');
  builderDraft = null;
}

function saveBuilder() {
  if (!builderDraft || !builderDraft.name.trim()) { toast('Give the component a name first'); return; }
  const idx = state.customComponents.findIndex(d => d.id === builderDraft.id);
  if (idx >= 0) state.customComponents[idx] = builderDraft;
  else state.customComponents.push(builderDraft);
  const saved = builderDraft.name;
  closeBuilder();
  state.libTab = 'custom';
  renderAll();
  toast(`Saved "${saved}"`);
}

function deleteBuilder() {
  if (!builderDraft || !confirm('Delete this component?')) return;
  const idx = state.customComponents.findIndex(d => d.id === builderDraft.id);
  if (idx >= 0) state.customComponents.splice(idx, 1);
  closeBuilder();
  renderAll();
  toast('Component deleted');
}

function _updateBuilderPreview() {
  const content = $('#bPreviewContent'); if (!content || !builderDraft) return;
  const tag = $('#bPreviewTag'); if (tag) tag.textContent = `custom · "${builderDraft.name || 'Unnamed'}"`;
  content.innerHTML = _renderCustomSchematicHtml(builderDraft);
  const ip = $('#bIconPreview'); if (!ip) return;
  ip.textContent = (builderDraft.icon || 'CMP').slice(0, 4).toUpperCase();
  ip.style.background   = builderDraft.color + '22';
  ip.style.color        = builderDraft.color;
  ip.style.borderColor  = builderDraft.color;
}

// Local schematic renderer (for the live preview inside the modal).
function _renderCustomSchematicHtml(def) {
  if (!def || !def.slots || !def.slots.length) {
    return '<div style="font-size:11px;color:var(--text-mute);font-style:italic;padding:4px 0;">No slots defined.</div>';
  }
  return def.slots.map(s => {
    switch (s.type) {
      case 'heading': return '<div class="sk-bar" style="width:58%;height:12px;margin:2px 0;"></div>';
      case 'text':    return '<div style="display:flex;flex-direction:column;gap:4px;"><div class="sk-bar dim" style="width:90%;"></div><div class="sk-bar dim" style="width:72%;"></div></div>';
      case 'label':   return '<div class="sk-bar dim" style="width:38%;height:8px;"></div>';
      case 'badge':   return `<span class="sk-pill">${s.label || 'Badge'}</span>`;
      case 'button':  return `<span class="sk-pill accent">${s.label || 'Action'}</span>`;
      case 'input':   return '<div class="sk-input" style="width:100%;"></div>';
      case 'image':   return '<div style="height:72px;background:var(--skeleton-dim);border-radius:5px;"></div>';
      case 'divider': return '<div style="height:1px;background:var(--border);margin:4px 0;"></div>';
      case 'row':     return `<div class="sk-row" style="gap:8px;"><div class="sk-bar" style="width:28%;height:8px;"></div><div class="sk-bar dim" style="width:28%;height:8px;"></div><span class="sk-pill accent" style="margin-left:auto;">${s.label || 'Action'}</span></div>`;
      default:        return '<div class="sk-bar dim" style="width:60%;"></div>';
    }
  }).join('');
}

function _renderColorPicker() {
  const el = $('#bColorPicker'); if (!el || !builderDraft) return; el.innerHTML = '';
  ICON_COLORS.forEach(col => {
    const sw = document.createElement('div'); sw.className = 'color-swatch'; sw.style.background = col; sw.title = col;
    if (col === builderDraft.color) sw.classList.add('active');
    sw.addEventListener('click', () => {
      builderDraft.color = col; _renderColorPicker(); _updateBuilderPreview();
    });
    el.appendChild(sw);
  });
}

function _renderSlotList() {
  const host = $('#bSlotList'); if (!host || !builderDraft) return; host.innerHTML = '';
  const cnt = $('#bSlotCount'); if (cnt) cnt.textContent = `(${builderDraft.slots.length})`;
  builderDraft.slots.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'slot-row';
    const handle  = document.createElement('span'); handle.className = 'slot-handle'; handle.textContent = '⠿';
    const typeSel = document.createElement('select');
    SLOT_TYPES.forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      if (t === s.type) o.selected = true; typeSel.appendChild(o);
    });
    typeSel.addEventListener('change', e => {
      builderDraft.slots[i].type = e.target.value; _renderSlotList(); _updateBuilderPreview();
    });
    const labelInp = document.createElement('input'); labelInp.placeholder = 'Label (optional)'; labelInp.value = s.label || '';
    labelInp.addEventListener('input', e => { builderDraft.slots[i].label = e.target.value; _updateBuilderPreview(); });
    const del = document.createElement('button'); del.className = 'slot-del'; del.textContent = '×'; del.title = 'Remove';
    del.addEventListener('click', () => { builderDraft.slots.splice(i, 1); _renderSlotList(); _updateBuilderPreview(); });
    row.append(handle, typeSel, labelInp, del);
    host.appendChild(row);
  });
}

function _syncBuilderFields() {
  if (!builderDraft) return;
  const n = $('#bName'); if (n) n.value = builderDraft.name;
  const d = $('#bDesc'); if (d) d.value = builderDraft.desc || '';
  const ic = $('#bIcon'); if (ic) ic.value = builderDraft.icon || 'CMP';
  const del = $('#bDelete');
  if (del) del.style.display = state.customComponents.find(x => x.id === builderDraft.id) ? '' : 'none';
  _renderColorPicker();
  _renderSlotList();
  _updateBuilderPreview();
}

function _mountBuilderListeners() {
  if (_builderListenersAttached) return; _builderListenersAttached = true;
  $('#bSave').addEventListener('click', saveBuilder);
  $('#bCancel').addEventListener('click', closeBuilder);
  $('#bDelete').addEventListener('click', deleteBuilder);
  $('#bName').addEventListener('input', e => { if (builderDraft) { builderDraft.name = e.target.value; _updateBuilderPreview(); } });
  $('#bDesc').addEventListener('input', e => { if (builderDraft) builderDraft.desc = e.target.value; });
  $('#bIcon').addEventListener('input', e => { if (builderDraft) { builderDraft.icon = e.target.value.toUpperCase(); _updateBuilderPreview(); } });
  $('#bAddSlot').addEventListener('click', () => {
    if (builderDraft) {
      builderDraft.slots.push({ id: uid('sl'), type: 'text', label: '' });
      _renderSlotList(); _updateBuilderPreview();
    }
  });
}
