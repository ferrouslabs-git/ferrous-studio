// Static component metadata, labels, and pattern presets.
(() => {
  const api = window.VSUB = window.VSUB || {};

  // Extensibility: new component types can optionally provide `defaultProps` here.
  // If omitted, state.js auto-falls back to { items: [label] } so inline editing still works.
  api.COMPONENT_TYPES = {
    navbar:     { group: 'Structure',    label: 'Nav bar',           desc: 'App header with logo, links, avatar' },
    sidebar:    { group: 'Structure',    label: 'Sidebar',           desc: 'Vertical nav rail or section list' },
    tabs:       { group: 'Structure',    label: 'Tabs',              desc: 'Horizontal tab bar for sub-sections' },
    breadcrumb: { group: 'Structure',    label: 'Breadcrumb',        desc: 'Location trail' },
    footer:     { group: 'Structure',    label: 'Footer',            desc: 'Page-level footer bar' },
    hero:       { group: 'Content',      label: 'Hero',              desc: 'Full-width banner or intro section' },
    kpi:        { group: 'Content',      label: 'KPI row',           desc: 'Metric tiles: numbers at a glance' },
    list:       { group: 'Content',      label: 'List / table',      desc: 'Rows of records with actions' },
    chart:      { group: 'Content',      label: 'Chart',             desc: 'Bar / line / pie data visualisation' },
    detail:     { group: 'Content',      label: 'Detail panel',      desc: 'Single-record read view (key → value)' },
    empty:      { group: 'Content',      label: 'Empty state',       desc: 'Zero-data / first-run placeholder' },
    main:       { group: 'Content',      label: 'Main content',      desc: 'Generic rich-text or summary area' },
    form:       { group: 'Interaction',  label: 'Form',              desc: 'Input fields for create / edit' },
    filters:    { group: 'Interaction',  label: 'Filter / search',   desc: 'Search box + filter chips' },
    'editable-component': { group: 'Interaction',  label: 'Editable component', desc: 'Reusable custom block editable with the builder' },
    stepper:    { group: 'Interaction',  label: 'Stepper',           desc: 'Multi-step progress indicator' },
    modal:      { group: 'Interaction',  label: 'Modal / dialog',    desc: 'Overlay dialog box' },
    actions:    { group: 'Interaction',  label: 'Footer actions',    desc: 'Save / cancel button row' },
  };

  api.DEFAULT_LABELS = {
    navbar: 'App', sidebar: 'Sidebar', tabs: 'Tabs', breadcrumb: 'Breadcrumb', footer: 'Footer',
    hero: 'Hero', kpi: 'Metrics', list: 'List', chart: 'Chart', detail: 'Detail',
    empty: 'No data yet', main: 'Main', form: 'Form', filters: 'Search bar',
    'editable-component': 'Editable component',
    stepper: 'Steps', modal: 'Dialog', actions: 'Actions',
    'nav-basic': 'Nav', 'nav-search': 'Nav', 'nav-cta': 'Nav',
    'sidenav-simple': 'Side Nav', 'sidenav-grouped': 'Side Nav', 'sidenav-workspace': 'Side Nav',
    'rightpanel-detail': 'Detail Panel', 'rightpanel-filters': 'Filter Panel', 'rightpanel-activity': 'Activity Feed',
  };

  // Shell component families — structural nav/panel components with selectable variants.
  api.COMPONENT_FAMILIES = [
    {
      id: 'top-nav',
      group: 'Shell',
      name: 'Top Nav',
      desc: 'Horizontal navigation bar docked to the header',
      region: 'header',
      icon: 'NAV',
      variants: [
        { type: 'nav-basic',  name: 'Basic',       desc: 'Logo · links · avatar',                  icon: 'N·B' },
        { type: 'nav-search', name: 'With search',  desc: 'Logo · search bar · avatar',             icon: 'N·S' },
        { type: 'nav-cta',    name: 'With CTA',     desc: 'Logo · links · action button · avatar',  icon: 'N·C' },
      ],
    },
    {
      id: 'side-nav',
      group: 'Shell',
      name: 'Side Nav',
      desc: 'Vertical navigation panel docked to the left',
      region: 'sidebar',
      icon: 'SID',
      variants: [
        { type: 'sidenav-simple',    name: 'Simple',             desc: 'Flat list of nav items',          icon: 'S·S' },
        { type: 'sidenav-grouped',   name: 'Grouped',            desc: 'Items organised under sections',  icon: 'S·G' },
        { type: 'sidenav-workspace', name: 'Workspace switcher', desc: 'Workspace selector + grouped nav', icon: 'S·W' },
      ],
    },
    {
      id: 'right-panel',
      group: 'Shell',
      name: 'Right Panel',
      desc: 'Content panel docked to the right of main',
      region: 'right',
      icon: 'RPL',
      variants: [
        { type: 'rightpanel-detail',   name: 'Detail view',   desc: 'Key / value record detail',  icon: 'R·D' },
        { type: 'rightpanel-filters',  name: 'Filter panel',  desc: 'Contextual filter controls', icon: 'R·F' },
        { type: 'rightpanel-activity', name: 'Activity feed', desc: 'Recent events timeline',     icon: 'R·A' },
      ],
    },
  ];

  api.PATTERNS = [
    {
      id: 'empty-screen',
      icon: 'EMP',
      name: 'Empty screen',
      group: 'Starter',
      desc: 'Blank screen with no components',
      components: [],
    },
    {
      id: 'nav-basic-only',
      icon: 'N-B',
      name: 'Nav only - Basic',
      group: 'Top Nav',
      desc: 'Header with basic top navigation',
      components: ['nav-basic'],
    },
    {
      id: 'nav-search-only',
      icon: 'N-S',
      name: 'Nav only - Search',
      group: 'Top Nav',
      desc: 'Header with search-enabled top navigation',
      components: ['nav-search'],
    },
    {
      id: 'nav-cta-only',
      icon: 'N-C',
      name: 'Nav only - CTA',
      group: 'Top Nav',
      desc: 'Header with CTA-style top navigation',
      components: ['nav-cta'],
    },
    {
      id: 'left-panel-simple',
      icon: 'L-S',
      name: 'Left panel - Simple',
      group: 'Left Panel',
      desc: 'Main area with simple side navigation',
      components: ['sidenav-simple', 'main'],
    },
    {
      id: 'left-panel-grouped',
      icon: 'L-G',
      name: 'Left panel - Grouped',
      group: 'Left Panel',
      desc: 'Main area with grouped side navigation',
      components: ['sidenav-grouped', 'main'],
    },
    {
      id: 'left-panel-workspace',
      icon: 'L-W',
      name: 'Left panel - Workspace',
      group: 'Left Panel',
      desc: 'Main area with workspace switcher side navigation',
      components: ['sidenav-workspace', 'main'],
    },
    {
      id: 'right-panel-detail',
      icon: 'R-D',
      name: 'Right panel - Detail',
      group: 'Right Panel',
      desc: 'Main area with right-side detail panel',
      components: ['main', 'rightpanel-detail'],
    },
    {
      id: 'right-panel-filters',
      icon: 'R-F',
      name: 'Right panel - Filters',
      group: 'Right Panel',
      desc: 'Main area with right-side filter panel',
      components: ['main', 'rightpanel-filters'],
    },
    {
      id: 'right-panel-activity',
      icon: 'R-A',
      name: 'Right panel - Activity',
      group: 'Right Panel',
      desc: 'Main area with right-side activity feed',
      components: ['main', 'rightpanel-activity'],
    },
    {
      id: 'full-shell-basic',
      icon: 'F-B',
      name: 'Full shell - Basic nav',
      group: 'Full Shell',
      desc: 'Basic nav + simple left panel + detail right panel',
      components: ['nav-basic', 'sidenav-simple', 'main', 'rightpanel-detail'],
    },
    {
      id: 'full-shell-search',
      icon: 'F-S',
      name: 'Full shell - Search nav',
      group: 'Full Shell',
      desc: 'Search nav + grouped left panel + filters right panel',
      components: ['nav-search', 'sidenav-grouped', 'main', 'rightpanel-filters'],
    },
    {
      id: 'full-shell-cta',
      icon: 'F-C',
      name: 'Full shell - CTA nav',
      group: 'Full Shell',
      desc: 'CTA nav + workspace left panel + activity right panel',
      components: ['nav-cta', 'sidenav-workspace', 'main', 'rightpanel-activity'],
    },
  ];
})();
