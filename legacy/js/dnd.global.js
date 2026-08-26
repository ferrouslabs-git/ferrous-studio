// Drag-and-drop handlers for the canvas and region drop targets.
(() => {
  const api = window.VSUB = window.VSUB || {};

  function hasOurPayload(e) {
    return Array.from(e.dataTransfer.types || []).includes('application/x-vsub');
  }

  function readPayload(e) {
    try { return JSON.parse(e.dataTransfer.getData('application/x-vsub')); }
    catch { return null; }
  }

  function clearDropIndicators() {
    document.querySelectorAll('.drop-indicator').forEach(d => d.remove());
    document.querySelectorAll('.frame-body.over-empty').forEach(b => b.classList.remove('over-empty'));
    document.querySelectorAll('.empty-hint.over').forEach(h => h.classList.remove('over'));
    document.querySelectorAll('.region.over').forEach(r => r.classList.remove('over'));
  }

  function onCanvasDragOver(e, targetEl) {
    if (!hasOurPayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    clearDropIndicators();
    const rect = targetEl.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const ind = document.createElement('div'); ind.className = 'drop-indicator';
    targetEl.parentNode.insertBefore(ind, before ? targetEl : targetEl.nextSibling);
  }

  function onCanvasDrop(e, targetEl) {
    if (!hasOurPayload(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const data = readPayload(e); if (!data) { clearDropIndicators(); return; }
    const frame = api.getActiveFrame(); if (!frame) { clearDropIndicators(); return; }
    const targetId = targetEl.dataset.cmpId;
    const region = targetEl.dataset.region || null;
    const loc = api.locateCmp(frame, targetId);
    const list = loc ? loc.list : (frame.layoutMode === 'regions' ? frame.layout.regions[region || 'main'] : frame.layout.components);
    const tgtIdx = loc ? loc.index : list.length;
    const rect = targetEl.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    const insertAt = before ? tgtIdx : tgtIdx + 1;
    clearDropIndicators();
    if (data.kind === 'pattern') api.applyPattern(data.id, region, insertAt);
    else if (data.kind === 'component') api.appendComponent(data.type, region, insertAt, data.customId || null);
    else if (data.kind === 'reorder') api.reorderById(data.id, targetId, before);
  }

  function attachEmptyDrop(hint, body, region) {
    [hint, body].forEach(el => {
      el.addEventListener('dragover', e => {
        if (!hasOurPayload(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        hint.classList.add('over');
        body.classList.add('over-empty');
      });
      el.addEventListener('dragleave', () => {
        hint.classList.remove('over');
        body.classList.remove('over-empty');
      });
      el.addEventListener('drop', e => {
        if (!hasOurPayload(e)) return;
        e.preventDefault();
        const data = readPayload(e); clearDropIndicators(); if (!data) return;
        if (data.kind === 'pattern') api.applyPattern(data.id, region, null);
        else if (data.kind === 'component') api.appendComponent(data.type, region, null, data.customId || null);
      });
    });
  }

  function attachRegionDrop(regionEl, regionName) {
    regionEl.addEventListener('dragover', e => {
      if (!hasOurPayload(e)) return;
      if (e.target.closest('.cmp')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
      clearDropIndicators();
      regionEl.classList.add('over');
    });
    regionEl.addEventListener('dragleave', e => {
      if (e.target === regionEl) regionEl.classList.remove('over');
    });
    regionEl.addEventListener('drop', e => {
      if (!hasOurPayload(e)) return;
      if (e.target.closest('.cmp')) return;
      e.preventDefault();
      const data = readPayload(e); clearDropIndicators(); if (!data) return;
      if (data.kind === 'pattern') api.applyPattern(data.id, regionName, null);
      else if (data.kind === 'component') api.appendComponent(data.type, regionName, null);
      else if (data.kind === 'reorder') api.moveToRegion(data.id, regionName);
    });
  }

  Object.assign(api, {
    hasOurPayload,
    readPayload,
    clearDropIndicators,
    onCanvasDragOver,
    onCanvasDrop,
    attachEmptyDrop,
    attachRegionDrop,
  });
})();