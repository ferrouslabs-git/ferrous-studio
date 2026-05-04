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

  function getDefaultProps(type) {
    switch (type) {
      case 'navbar':
      case 'nav-basic':
      case 'nav-search':
        return { items: ['Overview', 'Users', 'Reports'] };
      case 'nav-cta':
        return { items: ['Overview', 'Users'], ctaText: 'Get started' };
      case 'sidebar':
      case 'sidenav-simple':
        return {
          sectionTitle: 'Navigation',
          workspaceTitle: 'Workspace',
          items: ['Overview', 'Users', 'Reports', 'Settings'],
        };
      case 'sidenav-grouped':
        return {
          groups: [
            { title: 'Main', items: ['Overview', 'Reports'] },
            { title: 'Admin', items: ['Users', 'Billing'] },
          ],
        };
      case 'sidenav-workspace':
        return {
          sectionTitle: 'Workspace',
          workspace: 'Acme Workspace',
          items: ['Dashboard', 'Members', 'Projects', 'Settings'],
        };
      case 'tabs':
        return { items: ['All', 'Active', 'Invited', 'Disabled'] };
      case 'breadcrumb':
        return { items: ['Home', 'Section', 'Detail'] };
      case 'footer':
        return { items: ['Privacy', 'Terms', 'Support'] };
      case 'hero':
        return { items: ['Title', 'Subtitle', 'Get started'] };
      case 'kpi':
        return { items: ['Users', 'Active', 'Revenue', 'Churn'] };
      case 'list':
        return {
          columns: ['Name', 'Email', 'Status', 'Joined'],
          rows: [
            ['Ada Lovelace', 'ada@acme.io', 'Active', 'Mar 4, 2025'],
            ['Linus Torvalds', 'linus@acme.io', 'Active', 'Jan 12, 2024'],
            ['Grace Hopper', 'grace@acme.io', 'Inactive', 'Aug 22, 2023'],
          ],
        };
      case 'chart':
        return { items: ['Jan', 'Feb', 'Mar', 'Apr'] };
      case 'detail':
      case 'rightpanel-detail':
        return { items: ['Status', 'Email', 'Role', 'Joined'] };
      case 'rightpanel-filters':
        return { items: ['Status', 'Date range', 'Assigned to'] };
      case 'rightpanel-activity':
        return { items: ['Created record', 'Updated status', 'Added note'] };
      case 'empty':
        return { items: ['Nothing here yet', 'Create record'] };
      case 'main':
        return { items: ['Summary', 'Highlights', 'Notes'] };
      case 'form':
        return { items: ['Name', 'Email', 'Role', 'Team'] };
      case 'filters':
        return { items: ['Role', 'Joined', 'Clear'] };
      case 'editable-component':
        return {};
      case 'stepper':
        return { items: ['Account', 'Profile', 'Team', 'Review'] };
      case 'modal':
        return { items: ['Cancel', 'Confirm'] };
      case 'actions':
        return { items: ['Cancel', 'Save changes'] };
      default:
      {
        // Extensibility contract:
        // 1) If a new component type defines COMPONENT_TYPES[type].defaultProps, use it.
        // 2) Otherwise auto-enable generic editing with a single item from its label.
        const metaDefault = api.COMPONENT_TYPES?.[type]?.defaultProps;
        if (metaDefault && typeof metaDefault === 'object') {
          return JSON.parse(JSON.stringify(metaDefault));
        }
        if (type === 'custom') return {};
        const label = api.DEFAULT_LABELS?.[type] || api.COMPONENT_TYPES?.[type]?.label || type;
        if (!label) return {};
        return { items: [label] };
      }
    }
  }

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
    getDefaultProps,
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
