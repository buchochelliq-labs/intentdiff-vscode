// The review webview's chrome stylesheet (theme-native: --vscode-* variables only).

export function styles(): string {
  return `
    :root { color-scheme: light dark; --bright-fg:var(--vscode-editor-foreground); --bright-fg-strong:var(--vscode-editor-foreground); --sheen:var(--vscode-editorWidget-background); --chip-bg:var(--vscode-input-background); --purple-fg:var(--vscode-charts-purple); --purple-strong:var(--vscode-charts-purple); --red-fg:var(--vscode-charts-red); --green-fg:var(--vscode-charts-green); --soft-fg:var(--vscode-foreground); --cyan-fg:var(--vscode-charts-blue); --bg:var(--vscode-editor-background); --panel:var(--vscode-editorWidget-background); --panel2:var(--vscode-editorHoverWidget-background); --panel3:var(--vscode-sideBar-background); --text:var(--vscode-foreground); --muted:var(--vscode-descriptionForeground); --cyan:var(--vscode-charts-blue); --mint:var(--vscode-charts-green); --green:var(--vscode-charts-green); --red:var(--vscode-charts-red); --amber:var(--vscode-charts-yellow); --purple:var(--vscode-charts-purple); --line:var(--vscode-panel-border); --soft-line:rgba(81,103,134,.34); --diff-editor-bg:var(--vscode-editor-background); --diff-heads-bg:var(--vscode-editorGroupHeader-tabsBackground,var(--diff-editor-bg)); --diff-gutter-bg:var(--vscode-editorGutter-background,var(--diff-editor-bg)); --diff-linenumber-fg:var(--vscode-editorLineNumber-foreground); --diff-inserted-bg:var(--vscode-diffEditor-insertedLineBackground,rgba(46,160,67,.18)); --diff-removed-bg:var(--vscode-diffEditor-removedLineBackground,rgba(248,81,73,.18)); --diff-inserted-strip:var(--vscode-intentdiff-semanticChanges-addition,var(--green)); --diff-removed-strip:var(--vscode-intentdiff-semanticChanges-deletion,var(--red)); --diff-changed-strip:var(--vscode-intentdiff-semanticChanges-modification,var(--amber)); --intent-accent:var(--vscode-intentdiff-semanticChanges-root,var(--cyan)); --intent-refactor-accent:var(--vscode-intentdiff-semanticChanges-refactoring,var(--purple)); }
    * { box-sizing: border-box; }
    body { margin:0; padding:16px; background:radial-gradient(circle at 16% -12%,rgba(79,214,255,.16),transparent 32%),var(--bg); color:var(--text); font:13px/1.45 var(--vscode-font-family, system-ui, sans-serif); }
    h1,h2,h3,p { margin:0; }
    h1 { font-size:24px; line-height:1.1; letter-spacing:0; }
    h2 { font-size:13px; margin:0 0 10px; color:var(--bright-fg); }
    h3 { font-size:13px; }
    p, small { color:var(--muted); }
    button { font:inherit; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    .eyebrow { color:var(--cyan); text-transform:uppercase; font-size:11px; letter-spacing:.08em; margin-bottom:6px; }
    .hero,.panel-hero,.file-card,.card,.empty { border:1px solid var(--line); border-radius:8px; background:linear-gradient(180deg,rgba(18,32,52,.96),rgba(12,23,39,.96)); box-shadow:0 14px 34px rgba(0,0,0,.22); }
    .hero { padding:18px; display:grid; gap:16px; }
    .panel-hero { padding:16px; display:flex; justify-content:space-between; gap:14px; align-items:flex-start; margin-bottom:12px; }
    .review-panel-hero { border-color:rgba(79,214,255,.34); }
    .hero-copy { display:grid; gap:4px; min-width:0; }
    .hero-badges { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
    .hero-actions,.card-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .metric-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
    .metric { border:1px solid var(--line); border-radius:6px; padding:10px; background:var(--panel); }
    .metric span { display:block; color:var(--muted); font-size:11px; }
    .metric strong { display:block; margin-top:3px; font-size:22px; color:var(--mint); }
    .metric.warn strong { color:var(--amber); } .metric.danger strong { color:var(--red); }
    .strip { display:flex; gap:6px; flex-wrap:wrap; margin:12px 0; }
    .pill,.badge { border:1px solid var(--line); border-radius:999px; padding:3px 8px; color:var(--bright-fg); background:var(--chip-bg); }
    .intent-pill { border-color:rgba(181,140,255,.42); color:var(--purple-fg); background:rgba(181,140,255,.13); }
    .evidence-pill { border-color:rgba(79,214,255,.42); color:var(--cyan-fg); background:rgba(79,214,255,.12); }
    .guardrail-pill { border-color:rgba(255,107,107,.55); color:var(--red-fg); background:rgba(255,107,107,.12); }
    .section { margin-top:14px; }
    .file-card,.card,.empty { padding:12px; margin-bottom:10px; }
    .file-card.guarded { border-color:rgba(255,107,107,.75); }
    .file-card header { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:10px; }
    .action { cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid rgba(79,214,255,.5); color:var(--bright-fg); background:var(--panel2); border-radius:6px; padding:5px 9px; min-height:30px; }
    .action:hover { background:var(--panel2); }
    .action:focus-visible,.icon-action:focus-visible,.filter-pill:focus-visible,.stat:focus-visible,.intent-chip:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
    .control-icon { width:15px; height:15px; fill:none; stroke:currentColor; stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; flex:0 0 auto; }
    .dashboard-app { min-height:100vh; display:grid; grid-template-rows:auto minmax(0,1fr); gap:10px; }
    .dashboard-topbar { position:sticky; top:0; z-index:20; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,auto); grid-template-areas:"title actions" "pills pills"; gap:8px 12px; align-items:center; padding:12px 14px; border:1px solid var(--line); border-radius:8px; background:linear-gradient(180deg,rgba(16,29,48,.98),rgba(10,23,39,.98)); box-shadow:0 14px 34px rgba(0,0,0,.22); }
    .dashboard-title { grid-area:title; min-width:0; }
    .dashboard-title h1 { font-size:19px; }
    .dashboard-title p { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-pills { grid-area:pills; min-width:0; display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
    .dashboard-actions { grid-area:actions; min-width:0; display:flex; justify-content:flex-end; gap:6px; overflow-x:auto; overflow-y:hidden; scrollbar-width:thin; }
    .dashboard-summary-pill { display:inline-flex; align-items:center; gap:6px; border:1px solid rgba(79,214,255,.28); border-radius:999px; padding:3px 8px; color:var(--bright-fg); background:rgba(79,214,255,.09); }
    .dashboard-summary-pill small { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
    .dashboard-summary-pill strong { font-size:13px; color:var(--bright-fg-strong); }
    .dashboard-summary-pill.warn strong { color:var(--amber); }
    .dashboard-summary-pill.danger strong { color:var(--red); }
    .dashboard-filter-pill { cursor:pointer; border:1px solid rgba(79,214,255,.28); border-radius:999px; padding:3px 8px; color:var(--bright-fg); background:rgba(16,36,58,.65); }
    .dashboard-filter-pill:hover,.dashboard-filter-pill.is-active { border-color:rgba(79,214,255,.75); color:var(--bright-fg-strong); background:rgba(23,68,90,.84); }
    .dashboard-workspace { position:relative; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); }
    .dashboard-board { min-width:0; min-height:0; display:grid; grid-template-rows:auto auto auto minmax(0,1fr); gap:8px; padding:0 48px; transition:padding .16s ease; }
    .dashboard-app[data-left-pinned="true"] .dashboard-board { padding-left:310px; }
    .dashboard-app[data-right-pinned="true"] .dashboard-board { padding-right:330px; }
    .dashboard-board-heading { min-width:0; display:flex; justify-content:space-between; align-items:center; gap:12px; padding:8px 10px; border:1px solid rgba(81,103,134,.28); border-radius:8px; background:rgba(7,17,29,.55); }
    .dashboard-board-heading h2 { margin:0; text-transform:uppercase; letter-spacing:.06em; color:var(--bright-fg); }
    .dashboard-board-heading p { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
    .dashboard-board-count { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; border:1px solid rgba(79,214,255,.42); border-radius:999px; color:var(--bright-fg); background:rgba(79,214,255,.1); font-weight:700; }
    .dashboard-fuel-panel { min-width:0; display:grid; gap:8px; padding:10px; border:1px solid rgba(79,214,255,.25); border-radius:8px; background:linear-gradient(180deg,rgba(13,26,44,.9),rgba(8,18,31,.82)); }
    .dashboard-fuel-panel header { min-width:0; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .dashboard-fuel-panel h2 { margin:0; text-transform:uppercase; letter-spacing:.06em; color:var(--bright-fg); }
    .dashboard-fuel-panel p { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
    .dashboard-fuel-kpis { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
    .dashboard-fuel-kpis span { display:grid; min-width:58px; padding:5px 8px; border:1px solid rgba(79,214,255,.2); border-radius:7px; background:rgba(5,12,22,.32); }
    .dashboard-fuel-kpis strong { color:var(--bright-fg-strong); }
    .dashboard-fuel-kpis small { color:var(--muted); text-transform:uppercase; letter-spacing:.05em; font-size:9px; }
    .dashboard-fuel-table { display:grid; gap:5px; }
    .dashboard-fuel-row { min-width:0; display:grid; grid-template-columns:minmax(120px,1fr) minmax(70px,.4fr) repeat(3,minmax(70px,.35fr)) minmax(72px,.45fr); gap:8px; align-items:center; padding:7px 8px; border:1px solid rgba(79,214,255,.16); border-radius:7px; background:rgba(16,36,58,.35); color:var(--soft-fg); }
    .dashboard-fuel-row.is-hot { border-color:rgba(255,107,107,.44); background:rgba(255,107,107,.08); }
    .dashboard-fuel-row strong,.dashboard-fuel-row span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-timeline-panel { min-width:0; display:grid; gap:8px; padding:10px; border:1px solid rgba(181,140,255,.25); border-radius:8px; background:linear-gradient(180deg,rgba(23,18,46,.75),rgba(8,18,31,.82)); }
    .dashboard-timeline-panel header { min-width:0; display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .dashboard-timeline-panel h2 { margin:0; text-transform:uppercase; letter-spacing:.06em; color:var(--purple-fg); }
    .dashboard-timeline-panel p { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:11px; }
    .timeline-delta { max-width:48%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:1px solid rgba(181,140,255,.34); border-radius:999px; padding:4px 8px; color:var(--purple-fg); background:rgba(181,140,255,.1); font-size:11px; }
    .dashboard-timeline-list { display:grid; gap:5px; }
    .dashboard-timeline-row { min-width:0; display:grid; grid-template-columns:minmax(110px,.8fr) minmax(140px,1fr) repeat(4,minmax(58px,.35fr)); gap:8px; align-items:center; padding:7px 8px; border:1px solid rgba(181,140,255,.16); border-radius:7px; background:rgba(23,18,46,.32); color:var(--soft-fg); }
    .dashboard-timeline-row.is-hot { border-color:rgba(247,193,77,.42); background:rgba(247,193,77,.08); }
    .dashboard-timeline-row strong,.dashboard-timeline-row span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .fuel-sparkline { display:flex; align-items:end; gap:2px; height:26px; min-width:64px; }
    .fuel-sparkline i { width:5px; height:var(--bar-height); min-height:3px; border-radius:999px 999px 2px 2px; background:linear-gradient(180deg,var(--cyan),var(--green)); }
    .fuel-pill { border-color:rgba(247,193,77,.42); color:var(--amber); background:rgba(247,193,77,.12); }
    .dashboard-file-list { min-height:0; display:grid; align-content:start; gap:7px; overflow:auto; padding-bottom:12px; }
    .dashboard-file-group { display:grid; gap:6px; min-width:0; border:1px solid rgba(79,214,255,.22); border-radius:10px; padding:7px; background:linear-gradient(180deg,rgba(12,25,43,.72),rgba(7,17,29,.58)); }
    .dashboard-file-group[hidden] { display:none; }
    .dashboard-file-group-heading { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; min-width:0; }
    .dashboard-group-toggle { cursor:pointer; min-width:0; display:grid; grid-template-columns:auto minmax(0,auto) minmax(0,1fr); gap:7px; align-items:center; text-align:left; border:0; color:var(--bright-fg); background:transparent; padding:3px 2px; }
    .dashboard-group-toggle strong,.dashboard-group-toggle small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-group-toggle small { color:var(--muted); font-size:11px; }
    .group-chevron { color:var(--cyan); font-size:13px; }
    .dashboard-file-group[data-collapsed="true"] .group-chevron { transform:rotate(-90deg); }
    .dashboard-group-pills { min-width:0; display:flex; flex-wrap:wrap; justify-content:flex-end; gap:5px; }
    .dashboard-file-group-body { display:grid; gap:7px; min-width:0; }
    .dashboard-file-group[data-collapsed="true"] .dashboard-file-group-body { display:none; }
    .dashboard-file-row { border:1px solid rgba(55,76,104,.42); border-radius:8px; background:linear-gradient(180deg,rgba(13,26,44,.92),rgba(8,18,31,.92)); overflow:hidden; }
    .dashboard-file-row.guarded { border-color:rgba(255,107,107,.72); box-shadow:inset 3px 0 0 rgba(255,107,107,.82); }
    .dashboard-file-row.is-selected { border-color:rgba(79,214,255,.82); box-shadow:0 0 0 3px rgba(79,214,255,.1), inset 3px 0 0 rgba(79,214,255,.82); }
    .dashboard-file-row[hidden] { display:none; }
    .dashboard-file-row header { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; padding:9px 10px; border-bottom:1px solid rgba(81,103,134,.22); }
    .dashboard-file-select { cursor:pointer; display:grid; gap:2px; min-width:0; text-align:left; border:0; padding:0; color:var(--text); background:transparent; }
    .dashboard-file-select strong,.dashboard-file-select span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-file-select strong { font-size:13px; color:var(--bright-fg-strong); }
    .dashboard-file-select span { color:var(--muted); font-size:11px; }
    .dashboard-file-actions { min-width:0; display:flex; align-items:center; justify-content:flex-end; gap:5px; flex-wrap:wrap; }
    .dashboard-file-actions .action { min-height:26px; padding:3px 7px; border-radius:999px; }
    .dashboard-file-actions .action .control-icon { width:13px; height:13px; }
    .dashboard-signal-preview,.dashboard-file-extra,.dashboard-detail-signals { display:grid; gap:5px; padding:8px 10px; }
    .dashboard-file-extra { display:none; padding-top:0; }
    .dashboard-file-row[data-expanded="true"] .dashboard-file-extra { display:grid; }
    .dashboard-expand { cursor:pointer; margin:0 10px 8px; border:1px solid rgba(79,214,255,.28); border-radius:999px; padding:3px 8px; color:var(--bright-fg); background:rgba(79,214,255,.08); font-size:11px; }
    .dashboard-signal { cursor:pointer; display:grid; grid-template-columns:4px minmax(0,1fr) auto; gap:8px; align-items:center; min-width:0; border:1px solid transparent; border-radius:6px; padding:6px 7px; text-align:left; color:var(--text); background:rgba(7,17,29,.42); }
    .dashboard-signal:hover { border-color:rgba(79,214,255,.34); background:rgba(79,214,255,.08); }
    .dashboard-signal .entry-dot { align-self:stretch; width:3px; height:auto; min-height:30px; border-radius:999px; box-shadow:0 0 12px currentColor; }
    .dashboard-signal strong,.dashboard-signal small { display:block; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-signal strong { font-size:12px; color:var(--bright-fg-strong); }
    .dashboard-signal small { color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
    .dashboard-dock { position:absolute; z-index:15; top:0; bottom:0; width:288px; pointer-events:none; }
    .dashboard-dock-left { left:0; }
    .dashboard-dock-right { right:0; width:306px; }
    .dashboard-dock-tab { pointer-events:auto; position:absolute; top:8px; display:flex; align-items:center; gap:6px; width:36px; min-height:112px; border:1px solid rgba(79,214,255,.34); color:var(--bright-fg); background:linear-gradient(180deg,var(--chip-bg),var(--panel3)); box-shadow:0 10px 24px rgba(0,0,0,.24); writing-mode:vertical-rl; text-orientation:mixed; border-radius:999px; cursor:pointer; }
    .dashboard-dock-left .dashboard-dock-tab { left:8px; }
    .dashboard-dock-right .dashboard-dock-tab { right:8px; }
    .dashboard-dock-tab .control-icon { width:16px; height:16px; }
    .dashboard-dock-panel { pointer-events:auto; position:absolute; top:0; bottom:0; width:100%; display:grid; grid-template-rows:auto minmax(0,1fr); gap:8px; padding:10px; border:1px solid var(--line); border-radius:8px; background:linear-gradient(180deg,var(--panel3),var(--bg)); box-shadow:0 18px 36px rgba(0,0,0,.32); opacity:0; transform:translateX(-102%); transition:opacity .14s ease, transform .14s ease; }
    .dashboard-dock-right .dashboard-dock-panel { transform:translateX(102%); }
    .dashboard-dock:hover .dashboard-dock-panel,
    .dashboard-app[data-left-open="true"] .dashboard-dock-left .dashboard-dock-panel,
    .dashboard-app[data-left-pinned="true"] .dashboard-dock-left .dashboard-dock-panel,
    .dashboard-app[data-right-open="true"] .dashboard-dock-right .dashboard-dock-panel,
    .dashboard-app[data-right-pinned="true"] .dashboard-dock-right .dashboard-dock-panel { opacity:1; transform:translateX(0); }
    .dashboard-app[data-left-pinned="true"] .dashboard-dock-left,
    .dashboard-app[data-right-pinned="true"] .dashboard-dock-right { pointer-events:auto; }
    .dashboard-dock-panel header { display:flex; justify-content:space-between; align-items:center; gap:8px; padding-bottom:8px; border-bottom:1px solid rgba(81,103,134,.24); }
    .dashboard-dock-panel h2 { margin:0; }
    .dashboard-filter-groups,.dashboard-detail-stack { min-height:0; overflow:auto; display:grid; align-content:start; gap:12px; }
    .dashboard-filter-groups h3 { margin-bottom:6px; color:var(--bright-fg); text-transform:uppercase; letter-spacing:.06em; font-size:11px; }
    .dashboard-filter-list,.dashboard-detail-pills,.dashboard-detail-actions { min-width:0; display:flex; flex-wrap:wrap; gap:6px; }
    .dashboard-file-detail { display:none; gap:8px; align-content:start; }
    .dashboard-file-detail.is-selected { display:grid; }
    .dashboard-file-detail h3 { font-size:14px; color:var(--bright-fg-strong); overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .dashboard-file-detail p { font-size:11px; }
    .entry-list { display:grid; gap:6px; }
    .entry { width:100%; text-align:left; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:9px; align-items:center; border:1px solid rgba(55,76,104,.34); border-radius:7px; padding:8px; background:linear-gradient(90deg,rgba(12,23,39,.96),rgba(14,29,49,.96)); color:var(--text); }
    .entry:hover { border-color:rgba(79,214,255,.52); background:var(--panel2); transform:translateY(-1px); }
    .entry-reveal { cursor:pointer; min-width:0; display:grid; grid-template-columns:auto minmax(0,1fr); gap:9px; align-items:center; border:0; padding:0; text-align:left; color:inherit; background:transparent; }
    .entry-dot { width:10px; height:10px; border-radius:50%; background:var(--cyan); }
    .entry-main { min-width:0; display:grid; gap:1px; }
    .entry-main strong,.entry-main small { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .entry-meta { min-width:0; display:flex; gap:6px; align-items:center; }
    .entry-meta small:first-child { color:var(--bright-fg); text-transform:uppercase; font-size:10px; letter-spacing:.06em; }
    .entry-guardrail .entry-dot,.severity-error .entry-dot { background:var(--red); color:var(--red); }
    .entry-refactoring .entry-dot { background:var(--purple); color:var(--purple); }
    .entry-moved-code .entry-dot { background:var(--mint); color:var(--mint); }
    .entry-meaningful .entry-dot,.severity-warning .entry-dot { background:var(--amber); color:var(--amber); }
    .entry-schema-status .entry-dot { background:var(--cyan); color:var(--cyan); }
    .entry-ignored-style .entry-dot { background:var(--green); color:var(--green); }
    .entry-noise-suppressed .entry-dot { background:var(--muted); color:var(--muted); }
    .entry-raw-evidence .entry-dot { background:var(--cyan); color:var(--cyan); }
    /* Rich intent meaning (what/why + risk) shared by evidence rows and the Intent tab. */
    .entry-head { display:flex; align-items:center; gap:6px; min-width:0; }
    .entry-why { color:var(--muted); font-size:11px; line-height:1.35; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .entry-loc { color:var(--cyan) !important; font-family:var(--vscode-editor-font-family,monospace); text-transform:none !important; letter-spacing:0 !important; }
    .risk-pill { flex:0 0 auto; font-size:9px; text-transform:uppercase; letter-spacing:.05em; font-weight:700; padding:1px 6px; border-radius:999px; border:1px solid transparent; }
    .risk-pill.risk-behavior { color:var(--amber); border-color:rgba(247,193,77,.5); background:rgba(247,193,77,.12); }
    .risk-pill.risk-internal { color:var(--mint); border-color:rgba(86,214,194,.4); background:rgba(86,214,194,.1); }
    .risk-pill.risk-content { color:var(--muted); border-color:var(--soft-line); background:rgba(148,163,184,.1); }
    .intent-meaning-list { list-style:none; margin:0; padding:0; display:grid; gap:11px; }
    .intent-meaning { display:flex; gap:9px; align-items:flex-start; min-width:0; }
    .intent-meaning .entry-dot { margin-top:3px; flex:0 0 auto; }
    .intent-meaning-body { min-width:0; display:grid; gap:3px; }
    .intent-meaning-head { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
    .intent-meaning-head strong { color:var(--bright-fg-strong); line-height:1.3; }
    .intent-meaning-why { color:var(--muted); font-size:12px; line-height:1.4; }
    .intent-meaning-quiet .intent-meaning-head strong { color:var(--muted); }
    .intent-meaning code,.intent-meaning-why code,.entry-head code,.entry-why code,.release-note-preview code,.release-narrative-card code { font-family:var(--vscode-editor-font-family,monospace); font-size:.92em; padding:0 3px; border-radius:4px; background:rgba(79,214,255,.1); color:var(--bright-fg); }
    .release-narrative-card { border-color:rgba(124,106,247,.34); }
    .release-narrative-card p { color:var(--text); line-height:1.5; margin:0 0 8px; }
    .release-narrative-card .ai-badge { font-size:9px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; color:var(--purple,var(--purple)); border:1px solid rgba(181,140,255,.5); border-radius:999px; padding:1px 6px; margin-left:6px; vertical-align:middle; }
    .release-narrative-note { color:var(--muted) !important; font-size:11px; font-style:italic; margin-top:4px !important; }
    .entry-actions { grid-column:1 / -1; display:flex; justify-content:flex-end; gap:5px; min-width:0; }
    .entry-actions .action { min-height:24px; padding:3px 8px; font-size:11px; }
    .panel-grid { display:grid; grid-template-columns:minmax(240px, 30%) 1fr; gap:12px; min-height:0; }
    .intent-rail { border:1px solid var(--line); border-radius:8px; background:linear-gradient(180deg,var(--panel3),var(--bg)); padding:0; overflow:hidden; box-shadow:0 12px 28px rgba(0,0,0,.18); }
    .rail-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
    .rail-heading h2 { margin:0; }
    .rail-heading span { border:1px solid var(--line); border-radius:999px; padding:1px 7px; color:var(--bright-fg); background:var(--chip-bg); }
    .intent-summary { display:flex; flex-wrap:wrap; gap:5px; margin:0; }
    .intent-chip { border:1px solid var(--soft-line); border-radius:999px; padding:2px 7px; color:var(--muted); background:var(--panel3); font-size:11px; }
    .intent-chip strong { color:var(--text); margin-left:3px; }
    .chip-guardrail { border-color:rgba(255,107,107,.5); color:var(--red-fg); }
    .chip-moved-code { border-color:rgba(86,214,194,.45); color:var(--mint); }
    .chip-refactoring { border-color:rgba(181,140,255,.45); color:var(--purple-fg); }
    .chip-meaningful { border-color:rgba(247,193,77,.45); color:var(--amber); }
    .chip-schema-status { border-color:rgba(79,214,255,.45); color:var(--cyan-fg); }
    .chip-ignored-style { border-color:rgba(126,231,135,.45); color:var(--green); }
    .diff-surface { --diff-grid:24px 46px minmax(260px,1fr) 36px 46px minmax(260px,1fr); border:1px solid var(--line); border-radius:8px; overflow:hidden; background:var(--bg); box-shadow:0 12px 28px rgba(0,0,0,.18); min-height:420px; }
    .diff-toolbar { display:flex; justify-content:space-between; gap:10px; padding:9px 12px; color:var(--muted); background:var(--panel); border-bottom:1px solid var(--line); }
    .diff-toolbar strong { color:var(--bright-fg); }
    .diff-stats { display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end; }
    .stat { display:inline-flex; gap:5px; align-items:center; border:1px solid var(--soft-line); border-radius:999px; padding:2px 7px; background:var(--panel3); color:var(--muted); font-size:11px; }
    .stat strong { color:var(--text); font-weight:700; }
    .stat-insert { border-color:rgba(126,231,135,.44); color:var(--green); }
    .stat-delete { border-color:rgba(255,107,107,.44); color:var(--red); }
    .stat-change { border-color:rgba(247,193,77,.44); color:var(--amber); }
    .stat-semantic { border-color:rgba(79,214,255,.44); color:var(--cyan); }
    .diff-column-heads { display:grid; grid-template-columns:var(--diff-grid); min-width:900px; border-bottom:1px solid var(--line); background:var(--diff-heads-bg); color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; }
    .diff-column-heads span { padding:7px 10px; border-left:1px solid var(--soft-line); }
    .base-head { grid-column:2 / 4; }
    .connector-head { grid-column:4; border-left:0; background:var(--diff-gutter-bg); }
    .working-head { grid-column:5 / 7; }
    .diff-stage { position:relative; min-height:360px; overflow:hidden; }
    .diff-minimap { position:absolute; top:0; right:0; bottom:0; width:22px; z-index:12; background:var(--vscode-scrollbarSlider-background,rgba(121,121,121,.14)); border-left:1px solid var(--vscode-sideBar-border,rgba(255,255,255,.08)); overflow:hidden; pointer-events:auto; cursor:pointer; }
    .overview-ruler-track { position:absolute; inset:0; background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.008)); }
    .overview-lane-guide { position:absolute; top:0; bottom:0; width:1px; background:rgba(255,255,255,.06); pointer-events:none; }
    .overview-guide-left { left:6px; }
    .overview-guide-center { left:11px; }
    .overview-guide-right { left:16px; }
    .overview-viewport { position:absolute; left:2px; right:2px; top:var(--viewport-top,0%); height:var(--viewport-height,24%); min-height:8px; border:1px solid var(--vscode-scrollbarSlider-activeBackground,rgba(173,214,255,.62)); background:var(--vscode-scrollbarSlider-hoverBackground,rgba(173,214,255,.16)); box-shadow:0 0 0 1px rgba(0,0,0,.22); pointer-events:none; }
    .overview-active-marker { position:absolute; left:1px; right:1px; top:var(--active-overview-top,-10%); height:2px; background:var(--vscode-focusBorder,var(--cyan)); box-shadow:0 0 8px rgba(79,214,255,.72); pointer-events:none; opacity:0; }
    .overview-lane { position:absolute; inset:0; }
    .overview-hit { position:absolute; left:0; right:0; top:var(--overview-top); height:max(var(--overview-height), 4px); min-height:4px; padding:0; border:0; background:transparent; cursor:pointer; }
    .overview-mark { display:block; position:absolute; width:4px; height:100%; opacity:.98; background:rgba(147,164,186,.62); box-shadow:0 0 0 1px rgba(0,0,0,.22); }
    .overview-lane-left .overview-mark { left:3px; }
    .overview-lane-center .overview-mark { left:9px; }
    .overview-lane-right .overview-mark { right:3px; }
    .overview-collapsed .overview-mark { width:6px; }
    .overview-insert .overview-mark { background:var(--green); }
    .overview-delete .overview-mark { background:var(--red); }
    .overview-change .overview-mark { background:var(--amber); }
    .overview-equal.semantic .overview-mark { background:var(--cyan); }
    .overview-refactoring,
    .overview-refactoring.semantic .overview-mark { background:var(--purple); }
    .overview-hit.semantic .overview-mark { opacity:1; width:7px; }
    .overview-hit.is-selected .overview-mark { width:9px; }
    .overview-hit:hover .overview-mark,.overview-hit.is-selected .overview-mark { filter:brightness(1.18); outline:1px solid var(--vscode-focusBorder,rgba(255,255,255,.7)); }
    .diff-table { font-family:var(--vscode-editor-font-family, Consolas, monospace); font-size:12px; overflow:auto; max-height:72vh; min-height:360px; padding-right:22px; background:var(--diff-editor-bg); }
    .diff-hunk { display:grid; grid-template-columns:var(--diff-grid); align-items:center; min-width:900px; border-top:1px solid rgba(79,214,255,.28); border-bottom:1px solid rgba(79,214,255,.18); background:linear-gradient(90deg,rgba(79,214,255,.12),rgba(181,140,255,.09)); color:var(--bright-fg); font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
    .diff-hunk strong { color:var(--bright-fg); }
    .hunk-title { grid-column:3; min-width:0; display:flex; align-items:center; gap:8px; padding:7px 10px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .hunk-title small { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--muted); text-transform:none; letter-spacing:0; }
    .scope-trail { min-width:0; display:inline-flex; align-items:center; gap:4px; overflow:hidden; white-space:nowrap; }
    .scope-chip { max-width:150px; overflow:hidden; text-overflow:ellipsis; border:1px solid rgba(79,214,255,.28); border-radius:999px; background:rgba(79,214,255,.08); color:var(--bright-fg); font:inherit; font-size:10px; padding:1px 7px; cursor:pointer; }
    .scope-chip:hover { border-color:rgba(79,214,255,.55); background:rgba(79,214,255,.16); }
    .scope-separator { color:rgba(185,209,236,.45); font-size:10px; }
    .hunk-count { grid-column:5 / 7; justify-self:end; padding:7px 10px; color:var(--muted); text-transform:none; letter-spacing:0; }
    .hunk-glyph { grid-column:1 / 3; justify-self:center; border:1px solid rgba(79,214,255,.42); border-radius:999px; padding:1px 7px; color:var(--cyan); background:rgba(79,214,255,.1); }
    .hunk-connector { grid-column:4; justify-self:stretch; align-self:stretch; position:relative; border-inline:1px solid rgba(79,214,255,.16); background:rgba(79,214,255,.04); }
    .hunk-connector::before { content:""; position:absolute; left:50%; top:50%; width:22px; height:1px; transform:translate(-50%,-50%); background:rgba(79,214,255,.58); box-shadow:0 0 12px rgba(79,214,255,.32); }
    .hunk-actions { grid-column:1 / 7; display:flex; justify-content:flex-end; gap:5px; padding:0 8px 7px; }
    .hunk-actions .action { min-height:26px; padding:3px 7px; font-size:11px; border-radius:6px; }
    .hunk-inline-editor { grid-column:1 / 7; margin:0 8px 8px; border:1px solid var(--line); border-radius:6px; background:rgba(2,6,23,.22); text-transform:none; letter-spacing:0; }
    .hunk-inline-editor summary { cursor:pointer; padding:6px 8px; color:var(--muted); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
    .hunk-inline-editor label { display:grid; gap:5px; padding:0 8px 8px; color:var(--muted); font-size:11px; }
    .hunk-inline-editor textarea { min-height:72px; resize:vertical; border:1px solid var(--line); border-radius:5px; padding:7px; color:var(--text); background:rgba(2,6,23,.62); font:12px/1.45 var(--mono); tab-size:2; }
    .hunk-inline-editor .action { justify-self:end; margin:0 8px 8px; min-height:24px; padding:3px 8px; font-size:11px; }
    .diff-row { display:grid; grid-template-columns:var(--diff-grid); min-width:900px; border-bottom:1px solid var(--soft-line); }
    .diff-row code { white-space:pre; overflow:hidden; text-overflow:ellipsis; padding:3px 9px; min-height:22px; }
    /* highlight.js token colours (Dark+ approximation; VS Code exposes no per-scope vars). The .hljs class carries no background so the diff cell tint shows through. */
    .diff-table .hljs-comment,.diff-table .hljs-quote { color:var(--vscode-descriptionForeground); font-style:italic; }
    .diff-table .hljs-keyword,.diff-table .hljs-selector-tag,.diff-table .hljs-literal,.diff-table .hljs-name,.diff-table .hljs-meta .hljs-keyword { color:var(--vscode-charts-blue); }
    .diff-table .hljs-string,.diff-table .hljs-regexp,.diff-table .hljs-attribute { color:var(--vscode-charts-orange); }
    .diff-table .hljs-number,.diff-table .hljs-symbol,.diff-table .hljs-bullet { color:var(--vscode-charts-green); }
    .diff-table .hljs-title,.diff-table .hljs-title.function_,.diff-table .hljs-section { color:var(--vscode-charts-yellow); }
    .diff-table .hljs-type,.diff-table .hljs-title.class_,.diff-table .hljs-built_in { color:var(--mint); }
    .diff-table .hljs-attr,.diff-table .hljs-variable,.diff-table .hljs-template-variable,.diff-table .hljs-property { color:var(--cyan); }
    .diff-table .hljs-meta,.diff-table .hljs-doctag { color:var(--vscode-charts-blue); }
    .diff-table .hljs-emphasis { font-style:italic; }
    .diff-table .hljs-strong { font-weight:700; }
    .diff-table code.new-code[contenteditable="true"] { cursor:text; outline:none; }
    .diff-table code.new-code[contenteditable="true"]:hover { box-shadow:inset 3px 0 0 var(--diff-inserted-strip), inset 0 0 0 1px var(--soft-line); }
    .diff-table code.new-code[contenteditable="true"]:focus { outline:1px solid var(--vscode-focusBorder); outline-offset:-1px; white-space:pre; background:var(--vscode-editor-background,var(--diff-editor-bg)); }
    .hunk-apply-btn[disabled] { opacity:.45; cursor:default; }
    .hunk-apply-btn.is-dirty { border-color:var(--diff-inserted-strip); color:var(--diff-inserted-strip); }
    .unicode-marker { display:none; margin:0 2px; border:1px solid rgba(247,193,77,.42); border-radius:4px; background:rgba(247,193,77,.13); color:var(--amber); font-size:10px; line-height:1; padding:1px 3px; vertical-align:1px; }
    .diff-app[data-unicode-open="true"] .unicode-marker { display:inline-flex; }
    .diff-app[data-unicode-open="true"] [data-layout-toggle="unicode"] { border-color:rgba(247,193,77,.58); color:var(--amber); background:rgba(247,193,77,.14); }
    .diff-marker { display:flex; align-items:center; justify-content:center; color:var(--diff-linenumber-fg); background:var(--diff-gutter-bg); border-right:1px solid var(--soft-line); user-select:none; font-weight:700; }
    .line-no { color:var(--diff-linenumber-fg); text-align:right; padding:3px 7px; background:var(--diff-gutter-bg); user-select:none; border-right:1px solid var(--soft-line); }
    .old-code { border-right:0; }
    .diff-link-gutter { position:relative; display:flex; align-items:center; justify-content:center; background:var(--diff-gutter-bg); border-inline:1px solid rgba(81,103,134,.28); }
    .diff-link-gutter::before { content:""; position:absolute; top:0; bottom:0; left:50%; width:1px; transform:translateX(-50%); background:rgba(81,103,134,.28); }
    .diff-link-line { position:relative; width:22px; height:10px; border-top:1px solid rgba(147,164,186,.26); border-bottom:1px solid rgba(147,164,186,.16); border-radius:999px; opacity:.55; }
    .diff-insert .diff-link-line { border-color:rgba(126,231,135,.42); box-shadow:inset -10px 0 0 rgba(126,231,135,.16); }
    .diff-delete .diff-link-line { border-color:rgba(255,107,107,.42); box-shadow:inset 10px 0 0 rgba(255,107,107,.16); }
    .diff-change .diff-link-line { border-color:rgba(247,193,77,.5); box-shadow:0 0 10px rgba(247,193,77,.12); }
    .diff-row.semantic .diff-link-line { border-color:rgba(79,214,255,.72); background:rgba(79,214,255,.1); box-shadow:0 0 12px rgba(79,214,255,.22); opacity:1; }
    .diff-collapsed { border-block:1px solid rgba(79,214,255,.18); background:linear-gradient(90deg,rgba(79,214,255,.045),rgba(181,140,255,.035)); }
    .diff-collapsed .diff-marker { color:var(--cyan); background:rgba(79,214,255,.08); }
    .diff-collapsed .line-no { color:var(--muted); background:rgba(10,20,34,.86); }
    .collapsed-code { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; background:rgba(7,17,29,.62); }
    .collapsed-summary { color:var(--muted); text-transform:none; letter-spacing:0; }
    .collapse-gutter { background:linear-gradient(180deg,rgba(79,214,255,.1),rgba(7,17,29,.4)); }
    .collapse-gutter::before { background:rgba(79,214,255,.28); }
    .collapse-toggle { position:relative; z-index:1; min-width:28px; max-width:34px; height:16px; padding:0 5px; border:1px solid rgba(79,214,255,.52); border-radius:999px; color:var(--cyan-fg); background:var(--panel2); font-size:10px; line-height:1; cursor:pointer; box-shadow:0 0 10px rgba(79,214,255,.12); }
    .collapse-toggle:hover,.collapse-toggle:focus-visible { border-color:rgba(126,231,135,.78); color:var(--bright-fg-strong); background:var(--panel2); outline:none; }
    .collapsed-lines { display:contents; }
    .collapsed-lines[hidden] { display:none; }
    .empty-code { background:repeating-linear-gradient(135deg,rgba(147,164,186,.08),rgba(147,164,186,.08) 6px,rgba(147,164,186,.035) 6px,rgba(147,164,186,.035) 12px); border-right:1px solid var(--soft-line); }
    .empty-label { display:inline-block; color:var(--muted); font-size:10px; text-transform:uppercase; letter-spacing:.08em; }
    .semantic-token { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; border:1px solid rgba(79,214,255,.55); border-radius:50%; color:var(--cyan); background:rgba(79,214,255,.12); font-size:10px; font-family:var(--vscode-font-family, system-ui, sans-serif); }
    .diff-insert .diff-marker { color:var(--diff-inserted-strip); background:var(--diff-inserted-bg); }
    .diff-delete .diff-marker { color:var(--diff-removed-strip); background:var(--diff-removed-bg); }
    .diff-change .diff-marker { color:var(--diff-changed-strip); background:var(--diff-gutter-bg); }
    .diff-insert .new-code,.diff-change .new-code { background:var(--diff-inserted-bg); box-shadow:inset 3px 0 0 var(--diff-inserted-strip); }
    .diff-delete .old-code,.diff-change .old-code { background:var(--diff-removed-bg); box-shadow:inset 3px 0 0 var(--diff-removed-strip); }
    .diff-row.semantic { outline:1px solid var(--intent-accent); outline-offset:-1px; }
    .diff-row.semantic .diff-marker { color:var(--cyan); }
    .diff-row.intent-refactoring { outline-color:var(--intent-refactor-accent); }
    .diff-row.intent-refactoring .semantic-token { color:var(--purple); border-color:rgba(181,140,255,.72); background:rgba(181,140,255,.14); }
    .diff-row.intent-refactoring .diff-marker { color:var(--purple); background:rgba(181,140,255,.12); }
    .diff-row.intent-refactoring .diff-link-line { border-color:rgba(181,140,255,.78); background:rgba(181,140,255,.12); box-shadow:0 0 13px rgba(181,140,255,.3); opacity:1; }
    body:has(.diff-app) { padding:0; overflow:hidden; }
    .diff-app { height:100vh; display:grid; grid-template-rows:auto auto minmax(0,1fr); background:var(--bg); }
    .product-shell { display:grid; grid-template-columns:minmax(140px,1fr) minmax(0,auto); gap:12px; align-items:center; padding:8px 12px; border-bottom:1px solid var(--soft-line); background:var(--panel); }
    .product-context { min-width:0; display:grid; gap:1px; }
    .product-file-line { min-width:0; display:flex; align-items:center; gap:8px; }
    .product-context strong { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--bright-fg-strong); font-size:13px; line-height:1.25; }
    .product-context span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--muted); font-size:11px; line-height:1.25; }
    .file-mode-badge { flex:0 0 auto; display:inline-flex; align-items:center; min-height:18px; padding:2px 7px; border:1px solid rgba(79,214,255,.32); border-radius:999px; color:var(--bright-fg); background:rgba(79,214,255,.09); font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
    .product-tabs { min-width:0; display:inline-flex; justify-self:end; align-items:center; gap:2px; overflow-x:auto; overflow-y:hidden; padding:3px; border:1px solid rgba(81,103,134,.36); border-radius:999px; background:rgba(5,12,22,.44); scrollbar-width:thin; }
    .product-tab { cursor:pointer; flex:0 0 auto; display:inline-flex; align-items:center; gap:6px; min-height:28px; border:1px solid transparent; border-radius:999px; padding:4px 9px; color:var(--muted); background:transparent; }
    .product-tab .control-icon { width:14px; height:14px; }
    .product-tab:hover { color:var(--bright-fg-strong); border-color:rgba(79,214,255,.28); background:rgba(79,214,255,.07); }
    .product-tab.is-active { color:var(--bright-fg); border-color:rgba(79,214,255,.52); background:linear-gradient(180deg,rgba(79,214,255,.18),rgba(14,29,49,.76)); box-shadow:inset 0 0 0 1px rgba(255,255,255,.025),0 0 18px rgba(79,214,255,.12); }
    .diff-topbar { z-index:20; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; min-height:42px; padding:6px 12px; border-bottom:1px solid var(--line); background:var(--panel); box-shadow:0 8px 24px rgba(0,0,0,.14); }
    .diff-app:not([data-review-view="semantic"]) .diff-topbar { display:none; }
    .top-badges { min-width:0; display:flex; flex-wrap:nowrap; gap:6px; justify-content:flex-start; align-items:center; overflow-x:auto; overflow-y:hidden; padding-bottom:1px; scrollbar-width:thin; }
    .type-schema-badges { display:inline-flex; align-items:center; gap:4px; padding:2px; border:1px solid rgba(79,214,255,.28); border-radius:999px; background:linear-gradient(90deg,rgba(79,214,255,.11),rgba(126,231,135,.07)); box-shadow:inset 0 0 0 1px rgba(255,255,255,.02); }
    .type-schema-badges .pill { margin:0; }
    .type-pill { border-color:rgba(79,214,255,.48); color:var(--cyan-fg); background:rgba(79,214,255,.13); }
    .mode-pill { border-color:rgba(181,140,255,.42); color:var(--purple-fg); background:rgba(181,140,255,.11); }
    .schema-link { color:var(--green); font-size:12px; font-weight:800; line-height:1; }
    .schema-pill { border-color:rgba(126,231,135,.5); color:var(--green-fg); background:rgba(126,231,135,.11); }
    .schema-adjacent { box-shadow:0 0 0 1px rgba(126,231,135,.12); }
    .filter-pill,.stat,.intent-chip,.icon-action,.drawer-tab,.collapsed-rail button { cursor:pointer; }
    .filter-pill:hover,.stat:hover,.intent-chip:hover,.icon-action:hover,.drawer-tab:hover,.collapsed-rail button:hover { border-color:rgba(79,214,255,.72); color:var(--bright-fg-strong); }
    .diff-app[data-filter-active="schema"] [data-filter="schema"],
    .diff-app[data-filter-active="groups"] [data-filter="groups"],
    .diff-app[data-filter-active="raw"] [data-filter="raw"],
    .diff-app[data-filter-active="insert"] [data-filter="insert"],
    .diff-app[data-filter-active="delete"] [data-filter="delete"],
    .diff-app[data-filter-active="change"] [data-filter="change"],
    .diff-app[data-filter-active="semantic"] [data-filter="semantic"],
    .diff-app[data-filter-active="guardrails"] [data-filter="guardrails"] { outline:1px solid var(--cyan); box-shadow:0 0 0 3px rgba(79,214,255,.12); }
    .review-pages { min-height:0; display:grid; overflow:hidden; }
    .review-page { min-height:0; display:none !important; overflow:hidden; }
    .evidence-filters { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 8px; }
    .evidence-chip { cursor:pointer; border:1px solid var(--soft-line); border-radius:999px; padding:3px 10px; font-size:11px; color:var(--muted); background:transparent; }
    .evidence-chip:hover { color:var(--text); border-color:var(--vscode-focusBorder); }
    .evidence-list .entry[data-entry-kind="noise-suppressed"] { opacity:.6; }
    .diff-app[data-filter-active="moved-code"] .evidence-list .entry:not([data-entry-kind="moved-code"]),
    .diff-app[data-filter-active="refactoring"] .evidence-list .entry:not([data-entry-kind="refactoring"]),
    .diff-app[data-filter-active="meaningful"] .evidence-list .entry:not([data-entry-kind="meaningful"]),
    .diff-app[data-filter-active="cross-file"] .evidence-list .entry:not([data-entry-kind="cross-file"]),
    .diff-app[data-filter-active="ignored-style"] .evidence-list .entry:not([data-entry-kind="ignored-style"]),
    .diff-app[data-filter-active="noise-suppressed"] .evidence-list .entry:not([data-entry-kind="noise-suppressed"]),
    .diff-app[data-filter-active="raw-evidence"] .evidence-list .entry:not([data-entry-kind="raw-evidence"]) { opacity:.22; }
    .diff-app[data-filter-active="moved-code"] .evidence-chip[data-filter="moved-code"],
    .diff-app[data-filter-active="refactoring"] .evidence-chip[data-filter="refactoring"],
    .diff-app[data-filter-active="meaningful"] .evidence-chip[data-filter="meaningful"],
    .diff-app[data-filter-active="cross-file"] .evidence-chip[data-filter="cross-file"],
    .diff-app[data-filter-active="ignored-style"] .evidence-chip[data-filter="ignored-style"],
    .diff-app[data-filter-active="noise-suppressed"] .evidence-chip[data-filter="noise-suppressed"],
    .diff-app[data-filter-active="raw-evidence"] .evidence-chip[data-filter="raw-evidence"] { color:var(--text); border-color:var(--vscode-focusBorder); background:var(--vscode-list-activeSelectionBackground,rgba(79,214,255,.12)); }
    .diff-app[data-review-view="semantic"] [data-review-page="semantic"],
    .diff-app[data-review-view="intent"] [data-review-page="intent"],
    .diff-app[data-review-view="evidence"] [data-review-page="evidence"],
    .diff-app[data-review-view="diagnostics"] [data-review-page="diagnostics"],
    .diff-app[data-review-view="release-notes"] [data-review-page="release-notes"] { display:grid !important; }
    .semantic-page { grid-template-rows:minmax(0,1fr) auto; }
    .diff-cta { display:flex; align-items:center; justify-content:center; min-height:0; padding:32px 24px; }
    .diff-cta-card { max-width:520px; display:flex; flex-direction:column; align-items:flex-start; gap:10px; padding:28px 30px; border:1px solid var(--vscode-panel-border); border-radius:10px; background:var(--vscode-editorWidget-background); box-shadow:0 8px 24px rgba(0,0,0,.16); }
    .diff-cta-mark { width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; color:var(--vscode-textLink-foreground); }
    .diff-cta-mark .control-icon { width:26px; height:26px; }
    .diff-cta-card h2 { margin:0; font-size:1.15rem; color:var(--vscode-foreground); }
    .diff-cta-summary { margin:0; font-family:var(--vscode-editor-font-family); color:var(--vscode-descriptionForeground); }
    .diff-cta-detail { margin:0; color:var(--vscode-descriptionForeground); line-height:1.5; }
    .diff-cta-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:6px; }
    .diff-workbench { position:relative; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); gap:10px; padding:10px 12px 10px 50px; }
    .diff-app[data-rail="right"] .diff-workbench { padding-left:12px; padding-right:50px; }
    .diff-app[data-minimap-open="false"] .diff-minimap { display:none; }
    .diff-app[data-rail="right"] .diff-surface { grid-column:1; }
    .diff-app[data-drawer-open="true"] .diff-workbench { min-height:0; }
    .diff-app[data-drawer-open="true"] .evidence-drawer { max-height:180px; }
    .diff-app[data-drawer-open="true"] .drawer-body { display:grid; }
    .path-stack { min-width:0; }
    .path-stack h1,.path-stack p { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .hero-actions { display:inline-flex; justify-content:flex-end; align-items:center; gap:6px; min-width:0; }
    .diff-topbar .hero-actions { max-width:100%; overflow-x:auto; overflow-y:hidden; padding:0; scrollbar-width:thin; }
    .diff-topbar .action { min-height:30px; border-radius:999px; border-color:rgba(79,214,255,.36); background:rgba(16,36,58,.72); box-shadow:inset 0 0 0 1px rgba(255,255,255,.025); white-space:nowrap; }
    .diff-topbar .action.has-icon { padding-inline:10px; }
    .diff-topbar .toolbar-icon { width:30px; min-width:30px; padding:0; color:var(--bright-fg); }
    .diff-topbar .toolbar-icon:hover,.diff-topbar .action:hover { color:var(--bright-fg-strong); border-color:rgba(79,214,255,.75); background:rgba(23,68,90,.84); }
    .action.ghost,.icon-action { border:1px solid var(--line); background:var(--panel3); color:var(--muted); }
    .icon-action { border-radius:6px; min-width:28px; height:26px; }
    .dock-tab { position:absolute; z-index:15; display:inline-flex; align-items:center; justify-content:center; gap:7px; min-width:34px; min-height:34px; border:1px solid rgba(79,214,255,.34); border-radius:999px; color:var(--bright-fg); background:linear-gradient(180deg,var(--panel2),var(--panel3)); box-shadow:0 12px 26px rgba(0,0,0,.28); cursor:pointer; }
    .dock-tab .control-icon { width:16px; height:16px; }
    .dock-tab span { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
    .dock-tab:hover { border-color:rgba(79,214,255,.82); color:var(--bright-fg-strong); background:linear-gradient(180deg,var(--panel2),var(--chip-bg)); }
    .rail-dock-tab { left:12px; top:50%; transform:translateY(-50%); writing-mode:vertical-rl; padding:10px 6px; }
    .diff-app[data-rail="right"] .rail-dock-tab { left:auto; right:12px; }
    .diff-app[data-rail-open="true"] .rail-dock-tab { opacity:0; pointer-events:none; }
    .intent-rail { position:absolute; top:10px; bottom:10px; left:12px; z-index:16; width:min(304px, calc(100% - 92px)); min-height:0; display:grid; grid-template-rows:auto auto minmax(0,1fr); overflow:hidden; opacity:0; pointer-events:none; transform:translateX(-326px); transition:opacity .14s ease, transform .16s ease; }
    .diff-app[data-rail="right"] .intent-rail { left:auto; right:12px; transform:translateX(326px); }
    .diff-app[data-rail-open="true"] .intent-rail { opacity:1; pointer-events:auto; transform:translateX(0); }
    .intent-rail .rail-heading { margin:0; padding:10px 10px 8px; border-bottom:1px solid rgba(81,103,134,.28); background:linear-gradient(180deg,rgba(79,214,255,.08),rgba(8,18,31,.12)); }
    .intent-rail .rail-heading h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--bright-fg); }
    .rail-heading p { font-size:11px; color:var(--muted); }
    .rail-controls { display:flex; gap:5px; align-items:center; }
    .diff-app[data-rail-pinned="true"] .intent-rail .rail-heading { background:linear-gradient(180deg,rgba(79,214,255,.16),rgba(8,18,31,.18)); }
    .intent-rail .icon-action { width:26px; min-width:26px; height:24px; border-radius:999px; }
    .intent-rail .intent-summary { padding:8px 10px; border-bottom:1px solid rgba(81,103,134,.2); background:rgba(7,17,29,.55); }
    .intent-rail .intent-chip { min-height:22px; padding:2px 7px; background:transparent; color:var(--muted); }
    .intent-rail .intent-chip strong { color:var(--bright-fg-strong); }
    .intent-rail .entry-list { min-height:0; overflow:auto; padding:8px; gap:4px; }
    .intent-rail .entry { grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:7px 8px; border-color:transparent; border-radius:6px; background:transparent; box-shadow:none; }
    .intent-rail .entry:hover { transform:none; border-color:rgba(79,214,255,.34); background:linear-gradient(90deg,rgba(79,214,255,.08),rgba(14,29,49,.62)); }
    .intent-rail .entry-reveal { grid-template-columns:4px minmax(0,1fr); gap:8px; }
    .intent-rail .entry-dot { align-self:stretch; width:3px; height:auto; min-height:34px; border-radius:999px; box-shadow:0 0 14px currentColor; }
    .intent-rail .entry-main { gap:2px; }
    .intent-rail .entry-main strong { font-size:12px; line-height:1.25; }
    .intent-rail .entry-meta { gap:5px; min-width:0; }
    .intent-rail .entry-meta small { font-size:10px; }
    .intent-rail .entry-meta small:first-child { color:var(--bright-fg); letter-spacing:.04em; }
    .intent-rail .badge { border-radius:999px; padding:1px 6px; min-width:22px; text-align:center; color:var(--bright-fg); background:rgba(79,214,255,.11); }
    .primary-intent { padding-bottom:10px; }
    .diff-surface { min-height:0; display:grid; grid-template-rows:auto auto minmax(0,1fr); }
    .diff-toolbar { position:sticky; top:0; z-index:5; }
    .diff-nav { min-width:0; display:flex; justify-content:flex-end; gap:5px; overflow-x:auto; scrollbar-width:thin; }
    .diff-nav .action.toolbar-icon { width:28px; min-width:28px; min-height:26px; padding:0; border-radius:7px; }
    .diff-nav .action.toolbar-icon span { display:none; }
    .diff-stage { position:relative; display:flex; flex:1 1 auto; min-height:0; overflow:hidden; }
    .diff-table { max-height:none; height:100%; min-height:0; overflow:auto; background:linear-gradient(90deg,var(--bg),var(--bg)); }
    .asset-diff-workbench { padding:14px; overflow:auto; }
    .text-diff-workbench { padding:14px; overflow:auto; }
    .text-diff-surface { display:flex; flex-direction:column; min-height:0; overflow:hidden; }
    .text-diff-surface .diff-table { flex:1 1 auto; }
    .diff-empty { padding:28px 16px; text-align:center; color:var(--muted); font-size:12px; }
    .text-diff-toolbar { border-bottom:1px solid var(--line); }
    .diff-toolbar-tag { display:inline-flex; align-items:center; padding:2px 9px; border:1px solid rgba(79,214,255,.28); border-radius:999px; font-size:11px; color:var(--bright-fg); background:rgba(79,214,255,.08); }
    /* Override the text-diff's rigid 3-row grid (toolbar/heads/body): the asset
       workbench stacks summary + review-grid + histogram + artifacts, so it must
       flow as a scrollable block or those rows collapse and the image escapes. */
    .asset-diff-surface { display:block; min-height:0; overflow:auto; padding-bottom:14px; }
    .asset-diff-toolbar { border-bottom:1px solid var(--line); }
    .asset-diff-summary { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:14px; align-items:center; padding:16px; border-bottom:1px solid rgba(79,214,255,.16); background:radial-gradient(circle at 86% 12%,rgba(79,214,255,.11),transparent 30%),linear-gradient(180deg,rgba(14,29,49,.8),rgba(8,18,32,.42)); }
    .asset-diff-summary h2 { margin:2px 0 0; font-size:17px; line-height:1.35; color:var(--bright-fg-strong); }
    .asset-metric-strip { display:grid; grid-template-columns:repeat(4,minmax(84px,1fr)); gap:8px; min-width:min(520px,48vw); }
    .asset-review-grid { min-height:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(250px,28%); gap:12px; padding:14px; }
    .asset-primary-visual { min-width:0; border:1px solid rgba(79,214,255,.22); border-radius:10px; overflow:hidden; background:radial-gradient(circle at 50% 0%,rgba(79,214,255,.1),transparent 32%),var(--bg); }
    .asset-primary-visual .asset-artifact { border:0; border-radius:0; background:transparent; height:100%; }
    .asset-primary-visual .asset-artifact img { max-height:460px; border:0; border-radius:0; background:var(--bg); }
    .asset-review-panel { min-width:0; display:grid; align-content:start; gap:10px; padding:12px; border:1px solid rgba(79,214,255,.2); border-radius:10px; background:linear-gradient(180deg,rgba(16,29,48,.94),rgba(8,18,31,.92)); }
    .asset-review-panel h3 { color:var(--bright-fg); text-transform:uppercase; letter-spacing:.06em; font-size:11px; }
    .asset-hotspot-list { display:grid; gap:8px; list-style:none; margin:0; padding:0; max-height:360px; overflow:auto; scrollbar-width:thin; }
    .asset-comparison-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:14px; }
    .asset-artifact-strip { grid-template-columns:repeat(4,minmax(0,1fr)); padding-top:0; }
    /* Interactive three-mode image viewer (Phase 6). */
    /* Size to content — height:100% would resolve to 0 against the block-flow
       surface and collapse the viewer (letting the image overflow downward). */
    .asset-viewer { display:flex; flex-direction:column; min-height:0; }
    .asset-mode-switch { display:flex; align-items:center; gap:4px; padding:8px; border-bottom:1px solid var(--vscode-panel-border,rgba(255,255,255,.08)); }
    .asset-mode-btn { appearance:none; cursor:pointer; font:inherit; font-size:12px; padding:4px 10px; border-radius:6px; border:1px solid transparent; background:transparent; color:var(--vscode-foreground); }
    .asset-mode-btn:hover:not([disabled]) { background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.08)); }
    .asset-mode-btn.is-active { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:var(--vscode-button-background); }
    .asset-mode-btn[disabled] { opacity:.4; cursor:not-allowed; }
    .asset-mode-controls { display:flex; align-items:center; gap:10px; margin-left:auto; flex-wrap:wrap; }
    .asset-opacity { display:flex; align-items:center; gap:6px; font-size:11px; color:var(--vscode-descriptionForeground); }
    .asset-opacity input, .asset-blink-speed input { width:80px; }
    .asset-onion-ctl { display:none; align-items:center; gap:6px; }
    .asset-viewer[data-asset-mode="onion"] .asset-onion-ctl { display:flex; }
    .asset-blink { font-size:11px; color:var(--vscode-descriptionForeground); }
    .asset-blink-toggle { appearance:none; cursor:pointer; font:inherit; font-size:11px; padding:3px 8px; border-radius:6px; border:1px solid var(--vscode-panel-border,rgba(255,255,255,.14)); background:transparent; color:var(--vscode-foreground); }
    .asset-blink-toggle[aria-pressed="true"] { background:var(--intent,var(--purple-strong)); border-color:var(--intent,var(--purple-strong)); color:var(--bright-fg-strong); }
    .asset-blink-speed { display:flex; align-items:center; gap:5px; }
    .asset-outline-toggle { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--vscode-descriptionForeground); cursor:pointer; }
    .asset-stage { position:relative; flex:1; min-width:0; min-height:0; display:grid; grid-template-columns:minmax(0,1fr); }
    .asset-view { display:none; min-width:0; min-height:0; overflow:auto; padding:12px; place-items:center; }
    .asset-view.is-active { display:grid; grid-template-columns:minmax(0,1fr); justify-items:center; }
    .asset-sbs { min-width:0; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; width:100%; }
    .asset-sbs.single { grid-template-columns:minmax(0,1fr); }
    .asset-sbs figure { margin:0; display:grid; gap:6px; justify-items:center; min-width:0; }
    .asset-sbs figcaption { font-size:11px; color:var(--vscode-descriptionForeground); text-align:center; }
    .asset-sbs figure > img { width:100%; max-height:440px; object-fit:contain; background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border,rgba(255,255,255,.08)); border-radius:6px; }
    /* Inline-block box sized to its image so inset:0 overlays (lasso + markers) align 1:1. */
    .asset-stagebox { position:relative; min-width:0; display:inline-block; max-width:100%; line-height:0; }
    .asset-stagebox > img { display:block; max-width:100%; max-height:460px; height:auto; object-fit:contain; background:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border,rgba(255,255,255,.08)); border-radius:6px; }
    .asset-sbs .asset-stagebox { width:100%; }
    .asset-sbs .asset-stagebox > img { width:100%; max-height:440px; }
    /* Onion + swipe stack the after image over the before image at the same box. */
    .asset-onion .asset-onion-top, .asset-swipe .asset-swipe-top { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; border:0; border-radius:6px; }
    .asset-onion-top { pointer-events:none; }
    .asset-swipe { --swipe:50%; touch-action:none; cursor:ew-resize; }
    .asset-swipe-top { pointer-events:none; clip-path:inset(0 calc(100% - var(--swipe,50%)) 0 0); }
    .asset-swipe-divider { position:absolute; top:0; bottom:0; left:var(--swipe,50%); width:2px; transform:translateX(-1px); background:rgba(255,255,255,.92); box-shadow:0 0 0 1px rgba(0,0,0,.45); pointer-events:none; }
    .asset-swipe-grip { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:26px; height:26px; border-radius:999px; background:var(--intent,var(--purple-strong)); border:2px solid var(--bright-fg-strong); box-shadow:0 2px 6px rgba(0,0,0,.5); }
    .asset-swipe-grip::before { content:"\\2194"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--bright-fg-strong); font-size:13px; line-height:1; }
    /* Marching-ants lasso overlay (Photoshop-style), aligned over the image via the SVG viewBox. */
    .asset-overlay { position:absolute; inset:0; pointer-events:none; }
    .asset-viewer[data-asset-outline="off"] .asset-overlay { display:none; }
    .asset-lasso-svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; }
    .asset-lasso-hit { fill:transparent; stroke:transparent; stroke-width:12; pointer-events:stroke; cursor:pointer; }
    .asset-lasso-shadow { fill:none; stroke:rgba(0,0,0,.55); stroke-width:2.6; vector-effect:non-scaling-stroke; }
    .asset-lasso-ants { fill:none; stroke:var(--intent,var(--purple-strong)); stroke-width:1.6; stroke-dasharray:6 4; vector-effect:non-scaling-stroke; animation:asset-ants .6s linear infinite; }
    .asset-lasso.severity-high .asset-lasso-ants { stroke:var(--vscode-charts-red); }
    .asset-lasso.severity-medium .asset-lasso-ants { stroke:var(--vscode-charts-orange); }
    .asset-lasso.severity-low .asset-lasso-ants { stroke:var(--vscode-charts-yellow); }
    @keyframes asset-ants { to { stroke-dashoffset:-10; } }
    .asset-markers { position:absolute; inset:0; pointer-events:none; }
    .asset-marker { position:absolute; transform:translate(-50%,-50%); min-width:20px; height:20px; padding:0 4px; display:inline-flex; align-items:center; justify-content:center; border-radius:999px; font-size:11px; font-weight:600; color:var(--bright-fg-strong); background:var(--vscode-charts-red); border:2px solid rgba(255,255,255,.85); box-shadow:0 1px 4px rgba(0,0,0,.5); cursor:pointer; pointer-events:auto; appearance:none; }
    .asset-marker.severity-low { background:var(--vscode-charts-yellow); }
    /* Hotspot selection: pulse the chosen region, dim the others (spotlight). */
    .asset-viewer[data-asset-selected] .asset-lasso:not(.is-selected) { opacity:.28; }
    .asset-viewer[data-asset-selected] .asset-marker:not(.is-selected) { opacity:.35; }
    .asset-lasso.is-selected .asset-lasso-ants { stroke-width:2.6; animation-duration:.38s; }
    .asset-marker.is-selected { animation:asset-pulse 1s ease-in-out infinite; z-index:2; }
    @keyframes asset-pulse { 0%,100% { box-shadow:0 0 0 0 rgba(124,106,247,.7); } 50% { box-shadow:0 0 0 7px rgba(124,106,247,0); } }
    .asset-empty { padding:24px; color:var(--vscode-descriptionForeground); }
    .asset-artifact-details { padding:0 14px 14px; }
    .asset-artifact-details > summary { cursor:pointer; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); padding:6px 0; }
    .asset-histogram-card { padding:0 14px 14px; }
    .asset-histogram-card > summary { cursor:pointer; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--vscode-descriptionForeground); padding:6px 0; }
    .asset-detail-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr); gap:12px; padding:0 14px 14px; }
    .asset-unavailable-state { min-height:320px; display:grid; grid-template-columns:auto minmax(0,520px); justify-content:center; align-content:center; gap:16px; padding:32px; color:var(--muted); }
    .asset-unavailable-state h2 { margin:2px 0 8px; color:var(--bright-fg-strong); font-size:20px; }
    .collapsed-rail { display:none; position:fixed; left:12px; top:92px; z-index:12; gap:8px; padding:8px; border:1px solid var(--line); border-radius:999px; background:var(--panel3); box-shadow:0 12px 24px rgba(0,0,0,.28); }
    .diff-app[data-rail="right"] .collapsed-rail { left:auto; right:12px; }
    .collapsed-rail button { width:30px; height:30px; border:1px solid var(--line); border-radius:50%; color:var(--cyan); background:var(--chip-bg); font-weight:700; }
    .evidence-drawer { max-height:42px; overflow:hidden; border-top:1px solid var(--line); background:linear-gradient(180deg,var(--panel3),var(--panel3)); transition:max-height .16s ease; }
    .drawer-tab { width:100%; display:flex; justify-content:center; gap:8px; border:0; border-bottom:1px solid var(--line); padding:9px 12px; color:var(--bright-fg); background:var(--panel2); }
    .drawer-body { display:none; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:8px; padding:10px 12px; overflow:auto; max-height:136px; }
    .insight-page { padding:16px; overflow:auto; background:radial-gradient(circle at 88% 6%,rgba(79,214,255,.08),transparent 28%),linear-gradient(180deg,var(--bg),var(--bg)); }
    .insight-layout { min-height:0; display:grid; grid-template-columns:minmax(0,1fr) minmax(280px,34%); gap:12px; align-content:start; max-width:1480px; width:100%; margin:0 auto; }
    .insight-hero,.insight-card,.insight-list { border:1px solid var(--line); border-radius:9px; background:linear-gradient(180deg,rgba(16,29,48,.94),rgba(8,18,31,.94)); box-shadow:0 14px 34px rgba(0,0,0,.18); }
    .insight-hero { grid-column:1 / -1; display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:16px; align-items:center; padding:16px; }
    .insight-hero h2 { margin:0 0 6px; font-size:20px; line-height:1.18; color:var(--bright-fg-strong); }
    .insight-hero p:not(.eyebrow) { max-width:760px; }
    .insight-mark { display:grid; place-items:center; width:48px; height:48px; border:1px solid rgba(79,214,255,.38); border-radius:12px; color:var(--cyan); background:radial-gradient(circle at 30% 20%,rgba(79,214,255,.28),rgba(181,140,255,.08)); }
    .insight-mark .control-icon { width:26px; height:26px; }
    .insight-card,.insight-list { min-width:0; padding:14px; }
    .insight-card h3 { margin-bottom:8px; color:var(--bright-fg); text-transform:uppercase; letter-spacing:.06em; font-size:11px; }
    .insight-card ul { margin:0; padding-left:18px; color:var(--soft-fg); }
    .insight-card li + li { margin-top:6px; }
    .insight-list { display:grid; gap:8px; align-content:start; }
    .insight-list .entry { margin:0; }
    .product-hero { position:relative; overflow:hidden; }
    .product-hero::after { content:""; position:absolute; inset:0; pointer-events:none; background:radial-gradient(circle at top right,rgba(79,214,255,.13),transparent 34%); }
    .metric-strip { display:grid; grid-template-columns:repeat(auto-fit,minmax(112px,1fr)); gap:8px; padding:10px; }
    .metric-tile { min-height:70px; display:grid; align-content:center; gap:4px; padding:12px; border:1px solid rgba(79,214,255,.2); border-radius:8px; background:linear-gradient(180deg,rgba(79,214,255,.08),rgba(8,18,31,.54)); }
    .metric-tile strong { color:var(--bright-fg-strong); font-size:22px; line-height:1; }
    .metric-tile span { color:var(--muted); text-transform:uppercase; letter-spacing:.06em; font-size:10px; }
    .narrative-card ul,.traceability-card ul { padding:0; list-style:none; }
    .narrative-card li,.traceability-card li button { display:flex; align-items:center; gap:8px; min-width:0; }
    .narrative-card .control-icon,.traceability-card .control-icon { flex:0 0 auto; width:15px; height:15px; color:var(--cyan); }
    .tag-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
    .intent-tag,.severity-pill { display:inline-flex; align-items:center; border:1px solid rgba(79,214,255,.28); border-radius:999px; padding:3px 8px; font-size:11px; color:var(--bright-fg); background:rgba(79,214,255,.08); }
    .tag-refactoring,.tag-moved-code { border-color:rgba(181,140,255,.42); color:var(--purple-fg); background:rgba(181,140,255,.12); }
    .tag-guardrail,.severity-high { border-color:rgba(255,107,107,.46); color:var(--red-fg); background:rgba(255,107,107,.12); }
    .tag-meaningful,.tag-schema-status { border-color:rgba(126,231,135,.42); color:var(--green-fg); background:rgba(126,231,135,.1); }
    .severity-low { border-color:rgba(126,231,135,.42); color:var(--green-fg); background:rgba(126,231,135,.1); }
    .risk-fold .risk-fold-summary { display:flex; align-items:center; gap:8px; margin:0 0 10px; color:var(--muted); font-size:12px; }
    .risk-fold .risk-list { display:grid; gap:8px; margin:0 0 12px; }
    .risk-fold .remediation-card { border-top:1px solid rgba(81,103,134,.24); padding-top:10px; }
    .risk-fold .remediation-card h4 { margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--bright-fg); }
    .risk-fold .remediation-card ul { margin:0; padding-left:16px; display:grid; gap:4px; color:var(--muted); font-size:12px; }
    .quiet-state { min-height:140px; display:grid; place-items:center; gap:6px; padding:22px; color:var(--muted); text-align:center; border:1px dashed rgba(126,231,135,.32); border-radius:8px; background:rgba(126,231,135,.04); }
    .quiet-state .control-icon { width:24px; height:24px; color:var(--green); }
    .quiet-state strong { color:var(--green-fg); }
    .change-bars { display:grid; gap:9px; }
    .change-bar { position:relative; display:grid; grid-template-columns:1fr auto; gap:10px; align-items:center; padding-bottom:10px; color:var(--soft-fg); }
    .change-bar i { grid-column:1 / -1; display:block; width:var(--bar-width); height:6px; border-radius:999px; background:var(--cyan); box-shadow:0 0 16px rgba(79,214,255,.22); }
    .change-bar-insert i { background:var(--green); }
    .change-bar-delete i { background:var(--red); }
    .change-bar-change i { background:var(--amber); }
    .change-bar-semantic i { background:var(--cyan); }
    .diagnostics-product-page { grid-template-columns:minmax(0,1.4fr) minmax(300px,.8fr); }
    .fuel-timeline-card { grid-row:span 2; }
    .fuel-timeline { display:grid; gap:9px; }
    .fuel-row { display:grid; gap:7px; padding:10px; border:1px solid rgba(79,214,255,.18); border-radius:8px; background:rgba(16,36,58,.35); }
    .fuel-row.is-hot { border-color:rgba(255,107,107,.48); background:rgba(255,107,107,.08); }
    .fuel-row header,.fuel-row footer { min-width:0; display:flex; justify-content:space-between; gap:8px; align-items:center; color:var(--muted); font-size:11px; }
    .fuel-row strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--bright-fg-strong); }
    .fuel-row footer { justify-content:flex-start; flex-wrap:wrap; }
    .fuel-row footer span { display:inline-flex; align-items:center; border:1px solid rgba(79,214,255,.18); border-radius:999px; padding:2px 7px; background:rgba(5,12,22,.32); }
    .fuel-bar { width:100%; height:7px; border-radius:999px; background:rgba(81,103,134,.32); overflow:hidden; }
    .fuel-bar i { display:block; width:var(--bar-width); height:100%; border-radius:999px; background:linear-gradient(90deg,var(--green),var(--cyan),var(--purple)); box-shadow:0 0 16px rgba(79,214,255,.22); }
    .diagnostics-events { display:grid; gap:8px; margin:0; padding:0; list-style:none; }
    .diagnostics-event { display:grid; grid-template-columns:minmax(78px,auto) minmax(0,1fr); gap:8px; align-items:start; padding:9px; border:1px solid rgba(79,214,255,.18); border-radius:8px; background:rgba(16,36,58,.35); }
    .diagnostics-event strong { color:var(--bright-fg); text-transform:uppercase; letter-spacing:.05em; font-size:10px; }
    .diagnostics-event span { min-width:0; overflow-wrap:anywhere; color:var(--soft-fg); }
    .diagnostics-error { border-color:rgba(255,107,107,.44); background:rgba(255,107,107,.08); }
    .diagnostics-warning { border-color:rgba(247,193,77,.42); background:rgba(247,193,77,.08); }
    .diagnostics-list { display:grid; gap:8px; }
    .diagnostics-hotspot { display:grid; gap:5px; padding:10px; border:1px solid rgba(255,107,107,.42); border-radius:8px; background:rgba(255,107,107,.08); }
    .diagnostics-hotspot strong { color:var(--red-fg); }
    .diagnostics-hotspot span { color:var(--bright-fg-strong); }
    .diagnostics-hotspot small { color:var(--muted); }
    .traceability-card button { width:100%; border:1px solid rgba(79,214,255,.18); border-radius:7px; padding:8px; color:var(--bright-fg); background:rgba(16,36,58,.42); text-align:left; cursor:pointer; }
    .traceability-card button:hover { border-color:rgba(79,214,255,.54); background:rgba(79,214,255,.08); }
    .release-notes-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .release-note-preview ul { margin:0; padding:0 0 0 18px; display:grid; gap:4px; }
    .release-note-preview li { color:var(--bright-fg-strong); }
    .release-note-empty { list-style:none; margin-left:-18px; color:var(--muted); font-style:italic; }
    .boundary-note { color:var(--muted); font-size:12px; }
    .asset-metrics-card { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; }
    .asset-artifacts-card,.asset-hotspots-card,.asset-histogram-card { min-width:0; }
    .asset-artifact-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; }
    .asset-artifact { min-width:0; margin:0; padding:10px; border:1px solid rgba(79,214,255,.22); border-radius:8px; background:rgba(7,17,31,.56); }
    .asset-artifact img { width:100%; max-height:180px; object-fit:contain; border-radius:6px; background:var(--bg); border:1px solid rgba(255,255,255,.06); }
    .asset-artifact figcaption { display:grid; gap:3px; margin-top:8px; }
    .asset-artifact figcaption span,.asset-artifact.missing span { color:var(--muted); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .asset-artifact.missing { display:grid; align-content:center; min-height:96px; }
    .asset-hotspots-card ol { display:grid; gap:8px; list-style:none; margin:8px 0 0; padding:0; }
    .asset-hotspot-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .asset-hotspot-nav { display:flex; gap:4px; }
    .asset-hotspot-step { appearance:none; cursor:pointer; width:22px; height:22px; border-radius:6px; border:1px solid var(--vscode-panel-border,rgba(255,255,255,.14)); background:transparent; color:var(--vscode-foreground); font-size:14px; line-height:1; }
    .asset-hotspot-step:hover { background:var(--vscode-toolbar-hoverBackground,rgba(255,255,255,.08)); }
    .asset-hotspot { padding:10px; border-radius:8px; border:1px solid rgba(79,214,255,.18); background:rgba(8,20,36,.7); cursor:pointer; transition:border-color .12s ease, background .12s ease; }
    .asset-hotspot:hover { border-color:rgba(124,106,247,.5); }
    .asset-hotspot strong { display:flex; align-items:center; gap:7px; color:var(--bright-fg-strong); }
    .asset-hotspot-badge { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:999px; background:var(--intent,var(--purple-strong)); color:var(--bright-fg-strong); font-size:11px; font-weight:700; flex:none; }
    .asset-hotspot span { color:var(--muted); font-size:12px; }
    .asset-hotspot p { margin:6px 0 0; color:var(--muted); }
    .asset-hotspot.severity-high { border-color:rgba(255,83,104,.46); box-shadow:inset 3px 0 0 rgba(255,83,104,.8); }
    .asset-hotspot.severity-medium { border-color:rgba(255,190,68,.42); box-shadow:inset 3px 0 0 rgba(255,190,68,.75); }
    .asset-hotspot.severity-low { border-color:rgba(46,229,140,.32); box-shadow:inset 3px 0 0 rgba(46,229,140,.62); }
    .asset-hotspot.is-selected { border-color:var(--intent,var(--purple-strong)); background:rgba(124,106,247,.14); box-shadow:0 0 0 1px rgba(124,106,247,.45); }
    .asset-histogram-bars { display:grid; gap:8px; margin:10px 0 0; }
    .asset-histogram-row { display:grid; grid-template-columns:44px minmax(0,1fr) auto; align-items:center; gap:10px; }
    .asset-histogram-label { font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
    .asset-histogram-peak { font-size:10px; color:var(--muted); white-space:nowrap; }
    .asset-histogram-chart { width:100%; height:34px; display:block; }
    .asset-histogram-chart rect { fill:var(--muted); }
    .channel-red .asset-histogram-chart rect { fill:var(--vscode-charts-red); }
    .channel-green .asset-histogram-chart rect { fill:var(--vscode-charts-green); }
    .channel-blue .asset-histogram-chart rect { fill:var(--vscode-charts-blue,var(--cyan)); }
    .channel-brightness .asset-histogram-chart rect { fill:var(--vscode-charts-yellow); }
    .channel-alpha .asset-histogram-chart rect { fill:var(--muted); }
    .review-action-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:8px; }
    .review-action { cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:34px; border:1px solid rgba(79,214,255,.28); border-radius:7px; color:var(--bright-fg); background:rgba(16,36,58,.72); }
    .review-action.accept { border-color:rgba(126,231,135,.45); color:var(--green-fg); background:rgba(46,160,67,.16); }
    .review-action.risk { border-color:rgba(255,107,107,.42); color:var(--red-fg); background:rgba(255,107,107,.12); }
    .diff-row.is-selected { outline:2px solid var(--cyan); outline-offset:-2px; box-shadow:inset 0 0 0 999px rgba(79,214,255,.08); }
    .entry.is-selected { border-color:rgba(79,214,255,.9); background:linear-gradient(90deg,rgba(79,214,255,.13),rgba(14,29,49,.96)); }
    .diff-app[data-filter-active="insert"] .diff-row:not(.diff-insert),
    .diff-app[data-filter-active="delete"] .diff-row:not(.diff-delete),
    .diff-app[data-filter-active="change"] .diff-row:not(.diff-change),
    .diff-app[data-filter-active="semantic"] .diff-row:not(.semantic) { opacity:.28; }
    .diff-app[data-filter-active="raw"] .entry:not(.entry-raw-evidence):not(.entry-noise-suppressed),
    .diff-app[data-filter-active="groups"] .entry-raw-evidence,
    .diff-app[data-filter-active="groups"] .entry-noise-suppressed,
    .diff-app[data-filter-active="schema"] .entry:not(.entry-schema-status),
    .diff-app[data-filter-active="guardrails"] .entry:not(.entry-guardrail) { opacity:.35; }
    body.vscode-light { color-scheme:light; --bg:var(--vscode-editor-background); --panel:var(--vscode-editorWidget-background); --panel2:var(--vscode-editorHoverWidget-background); --panel3:var(--vscode-sideBar-background,var(--sheen)); --text:var(--vscode-foreground); --muted:var(--vscode-descriptionForeground); --cyan:var(--vscode-charts-blue); --mint:var(--vscode-charts-green); --green:var(--vscode-charts-green); --red:var(--vscode-charts-red); --amber:var(--vscode-charts-yellow); --purple:var(--vscode-charts-purple); --line:var(--vscode-panel-border); --soft-line:rgba(111,132,158,.34); background:linear-gradient(180deg,var(--sheen),var(--panel) 42%,var(--panel)); color:var(--text); }
    body.vscode-light h2,
    body.vscode-light .product-file-line strong,
    body.vscode-light .dashboard-title h1,
    body.vscode-light .dashboard-board-heading h2,
    body.vscode-light .dashboard-file-select strong,
    body.vscode-light .insight-hero h2,
    body.vscode-light .asset-diff-summary h2,
    body.vscode-light .entry-main strong,
    body.vscode-light .metric-tile strong { color:var(--vscode-foreground); }
    body.vscode-light p,
    body.vscode-light small,
    body.vscode-light .product-context,
    body.vscode-light .dashboard-file-select span,
    body.vscode-light .entry-meta small,
    body.vscode-light .rail-heading p { color:var(--muted); }
    body.vscode-light .hero,
    body.vscode-light .panel-hero,
    body.vscode-light .file-card,
    body.vscode-light .card,
    body.vscode-light .empty,
    body.vscode-light .dashboard-topbar,
    body.vscode-light .dashboard-board,
    body.vscode-light .dashboard-fuel-panel,
    body.vscode-light .dashboard-fuel-row,
    body.vscode-light .dashboard-timeline-panel,
    body.vscode-light .dashboard-timeline-row,
    body.vscode-light .dashboard-dock-panel,
    body.vscode-light .dashboard-file-row,
    body.vscode-light .dashboard-file-group,
    body.vscode-light .product-shell,
    body.vscode-light .diff-topbar,
    body.vscode-light .diff-surface,
    body.vscode-light .intent-rail,
    body.vscode-light .evidence-drawer,
    body.vscode-light .insight-hero,
    body.vscode-light .insight-card,
    body.vscode-light .insight-list,
    body.vscode-light .asset-review-panel,
    body.vscode-light .asset-primary-visual,
    body.vscode-light .asset-artifact { border-color:var(--line); background:var(--panel); box-shadow:0 10px 28px rgba(18,32,52,.08); }
    body.vscode-light .dashboard-dock-tab,
    body.vscode-light .dock-tab,
    body.vscode-light .drawer-tab,
    body.vscode-light .action,
    body.vscode-light .action.ghost,
    body.vscode-light .icon-action,
    body.vscode-light .review-action,
    body.vscode-light .product-tabs,
    body.vscode-light .product-tab,
    body.vscode-light .pill,
    body.vscode-light .badge,
    body.vscode-light .collapsed-rail button { border-color:var(--line); background:var(--sheen); color:var(--vscode-foreground); box-shadow:none; }
    body.vscode-light .product-tab:hover,
    body.vscode-light .product-tab.is-active,
    body.vscode-light .action:hover,
    body.vscode-light .icon-action:hover,
    body.vscode-light .review-action:hover,
    body.vscode-light .entry:hover,
    body.vscode-light .entry.is-selected { border-color:rgba(9,105,218,.48); background:var(--panel); color:var(--cyan); }
    body.vscode-light .diff-column-heads,
    body.vscode-light .diff-toolbar,
    body.vscode-light .diff-table { background:var(--sheen); }
    body.vscode-light .diff-app { background:var(--panel); }
    body.vscode-light .diff-toolbar strong,
    body.vscode-light .diff-hunk strong,
    body.vscode-light .hunk-glyph,
    body.vscode-light .scope-chip,
    body.vscode-light .file-mode-badge { color:var(--cyan); }
    body.vscode-light .diff-column-heads { color:var(--muted); }
    body.vscode-light .connector-head,
    body.vscode-light .diff-link-gutter,
    body.vscode-light .diff-marker,
    body.vscode-light .line-no { background:var(--panel); border-color:var(--line); }
    body.vscode-light .diff-link-gutter::before { background:var(--line); }
    body.vscode-light .diff-link-line { border-color:var(--line); background:var(--sheen); opacity:.82; }
    body.vscode-light .diff-insert .diff-link-line { border-color:rgba(26,127,55,.42); box-shadow:inset -10px 0 0 rgba(26,127,55,.12); }
    body.vscode-light .diff-delete .diff-link-line { border-color:rgba(207,34,46,.38); box-shadow:inset 10px 0 0 rgba(207,34,46,.1); }
    body.vscode-light .diff-change .diff-link-line { border-color:rgba(154,103,0,.46); box-shadow:0 0 8px rgba(154,103,0,.08); }
    body.vscode-light .diff-row.semantic .diff-link-line { border-color:rgba(9,105,218,.72); background:rgba(9,105,218,.09); box-shadow:0 0 10px rgba(9,105,218,.16); }
    body.vscode-light .diff-hunk { border-color:rgba(9,105,218,.22); background:linear-gradient(90deg,rgba(9,105,218,.08),rgba(103,65,217,.06)); color:var(--vscode-foreground); }
    body.vscode-light .hunk-connector { border-color:rgba(9,105,218,.18); background:rgba(9,105,218,.05); }
    body.vscode-light .hunk-connector::before { background:rgba(9,105,218,.52); box-shadow:none; }
    body.vscode-light .scope-chip { border-color:rgba(9,105,218,.28); background:rgba(9,105,218,.08); }
    body.vscode-light .scope-separator { color:var(--muted); }
    body.vscode-light .semantic-token { color:var(--cyan); border-color:rgba(9,105,218,.48); background:rgba(9,105,218,.1); }
    body.vscode-light .diff-row.intent-refactoring .semantic-token,
    body.vscode-light .diff-row.intent-refactoring .diff-marker { color:var(--purple); background:rgba(103,65,217,.1); }
    body.vscode-light .diff-row.intent-refactoring .diff-link-line { border-color:rgba(103,65,217,.62); background:rgba(103,65,217,.1); box-shadow:none; }
    body.vscode-light .empty-code { background:repeating-linear-gradient(135deg,rgba(111,132,158,.12),rgba(111,132,158,.12) 6px,rgba(111,132,158,.05) 6px,rgba(111,132,158,.05) 12px); }
    body.vscode-light .empty-label { color:var(--muted); }
    body.vscode-light .diff-row { background:var(--panel); }
    body.vscode-light .diff-row code,
    body.vscode-light .line-no,
    body.vscode-light .diff-marker { color:var(--vscode-foreground); }
    body.vscode-light .diff-delete code.old-code { background:rgba(248,81,73,.14); color:rgba(90,26,31,.92); }
    body.vscode-light .diff-insert code.new-code { background:rgba(46,160,67,.16); color:rgba(22,61,33,.92); }
    body.vscode-light .diff-change code.old-code,
    body.vscode-light .diff-change code.new-code { background:rgba(154,103,0,.15); color:rgba(77,54,0,.92); }
    body.vscode-light .diff-row.semantic { box-shadow:inset 3px 0 0 var(--cyan); }
    body.vscode-light .diff-table .hljs-comment,body.vscode-light .diff-table .hljs-quote { color:var(--green); }
    body.vscode-light .diff-table .hljs-keyword,body.vscode-light .diff-table .hljs-selector-tag,body.vscode-light .diff-table .hljs-literal,body.vscode-light .diff-table .hljs-name { color:var(--cyan); }
    body.vscode-light .diff-table .hljs-string,body.vscode-light .diff-table .hljs-attribute { color:var(--red); }
    body.vscode-light .diff-table .hljs-number,body.vscode-light .diff-table .hljs-symbol { color:var(--green); }
    body.vscode-light .diff-table .hljs-title,body.vscode-light .diff-table .hljs-title.function_,body.vscode-light .diff-table .hljs-section { color:var(--amber); }
    body.vscode-light .diff-table .hljs-type,body.vscode-light .diff-table .hljs-title.class_,body.vscode-light .diff-table .hljs-built_in { color:var(--cyan); }
    body.vscode-light .diff-table .hljs-attr,body.vscode-light .diff-table .hljs-variable,body.vscode-light .diff-table .hljs-property { color:var(--cyan); }
    body.vscode-light .diff-table .hljs-meta,body.vscode-light .diff-table .hljs-doctag { color:var(--cyan); }
    body.vscode-light .intent-rail .intent-summary,
    body.vscode-light .intent-rail .rail-heading,
    body.vscode-light .drawer-body,
    body.vscode-light .metric,
    body.vscode-light .metric-tile,
    body.vscode-light .asset-diff-summary,
    body.vscode-light .insight-page { background:var(--sheen); }
    body.vscode-light .intent-pill { border-color:rgba(103,65,217,.35); color:var(--purple); background:rgba(103,65,217,.09); }
    body.vscode-light .evidence-pill,
    body.vscode-light .type-pill { border-color:rgba(9,105,218,.35); color:var(--cyan); background:rgba(9,105,218,.09); }
    body.vscode-light .guardrail-pill { border-color:rgba(207,34,46,.35); color:var(--red); background:rgba(207,34,46,.08); }
    body.vscode-light .stat { background:var(--sheen); color:var(--vscode-foreground); }
    body.vscode-light .stat strong { color:var(--vscode-foreground); }
    body.vscode-light .stat-insert { border-color:rgba(26,127,55,.36); color:var(--green); background:rgba(26,127,55,.08); }
    body.vscode-light .stat-delete { border-color:rgba(207,34,46,.34); color:var(--red); background:rgba(207,34,46,.08); }
    body.vscode-light .stat-change { border-color:rgba(154,103,0,.38); color:var(--amber); background:rgba(154,103,0,.08); }
    body.vscode-light .stat-semantic { border-color:rgba(9,105,218,.36); color:var(--cyan); background:rgba(9,105,218,.09); }
    body.vscode-light .fuel-sparkline i { background:linear-gradient(180deg,var(--cyan),var(--green)); }
    @media (max-width: 920px) {
      .dashboard-topbar { grid-template-columns:minmax(0,1fr); grid-template-areas:"title" "pills" "actions"; align-items:start; }
      .dashboard-pills { flex-wrap:nowrap; overflow-x:auto; padding-bottom:2px; scrollbar-width:thin; }
      .dashboard-actions { justify-content:flex-start; width:100%; }
      .dashboard-board { padding:0 42px; }
      .dashboard-app[data-left-pinned="true"] .dashboard-board { padding-left:42px; }
      .dashboard-app[data-right-pinned="true"] .dashboard-board { padding-right:42px; }
      .dashboard-dock { width:min(288px, calc(100% - 74px)); }
      .dashboard-dock-right { width:min(306px, calc(100% - 74px)); }
      .product-shell { grid-template-columns:minmax(0,1fr); gap:8px; }
      .product-context { padding-left:0; border-left:0; }
      .product-tabs { justify-self:start; max-width:100%; }
      .diff-topbar { grid-template-columns:minmax(0,1fr); align-items:start; }
      .diff-topbar .hero-actions { justify-content:flex-start; flex-wrap:nowrap; width:100%; }
      .asset-diff-summary,.asset-detail-grid { grid-template-columns:minmax(0,1fr); }
      .asset-metric-strip { min-width:0; grid-template-columns:repeat(2,minmax(0,1fr)); }
      .asset-review-grid { grid-template-columns:minmax(0,1fr); }
      .asset-artifact-strip { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .asset-comparison-grid { grid-template-columns:minmax(0,1fr); }
      .asset-unavailable-state { grid-template-columns:minmax(0,1fr); justify-content:start; }
      .diff-workbench { padding:8px 8px 8px 42px; }
      .diff-app[data-rail="right"] .diff-workbench { padding-left:8px; padding-right:42px; }
      .rail-dock-tab { left:8px; }
      .diff-app[data-rail="right"] .rail-dock-tab { right:8px; }
      .intent-rail { left:8px; width:min(292px, calc(100% - 76px)); }
      .diff-app[data-rail="right"] .intent-rail { right:8px; }
      .insight-layout { grid-template-columns:1fr; }
    }
    @media (max-width: 700px) {
      .dashboard-title p { white-space:normal; }
      .dashboard-board-heading { align-items:flex-start; }
      .dashboard-file-row header { grid-template-columns:minmax(0,1fr); align-items:start; }
      .dashboard-file-actions { justify-content:flex-start; flex-wrap:nowrap; max-width:100%; overflow-x:auto; padding-bottom:2px; scrollbar-width:thin; }
      .dashboard-detail-actions { flex-wrap:nowrap; overflow-x:auto; padding-bottom:2px; scrollbar-width:thin; }
      .dashboard-actions .action span,
      .diff-topbar .action:not(.toolbar-icon) span { display:none; }
      .dashboard-actions .action.has-icon,
      .diff-topbar .action.has-icon { width:30px; min-width:30px; padding-inline:0; justify-content:center; }
      .product-tab span { display:none; }
      .product-tab { width:30px; padding-inline:0; justify-content:center; }
      .diff-surface { --diff-grid:22px 34px minmax(90px,1fr) 24px 34px minmax(90px,1fr); }
      .diff-column-heads,.diff-hunk,.diff-row { min-width:0; }
      .diff-column-heads span { padding-inline:7px; }
      .diff-row code { padding-inline:6px; }
      .diff-link-line { width:16px; }
      .hunk-title small { display:none; }
      .hunk-count { font-size:10px; }
    }
    @media (max-width: 760px) { body { padding:10px; } .metric-grid,.panel-grid { grid-template-columns:1fr; } .panel-hero,.file-card header { display:grid; } }
  `;
}
