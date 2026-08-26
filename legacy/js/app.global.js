// Bootstrap: wire all global event listeners, panel collapse, theme, and kick off the initial render.
(() => {
  const api = window.VSUB = window.VSUB || {};

  api.$('#addPageBtn').addEventListener('click', api.addPage);
  api.$('#addFrameBtn').addEventListener('click', api.addFrame);
  api.$('#copyJsonBtn').addEventListener('click', async () => {
    const obj = {
      schemaVersion: '1.0',
      projectId: api.state.project.id,
      projectName: api.state.project.name,
      customComponents: api.state.customComponents,
      pages: api.state.pages.map(api.serializePage),
    };
    const text = JSON.stringify(obj, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      api.toast('Project JSON copied to clipboard');
    } catch {
      console.log(text);
      api.toast('Clipboard blocked — JSON logged to console');
    }
  });

  document.querySelectorAll('.tab[data-libtab]').forEach(t => {
    t.addEventListener('click', () => { api.state.libTab = t.dataset.libtab; api.renderLibrary(); });
  });

  const app = api.$('#app');
  const leftPanel = api.$('#leftPanel');
  const rightPanel = api.$('#rightPanel');
  const toggleLeft = api.$('#toggleLeft');
  const toggleRight = api.$('#toggleRight');

  function setLeft(collapsed) {
    app.classList.toggle('left-collapsed', collapsed);
    leftPanel.classList.toggle('collapsed', collapsed);
    toggleLeft.textContent = collapsed ? '›' : '‹';
    toggleLeft.title = collapsed ? 'Expand library (Ctrl/⌘+B)' : 'Collapse library (Ctrl/⌘+B)';
  }

  function setRight(collapsed) {
    app.classList.toggle('right-collapsed', collapsed);
    rightPanel.classList.toggle('collapsed', collapsed);
    toggleRight.textContent = collapsed ? '‹' : '›';
    toggleRight.title = collapsed ? 'Expand inspector (Ctrl/⌘+I)' : 'Collapse inspector (Ctrl/⌘+I)';
  }

  toggleLeft.addEventListener('click', () => setLeft(!app.classList.contains('left-collapsed')));
  toggleRight.addEventListener('click', () => setRight(!app.classList.contains('right-collapsed')));

  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') {
      e.preventDefault();
      toggleLeft.click();
    } else if (k === 'i') {
      e.preventDefault();
      toggleRight.click();
    }
  });

  const themeToggle = api.$('#themeToggle');
  const themeIcon = api.$('#themeIcon');
  const themeLabel = api.$('#themeLabel');

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const dark = theme === 'dark';
    themeIcon.textContent = dark ? '☾' : '☀';
    themeLabel.textContent = dark ? 'Light' : 'Dark';
    try { localStorage.setItem('vsub-theme', theme); } catch (_) {}
  }

  let savedTheme = 'dark';
  try { savedTheme = localStorage.getItem('vsub-theme') || 'dark'; } catch (_) {}
  applyTheme(savedTheme);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  api.renderAll();
})();