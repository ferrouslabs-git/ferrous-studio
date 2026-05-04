// Component Builder modal — create, edit, and delete custom component definitions.
(() => {
  const api = window.VSUB = window.VSUB || {};
  const SLOT_TYPES = ['heading', 'text', 'label', 'badge', 'button', 'input', 'image', 'row', 'divider'];
  const ICON_COLORS = ['#6aa0ff', '#58c08d', '#e0b341', '#e06060', '#a080ff', '#60c0e0', '#e0a060'];

  let builderDraft = null;
  let builderListenersAttached = false;

  function openBuilder(existingId) {
    const existing = existingId ? api.state.customComponents.find(d => d.id === existingId) : null;
    builderDraft = existing
      ? JSON.parse(JSON.stringify(existing))
      : { id: api.uid('cdef'), name: '', desc: '', icon: 'CMP', color: ICON_COLORS[0], slots: [] };
    mountBuilderListeners();
    syncBuilderFields();
    api.$('#builderOverlay').classList.add('open');
  }

  function closeBuilder() {
    api.$('#builderOverlay').classList.remove('open');
    builderDraft = null;
  }

  function saveBuilder() {
    if (!builderDraft || !builderDraft.name.trim()) {
      api.toast('Give the component a name first');
      return;
    }
    const idx = api.state.customComponents.findIndex(d => d.id === builderDraft.id);
    if (idx >= 0) api.state.customComponents[idx] = builderDraft;
    else api.state.customComponents.push(builderDraft);
    const saved = builderDraft.name;
    closeBuilder();
    api.state.libTab = 'custom';
    api.renderAll();
    api.toast(`Saved "${saved}"`);
  }

  function deleteBuilder() {
    if (!builderDraft || !confirm('Delete this component?')) return;
    const idx = api.state.customComponents.findIndex(d => d.id === builderDraft.id);
    if (idx >= 0) api.state.customComponents.splice(idx, 1);
    closeBuilder();
    api.renderAll();
    api.toast('Component deleted');
  }

  function renderCustomPreview(def) {
    if (!def || !def.slots || !def.slots.length) {
      return '<div style="font-size:11px;color:var(--text-mute);font-style:italic;padding:4px 0;">No slots defined.</div>';
    }
    return def.slots.map(s => {
      switch (s.type) {
        case 'heading': return '<div class="sk-bar" style="width:58%;height:12px;margin:2px 0;"></div>';
        case 'text': return '<div style="display:flex;flex-direction:column;gap:4px;"><div class="sk-bar dim" style="width:90%;"></div><div class="sk-bar dim" style="width:72%;"></div></div>';
        case 'label': return '<div class="sk-bar dim" style="width:38%;height:8px;"></div>';
        case 'badge': return `<span class="sk-pill">${s.label || 'Badge'}</span>`;
        case 'button': return `<span class="sk-pill accent">${s.label || 'Action'}</span>`;
        case 'input': return '<div class="sk-input" style="width:100%;"></div>';
        case 'image': return '<div style="height:72px;background:var(--skeleton-dim);border-radius:5px;"></div>';
        case 'divider': return '<div style="height:1px;background:var(--border);margin:4px 0;"></div>';
        case 'row': return `<div class="sk-row" style="gap:8px;"><div class="sk-bar" style="width:28%;height:8px;"></div><div class="sk-bar dim" style="width:28%;height:8px;"></div><span class="sk-pill accent" style="margin-left:auto;">${s.label || 'Action'}</span></div>`;
        default: return '<div class="sk-bar dim" style="width:60%;"></div>';
      }
    }).join('');
  }

  function updateBuilderPreview() {
    const content = api.$('#bPreviewContent');
    if (!content || !builderDraft) return;
    const tag = api.$('#bPreviewTag');
    if (tag) tag.textContent = `custom · "${builderDraft.name || 'Unnamed'}"`;
    content.innerHTML = renderCustomPreview(builderDraft);
    const iconPreview = api.$('#bIconPreview');
    if (!iconPreview) return;
    iconPreview.textContent = (builderDraft.icon || 'CMP').slice(0, 4).toUpperCase();
    iconPreview.style.background = builderDraft.color + '22';
    iconPreview.style.color = builderDraft.color;
    iconPreview.style.borderColor = builderDraft.color;
  }

  function renderColorPicker() {
    const el = api.$('#bColorPicker');
    if (!el || !builderDraft) return;
    el.innerHTML = '';
    ICON_COLORS.forEach(color => {
      const sw = document.createElement('div');
      sw.className = 'color-swatch';
      sw.style.background = color;
      sw.title = color;
      if (color === builderDraft.color) sw.classList.add('active');
      sw.addEventListener('click', () => {
        builderDraft.color = color;
        renderColorPicker();
        updateBuilderPreview();
      });
      el.appendChild(sw);
    });
  }

  function renderSlotList() {
    const host = api.$('#bSlotList');
    if (!host || !builderDraft) return;
    host.innerHTML = '';
    const count = api.$('#bSlotCount');
    if (count) count.textContent = `(${builderDraft.slots.length})`;
    builderDraft.slots.forEach((slot, index) => {
      const row = document.createElement('div');
      row.className = 'slot-row';
      const handle = document.createElement('span');
      handle.className = 'slot-handle';
      handle.textContent = '⠿';
      const typeSel = document.createElement('select');
      SLOT_TYPES.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        if (type === slot.type) option.selected = true;
        typeSel.appendChild(option);
      });
      typeSel.addEventListener('change', e => {
        builderDraft.slots[index].type = e.target.value;
        renderSlotList();
        updateBuilderPreview();
      });
      const labelInput = document.createElement('input');
      labelInput.placeholder = 'Label (optional)';
      labelInput.value = slot.label || '';
      labelInput.addEventListener('input', e => {
        builderDraft.slots[index].label = e.target.value;
        updateBuilderPreview();
      });
      const del = document.createElement('button');
      del.className = 'slot-del';
      del.textContent = '×';
      del.title = 'Remove';
      del.addEventListener('click', () => {
        builderDraft.slots.splice(index, 1);
        renderSlotList();
        updateBuilderPreview();
      });
      row.append(handle, typeSel, labelInput, del);
      host.appendChild(row);
    });
  }

  function syncBuilderFields() {
    if (!builderDraft) return;
    const nameInput = api.$('#bName');
    if (nameInput) nameInput.value = builderDraft.name;
    const descInput = api.$('#bDesc');
    if (descInput) descInput.value = builderDraft.desc || '';
    const iconInput = api.$('#bIcon');
    if (iconInput) iconInput.value = builderDraft.icon || 'CMP';
    const deleteBtn = api.$('#bDelete');
    if (deleteBtn) deleteBtn.style.display = api.state.customComponents.find(x => x.id === builderDraft.id) ? '' : 'none';
    renderColorPicker();
    renderSlotList();
    updateBuilderPreview();
  }

  function mountBuilderListeners() {
    if (builderListenersAttached) return;
    builderListenersAttached = true;
    api.$('#bSave').addEventListener('click', saveBuilder);
    api.$('#bCancel').addEventListener('click', closeBuilder);
    api.$('#bDelete').addEventListener('click', deleteBuilder);
    api.$('#bName').addEventListener('input', e => {
      if (!builderDraft) return;
      builderDraft.name = e.target.value;
      updateBuilderPreview();
    });
    api.$('#bDesc').addEventListener('input', e => {
      if (builderDraft) builderDraft.desc = e.target.value;
    });
    api.$('#bIcon').addEventListener('input', e => {
      if (!builderDraft) return;
      builderDraft.icon = e.target.value.toUpperCase();
      updateBuilderPreview();
    });
    api.$('#bAddSlot').addEventListener('click', () => {
      if (!builderDraft) return;
      builderDraft.slots.push({ id: api.uid('sl'), type: 'text', label: '' });
      renderSlotList();
      updateBuilderPreview();
    });
  }

  api.openBuilder = openBuilder;
})();