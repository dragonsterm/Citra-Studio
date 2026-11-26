"use strict";

function createComparisonView({ inspect, onViewChange, detached = false }) {
  const panel = $("comparison");
  panel.classList.add("comparison-panel");
  panel.innerHTML = `
  <div id="compare-resize" class="comparison-resize" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize Compare methods"><span></span></div>
  <header class="comparison-header">
    <div class="comparison-ident">
      <span class="comparison-mark"><svg class="icon" aria-hidden="true"><use href="#i-chart"></use></svg></span>
      <div><h2 id="comparison-title">Compare methods</h2><p id="comparison-subtitle">Live histograms and processing metrics</p></div>
    </div>
    <div class="comparison-controls">
      <div class="channel-switch" role="group" aria-label="Histogram channels">
        <button id="compare-luma" type="button" aria-pressed="true" title="Luminance">Luma</button>
        <button id="compare-rgb" type="button" aria-pressed="false" title="Red, green and blue channels">RGB</button>
      </div>
      <button id="compare-pause" type="button" class="icon-button" aria-label="Pause live histograms" title="Pause live histograms" aria-pressed="false" disabled><svg class="icon" aria-hidden="true"><use href="#i-pause"></use></svg></button>
      <button id="compare-popout" type="button" class="icon-button" aria-label="Pop out comparison" title="Pop out comparison"><svg class="icon" aria-hidden="true"><use href="#i-popout"></use></svg></button>
      <button id="compare-expand" type="button" class="icon-button" aria-label="Expand comparison" title="Expand comparison" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-expand"></use></svg></button>
      <button id="compare-close" type="button" class="icon-button" aria-label="Close comparison" title="Close comparison"><svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg></button>
    </div>
  </header>
  <div class="comparison-strip">
    <span id="comparison-status" class="comparison-status"><span class="live-dot"></span><span>Awaiting source</span></span>
    <button id="comparison-scale" type="button" class="seg-toggle" aria-pressed="true" title="Switch between shared and per-card histogram scales">Shared scale · % of pixels</button>
    <button id="compare-cursor" class="text-button compact" type="button" hidden>Clear locked bin</button>
  </div>
  <div class="comparison-body">
    <div id="comparison-empty" class="comparison-empty"><svg class="icon" aria-hidden="true"><use href="#i-activity"></use></svg><strong>Waiting for a source</strong><p>Open a photo or start the webcam to compare pixel distributions.</p></div>
    <section id="pinned-comparison" class="pinned-shelf" aria-label="Pinned histograms" hidden>
      <div class="shelf-heading"><svg class="icon" aria-hidden="true"><use href="#i-pin"></use></svg> Pinned histograms</div>
      <div id="pinned-comparison-grid" class="card-grid comparison-grid"></div>
    </section>
    <div id="comparison-scroll" class="card-scroll">
      <div id="comparison-grid" class="card-grid comparison-grid"></div>
    </div>
  </div>
  `;
  const pause = $("compare-pause");
  const scale = $("comparison-scale");
  const cards = new Map();
  const colors = { Y: "#9aa2ff", R: "#ff7d84", G: "#6bdd9f", B: "#76aaff" };
  const board = createCardBoard({
    grid: $("comparison-grid"), scroll: $("comparison-scroll"),
    shelf: $("pinned-comparison"), pinnedGrid: $("pinned-comparison-grid"), swap: true,
    onChange: notifyViewChange,
  });
  let latest = { status: { kind: "idle" }, items: [] };
  let rgb = false;
  let shared = true;
  let held = null;
  let cursor = null;
  let locked = false;

  $("compare-resize").hidden = detached;
  $("compare-expand").hidden = detached;
  $("compare-close").hidden = detached;
  if (detached) replaceIcon($("compare-popout"), "dock", "Dock comparison in workspace");

  function channels(stats) {
    return rgb && stats?.bins.R ? ["R", "G", "B"] : ["Y"];
  }

  function snapshot(id) {
    return (held || latest).items.find((item) => item.id === id);
  }

  function cardFor({ id, title, icon: iconName }) {
    const node = element("article", "comparison-card");
    const head = element("header", "comparison-card-head");
    const label = element("button", "comparison-label");
    label.type = "button";
    label.dataset.dragHandle = "";
    label.title = "Inspect or drag to swap. Alt+arrow keys also move this card.";
    const mark = icon(iconName);
    const names = element("span");
    const subtitle = element("small");
    names.append(element("strong", "", title), subtitle);
    label.append(mark, names);
    label.addEventListener("click", () => inspect(id));
    const pin = button("pin", "Pin " + title.toLowerCase() + " histogram");
    pin.dataset.cardPin = title.toLowerCase() + " histogram";
    pin.setAttribute("aria-pressed", "false");
    pin.addEventListener("click", () => board.togglePin(id));
    head.append(label, pin);

    const chart = element("div", "comparison-plot");
    chart.dataset.noSort = "";
    chart.tabIndex = 0;
    chart.setAttribute("role", "group");
    chart.setAttribute("aria-label", title + " histogram. Use arrow keys to move the shared intensity cursor and Enter to lock it.");
    chart.title = "Hover to compare the same bin. Click to lock or unlock.";
    const graph = chartBase(96, ["0", "64", "128", "192", "255"], title + " intensity histogram");
    graph.svg.setAttribute("preserveAspectRatio", "none");
    const series = svgNode("g", { class: "comparison-series" });
    const guide = svgNode("path", { stroke: "#e3e5ff", "stroke-width": "1", opacity: ".85", visibility: "hidden" });
    const empty = svgNode("text", { x: 124, y: 46, "text-anchor": "middle", fill: "#b1b1c1",
      "font-size": 9, "font-family": "Consolas,monospace" });
    graph.svg.append(series, guide, empty);
    chart.append(graph.svg);

    const readout = element("div", "comparison-readout");
    const metrics = element("dl", "comparison-metrics");
    const values = new Map();
    for (const [key, name] of [["min", "Min"], ["max", "Max"], ["mean", "Mean"], ["stddev", "Std. dev."]]) {
      const row = element("div");
      const value = element("dd", "", "—");
      row.append(element("dt", "", name), value);
      metrics.append(row);
      values.set(key, value);
    }
    const footer = element("footer", "comparison-foot");
    const dimensions = element("span");
    const time = element("span");
    footer.append(dimensions, time);
    node.append(head, chart, readout, metrics, footer);

    function binAt(event) {
      const matrix = graph.svg.getScreenCTM();
      if (!matrix) return 0;
      const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      const fraction = (point.x - graph.left) / (graph.right - graph.left);
      return Math.max(0, Math.min(63, Math.round(fraction * 63)));
    }
    chart.addEventListener("pointermove", (event) => {
      if (locked || !snapshot(id)?.sample?.stats) return;
      const next = binAt(event);
      if (next !== cursor) setCursor(next);
    });
    chart.addEventListener("pointerleave", () => { if (!locked) setCursor(null); });
    chart.addEventListener("click", (event) => {
      if (!snapshot(id)?.sample?.stats) return;
      const next = binAt(event);
      locked = !(locked && cursor === next);
      setCursor(next);
      notifyViewChange();
    });
    chart.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && cursor !== null) {
        event.preventDefault();
        clearCursor();
        return;
      }
      if (!snapshot(id)?.sample?.stats || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      let next = cursor ?? 32;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = 63;
      if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
      if (event.key === "ArrowRight") next = Math.min(63, next + 1);
      if (event.key === "Enter" || event.key === " ") locked = !locked;
      setCursor(next);
      if (locked || event.key === "Enter" || event.key === " ") notifyViewChange();
    });

    return { node, mark, subtitle, chart, graph, series, guide, empty, readout, values, dimensions, time };
  }

  function setCursor(bin) {
    cursor = bin;
    $("compare-cursor").hidden = !locked;
    for (const [id, card] of cards) drawCursor(card, snapshot(id)?.sample);
  }

  function clearCursor() {
    const wasLocked = locked;
    locked = false;
    setCursor(null);
    if (wasLocked) notifyViewChange();
  }

  function drawCursor(card, entry) {
    const stats = entry?.stats;
    const showing = !!stats && cursor !== null;
    card.guide.setAttribute("visibility", showing ? "visible" : "hidden");
    card.chart.dataset.locked = String(showing && locked);
    if (!showing) {
      card.readout.textContent = stats ? "64 bins · 0–255" : (entry?.error || "Waiting for pixels…");
      return;
    }
    const { left, right, top, bottom } = card.graph;
    const x = left + (right - left) * cursor / 63;
    card.guide.setAttribute("d", "M" + x + " " + top + "V" + bottom);
    const start = cursor * 4;
    const fractions = channels(stats).map((key) => key + " " + (100 * stats.bins[key][cursor] / stats.pixels).toFixed(2) + "%");
    card.readout.textContent = start + "–" + (start + 3) + " · " + fractions.join("  ");
  }

  function refresh() {
    const current = (held || latest).status;
    const active = current.kind !== "idle";
    const live = current.kind === "live";
    const measurement = current.measurement;
    $("comparison-empty").hidden = active;
    $("comparison-scroll").hidden = !active;
    $("pinned-comparison").hidden = !active || !$("pinned-comparison-grid").childElementCount;
    const name = held ? "Paused" : live ? "Live · frame " + current.frame : active ? "Photo" : "Awaiting source";
    const indicator = $("comparison-status");
    indicator.lastElementChild.textContent = name;
    indicator.firstElementChild.className = "live-dot" + (held ? " paused" : live ? " live" : active ? " ready" : "");
    $("comparison-subtitle").textContent = !active ? "Live histograms and processing metrics" :
      (cards.size - 1) + (cards.size === 2 ? " method" : " methods") + " + source" +
      (measurement ? " · " + dimensionsText(measurement) + " · " + measurement.engine.toFixed(1) + " ms/frame" : "");
    pause.disabled = !live;
    $("compare-luma").setAttribute("aria-pressed", String(!rgb));
    $("compare-rgb").setAttribute("aria-pressed", String(rgb));
    scale.setAttribute("aria-pressed", String(shared));
    $("compare-cursor").hidden = !locked;
    pause.setAttribute("aria-pressed", String(!!held));
    replaceIcon(pause, held ? "play" : "pause", held ? "Resume live histograms" : "Pause live histograms");
    if (!active || panel.classList.contains("compact")) {
      scale.textContent = shared ? "Shared scale · % of pixels" : "Fit each · % of pixels";
      return;
    }

    const histograms = new Map();
    let peak = 1;
    for (const [id] of cards) {
      const item = snapshot(id);
      const entry = item?.sample;
      const stats = entry?.stats;
      const curves = stats ? channels(stats).map((key) => [key, stats.bins[key].map((count) => 100 * count / stats.pixels)]) : [];
      const localPeak = Math.ceil(Math.max(1, ...curves.flatMap(([, bins]) => bins)));
      peak = Math.max(peak, localPeak);
      histograms.set(id, { entry, description: item?.description, curves, localPeak });
    }
    scale.textContent = shared ? "Shared scale · 0–" + peak + "% of pixels" : "Fit each · % of pixels";
    for (const [id, card] of cards) {
      const { entry, description, curves, localPeak } = histograms.get(id);
      const stats = entry?.stats;
      card.series.replaceChildren();
      for (const [key, bins] of curves) {
        plotLine({ ...card.graph, svg: card.series }, bins, shared ? peak : localPeak, colors[key], curves.length === 1);
      }
      card.empty.textContent = stats ? "" : entry?.error ? "Needs input" : "Awaiting pixels";
      if (id === "source") replaceIcon(card.mark, live ? "video" : "image");
      card.subtitle.textContent = description || "";
      card.subtitle.title = description || "";
      for (const [key, value] of card.values) value.textContent = stats ? String(stats[key]) : "—";
      card.dimensions.textContent = stats ? dimensionsText(stats) + (stats.bins.R ? " · RGB" : " · Gray") : "—";
      card.time.textContent = id === "source" ? "Source" : Number.isFinite(entry?.ms) ? entry.ms.toFixed(2) + " ms" : "—";
      drawCursor(card, entry);
    }
  }

  function settings() {
    return { rgb, shared, bin: locked ? cursor : null, held, arrangement: board.arrangement() };
  }

  function notifyViewChange() {
    onViewChange?.(settings());
  }

  function update(data) {
    const generationChanged = latest.status.generation !== data.status.generation;
    latest = data;
    const wasPaused = !!held;
    if (generationChanged) {
      held = null;
      locked = false;
      cursor = null;
    }
    const ids = new Set(data.items.map((item) => item.id));
    for (const id of cards.keys()) {
      if (!ids.has(id)) {
        board.remove(id);
        cards.delete(id);
      }
    }
    for (const item of data.items) {
      if (cards.has(item.id)) continue;
      const card = cardFor(item);
      cards.set(item.id, card);
      board.add(item.id, card.node);
    }
    refresh();
    if (generationChanged && wasPaused) notifyViewChange();
  }

  function restore(view) {
    if (!view) return;
    rgb = !!view.rgb;
    shared = view.shared !== false;
    held = view.held && view.held.status.generation === latest.status.generation ? view.held : null;
    locked = Number.isInteger(view.bin) && view.bin >= 0 && view.bin <= 63;
    cursor = locked ? view.bin : null;
    board.restoreArrangement(view.arrangement);
    refresh();
  }

  $("compare-cursor").addEventListener("click", clearCursor);
  scale.addEventListener("click", () => {
    shared = !shared;
    refresh();
    notifyViewChange();
  });
  for (const [id, mode] of [["compare-luma", false], ["compare-rgb", true]]) {
    $(id).addEventListener("click", () => {
      rgb = mode;
      refresh();
      notifyViewChange();
    });
  }
  pause.addEventListener("click", () => {
    if (latest.status.kind !== "live") return;
    held = held ? null : latest;
    refresh();
    notifyViewChange();
  });

  return {
    get paused() { return !!held; },
    update,
    refresh,
    settings,
    restore,
    cancelDrag: board.cancelDrag,
    clearFrame() {
      held = null;
      locked = false;
      cursor = null;
    },
  };
}

