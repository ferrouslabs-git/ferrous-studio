// All DOM render functions and the toast helper.
(() => {
  const api = window.VSUB = window.VSUB || {};
  const $ = sel => document.querySelector(sel);
  let toastTimer = null;


  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function renderAll() {
    renderLibrary();
    renderPageTabs();
    renderFrameTabs();
    renderCanvas();
    renderInspector();
  }

  function renderLibrary() {
    document.querySelectorAll('.tab[data-libtab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.libtab === api.state.libTab);
    });

    const libBody = $('#libraryBody');
    libBody.innerHTML = '';

    if (api.state.libTab === 'patterns') {
      const groupOrder = ['Starter', 'Top Nav', 'Left Panel', 'Right Panel', 'Full Shell'];
      const grouped = {};
      api.PATTERNS.forEach(pattern => {
        const key = pattern.group || 'Other';
        (grouped[key] = grouped[key] || []).push(pattern);
      });

      [...groupOrder, ...Object.keys(grouped).filter(g => !groupOrder.includes(g))].forEach(group => {
        const items = grouped[group];
        if (!items || !items.length) return;
        const title = document.createElement('div');
        title.className = 'group-title';
        title.textContent = group;
        libBody.appendChild(title);
        items.forEach(pattern => libBody.appendChild(libItem({
          icon: pattern.icon,
          name: pattern.name,
          desc: pattern.desc,
          meta: pattern.components.join(' · '),
          drag: { kind: 'pattern', id: pattern.id },
          click: () => api.applyPattern(pattern.id),
        })));
      });
    } else if (api.state.libTab === 'components') {
      // ── Standard component groups ──────────────────────────────────
      const groups = {};
      Object.entries(api.COMPONENT_TYPES).forEach(([type, info]) => {
        // Keep Components tab focused on main-area/content widgets only.
        if (api.STRUCTURAL_TYPES.has(type)) return;
        (groups[info.group] = groups[info.group] || []).push([type, info]);
      });
      Object.entries(groups).forEach(([group, items]) => {
        const title = document.createElement('div');
        title.className = 'group-title';
        title.textContent = group;
        libBody.appendChild(title);
        items.forEach(([type, info]) => libBody.appendChild(libItem({
          icon: type.slice(0, 3).toUpperCase(),
          name: info.label,
          desc: info.desc,
          meta: type,
          drag: { kind: 'component', type },
          click: () => api.appendComponent(type),
        })));
      });
    } else {
      const addWrap = document.createElement('div');
      addWrap.style.cssText = 'padding:10px 8px 4px;';
      const addBtn = document.createElement('button');
      addBtn.className = 'btn';
      addBtn.textContent = '+ New component';
      addBtn.style.width = '100%';
      addBtn.addEventListener('click', () => api.openBuilder(null));
      addWrap.appendChild(addBtn);
      libBody.appendChild(addWrap);

      if (!api.state.customComponents.length) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.style.margin = '8px';
        hint.textContent = 'No custom components yet. Build one above.';
        libBody.appendChild(hint);
      } else {
        api.state.customComponents.forEach(def => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative;';
          const item = libItem({
            icon: (def.icon || 'CMP').slice(0, 3).toUpperCase(),
            name: def.name,
            desc: def.desc || '',
            meta: `${def.slots.length} slot${def.slots.length !== 1 ? 's' : ''}`,
            drag: { kind: 'component', type: 'custom', customId: def.id },
            click: () => api.appendComponent('custom', null, null, def.id),
          });
          const icon = item.querySelector('.lib-icon');
          if (icon && def.color) {
            icon.style.color = def.color;
            icon.style.borderColor = def.color;
            icon.style.background = def.color + '22';
          }
          const editBtn = document.createElement('button');
          editBtn.className = 'btn';
          editBtn.textContent = '✎';
          editBtn.title = 'Edit';
          editBtn.style.cssText = 'position:absolute;top:6px;right:6px;height:20px;width:20px;padding:0;font-size:11px;';
          editBtn.addEventListener('click', e => {
            e.stopPropagation();
            api.openBuilder(def.id);
          });
          item.appendChild(editBtn);
          wrap.appendChild(item);
          libBody.appendChild(wrap);
        });
      }
    }
  }

  function libItem({ icon, name, desc, meta, drag, click }) {
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

  function renderPageTabs() {
    const host = $('#pageTabs');
    host.innerHTML = '';
    api.state.pages.forEach(page => {
      const tab = document.createElement('div');
      tab.className = 'page-tab' + (page.id === api.state.activePageId ? ' active' : '');
      const name = document.createElement('span');
      name.textContent = page.name;
      const route = document.createElement('span');
      route.className = 'route';
      route.textContent = page.route;
      tab.append(name, route);
      if (api.state.pages.length > 1) {
        const close = document.createElement('span');
        close.className = 'close';
        close.textContent = '×';
        close.addEventListener('click', e => {
          e.stopPropagation();
          api.deletePage(page.id);
        });
        tab.append(close);
      }
      tab.addEventListener('click', () => api.switchPage(page.id));
      host.appendChild(tab);
    });
    const add = document.createElement('div');
    add.className = 'add-btn';
    add.title = 'Add page';
    add.textContent = '+';
    add.addEventListener('click', api.addPage);
    host.appendChild(add);
  }

  function renderFrameTabs() {
    const page = api.getActivePage();
    const host = $('#frameTabs');
    host.innerHTML = '';
    const label = document.createElement('span');
    label.style.cssText = 'font-size:11px;color:var(--text-mute);margin-right:4px;';
    label.textContent = 'Frames:';
    host.appendChild(label);
    if (!page) return;
    page.frames.forEach(frame => {
      const tab = document.createElement('div');
      tab.className = 'frame-tab' + (frame.id === api.state.activeFrameId ? ' active' : '');
      tab.textContent = frame.label;
      if (page.frames.length > 1) {
        const close = document.createElement('span');
        close.className = 'close';
        close.textContent = '×';
        close.addEventListener('click', e => {
          e.stopPropagation();
          api.deleteFrame(frame.id);
        });
        tab.append(close);
      }
      tab.addEventListener('click', () => {
        api.state.activeFrameId = frame.id;
        api.state.selectedCmpId = null;
        renderAll();
      });
      host.appendChild(tab);
    });
    const add = document.createElement('div');
    add.className = 'add-btn';
    add.style.cssText = 'font-size:12px;padding:0 6px;';
    add.textContent = '+';
    add.addEventListener('click', api.addFrame);
    host.appendChild(add);
  }

  function renderCanvas() {
    const page = api.getActivePage();
    const frame = api.getActiveFrame();
    $('#deviceUrl').textContent = 'acme-admin.app' + (page ? page.route : '/');
    const body = $('#frameBody');
    body.innerHTML = '';
    if (!frame) return;

    if (frame.layoutMode === 'regions') {
      const grid = document.createElement('div');
      const regions = frame.layout.regions;
      const hasHeader = (regions.header || []).length > 0;
      const hasSidebar = (regions.sidebar || []).length > 0;
      const hasRight = (regions.right || []).length > 0;
      const hasFooter = (regions.footer || []).length > 0;
      grid.className = 'regions'
        + (hasHeader ? ' has-header' : ' no-header')
        + (hasSidebar ? ' has-sidebar' : ' no-sidebar')
        + (hasRight ? ' has-right' : ' no-right')
        + (hasFooter ? ' has-footer' : ' no-footer');
      api.REGION_ORDER.forEach(region => grid.appendChild(renderRegion(region, frame)));
      body.appendChild(grid);
      return;
    }

    if (!frame.layout.components.length) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'Drag a preset or component here';
      body.appendChild(hint);
      api.attachEmptyDrop(hint, body, null);
      return;
    }

    frame.layout.components.forEach((component, index) => body.appendChild(renderComponent(component, index, frame, null)));
  }

  function renderRegion(regionName, frame) {
    const wrap = document.createElement('div');
    wrap.className = `region r-${regionName}`;
    wrap.dataset.region = regionName;
    const label = document.createElement('span');
    label.className = 'region-label';
    label.textContent = api.REGION_LABEL[regionName];
    wrap.appendChild(label);

    const content = document.createElement('div');
    content.className = 'region-content' + (regionName === 'main' ? ` main-flow-${api.getMainFlow(frame)}` : '');

    const list = frame.layout.regions[regionName] || [];
    if (!list.length && regionName !== 'main') wrap.classList.add('collapsed');
    if (!list.length) {
      const hint = document.createElement('div');
      hint.className = 'region-empty';
      hint.textContent = regionName === 'sidebar'
        ? 'Drop sidebar here'
        : (regionName === 'right' ? 'Drop right panel here' : `Drop here · ${regionName}`);
      content.appendChild(hint);
    } else {
      list.forEach((component, index) => content.appendChild(renderComponent(component, index, frame, regionName)));
    }
    wrap.appendChild(content);
    api.attachRegionDrop(wrap, regionName);
    return wrap;
  }

  function startInlineEdit(target, initialValue, onCommit) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-edit-input';
    input.value = initialValue || '';
    input.style.width = `${Math.max(72, Math.ceil(target.getBoundingClientRect().width))}px`;

    const parent = target.parentElement;
    if (!parent) return;
    const prevDisplay = target.style.display;
    target.style.display = 'none';
    parent.insertBefore(input, target.nextSibling);

    const cleanup = () => {
      if (input.parentElement) input.parentElement.removeChild(input);
      target.style.display = prevDisplay;
    };

    const commit = () => {
      onCommit(input.value);
      cleanup();
    };

    const cancel = () => cleanup();

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    input.addEventListener('blur', commit, { once: true });

    input.focus();
    input.select();
  }

  function renderComponent(component, index, frame, region) {
    const el = document.createElement('div');
    el.className = 'cmp' + (component.id === api.state.selectedCmpId ? ' selected' : '');
    const isSidenavType = ['sidebar', 'sidenav-simple', 'sidenav-grouped', 'sidenav-workspace'].includes(component.type);
    if (isSidenavType && region === 'sidebar') el.classList.add('cmp-shell-sidebar');
    const isRightPanelType = ['detail', 'rightpanel-detail', 'rightpanel-filters', 'rightpanel-activity'].includes(component.type);
    if (isRightPanelType && region === 'right') el.classList.add('cmp-shell-right');
    if (region === 'main' && ['list', 'chart', 'form', 'detail', 'modal'].includes(component.type)) el.classList.add('cmp-wide');
    el.dataset.cmpId = component.id;
    if (region) el.dataset.region = region;
    el.draggable = true;

    const tag = document.createElement('span');
    tag.className = 'cmp-tag';
    tag.textContent = `${component.type} · "${component.label}"`;
    el.appendChild(tag);

    const actions = document.createElement('div');
    actions.className = 'cmp-actions';
    const mk = (text, title, handler) => {
      const button = document.createElement('button');
      button.textContent = text;
      button.title = title;
      button.addEventListener('click', e => {
        e.stopPropagation();
        handler();
      });
      return button;
    };
    actions.append(
      mk('↑', 'Move up', () => api.moveComponent(component.id, -1)),
      mk('↓', 'Move down', () => api.moveComponent(component.id, 1)),
      mk('×', 'Remove', () => api.removeComponent(component.id))
    );
    if (component.type === 'editable-component' || component.type === 'custom') {
      actions.prepend(mk('✎', 'Edit component structure', () => api.editEditableComponentByCmpId(component.id)));
    }
    el.appendChild(actions);
    el.appendChild(api.renderSchematic(component, region));

    el.addEventListener('click', e => {
      const addColBtn = e.target.closest('[data-prop-add-col]');
      if (addColBtn) {
        e.stopPropagation();
        api.addComponentPropColumn(
          component.id,
          addColBtn.dataset.propAddCol || 'columns',
          addColBtn.dataset.propRowsKey || 'rows'
        );
        return;
      }
      const addRowBtn = e.target.closest('[data-prop-add-row]');
      if (addRowBtn) {
        e.stopPropagation();
        api.addComponentPropRow(component.id, addRowBtn.dataset.propAddRow || 'rows');
        return;
      }
      const propAddBtn = e.target.closest('[data-prop-add-key]');
      if (propAddBtn) {
        e.stopPropagation();
        api.addComponentPropItem(component.id, propAddBtn.dataset.propAddKey || 'items');
        return;
      }
      const addBtn = e.target.closest('[data-shell-add]');
      if (addBtn) {
        e.stopPropagation();
        const rawGroup = addBtn.dataset.shellGroupIndex;
        const groupIndex = rawGroup == null ? null : Number(rawGroup);
        api.addShellItem(component.id, Number.isNaN(groupIndex) ? null : groupIndex);
        return;
      }
      // Let the browser detect native double-click on editable tokens.
      if (e.target.closest('[data-prop-key], [data-prop-path], [data-shell-item-index], [data-shell-group-title-index]')) {
        return;
      }
      if (e.target.closest('.cmp-actions')) return;
      api.state.selectedCmpId = component.id;
      renderAll();
    });
    el.addEventListener('dblclick', e => {
      if (!e.target.closest('[data-prop-key], [data-prop-path], [data-shell-item-index], [data-shell-group-title-index]')) {
        if (component.type === 'editable-component' || component.type === 'custom') {
          e.stopPropagation();
          api.editEditableComponentByCmpId(component.id);
          return;
        }
      }
      const groupTitleTarget = e.target.closest('[data-shell-group-title-index]');
      if (groupTitleTarget) {
        e.stopPropagation();
        const groupIndex = Number(groupTitleTarget.dataset.shellGroupTitleIndex);
        if (Number.isNaN(groupIndex)) return;
        const current = groupTitleTarget.dataset.shellGroupTitleText || groupTitleTarget.textContent.trim();
        startInlineEdit(groupTitleTarget, current, next => api.renameShellGroupTitle(component.id, groupIndex, next));
        return;
      }
      const propTarget = e.target.closest('[data-prop-key]');
      if (propTarget) {
        e.stopPropagation();
        const key = propTarget.dataset.propKey;
        const rawIndex = propTarget.dataset.propIndex;
        const itemIndex = rawIndex == null ? null : Number(rawIndex);
        const current = propTarget.dataset.propText || propTarget.textContent.trim();
        startInlineEdit(propTarget, current, next => {
          if (itemIndex == null || Number.isNaN(itemIndex)) api.setComponentPropValue(component.id, key, next);
          else api.renameComponentPropItem(component.id, key, itemIndex, next);
        });
        return;
      }
      const propPathTarget = e.target.closest('[data-prop-path]');
      if (propPathTarget) {
        e.stopPropagation();
        const path = propPathTarget.dataset.propPath;
        const current = propPathTarget.dataset.propText || propPathTarget.textContent.trim();
        startInlineEdit(propPathTarget, current, next => api.setComponentPropPathValue(component.id, path, next));
        return;
      }
      const target = e.target.closest('[data-shell-item-index]');
      if (!target) return;
      e.stopPropagation();
      const itemIndex = Number(target.dataset.shellItemIndex);
      if (Number.isNaN(itemIndex)) return;
      const rawGroup = target.dataset.shellGroupIndex;
      const groupIndex = rawGroup == null ? null : Number(rawGroup);
      const current = target.dataset.shellItemText || target.textContent.trim();
      startInlineEdit(target, current, next => {
        api.renameShellItem(component.id, itemIndex, next, Number.isNaN(groupIndex) ? null : groupIndex);
      });
    });
    el.addEventListener('dragstart', e => {
      if (e.target.closest('.shell-pill, .prop-pill, .editable-title, .editable-text, .editable-pill, .tbl-edit, .inline-edit-input')) {
        e.preventDefault();
        return;
      }
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-vsub', JSON.stringify({ kind: 'reorder', id: component.id }));
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      api.clearDropIndicators();
    });
    el.addEventListener('dragover', e => api.onCanvasDragOver(e, el));
    el.addEventListener('drop', e => api.onCanvasDrop(e, el));
    return el;
  }

  function renderInspector() {
    const page = api.getActivePage();
    const frame = api.getActiveFrame();
    const cmp = frame && (api.locateCmp(frame, api.state.selectedCmpId) || {}).list?.find(c => c.id === api.state.selectedCmpId);
    const host = $('#inspectorBody');
    host.innerHTML = '';

    const pageSec = document.createElement('div');
    pageSec.className = 'insp-section';
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
        <select id="smartDock"><option value="on">On</option><option value="off">Off</option></select>
      </div>
      <div class="field"><label>Main flow</label>
        <select id="mainFlow"><option value="stack">Stack</option><option value="two-col">2 columns</option><option value="three-col">3 columns</option></select>
      </div>
      <div style="font-size:11px;color:var(--text-mute);margin-top:4px;">
        <b>Regions</b> previews the future schema (PRD §9): <code style="font-family:var(--mono)">layout.regions = { header, sidebar, main, right, footer }</code>.
      </div>`;
    host.appendChild(pageSec);

    pageSec.querySelector('#pageName').value = page ? page.name : '';
    pageSec.querySelector('#pageRoute').value = page ? page.route : '';
    pageSec.querySelector('#pageName').addEventListener('input', e => {
      if (!page) return;
      page.name = e.target.value;
      renderPageTabs();
      renderJson();
    });
    pageSec.querySelector('#pageRoute').addEventListener('input', e => {
      if (!page) return;
      page.route = e.target.value;
      renderPageTabs();
      $('#deviceUrl').textContent = 'acme-admin.app' + page.route;
      renderJson();
    });

    const frameSel = pageSec.querySelector('#frameSelect');
    if (page) page.frames.forEach(frameItem => {
      const option = document.createElement('option');
      option.value = frameItem.id;
      option.textContent = frameItem.label;
      if (frameItem.id === api.state.activeFrameId) option.selected = true;
      frameSel.appendChild(option);
    });
    frameSel.addEventListener('change', e => {
      api.state.activeFrameId = e.target.value;
      api.state.selectedCmpId = null;
      renderAll();
    });

    const seg = pageSec.querySelector('#layoutModeSeg');
    seg.querySelectorAll('button').forEach(button => {
      if (frame && button.dataset.mode === frame.layoutMode) button.classList.add('active');
      button.addEventListener('click', () => api.setLayoutMode(button.dataset.mode));
    });

    const smartDockSel = pageSec.querySelector('#smartDock');
    const mainFlowSel = pageSec.querySelector('#mainFlow');
    if (frame && frame.layoutMode === 'regions') {
      const opts = api.ensureRegionOptions(frame);
      smartDockSel.value = opts.smartDock ? 'on' : 'off';
      mainFlowSel.value = opts.mainFlow;
      smartDockSel.disabled = false;
      mainFlowSel.disabled = false;
    } else {
      smartDockSel.value = 'on';
      mainFlowSel.value = 'stack';
      smartDockSel.disabled = true;
      mainFlowSel.disabled = true;
    }
    smartDockSel.addEventListener('change', e => {
      if (!frame || frame.layoutMode !== 'regions') return;
      api.ensureRegionOptions(frame).smartDock = e.target.value === 'on';
      renderAll();
    });
    mainFlowSel.addEventListener('change', e => {
      if (!frame || frame.layoutMode !== 'regions') return;
      api.ensureRegionOptions(frame).mainFlow = e.target.value;
      renderCanvas();
      renderJson();
    });

    const cmpSec = document.createElement('div');
    cmpSec.className = 'insp-section';
    if (cmp) {
      cmpSec.innerHTML = `<h4>Selected component</h4>
        <div class="field"><label>Type</label><select id="cmpType"></select></div>
        <div class="field"><label>Label</label><input id="cmpLabel" /></div>
        <div class="field"><label>ID</label><input id="cmpId" disabled /></div>
        <div style="font-size:11px;color:var(--text-mute);margin-top:6px;">V1 schema stores <code style="font-family:var(--mono)">type</code>, <code style="font-family:var(--mono)">label</code>, and optional <code style="font-family:var(--mono)">props</code> for shell/item content.</div>`;
      const typeSel = cmpSec.querySelector('#cmpType');
      const typeOptions = [...new Set([
        ...Object.keys(api.COMPONENT_TYPES),
        ...Object.keys(api.DEFAULT_LABELS || {}),
      ])];
      typeOptions.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        if (type === cmp.type) option.selected = true;
        typeSel.appendChild(option);
      });
      typeSel.addEventListener('change', e => {
        cmp.type = e.target.value;
        if (cmp.type === 'editable-component') api.ensureEditableComponentLink(cmp);
        if (cmp.type !== 'editable-component' && cmp.type !== 'custom') delete cmp.customId;
        const defaults = api.getDefaultProps(cmp.type);
        if (Object.keys(defaults).length) cmp.props = JSON.parse(JSON.stringify(defaults));
        if (!Object.keys(defaults).length) delete cmp.props;
        renderCanvas();
        renderJson();
      });
      const labelInput = cmpSec.querySelector('#cmpLabel');
      labelInput.value = cmp.label;
      labelInput.addEventListener('input', e => {
        cmp.label = e.target.value;
        renderCanvas();
        renderJson();
      });
      cmpSec.querySelector('#cmpId').value = cmp.id;
    } else {
      cmpSec.innerHTML = `<h4>Selected component</h4><div style="font-size:12px;color:var(--text-mute);">Click a component on the canvas to edit it.</div>`;
    }
    host.appendChild(cmpSec);

    const jsonSec = document.createElement('div');
    jsonSec.className = 'insp-section';
    jsonSec.style.borderBottom = '0';
    jsonSec.style.paddingBottom = '0';
    jsonSec.innerHTML = `<h4>PageDefinition JSON</h4>`;
    host.appendChild(jsonSec);
    const pre = document.createElement('pre');
    pre.className = 'json';
    pre.id = 'jsonOut';
    host.appendChild(pre);
    renderJson();
  }

  function renderJson() {
    const page = api.getActivePage();
    const out = $('#jsonOut');
    if (!page || !out) return;
    out.innerHTML = highlightJson(api.serializePage(page));
  }

  function highlightJson(obj) {
    const s = JSON.stringify(obj, null, 2);
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(s)
      .replace(/("(\\.|[^"\\])*")\s*:/g, '<span class="k">$1</span>:')
      .replace(/:\s*("(\\.|[^"\\])*")/g, ': <span class="s">$1</span>')
      .replace(/:\s*(-?\d+(\.\d+)?)/g, ': <span class="n">$1</span>')
      .replace(/([{}\[\],])/g, '<span class="p">$1</span>');
  }

  Object.assign(api, {
    $,
    toast,
    renderAll,
    renderLibrary,
    libItem,
    renderPageTabs,
    renderFrameTabs,
    renderCanvas,
    renderRegion,
    renderComponent,
    renderInspector,
    renderJson,
    highlightJson,
  });
})();