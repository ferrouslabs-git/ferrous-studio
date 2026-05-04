// Application state, region helpers, and active-frame accessors.
(() => {
  const api = window.VSUB = window.VSUB || {};

  const uid = (() => {
    let n = 0;
    return p => `${p}-${(++n).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  })();

  const REGION_ORDER = ['header', 'sidebar', 'main', 'right', 'footer'];
  const REGION_LABEL = { header: 'header', sidebar: 'sidebar', main: 'main', right: 'right', footer: 'footer' };
  const REGION_RULES = {
    navbar: 'header', breadcrumb: 'header', tabs: 'header',
    'nav-basic': 'header', 'nav-search': 'header', 'nav-cta': 'header',
    sidebar: 'sidebar',
    'sidenav-simple': 'sidebar', 'sidenav-grouped': 'sidebar', 'sidenav-workspace': 'sidebar',
    detail: 'right',
    'rightpanel-detail': 'right', 'rightpanel-filters': 'right', 'rightpanel-activity': 'right',
    footer: 'footer',
  };
  const STRUCTURAL_TYPES = new Set([
    'navbar', 'sidebar', 'detail', 'footer', 'tabs', 'breadcrumb', 'main',
    'nav-basic', 'nav-search', 'nav-cta',
    'sidenav-simple', 'sidenav-grouped', 'sidenav-workspace',
    'rightpanel-detail', 'rightpanel-filters', 'rightpanel-activity',
  ]);

  const classifyRegion = type => REGION_RULES[type] || 'main';
  const emptyRegions = () => ({ header: [], sidebar: [], main: [], right: [], footer: [] });

  function flatToRegions(components) {
    const r = emptyRegions();
    components.forEach(c => r[classifyRegion(c.type)].push(c));
    return r;
  }

  function regionsToFlat(regions) {
    return REGION_ORDER.flatMap(k => regions[k] || []);
  }

  function makeFrame(label, layoutMode, components) {
    const cmps = components.map(([t, l]) => ({ id: uid('c'), type: t, label: l }));
    const layout = layoutMode === 'regions'
      ? { regions: flatToRegions(cmps), options: { smartDock: true, mainFlow: 'stack' } }
      : { components: cmps };
    return { id: uid('frame'), label, layoutMode, layout };
  }

  function page(name, route, components, layoutMode = 'flat') {
    return { id: uid('page'), name, route, frames: [makeFrame('Default', layoutMode, components)] };
  }

  function regionGroups(frame) {
    if (frame.layoutMode === 'regions') {
      return REGION_ORDER.map(r => ({ region: r, components: frame.layout.regions[r] }));
    }
    return [{ region: null, components: frame.layout.components }];
  }

  function locateCmp(frame, id) {
    for (const g of regionGroups(frame)) {
      const idx = g.components.findIndex(c => c.id === id);
      if (idx >= 0) return { region: g.region, list: g.components, index: idx };
    }
    return null;
  }

  function listFor(frame, region) {
    if (frame.layoutMode === 'regions') return frame.layout.regions[region || 'main'];
    return frame.layout.components;
  }

  function ensureRegionOptions(frame) {
    if (!frame || frame.layoutMode !== 'regions') return { smartDock: true, mainFlow: 'stack' };
    frame.layout.options = frame.layout.options || {};
    if (typeof frame.layout.options.smartDock !== 'boolean') frame.layout.options.smartDock = true;
    if (!['stack', 'two-col', 'three-col'].includes(frame.layout.options.mainFlow)) frame.layout.options.mainFlow = 'stack';
    return frame.layout.options;
  }

  function isSmartDock(frame) {
    return frame && frame.layoutMode === 'regions' ? ensureRegionOptions(frame).smartDock : false;
  }

  function getMainFlow(frame) {
    return frame && frame.layoutMode === 'regions' ? ensureRegionOptions(frame).mainFlow : 'stack';
  }

  const state = {
    project: { id: uid('proj'), name: 'Acme Admin' },
    pages: [
      page('Dashboard', '/',         [['navbar','App'],['kpi','Metrics'],['chart','Trend'],['list','Recent activity']]),
      page('Users',     '/users',    [['navbar','App'],['tabs','Status tabs'],['filters','Search bar'],['list','User directory']]),
      page('Settings',  '/settings', [['navbar','App'],['sidebar','Sections'],['form','Profile'],['footer','Footer']], 'regions'),
    ],
    activePageId: null,
    activeFrameId: null,
    selectedCmpId: null,
    libTab: 'components',
    customComponents: [],
  };
  state.activePageId = state.pages[1].id;
  state.activeFrameId = state.pages[1].frames[0].id;

  const getActivePage = () => state.pages.find(p => p.id === state.activePageId);
  const getActiveFrame = () => {
    const p = getActivePage();
    return p && p.frames.find(f => f.id === state.activeFrameId);
  };

  Object.assign(api, {
    uid,
    REGION_ORDER,
    REGION_LABEL,
    REGION_RULES,
    STRUCTURAL_TYPES,
    classifyRegion,
    emptyRegions,
    flatToRegions,
    regionsToFlat,
    makeFrame,
    page,
    regionGroups,
    locateCmp,
    listFor,
    ensureRegionOptions,
    isSmartDock,
    getMainFlow,
    state,
    getActivePage,
    getActiveFrame,
  });
})();