function createWorkspaceComparison({ api, snapshot, inspect, onSampleNeeded, onError }) {
  const drawer = $("comparison");
  const dock = $("dock-compare");
  const view = createComparisonView({ inspect, onViewChange: () => { if (!view.paused) onSampleNeeded(); } });
  const grip = $("compare-resize");
  const header = drawer.querySelector(".comparison-header");
  const workspace = drawer.parentElement;
  const expand = $("compare-expand");
  const minHeight = 74;
  let opened = false;
  let detached = false;
  let detachedSampling = false;
  let preferredHeight;
  let expanded = false;
  let drag = null;
  let compact = false;

  function maxHeight() {
    const chrome = workspace.querySelector(".channel-header").offsetHeight + dock.closest(".dock").offsetHeight;
    return Math.max(minHeight, workspace.clientHeight - chrome - 154);
  }

  function syncHeight() {
    const max = maxHeight();
    const ideal = preferredHeight ?? Math.min(372, Math.round(workspace.clientHeight * 0.4));
    const height = expanded ? max : Math.max(minHeight, Math.min(max, ideal));
    const wasCompact = compact;
    compact = height === minHeight;
    drawer.style.setProperty("--comparison-height", height + "px");
    drawer.classList.toggle("compact", compact);
    grip.setAttribute("aria-valuemin", String(minHeight));
    grip.setAttribute("aria-valuemax", String(max));
    grip.setAttribute("aria-valuenow", String(height));
    expand.setAttribute("aria-pressed", String(expanded));
    replaceIcon(expand, expanded ? "collapse" : "expand", expanded ? "Restore comparison height" : "Expand comparison");
    if (opened && !detached && wasCompact && !compact) {
      refresh();
      onSampleNeeded();
    }
  }

  function resizeTo(height) {
    preferredHeight = Math.max(minHeight, Math.min(maxHeight(), height));
    expanded = false;
    syncHeight();
  }

  function startResize(event) {
    if (!event.isPrimary || event.button !== 0 || event.target.closest("button")) return;
    drag = { id: event.pointerId, y: event.clientY, height: drawer.getBoundingClientRect().height };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  for (const handle of [grip, header]) {
    handle.addEventListener("pointerdown", startResize);
    handle.addEventListener("pointermove", (event) => {
      if (event.pointerId === drag?.id) resizeTo(Math.round(drag.height + drag.y - event.clientY));
    });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      handle.addEventListener(name, () => { drag = null; });
    }
  }
  grip.addEventListener("keydown", (event) => {
    const height = drawer.offsetHeight;
    const heights = { ArrowUp: height + 32, ArrowDown: height - 32, Home: minHeight, End: maxHeight() };
    if (!Object.hasOwn(heights, event.key)) return;
    event.preventDefault();
    resizeTo(heights[event.key]);
  });
  window.addEventListener("resize", syncHeight);
  expand.addEventListener("click", () => {
    expanded = !expanded;
    syncHeight();
  });

  function syncDock() {
    const inline = opened && !detached;
    const label = detached ? "Focus comparison window" : "Compare live telemetry";
    drawer.hidden = !inline;
    drawer.inert = !inline;
    dock.setAttribute("aria-expanded", String(inline));
    dock.classList.toggle("detached", detached);
    replaceIcon(dock, detached ? "popout" : "activity", label);
  }

  function refresh() {
    if (!opened) return;
    const current = snapshot();
    if (detached) api.sendComparisonData(current);
    else view.update(current);
  }

  function open() {
    opened = true;
    syncDock();
    syncHeight();
    refresh();
    onSampleNeeded();
    $("compare-luma").focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!opened || detached) return;
    opened = false;
    view.clearFrame();
    view.cancelDrag();
    syncDock();
    if (restoreFocus) dock.focus({ preventScroll: true });
  }

  async function popOut() {
    if (!opened || detached) return;
    view.cancelDrag();
    detached = true;
    detachedSampling = !view.paused;
    syncDock();
    try {
      await api.popOutComparison(snapshot(), view.settings());
      refresh();
      onSampleNeeded();
    } catch (error) {
      detached = false;
      open();
      onError(error.message);
    }
  }

  dock.addEventListener("click", () => {
    if (detached) void api.focusComparison().catch((error) => onError(error.message));
    else if (opened) close();
    else open();
  });
  $("compare-close").addEventListener("click", () => close());
  $("compare-popout").addEventListener("click", popOut);

  api.onComparisonSampling((sampling) => {
    if (detachedSampling === sampling) return;
    detachedSampling = sampling;
    if (sampling) onSampleNeeded();
  });
  api.onComparisonReturn(({ docked, settings, error }) => {
    detached = false;
    opened = false;
    view.update(snapshot());
    view.restore(settings);
    if (docked || error) open();
    else {
      view.clearFrame();
      syncDock();
    }
    if (error) onError(error);
  });
  api.onComparisonInspect(inspect);

  return {
    get open() { return opened && !detached; },
    get sampling() { return opened && (detached ? detachedSampling : !compact && !view.paused); },
    close,
    refresh,
  };
}

function startDetachedComparison(api) {
  const view = createComparisonView({
    detached: true,
    inspect: (id) => api.inspect(id).catch(() => {}),
    onViewChange: api.changeSettings,
  });
  let receivedUpdate = false;
  api.onData((data) => {
    receivedUpdate = true;
    view.update(data);
  });
  $("compare-popout").addEventListener("click", () => {
    view.cancelDrag();
    void api.dock(view.settings()).catch(() => {});
  });
  api.initial().then(({ data, settings }) => {
    if (!receivedUpdate) view.update(data);
    view.restore(settings);
    api.changeSettings(view.settings());
  }).catch(() => window.close());
}

if (window.compareWindow) startDetachedComparison(window.compareWindow);
