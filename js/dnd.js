// Drag-and-drop handlers for the canvas and region drop targets.
import { getActiveFrame, locateCmp } from './state.js';
import { applyPattern, appendComponent, reorderById, moveToRegion } from './mutations.js';

export function hasOurPayload(e) {
  return Array.from(e.dataTransfer.types || []).includes('application/x-vsub');
}

export function readPayload(e) {
  try { return JSON.parse(e.dataTransfer.getData('application/x-vsub')); }
  catch { return null; }
}

export function clearDropIndicators() {
  document.querySelectorAll('.drop-indicator').forEach(d => d.remove());
  document.querySelectorAll('.frame-body.over-empty').forEach(b => b.classList.remove('over-empty'));
  document.querySelectorAll('.empty-hint.over').forEach(h => h.classList.remove('over'));
  document.querySelectorAll('.region.over').forEach(r => r.classList.remove('over'));
}

export function onCanvasDragOver(e, targetEl) {
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

export function onCanvasDrop(e, targetEl) {
  if (!hasOurPayload(e)) return;
  e.preventDefault(); e.stopPropagation();
  const data = readPayload(e); if (!data) { clearDropIndicators(); return; }
  const frame = getActiveFrame(); if (!frame) { clearDropIndicators(); return; }
  const targetId = targetEl.dataset.cmpId;
  const region   = targetEl.dataset.region || null;
  const loc  = locateCmp(frame, targetId);
  const list = loc ? loc.list : (frame.layoutMode === 'regions'
    ? frame.layout.regions[region || 'main'] : frame.layout.components);
  const tgtIdx = loc ? loc.index : list.length;
  const rect   = targetEl.getBoundingClientRect();
  const before = (e.clientY - rect.top) < rect.height / 2;
  const insertAt = before ? tgtIdx : tgtIdx + 1;
  clearDropIndicators();
  if (data.kind === 'pattern')   applyPattern(data.id, region, insertAt);
  else if (data.kind === 'component') appendComponent(data.type, region, insertAt, data.customId || null);
  else if (data.kind === 'reorder')   reorderById(data.id, targetId, before);
}

export function attachEmptyDrop(hint, body, region) {
  [hint, body].forEach(el => {
    el.addEventListener('dragover', e => {
      if (!hasOurPayload(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      hint.classList.add('over'); body.classList.add('over-empty');
    });
    el.addEventListener('dragleave', () => {
      hint.classList.remove('over'); body.classList.remove('over-empty');
    });
    el.addEventListener('drop', e => {
      if (!hasOurPayload(e)) return;
      e.preventDefault();
      const data = readPayload(e); clearDropIndicators(); if (!data) return;
      if (data.kind === 'pattern')        applyPattern(data.id, region, null);
      else if (data.kind === 'component') appendComponent(data.type, region, null, data.customId || null);
    });
  });
}

export function attachRegionDrop(regionEl, regionName) {
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
    if (data.kind === 'pattern')        applyPattern(data.id, regionName, null);
    else if (data.kind === 'component') appendComponent(data.type, regionName, null);
    else if (data.kind === 'reorder')   moveToRegion(data.id, regionName);
  });
}
