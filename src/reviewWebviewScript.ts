// The review webview's client-side behavior script (runs inside the webview CSP).

export function script(): string {
  return `
    const vscode = acquireVsCodeApi();
    window.__intentdiffPostMessage = function (message) { vscode.postMessage(message); };
    const app = document.querySelector(".diff-app");
    const dashboard = document.querySelector(".dashboard-app");
    const persisted = vscode.getState() || {};
    const state = Object.assign({
      reviewView: "semantic",
      railOpen: false,
      railPinned: false,
      railSide: "left",
      minimapOpen: true,
      drawerOpen: false,
      unicodeOpen: false,
      filter: "",
      selectedTarget: "",
      expandedBlocks: [],
    }, persisted.diff || persisted);
    const dashboardState = Object.assign({
      leftPinned: false,
      rightPinned: false,
      leftOpen: false,
      rightOpen: false,
      filter: "",
      selectedFile: dashboard?.dataset.selectedFile || "",
      expandedFiles: [],
      collapsedGroups: [],
    }, persisted.dashboard || {});
    const reviewViews = new Set(["semantic", "intent", "evidence", "diagnostics", "release-notes"]);
    function normalizeReviewView(value, fallback = "semantic") {
      return typeof value === "string" && reviewViews.has(value) ? value : fallback;
    }
    function persist() {
      vscode.setState(Object.assign({}, vscode.getState() || {}, {
        diff: state,
        dashboard: dashboardState,
      }));
    }
    function applyState() {
      if (!app) return;
      state.reviewView = normalizeReviewView(state.reviewView);
      if (!state.selectedTarget) {
        state.selectedTarget = selectableTargets()[0] || "";
      }
      app.dataset.reviewView = state.reviewView;
      app.dataset.railOpen = String(state.railOpen);
      app.dataset.railPinned = String(state.railPinned);
      app.dataset.rail = state.railSide;
      app.dataset.minimapOpen = String(state.minimapOpen);
      app.dataset.drawerOpen = String(state.drawerOpen);
      app.dataset.unicodeOpen = String(state.unicodeOpen);
      if (state.filter) app.dataset.filterActive = state.filter;
      else delete app.dataset.filterActive;
      document.querySelectorAll(".diff-row.is-selected,.entry.is-selected").forEach((node) => node.classList.remove("is-selected"));
      if (state.selectedTarget) {
        document.getElementById(state.selectedTarget)?.classList.add("is-selected");
        document.querySelectorAll('[data-target="' + state.selectedTarget + '"]').forEach((node) => node.classList.add("is-selected"));
      }
      applyCollapsedBlocks();
      document.querySelectorAll(".product-tab[data-review-view]").forEach((button) => {
        button.classList.toggle("is-active", normalizeReviewView(button.getAttribute("data-review-view")) === state.reviewView);
      });
      syncOverviewViewport();
    }
    function isTextInputTarget(target) {
      if (!(target instanceof Element)) {
        return false;
      }
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return true;
      }
      return target.isContentEditable || target.closest("textarea, input, select, [contenteditable='true'], button, a") !== null;
    }
    function syncOverviewViewport() {
      const table = document.querySelector(".diff-table");
      const viewport = document.querySelector(".overview-viewport");
      const activeMarker = document.querySelector(".overview-active-marker");
      if (!table || !viewport) return;
      const scrollHeight = Math.max(table.scrollHeight, table.clientHeight, 1);
      const clientHeight = Math.max(table.clientHeight, 1);
      const maxScroll = Math.max(scrollHeight - clientHeight, 1);
      const height = Math.max(8, Math.min(100, (clientHeight / scrollHeight) * 100));
      const top = Math.max(0, Math.min(100 - height, (table.scrollTop / maxScroll) * (100 - height)));
      viewport.style.setProperty("--viewport-top", top.toFixed(3) + "%");
      viewport.style.setProperty("--viewport-height", height.toFixed(3) + "%");
      viewport.setAttribute("aria-label", "Visible diff window " + Math.round(top) + "%");
      if (activeMarker && state.selectedTarget) {
        const target = document.getElementById(state.selectedTarget);
        if (target) {
          const markerTop = Math.max(0, Math.min(100, ((target.offsetTop + target.offsetHeight / 2) / scrollHeight) * 100));
          activeMarker.style.setProperty("--active-overview-top", markerTop.toFixed(3) + "%");
          activeMarker.style.opacity = "1";
        } else {
          activeMarker.style.opacity = "0";
        }
      } else if (activeMarker) {
        activeMarker.style.opacity = "0";
      }
    }
    function scrollOverviewToPoint(event, ruler) {
      const table = document.querySelector(".diff-table");
      if (!table || !ruler) return false;
      const bounds = ruler.getBoundingClientRect();
      if (!bounds.height) return false;
      const ratio = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      const maxScroll = Math.max(table.scrollHeight - table.clientHeight, 0);
      table.scrollTop = ratio * maxScroll;
      syncOverviewViewport();
      return true;
    }
    function applyDashboardState() {
      if (!dashboard) return;
      dashboard.dataset.leftPinned = String(dashboardState.leftPinned);
      dashboard.dataset.rightPinned = String(dashboardState.rightPinned);
      dashboard.dataset.leftOpen = String(dashboardState.leftOpen);
      dashboard.dataset.rightOpen = String(dashboardState.rightOpen);
      if (dashboardState.filter) dashboard.dataset.filterActive = dashboardState.filter;
      else delete dashboard.dataset.filterActive;
      const selectedFile = dashboardState.selectedFile || dashboard.querySelector("[data-dashboard-file]")?.getAttribute("data-dashboard-file") || "";
      dashboardState.selectedFile = selectedFile;
      dashboard.querySelectorAll("[data-dashboard-file]").forEach((row) => {
        const id = row.getAttribute("data-dashboard-file") || "";
        const tokens = (row.getAttribute("data-filter-tokens") || "").split(" ");
        const matchesFilter = !dashboardState.filter || tokens.includes(dashboardState.filter);
        row.hidden = !matchesFilter;
        row.classList.toggle("is-selected", id === selectedFile);
        row.dataset.expanded = dashboardState.expandedFiles.includes(id) ? "true" : "false";
      });
      dashboard.querySelectorAll("[data-dashboard-detail]").forEach((detail) => {
        detail.classList.toggle("is-selected", detail.getAttribute("data-dashboard-detail") === selectedFile);
      });
      dashboard.querySelectorAll("[data-dashboard-filter]").forEach((button) => {
        button.classList.toggle("is-active", (button.getAttribute("data-dashboard-filter") || "") === dashboardState.filter);
      });
      dashboard.querySelectorAll("[data-dashboard-group]").forEach((group) => {
        const key = group.getAttribute("data-dashboard-group") || "";
        const tokens = (group.getAttribute("data-filter-tokens") || "").split(" ");
        const collapsed = dashboardState.collapsedGroups.includes(key);
        const matchesFilter = !dashboardState.filter || tokens.includes(dashboardState.filter);
        group.dataset.collapsed = String(collapsed);
        group.hidden = !matchesFilter;
      });
    }
    function toggleDashboardDock(side) {
      if (side === "left") {
        dashboardState.leftPinned = !dashboardState.leftPinned;
        dashboardState.leftOpen = dashboardState.leftPinned;
      }
      if (side === "right") {
        dashboardState.rightPinned = !dashboardState.rightPinned;
        dashboardState.rightOpen = dashboardState.rightPinned;
      }
      applyDashboardState();
      persist();
    }
    function selectDashboardFile(fileId) {
      if (!fileId) return;
      dashboardState.selectedFile = fileId;
      dashboardState.rightOpen = true;
      applyDashboardState();
      persist();
    }
    function toggleDashboardFile(fileId) {
      const index = dashboardState.expandedFiles.indexOf(fileId);
      if (index >= 0) dashboardState.expandedFiles.splice(index, 1);
      else dashboardState.expandedFiles.push(fileId);
      applyDashboardState();
      persist();
    }
    function toggleDashboardGroup(groupKey) {
      const index = dashboardState.collapsedGroups.indexOf(groupKey);
      if (index >= 0) dashboardState.collapsedGroups.splice(index, 1);
      else dashboardState.collapsedGroups.push(groupKey);
      applyDashboardState();
      persist();
    }
    applyDashboardState();
    function revealTarget(targetId) {
      const target = document.getElementById(targetId);
      if (!target) return false;
      const collapsedContent = target.closest("[data-collapse-content]");
      const blockId = collapsedContent?.getAttribute("data-collapse-content");
      if (blockId && !state.expandedBlocks.includes(blockId)) {
        state.expandedBlocks.push(blockId);
      }
      state.selectedTarget = targetId;
      applyState();
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      persist();
      return true;
    }
    function applyCollapsedBlocks() {
      document.querySelectorAll("[data-collapse-block]").forEach((block) => {
        const id = block.getAttribute("data-collapse-block") || "";
        const open = state.expandedBlocks.includes(id);
        block.dataset.collapseOpen = String(open);
        const button = block.querySelector("[data-collapse-toggle]");
        const count = button?.getAttribute("data-count") || "";
        if (button) {
          button.setAttribute("aria-expanded", String(open));
          button.textContent = (open ? "− " : "+ ") + count;
          button.title = (open ? "Collapse " : "Expand ") + count + " hidden lines";
        }
        const content = document.querySelector('[data-collapse-content="' + id + '"]');
        if (content) {
          content.hidden = !open;
        }
      });
    }
    function toggleCollapsedBlock(blockId) {
      if (!blockId) return;
      const index = state.expandedBlocks.indexOf(blockId);
      if (index >= 0) {
        state.expandedBlocks.splice(index, 1);
      } else {
        state.expandedBlocks.push(blockId);
      }
      applyState();
      persist();
    }
    function allCollapseBlockIds() {
      return Array.prototype.map.call(document.querySelectorAll("[data-collapse-block]"), (block) =>
        block.getAttribute("data-collapse-block") || "").filter(Boolean);
    }
    function expandAllBlocks() {
      state.expandedBlocks = allCollapseBlockIds();
      applyState();
      persist();
    }
    function collapseAllBlocks() {
      state.expandedBlocks = [];
      applyState();
      persist();
    }
    function highlightCell(cell) {
      if (typeof hljs === "undefined") return;
      const text = cell.textContent || "";
      if (!text.trim()) { cell.dataset.hlDone = "1"; return; }
      const lang = (app && app.dataset.language) || "";
      const known = lang && hljs.getLanguage && hljs.getLanguage(lang);
      try {
        const result = known ? hljs.highlight(text, { language: lang }) : hljs.highlightAuto(text);
        cell.innerHTML = result.value;
        cell.classList.add("hljs");
        cell.dataset.hlDone = "1";
      } catch (err) { /* leave the cell as plain text */ }
    }
    function highlightDiff() {
      if (typeof hljs === "undefined") return;
      document.querySelectorAll(".diff-table code.old-code, .diff-table code.new-code").forEach((cell) => {
        if (cell.dataset.hlDone === "1" || cell.dataset.editing === "1") return;
        highlightCell(cell);
      });
    }
    function markHunkDirty(hunkId) {
      if (!hunkId) return;
      const btn = document.querySelector('.hunk-apply-btn[data-hunk-id="' + hunkId + '"]');
      if (btn) { btn.disabled = false; btn.classList.add("is-dirty"); }
    }
    function selectableTargets() {
      return Array.from(document.querySelectorAll(".entry[data-target]"))
        .map((node) => node.getAttribute("data-target"))
        .filter((value, index, values) => value && values.indexOf(value) === index);
    }
    function moveSelection(delta) {
      const targets = selectableTargets();
      if (!targets.length) return;
      const current = Math.max(0, targets.indexOf(state.selectedTarget));
      const next = targets[(current + delta + targets.length) % targets.length];
      revealTarget(next);
    }
    function moveSelectionToEdge(end) {
      const targets = selectableTargets();
      if (!targets.length) return;
      const target = end === "start" ? targets[0] : targets[targets.length - 1];
      revealTarget(target);
    }
    function toggleLayout(kind) {
      if (kind === "rail") {
        state.railOpen = !state.railOpen;
        state.railPinned = state.railOpen;
      }
      if (kind === "rail-pin") {
        state.railPinned = !state.railPinned;
        state.railOpen = state.railPinned || state.railOpen;
      }
      if (kind === "rail-close") {
        state.railPinned = false;
        state.railOpen = false;
      }
      if (kind === "rail-side") state.railSide = state.railSide === "left" ? "right" : "left";
      if (kind === "minimap") {
        state.minimapOpen = !state.minimapOpen;
      }
      if (kind === "drawer") state.drawerOpen = !state.drawerOpen;
      if (kind === "unicode") state.unicodeOpen = !state.unicodeOpen;
      applyState();
      persist();
    }
    function setReviewView(view) {
      state.reviewView = normalizeReviewView(view, normalizeReviewView(state.reviewView));
      if (state.reviewView !== "semantic") {
        state.railOpen = false;
        state.drawerOpen = false;
      }
      applyState();
      persist();
    }
    function hoverLayout(kind, open) {
      if (kind === "rail" && !state.railPinned) {
        state.railOpen = open;
      }
      applyState();
    }
    applyState();
    syncOverviewViewport();
    highlightDiff();
    const diffTable = document.querySelector(".diff-table");
    if (diffTable) {
      diffTable.addEventListener("scroll", syncOverviewViewport, { passive: true });
      window.addEventListener("resize", syncOverviewViewport);
    }
    window.addEventListener("keydown", (event) => {
      if (event.defaultPrevented || isTextInputTarget(event.target)) {
        return;
      }
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (event.key === "Home" || event.key === "g") {
        event.preventDefault();
        moveSelectionToEdge("start");
        return;
      }
      if (event.key === "End" || event.key === "G") {
        event.preventDefault();
        moveSelectionToEdge("end");
        return;
      }
      if (event.key === "Enter" && state.selectedTarget) {
        event.preventDefault();
        revealTarget(state.selectedTarget);
      }
    });
    document.querySelectorAll("[data-layout-hover]").forEach((node) => {
      const kind = node.getAttribute("data-layout-hover");
      node.addEventListener("mouseenter", () => hoverLayout(kind, true));
      node.addEventListener("mouseleave", () => hoverLayout(kind, false));
    });
    document.querySelectorAll("[data-layout-region]").forEach((node) => {
      const kind = node.getAttribute("data-layout-region");
      node.addEventListener("mouseenter", () => hoverLayout(kind, true));
      node.addEventListener("mouseleave", () => hoverLayout(kind, false));
    });
    // Perceptual image viewer: mode switching (side-by-side / onion / swipe /
    // difference), onion blend, blink comparator, swipe curtain, hotspot selection
    // and change-outline toggle. Pure client-side DOM — no round-trip, no image work.
    var assetBlinkTimer = null;
    var assetBlinkOn = false;
    var assetSelectedId = null;
    function assetStopBlink() {
      if (assetBlinkTimer) { clearInterval(assetBlinkTimer); assetBlinkTimer = null; }
      assetBlinkOn = false;
      document.querySelectorAll("[data-asset-blink]").forEach((btn) => {
        btn.setAttribute("aria-pressed", "false");
        btn.textContent = "▶ Blink";
      });
    }
    function setAssetMode(mode) {
      if (mode !== "onion") assetStopBlink();
      document.querySelectorAll("[data-asset-viewer]").forEach((viewer) => {
        viewer.setAttribute("data-asset-mode", mode);
        viewer.querySelectorAll("[data-asset-mode]").forEach((btn) => {
          const active = btn.getAttribute("data-asset-mode") === mode;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        viewer.querySelectorAll("[data-asset-view]").forEach((view) => {
          view.classList.toggle("is-active", view.getAttribute("data-asset-view") === mode);
        });
      });
    }
    function setAssetOpacity(value) {
      assetStopBlink();
      const opacity = Math.min(100, Math.max(0, Number(value) || 0)) / 100;
      document.querySelectorAll("[data-asset-onion-top]").forEach((img) => {
        img.style.opacity = String(opacity);
      });
    }
    function assetBlinkInterval() {
      const el = document.querySelector("[data-asset-blink-speed]");
      const speed = Number((el && el.value) || 4);
      return Math.max(80, Math.round(1100 - speed * 100));
    }
    function assetBlinkTick(tops) {
      assetBlinkOn = !assetBlinkOn;
      tops.forEach((img) => { img.style.opacity = assetBlinkOn ? "1" : "0"; });
    }
    function toggleAssetBlink() {
      if (assetBlinkTimer) { assetStopBlink(); return; }
      const tops = document.querySelectorAll("[data-asset-onion-top]");
      if (!tops.length) return;
      document.querySelectorAll("[data-asset-blink]").forEach((btn) => {
        btn.setAttribute("aria-pressed", "true");
        btn.textContent = "⏸ Blink";
      });
      assetBlinkTick(tops);
      assetBlinkTimer = setInterval(() => assetBlinkTick(tops), assetBlinkInterval());
    }
    function restartAssetBlinkIfRunning() {
      if (!assetBlinkTimer) return;
      clearInterval(assetBlinkTimer);
      const tops = document.querySelectorAll("[data-asset-onion-top]");
      assetBlinkTimer = setInterval(() => assetBlinkTick(tops), assetBlinkInterval());
    }
    function setAssetSwipe(stage, clientX) {
      const rect = stage.getBoundingClientRect();
      if (!rect.width) return;
      const pct = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      stage.style.setProperty("--swipe", pct.toFixed(2) + "%");
      const handle = stage.querySelector("[data-asset-swipe-handle]");
      if (handle) handle.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
    document.querySelectorAll(".asset-swipe").forEach((stage) => {
      let dragging = false;
      stage.addEventListener("pointerdown", (e) => { dragging = true; setAssetSwipe(stage, e.clientX); e.preventDefault(); });
      window.addEventListener("pointermove", (e) => { if (dragging) setAssetSwipe(stage, e.clientX); });
      window.addEventListener("pointerup", () => { dragging = false; });
    });
    function setAssetOutline(on) {
      document.querySelectorAll("[data-asset-viewer]").forEach((viewer) => {
        viewer.setAttribute("data-asset-outline", on ? "on" : "off");
      });
    }
    function selectAssetHotspot(id) {
      const scope = document.querySelector(".asset-review-grid");
      if (!scope) return;
      scope.querySelectorAll("[data-asset-hotspot]").forEach((el) => {
        const on = el.getAttribute("data-asset-hotspot") === id;
        el.classList.toggle("is-selected", on);
        if (el.classList.contains("asset-hotspot")) el.setAttribute("aria-pressed", on ? "true" : "false");
      });
      scope.querySelectorAll("[data-asset-viewer]").forEach((viewer) => {
        if (id) viewer.setAttribute("data-asset-selected", id); else viewer.removeAttribute("data-asset-selected");
      });
      assetSelectedId = id || null;
    }
    function cycleAssetHotspot(dir) {
      const panel = document.querySelector(".asset-review-grid");
      if (!panel) return;
      const ids = [];
      panel.querySelectorAll(".asset-hotspot[data-asset-hotspot]").forEach((el) => {
        const id = el.getAttribute("data-asset-hotspot");
        if (id && ids.indexOf(id) === -1) ids.push(id);
      });
      if (!ids.length) return;
      let idx = assetSelectedId ? ids.indexOf(assetSelectedId) : -1;
      idx = (idx + (dir === "prev" ? -1 : 1) + ids.length) % ids.length;
      selectAssetHotspot(ids[idx]);
      const item = panel.querySelector('.asset-hotspot[data-asset-hotspot="' + ids[idx] + '"]');
      if (item && item.scrollIntoView) item.scrollIntoView({ block: "nearest" });
    }
    // Inline editing of working-tree cells: strip highlight to plain text on
    // focus, mark the hunk dirty on input, re-highlight on blur, Esc cancels.
    document.addEventListener("focusin", (event) => {
      const cell = event.target.closest && event.target.closest("[data-hunk-edit-cell]");
      if (!cell || cell.dataset.editing === "1") return;
      cell.dataset.original = cell.textContent || "";
      cell.textContent = cell.dataset.original;
      cell.classList.remove("hljs");
      cell.dataset.editing = "1";
    });
    document.addEventListener("input", (event) => {
      const opacitySlider = event.target.closest && event.target.closest("[data-asset-opacity]");
      if (opacitySlider) {
        setAssetOpacity(opacitySlider.value);
        return;
      }
      const blinkSpeed = event.target.closest && event.target.closest("[data-asset-blink-speed]");
      if (blinkSpeed) {
        restartAssetBlinkIfRunning();
        return;
      }
      const outlineToggle = event.target.closest && event.target.closest("[data-asset-outline-toggle]");
      if (outlineToggle) {
        setAssetOutline(!!outlineToggle.checked);
        return;
      }
      const cell = event.target.closest && event.target.closest("[data-hunk-edit-cell]");
      if (!cell) return;
      markHunkDirty(cell.getAttribute("data-hunk-id"));
    });
    document.addEventListener("focusout", (event) => {
      const cell = event.target.closest && event.target.closest("[data-hunk-edit-cell]");
      if (!cell) return;
      cell.dataset.editing = "";
      cell.dataset.hlDone = "";
      highlightCell(cell);
    });
    document.addEventListener("keydown", (event) => {
      const cell = event.target.closest && event.target.closest("[data-hunk-edit-cell]");
      if (!cell || event.key !== "Escape") return;
      event.preventDefault();
      cell.textContent = cell.dataset.original || "";
      cell.dataset.editing = "";
      cell.blur();
      cell.dataset.hlDone = "";
      highlightCell(cell);
    }, true);
    // Keyboard hotspot navigation (only while focus is inside the hotspot panel,
    // so the blend / speed range sliders keep their native arrow behaviour).
    document.addEventListener("keydown", (event) => {
      const hotspotItem = event.target.closest && event.target.closest(".asset-hotspot[data-asset-hotspot]");
      if (hotspotItem && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        selectAssetHotspot(hotspotItem.getAttribute("data-asset-hotspot"));
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const handle = event.target.closest && event.target.closest("[data-asset-swipe-handle]");
        if (handle) {
          const stage = handle.closest(".asset-swipe");
          if (stage) {
            event.preventDefault();
            const current = parseFloat(stage.style.getPropertyValue("--swipe")) || 50;
            const next = Math.min(100, Math.max(0, current + (event.key === "ArrowLeft" ? -5 : 5)));
            stage.style.setProperty("--swipe", next + "%");
            handle.setAttribute("aria-valuenow", String(Math.round(next)));
          }
          return;
        }
        const inPanel = event.target.closest && event.target.closest(".asset-review-panel");
        if (inPanel) {
          event.preventDefault();
          cycleAssetHotspot(event.key === "ArrowLeft" ? "prev" : "next");
        }
      }
    });
    document.addEventListener("click", (event) => {
      const dashboardDockButton = event.target.closest("[data-dashboard-dock]");
      if (dashboardDockButton) {
        toggleDashboardDock(dashboardDockButton.getAttribute("data-dashboard-dock"));
        return;
      }
      const dashboardFilter = event.target.closest("[data-dashboard-filter]");
      if (dashboardFilter) {
        const filter = dashboardFilter.getAttribute("data-dashboard-filter") || "";
        dashboardState.filter = dashboardState.filter === filter ? "" : filter;
        applyDashboardState();
        persist();
        return;
      }
      const dashboardFile = event.target.closest("[data-dashboard-file-select]");
      if (dashboardFile) {
        selectDashboardFile(dashboardFile.getAttribute("data-dashboard-file-select"));
        return;
      }
      const dashboardToggle = event.target.closest("[data-dashboard-toggle-file]");
      if (dashboardToggle) {
        toggleDashboardFile(dashboardToggle.getAttribute("data-dashboard-toggle-file"));
        return;
      }
      const dashboardGroupToggle = event.target.closest("[data-dashboard-toggle-group]");
      if (dashboardGroupToggle) {
        toggleDashboardGroup(dashboardGroupToggle.getAttribute("data-dashboard-toggle-group"));
        return;
      }
      const layoutButton = event.target.closest("[data-layout-toggle]");
      if (layoutButton) {
        toggleLayout(layoutButton.getAttribute("data-layout-toggle"));
        return;
      }
      const assetModeButton = event.target.closest("button[data-asset-mode]");
      if (assetModeButton && !assetModeButton.disabled) {
        setAssetMode(assetModeButton.getAttribute("data-asset-mode"));
        return;
      }
      const assetBlinkButton = event.target.closest("[data-asset-blink]");
      if (assetBlinkButton) {
        toggleAssetBlink();
        return;
      }
      const assetHotspotStep = event.target.closest("[data-asset-hotspot-step]");
      if (assetHotspotStep) {
        cycleAssetHotspot(assetHotspotStep.getAttribute("data-asset-hotspot-step"));
        return;
      }
      const assetHotspotEl = event.target.closest("[data-asset-hotspot]");
      if (assetHotspotEl) {
        selectAssetHotspot(assetHotspotEl.getAttribute("data-asset-hotspot"));
        return;
      }
      const reviewViewButton = event.target.closest(".product-tab[data-review-view]");
      if (reviewViewButton) {
        setReviewView(reviewViewButton.getAttribute("data-review-view"));
        return;
      }
      const collapseButton = event.target.closest("[data-collapse-toggle]");
      if (collapseButton) {
        toggleCollapsedBlock(collapseButton.getAttribute("data-collapse-toggle"));
        return;
      }
      const filterButton = event.target.closest("[data-filter]");
      if (filterButton) {
        const filter = filterButton.getAttribute("data-filter") || "";
        state.filter = state.filter === filter ? "" : filter;
        if (filter === "raw" || filter === "noise-suppressed" || filter === "raw-evidence") state.drawerOpen = true;
        applyState();
        persist();
        return;
      }
      const panelAction = event.target.closest("[data-panel-action]");
      if (panelAction) {
        const action = panelAction.getAttribute("data-panel-action");
        if (action === "previousChange") moveSelection(-1);
        if (action === "nextChange") moveSelection(1);
        if (action === "expandAll") { expandAllBlocks(); return; }
        if (action === "collapseAll") { collapseAllBlocks(); return; }
        if (action === "applyEdits" && window.__intentdiffApplyEdits) {
          window.__intentdiffApplyEdits();
        }
        if (action === "discardEdits" && window.__intentdiffDiscardEdits) {
          window.__intentdiffDiscardEdits();
        }
        return;
      }
      const commandButton = event.target.closest("[data-command]");
      if (commandButton && commandButton.getAttribute("data-command") !== "reveal") {
        postCommandButton(commandButton);
        return;
      }
      const targetButton = event.target.closest("[data-target]");
      if (targetButton && revealTarget(targetButton.getAttribute("data-target"))) {
        return;
      }
      const overviewRuler = event.target.closest(".diff-minimap");
      if (overviewRuler && scrollOverviewToPoint(event, overviewRuler)) {
        return;
      }
      const button = event.target.closest("[data-command]");
      if (!button) return;
      postCommandButton(button);
    });
    function postCommandButton(button) {
      const command = button.getAttribute("data-command");
      let payload;
      const rawPayload = button.getAttribute("data-payload");
      if (rawPayload) {
        try { payload = JSON.parse(rawPayload); } catch { return; }
      }
      if (command === "editHunk") {
        const hunkId = button.getAttribute("data-hunk-id");
        const cells = document.querySelectorAll('[data-hunk-edit-cell][data-hunk-id="' + hunkId + '"]');
        if (!cells.length || !payload || !payload.hunk) return;
        const editedLines = Array.prototype.map.call(cells, (cell) => cell.textContent || "");
        payload.hunk.newLines = editedLines;
        if (payload.hunk.newStartLine !== undefined) {
          payload.hunk.newEndLine = payload.hunk.newStartLine + Math.max(editedLines.length - 1, 0);
        }
        payload.actionKind = "applyHunk";
      }
      vscode.postMessage({ command, payload });
    }
    window.addEventListener("message", (event) => {
      const command = event.data && event.data.command;
      if (command === "previousChange") moveSelection(-1);
      if (command === "nextChange") moveSelection(1);
      if (command === "toggleRail") toggleLayout("rail");
      if (command === "toggleEvidenceDrawer") toggleLayout("drawer");
      if (command === "setReviewView") setReviewView(event.data.reviewView);
    });
  `;
}
