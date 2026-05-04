// Schematic HTML generators for each component type.
(() => {
  const api = window.VSUB = window.VSUB || {};

  function renderCustomSchematicHtml(def) {
    function renderSlot(s) {
      if (s.type === 'group') {
        const layout = s.layout || 'col';
        const align = s.align || 'start';
        const justify = align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start';
        let style = '';
        if (layout === 'grid') style = `display:grid;gap:8px;grid-template-columns:repeat(${s.gridCols || 2},1fr);justify-items:${align === 'center' ? 'center' : align === 'end' ? 'end' : 'start'};`;
        else if (layout === 'row') style = `display:flex;flex-direction:row;gap:8px;align-items:center;justify-content:${justify};`;
        else style = `display:flex;flex-direction:column;gap:6px;align-items:${align === 'center' ? 'center' : align === 'end' ? 'flex-end' : 'flex-start'};`;
        return `<div style="${style}">${(s.children || []).map(renderSlot).join('')}</div>`;
      }
      if (s.type === 'text') return `<div class="sk-bar dim" style="width:80%;"></div>`;
      if (s.type === 'heading') return `<div class="sk-bar" style="width:58%;height:12px;"></div>`;
      if (s.type === 'label') return `<div class="sk-bar dim" style="width:38%;height:8px;"></div>`;
      if (s.type === 'image') return `<div style="width:min(680px,100%);height:200px;background:var(--skeleton);border-radius:6px;"></div>`;
      if (s.type === 'action' || s.type === 'button') return `<span class="sk-pill accent">${s.label || 'Action'}</span>`;
      if (s.type === 'list') return `<div style="display:flex;flex-direction:column;gap:4px;">${[1, 2, 3].map(() => `<div class="sk-bar dim" style="width:90%;"></div>`).join('')}</div>`;
      if (s.type === 'badge') return `<span class="sk-pill" style="background:${def.color || 'var(--skeleton-dim)'}22;color:${def.color || 'var(--accent)'};">${s.label || 'Badge'}</span>`;
      if (s.type === 'input') return '<div class="sk-input" style="width:min(420px,100%);height:30px;"></div>';
      if (s.type === 'divider') return '<div style="height:1px;background:var(--border);margin:4px 0;"></div>';
      if (s.type === 'row') return `<div class="sk-row" style="gap:8px;"><div class="sk-bar" style="width:28%;height:8px;"></div><div class="sk-bar dim" style="width:28%;height:8px;"></div><span class="sk-pill accent" style="margin-left:auto;">${s.label || 'Action'}</span></div>`;
      if (s.type === 'button-row') {
        const labels = (s.label || 'Cancel, Save').split(',').map(x => x.trim()).filter(Boolean);
        return `<div class="sk-row" style="gap:6px;justify-content:flex-end;">${labels.map((txt, i) => `<span class="sk-pill${i === labels.length - 1 ? ' accent' : ''}">${txt}</span>`).join('')}</div>`;
      }
      return `<div class="sk-bar dim" style="width:70%;"></div>`;
    }
    const lines = (def.slots || []).map(renderSlot).join('');
    const rootLayout = def.rootLayout || 'col';
    const rootAlign = def.rootAlign || 'start';
    const rootGap = Math.max(0, Number(def.rootGap ?? 8));
    const rootPadding = Math.max(0, Number(def.rootPadding ?? 8));
    const rootJustify = rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'flex-end' : 'flex-start';
    let rootStyle = '';
    if (rootLayout === 'grid') rootStyle = `display:grid;gap:${rootGap}px;padding:${rootPadding}px;grid-template-columns:repeat(${def.rootGridCols || 2}, minmax(180px,1fr));justify-items:${rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'end' : 'start'};`;
    else if (rootLayout === 'row') rootStyle = `display:flex;flex-direction:row;gap:${rootGap}px;padding:${rootPadding}px;flex-wrap:wrap;justify-content:${rootJustify};align-items:flex-start;`;
    else rootStyle = `display:flex;flex-direction:column;gap:${rootGap}px;padding:${rootPadding}px;align-items:${rootAlign === 'center' ? 'center' : rootAlign === 'end' ? 'flex-end' : 'flex-start'};`;

    return `<div style="${rootStyle}">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:28px;height:28px;border-radius:6px;display:grid;place-items:center;
          font-family:var(--mono);font-size:10px;font-weight:700;
          background:${def.color ? def.color + '22' : 'var(--accent-soft)'};
          color:${def.color || 'var(--accent)'};border:1px solid ${def.color || 'var(--accent)'};">
          ${(def.icon || 'CMP').slice(0, 3).toUpperCase()}
        </div>
        <div class="sk-bar" style="width:100px;height:10px;"></div>
      </div>
      ${lines}
    </div>`;
  }

  const esc = v => String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function shellItems(c) {
    const defaults = api.getDefaultProps(c.type);
    const fallback = Array.isArray(defaults.items) ? defaults.items : [];
    return Array.isArray(c.props?.items) && c.props.items.length ? c.props.items : fallback;
  }

  function shellGroups(c) {
    const defaults = api.getDefaultProps(c.type);
    const fallback = Array.isArray(defaults.groups) ? defaults.groups : [];
    return Array.isArray(c.props?.groups) && c.props.groups.length ? c.props.groups : fallback;
  }

  function genericItems(c) {
    const defaults = api.getDefaultProps(c.type);
    const fallback = Array.isArray(defaults.items) ? defaults.items : [];
    return Array.isArray(c.props?.items) && c.props.items.length ? c.props.items : fallback;
  }

  function renderShellPill(label, idx, groupIdx = null, accent = false) {
    const cls = `sk-pill${accent ? ' accent' : ''}`;
    const groupAttr = groupIdx == null ? '' : ` data-shell-group-index="${groupIdx}"`;
    return `<button class="${cls} shell-pill" style="width:100%;justify-content:flex-start;" data-shell-item-index="${idx}" data-shell-item-text="${esc(label)}"${groupAttr}>${esc(label)}</button>`;
  }

  function renderAddShellButton(groupIdx = null) {
    const groupAttr = groupIdx == null ? '' : ` data-shell-group-index="${groupIdx}"`;
    return `<button class="shell-add-btn" title="Add button" data-shell-add="item"${groupAttr}>+</button>`;
  }

  function renderEditableText(c, key, fallback, cssClass = 'editable-text') {
    const val = c.props?.[key] != null ? c.props[key] : fallback;
    const safe = esc(val || '');
    return `<button class="${cssClass}" data-prop-key="${key}" data-prop-text="${safe}" title="Double-click to edit text">${safe || ' '}</button>`;
  }

  function appendGenericItemsEditor(wrap, c) {
    const shellTypes = new Set([
      'navbar', 'nav-basic', 'nav-search', 'nav-cta',
      'sidebar', 'sidenav-simple', 'sidenav-grouped', 'sidenav-workspace',
    ]);
    if (shellTypes.has(c.type) || c.type === 'list') return;
    const items = genericItems(c);
    if (!items.length) return;

    const row = document.createElement('div');
    row.className = 'prop-items';
    row.innerHTML = `
      ${items.map((item, idx) => `<button class="sk-pill prop-pill" data-prop-key="items" data-prop-index="${idx}" data-prop-text="${esc(item)}">${esc(item)}</button>`).join('')}
      <button class="shell-add-btn compact" title="Add item" data-prop-add-key="items">+</button>`;
    wrap.appendChild(row);
  }

  function renderSchematic(c, region) {
    const wrap = document.createElement('div');
    switch (c.type) {
      case 'navbar':
      case 'nav-basic': {
        const items = shellItems(c);
        wrap.innerHTML = `
          <div class="nv">
            <div class="sk-bar logo" style="width:64px;height:10px;"></div>
            <div class="links">
              ${items.map((item, idx) => `<button class="sk-pill shell-pill" data-shell-item-index="${idx}" data-shell-item-text="${esc(item)}">${esc(item)}</button>`).join('')}
              <button class="shell-add-btn compact" title="Add nav item" data-shell-add="item">+</button>
            </div>
            <div class="avatar"></div>
          </div>`;
        break;
      }
      case 'sidebar':
      case 'sidenav-simple': {
        const items = shellItems(c);
        const defaults = api.getDefaultProps(c.type);
        if (region === 'sidebar') {
          wrap.innerHTML = `
            <div class="sidebar-shell">
              <div class="section">
                <div class="title">${renderEditableText(c, 'sectionTitle', defaults.sectionTitle || 'Navigation', 'editable-title')}</div>
                ${items.map((item, idx) => renderShellPill(item, idx, null, idx === 0)).join('')}
                ${renderAddShellButton()}
              </div>
              <div class="section" style="margin-top:auto;">
                <div class="title">${renderEditableText(c, 'workspaceTitle', defaults.workspaceTitle || 'Workspace', 'editable-title')}</div>
                <div class="sk-bar dim" style="width:100%;"></div>
                <div class="sk-bar dim" style="width:82%;"></div>
              </div>
            </div>`;
        } else {
          wrap.innerHTML = `
            <div style="display:flex;gap:14px;">
              <div style="width:120px;display:flex;flex-direction:column;gap:6px;">
                ${items.slice(0, 4).map((item, idx) => `<button class="sk-pill${idx === 0 ? ' accent' : ''} shell-pill" style="width:100px;" data-shell-item-index="${idx}" data-shell-item-text="${esc(item)}">${esc(item)}</button>`).join('')}
                <button class="shell-add-btn" title="Add button" data-shell-add="item">+</button>
              </div>
              <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
                <div class="sk-bar" style="width:60%;height:10px;"></div>
                <div class="sk-bar dim" style="width:90%;"></div>
                <div class="sk-bar dim" style="width:80%;"></div>
              </div>
            </div>`;
        }
        break;
      }
      case 'tabs':
        wrap.innerHTML = `
          <div class="sk-row">
            <span class="sk-pill accent">All</span>
            <span class="sk-pill">Active</span>
            <span class="sk-pill">Invited</span>
            <span class="sk-pill">Disabled</span>
          </div>`;
        break;
      case 'breadcrumb':
        wrap.innerHTML = `
          <div class="sk-row" style="font-family:var(--mono);font-size:11px;color:var(--text-mute);">
            Home <span style="opacity:.6;">/</span> Section <span style="opacity:.6;">/</span>
            <span style="color:var(--text);">Detail</span>
          </div>`;
        break;
      case 'footer':
        wrap.innerHTML = `
          <div class="sk-row" style="justify-content:space-between;color:var(--text-mute);font-size:11px;">
            <span>© 2026 Acme</span><span>Privacy · Terms · Support</span>
          </div>`;
        break;
      case 'hero':
        wrap.innerHTML = `
          <div style="padding:8px 4px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
            <div class="sk-bar" style="width:60%;height:14px;"></div>
            <div class="sk-bar dim" style="width:80%;"></div>
            <div class="sk-bar dim" style="width:70%;"></div>
            <span class="sk-pill accent" style="margin-top:4px;">Get started ›</span>
          </div>`;
        break;
      case 'kpi':
        wrap.innerHTML = `
          <div class="kpi">
            ${[['Users','12,408','+4.2%'],['Active','3,120','+1.1%'],['Revenue','$84.3k','+8.0%'],['Churn','1.4%','-0.2%']]
              .map(([l, v, d]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="delta">${d}</div></div>`).join('')}
          </div>`;
        break;
      case 'list':
      {
        const defaults = api.getDefaultProps(c.type);
        const columns = Array.isArray(c.props?.columns) && c.props.columns.length ? c.props.columns : defaults.columns;
        const rows = Array.isArray(c.props?.rows) && c.props.rows.length ? c.props.rows : defaults.rows;
        wrap.innerHTML = `
          <div>
            <table class="tbl">
              <thead>
                <tr>
                  ${columns.map((col, ci) => `<th><button class="tbl-edit" data-prop-path="columns.${ci}" data-prop-text="${esc(col)}">${esc(col)}</button></th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${rows.map((row, ri) => `
                  <tr>
                    ${columns.map((_, ci) => {
                      const val = row?.[ci] != null ? row[ci] : '';
                      return `<td><button class="tbl-edit" data-prop-path="rows.${ri}.${ci}" data-prop-text="${esc(val)}">${esc(val)}</button></td>`;
                    }).join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div style="margin-top:6px;display:flex;justify-content:flex-end;gap:6px;">
              <button class="shell-add-btn" data-prop-add-col="columns" data-prop-rows-key="rows" title="Add table column">+ col</button>
              <button class="shell-add-btn" data-prop-add-row="rows" title="Add table row">+ row</button>
            </div>
          </div>`;
        break;
      }
      case 'chart': {
        const heights = [40, 55, 30, 72, 48, 65, 82, 58, 70, 90, 62, 78];
        wrap.innerHTML = `<div class="chart">${heights.map(h => `<div class="b" style="height:${h}%"></div>`).join('')}</div>`;
        break;
      }
      case 'detail':
        wrap.innerHTML = `
          <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 14px;font-size:12px;">
            <div style="color:var(--text-mute);">Name</div><div>Ada Lovelace</div>
            <div style="color:var(--text-mute);">Email</div><div>ada@acme.io</div>
            <div style="color:var(--text-mute);">Status</div><div><span class="status active">Active</span></div>
            <div style="color:var(--text-mute);">Joined</div><div>Mar 4, 2025</div>
          </div>`;
        break;
      case 'empty':
        wrap.innerHTML = `
          <div style="text-align:center;padding:18px;color:var(--text-mute);">
            <div style="font-size:13px;color:var(--text);margin-bottom:4px;">Nothing here yet</div>
            <div style="font-size:11px;margin-bottom:10px;">Get started by creating your first record.</div>
            <span class="sk-pill accent">Create record</span>
          </div>`;
        break;
      case 'main':
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px;padding:6px 0;">
            <div class="sk-bar" style="width:40%;height:12px;"></div>
            <div class="sk-bar dim" style="width:90%;"></div>
            <div class="sk-bar dim" style="width:85%;"></div>
            <div class="sk-bar dim" style="width:60%;"></div>
          </div>`;
        break;
      case 'form':
        wrap.innerHTML = `
          <div class="sk-grid" style="grid-template-columns:1fr 1fr;">
            ${['Name', 'Email', 'Role', 'Team', 'Notes', 'Avatar'].map(f => `
              <div><div style="font-size:11px;color:var(--text-mute);margin-bottom:4px;">${f}</div><div class="sk-input"></div></div>
            `).join('')}
          </div>`;
        break;
      case 'filters':
        wrap.innerHTML = `
          <div class="filters">
            <div class="sk-input search"></div>
            <span class="sk-pill">Role ▾</span>
            <span class="sk-pill">Joined ▾</span>
            <span class="sk-pill">Clear</span>
          </div>`;
        break;
      case 'stepper':
        wrap.innerHTML = `
          <div class="sk-row" style="gap:14px;">
            ${['Account','Profile','Team','Review'].map((s, i) => `
              <div class="sk-row" style="gap:6px;">
                <div style="width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:10px;background:${i === 1 ? 'var(--accent)' : 'var(--skeleton-dim)'};color:${i === 1 ? 'var(--on-accent)' : 'var(--text-mute)'};">${i + 1}</div>
                <span style="font-size:11px;color:${i === 1 ? 'var(--text)' : 'var(--text-mute)'};">${s}</span>
              </div>
            `).join('<div class="sk-bar dim" style="flex:1;height:2px;"></div>')}
          </div>`;
        break;
      case 'modal':
        wrap.innerHTML = `
          <div style="border:1px solid var(--border-strong);border-radius:6px;padding:12px;background:var(--inset);">
            <div class="sk-bar" style="width:50%;height:12px;margin-bottom:8px;"></div>
            <div class="sk-bar dim" style="width:90%;"></div>
            <div class="sk-bar dim" style="width:80%;margin-top:6px;"></div>
            <div class="sk-row" style="justify-content:flex-end;margin-top:10px;gap:6px;"><span class="sk-pill">Cancel</span><span class="sk-pill accent">Confirm</span></div>
          </div>`;
        break;
      case 'actions':
        wrap.innerHTML = `
          <div class="sk-row" style="justify-content:flex-end;gap:8px;"><span class="sk-pill">Cancel</span><span class="sk-pill accent">Save changes</span></div>`;
        break;
      // ── Top Nav variants ───────────────────────────────────────────
      case 'nav-search':
      {
        const items = shellItems(c);
        wrap.innerHTML = `
          <div class="nv">
            <div class="sk-bar logo" style="width:64px;height:10px;flex-shrink:0;"></div>
            <div class="links" style="flex:1;min-width:0;">
              ${items.map((item, idx) => `<button class="sk-pill shell-pill" data-shell-item-index="${idx}" data-shell-item-text="${esc(item)}">${esc(item)}</button>`).join('')}
              <button class="shell-add-btn compact" title="Add nav item" data-shell-add="item">+</button>
            </div>
            <div class="sk-input" style="flex:1;max-width:200px;height:20px;border-radius:10px;"></div>
            <div class="avatar" style="margin-left:auto;"></div>
          </div>`;
        break;
      }
      case 'nav-cta':
      {
        const items = shellItems(c);
        wrap.innerHTML = `
          <div class="nv">
            <div class="sk-bar logo" style="width:64px;height:10px;flex-shrink:0;"></div>
            <div class="links" style="flex:1;">
              ${items.map((item, idx) => `<button class="sk-pill shell-pill" data-shell-item-index="${idx}" data-shell-item-text="${esc(item)}">${esc(item)}</button>`).join('')}
              <button class="shell-add-btn compact" title="Add nav item" data-shell-add="item">+</button>
            </div>
            ${renderEditableText(c, 'ctaText', api.getDefaultProps(c.type).ctaText || 'Get started', 'sk-pill accent editable-pill')}
            <div class="avatar"></div>
          </div>`;
        break;
      }

      // ── Side Nav variants ───────────────────────────────────────────
      case 'sidenav-grouped':
      {
        const groups = shellGroups(c);
        wrap.innerHTML = `
          <div class="sidebar-shell">
            ${groups.map((group, gIdx) => `
              <div class="section" ${gIdx === groups.length - 1 ? 'style="margin-top:auto;"' : ''}>
                <div class="title"><button class="editable-title" data-shell-group-title-index="${gIdx}" data-shell-group-title-text="${esc(group.title || `Group ${gIdx + 1}`)}" title="Double-click to edit title">${esc(group.title || `Group ${gIdx + 1}`)}</button></div>
                ${(group.items || []).map((item, i) => renderShellPill(item, i, gIdx, gIdx === 0 && i === 0)).join('')}
                ${renderAddShellButton(gIdx)}
              </div>
            `).join('')}
          </div>`;
        break;
      }
      case 'sidenav-workspace':
      {
        const items = shellItems(c);
        const defaults = api.getDefaultProps(c.type);
        wrap.innerHTML = `
          <div class="sidebar-shell">
            <div class="sk-input" style="height:28px;border-radius:6px;margin-bottom:10px;"></div>
            <div class="section">
              <div class="title">${renderEditableText(c, 'sectionTitle', defaults.sectionTitle || 'Workspace', 'editable-title')}</div>
              ${items.map((item, idx) => renderShellPill(item, idx, null, idx === 0)).join('')}
              ${renderAddShellButton()}
            </div>
          </div>`;
        break;
      }

      // ── Right Panel variants ────────────────────────────────────────
      case 'rightpanel-detail':
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div class="sk-bar" style="width:55%;height:11px;"></div>
            <div class="sk-bar dim" style="width:38%;height:8px;"></div>
            <div style="height:1px;background:var(--border);margin:4px 0;"></div>
            <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 10px;font-size:11px;">
              <div style="color:var(--text-mute);">Status</div><div><span class="status active">Active</span></div>
              <div style="color:var(--text-mute);">Email</div><div><div class="sk-bar dim" style="width:100%;"></div></div>
              <div style="color:var(--text-mute);">Role</div><div><div class="sk-bar dim" style="width:70%;"></div></div>
              <div style="color:var(--text-mute);">Joined</div><div><div class="sk-bar dim" style="width:60%;"></div></div>
            </div>
            <div style="display:flex;gap:6px;margin-top:4px;">
              <span class="sk-pill">Edit</span>
              <span class="sk-pill" style="color:#e06060;">Delete</span>
            </div>
          </div>`;
        break;
      case 'rightpanel-filters':
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:8px;">
            <div class="sk-bar" style="width:40%;height:9px;"></div>
            <div style="font-size:10px;color:var(--text-mute);">Status</div>
            <div class="sk-input" style="height:22px;"></div>
            <div style="font-size:10px;color:var(--text-mute);">Date range</div>
            <div class="sk-input" style="height:22px;"></div>
            <div style="font-size:10px;color:var(--text-mute);">Assigned to</div>
            <div class="sk-input" style="height:22px;"></div>
            <div style="display:flex;gap:6px;margin-top:4px;">
              <span class="sk-pill">Clear</span>
              <span class="sk-pill accent">Apply</span>
            </div>
          </div>`;
        break;
      case 'rightpanel-activity':
        wrap.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:10px;">
            <div class="sk-bar" style="width:45%;height:9px;"></div>
            ${[['Created record','2m ago'],['Updated status','1h ago'],['Added note','3h ago']].map(([a, t]) => `
              <div style="display:flex;gap:8px;align-items:flex-start;">
                <div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-top:3px;"></div>
                <div style="flex:1;">
                  <div class="sk-bar dim" style="width:80%;margin-bottom:3px;"></div>
                  <div style="font-size:10px;color:var(--text-mute);">${t}</div>
                </div>
              </div>`).join('')}
          </div>`;
        break;

      case 'custom': {
        const def = api.state.customComponents.find(d => d.id === c.customId);
        wrap.innerHTML = def
          ? renderCustomSchematicHtml(def)
          : `<div style="font-family:var(--mono);font-size:11px;color:var(--text-mute);">[custom: ${c.customId || '?'}]</div>`;
        break;
      }
      case 'editable-component': {
        const def = api.state.customComponents.find(d => d.id === c.customId);
        wrap.innerHTML = def
          ? renderCustomSchematicHtml(def)
          : `<div style="display:flex;flex-direction:column;gap:6px;"><div class="sk-bar" style="width:58%;height:10px;"></div><div class="sk-bar dim" style="width:76%;"></div><div style="font-size:10px;color:var(--text-mute);">Double-click or click ✎ to edit structure</div></div>`;
        break;
      }
      default:
        wrap.innerHTML = `<div style="font-family:var(--mono);font-size:11px;color:var(--text-mute);">[${c.type}]</div>`;
    }
    appendGenericItemsEditor(wrap, c);
    return wrap;
  }

  api.renderCustomSchematicHtml = renderCustomSchematicHtml;
  api.renderSchematic = renderSchematic;
})();