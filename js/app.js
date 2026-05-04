// Bootstrap: wire all global event listeners, panel collapse, theme, and kick off the initial render.
import { state } from './state.js';
import { renderAll, renderLibrary, toast, $ } from './render.js';
import { addPage, addFrame, serializePage } from './mutations.js';

// ── Top bar actions ────────────────────────────────────────────────────────
$('#addPageBtn').addEventListener('click', addPage);
$('#addFrameBtn').addEventListener('click', addFrame);
$('#copyJsonBtn').addEventListener('click', async () => {
  const obj = {
    schemaVersion: '1.0',
    projectId: state.project.id,
    projectName: state.project.name,
    customComponents: state.customComponents,
    pages: state.pages.map(serializePage),
  };
  const text = JSON.stringify(obj, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('Project JSON copied to clipboard');
  } catch {
    console.log(text);
    toast('Clipboard blocked — JSON logged to console');
  }
});

// ── Library tab switching ──────────────────────────────────────────────────
document.querySelectorAll('.tab[data-libtab]').forEach(t => {
  t.addEventListener('click', () => { state.libTab = t.dataset.libtab; renderLibrary(); });
});

// ── Panel collapse / expand ────────────────────────────────────────────────
const app         = $('#app');
const leftPanel   = $('#leftPanel');
const rightPanel  = $('#rightPanel');
const toggleLeft  = $('#toggleLeft');
const toggleRight = $('#toggleRight');

function setLeft(collapsed) {
  app.classList.toggle('left-collapsed', collapsed);
  leftPanel.classList.toggle('collapsed', collapsed);
  toggleLeft.textContent = collapsed ? '›' : '‹';
  toggleLeft.title = collapsed
    ? 'Expand library (Ctrl/⌘+B)'
    : 'Collapse library (Ctrl/⌘+B)';
}

function setRight(collapsed) {
  app.classList.toggle('right-collapsed', collapsed);
  rightPanel.classList.toggle('collapsed', collapsed);
  toggleRight.textContent = collapsed ? '‹' : '›';
  toggleRight.title = collapsed
    ? 'Expand inspector (Ctrl/⌘+I)'
    : 'Collapse inspector (Ctrl/⌘+I)';
}

toggleLeft.addEventListener('click',  () => setLeft(!app.classList.contains('left-collapsed')));
toggleRight.addEventListener('click', () => setRight(!app.classList.contains('right-collapsed')));

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'b') { e.preventDefault(); toggleLeft.click(); }
  else if (k === 'i') { e.preventDefault(); toggleRight.click(); }
});

// ── Theme ──────────────────────────────────────────────────────────────────
const themeToggle = $('#themeToggle');
const themeIcon   = $('#themeIcon');
const themeLabel  = $('#themeLabel');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  themeIcon.textContent  = dark ? '☾' : '☀';
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

// ── Initial render ─────────────────────────────────────────────────────────
renderAll();
