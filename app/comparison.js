"use strict";

function createComparison({ status, sample, widget, inspect, onSampleNeeded }) {
  const drawer = $("comparison");
  const dock = $("dock-compare");
  const pause = $("compare-pause");
  const scale = $("comparison-scale");
  const cards = new Map();
  const colors = { Y: "#9aa2ff", R: "#ff7d84", G: "#6bdd9f", B: "#76aaff" };
  const board = createCardBoard({
    grid: $("comparison-grid"), scroll: $("comparison-scroll"),
    shelf: $("pinned-comparison"), pinnedGrid: $("pinned-comparison-grid"), swap: true,
  });
  let opened = false;
  let expanded = false;
  let rgb = false;
  let shared = true;
  let held = null;
  let cursor = null;
  let locked = false;
  let closeTimer = 0;

  function channels(stats) {
    return rgb && stats?.bins.R ? ["R", "G", "B"] : ["Y"];
  }

  function snapshot(id) {
    return held ? held.samples.get(id) : sample(id);
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
      if (locked || !snapshot(id)?.stats) return;
      const next = binAt(event);
      if (next !== cursor) setCursor(next);
    });
    chart.addEventListener("pointerleave", () => { if (!locked) setCursor(null); });
    chart.addEventListener("click", (event) => {
      if (!snapshot(id)?.stats) return;
      const next = binAt(event);
      locked = !(locked && cursor === next);
      setCursor(next);
    });
    chart.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && cursor !== null) {
        event.preventDefault();
        clearCursor();
        return;
      }
      if (!snapshot(id)?.stats || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      let next = cursor ?? 32;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = 63;
      if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
      if (event.key === "ArrowRight") next = Math.min(63, next + 1);
      if (event.key === "Enter" || event.key === " ") locked = !locked;
      setCursor(next);
    });

    return { node, mark, subtitle, chart, graph, series, guide, empty, readout, values, dimensions, time };
  }

  function setCursor(bin) {
    cursor = bin;
    $("compare-cursor").hidden = !locked;
    for (const [id, card] of cards) drawCursor(card, snapshot(id));
  }

  function clearCursor() {
    locked = false;
    setCursor(null);
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

  function summarize(id, entry) {
    if (id === "source") return "Reference distribution";
    const sourceWidget = widget(id);
    if (!sourceWidget) return "";
    const values = entry?.params || sourceWidget.params;
    const active = sourceWidget.method.params.filter((spec) => !spec.when || spec.when.values.includes(values[spec.when.key]));
    const description = active.filter((spec) => spec.type !== "text").map((spec) => spec.type === "select"
      ? values[spec.key] : spec.label + " " + values[spec.key]);
    return description.slice(0, 2).join(" · ") || "Fixed calculation";
  }

  function refresh() {
    if (!opened) return;
    const current = held?.status || status();
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
    pause.setAttribute("aria-pressed", String(!!held));
    replaceIcon(pause, held ? "play" : "pause", held ? "Resume live histograms" : "Pause live histograms");
    if (!active) {
      scale.textContent = shared ? "Shared scale · % of pixels" : "Fit each · % of pixels";
      return;
    }

    const histograms = new Map();
    let peak = 1;
    for (const [id] of cards) {
      const entry = snapshot(id);
      const stats = entry?.stats;
      const curves = stats ? channels(stats).map((key) => [key, stats.bins[key].map((count) => 100 * count / stats.pixels)]) : [];
      const localPeak = Math.ceil(Math.max(1, ...curves.flatMap(([, bins]) => bins)));
      peak = Math.max(peak, localPeak);
      histograms.set(id, { entry, curves, localPeak });
    }
    scale.textContent = shared ? "Shared scale · 0–" + peak + "% of pixels" : "Fit each · % of pixels";
    for (const [id, card] of cards) {
      const { entry, curves, localPeak } = histograms.get(id);
      const stats = entry?.stats;
      card.series.replaceChildren();
      for (const [key, bins] of curves) {
        plotLine({ ...card.graph, svg: card.series }, bins, shared ? peak : localPeak, colors[key], curves.length === 1);
      }
      card.empty.textContent = stats ? "" : entry?.error ? "Needs input" : "Awaiting pixels";
      if (id === "source") replaceIcon(card.mark, live ? "video" : "image");
      const description = summarize(id, entry);
      card.subtitle.textContent = description;
      card.subtitle.title = description;
      for (const [key, value] of card.values) value.textContent = stats ? String(stats[key]) : "—";
      card.dimensions.textContent = stats ? dimensionsText(stats) + (stats.bins.R ? " · RGB" : " · Gray") : "—";
      card.time.textContent = id === "source" ? "Source" : Number.isFinite(entry?.ms) ? entry.ms.toFixed(2) + " ms" : "—";
      drawCursor(card, entry);
    }
  }

  function open() {
    clearTimeout(closeTimer);
    opened = true;
    drawer.hidden = false;
    drawer.inert = false;
    drawer.classList.add("open");
    dock.setAttribute("aria-expanded", "true");
    refresh();
    onSampleNeeded();
    $("compare-luma").focus({ preventScroll: true });
  }

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    held = null;
    clearCursor();
    board.cancelDrag();
    drawer.classList.remove("open");
    drawer.inert = true;
    dock.setAttribute("aria-expanded", "false");
    closeTimer = setTimeout(() => { drawer.hidden = true; }, 185);
    if (restoreFocus) dock.focus({ preventScroll: true });
  }

  dock.addEventListener("click", () => { if (opened) close(); else open(); });
  $("compare-close").addEventListener("click", () => close());
  $("compare-cursor").addEventListener("click", clearCursor);
  $("compare-expand").addEventListener("click", (event) => {
    expanded = !expanded;
    drawer.classList.toggle("expanded", expanded);
    event.currentTarget.setAttribute("aria-pressed", String(expanded));
    replaceIcon(event.currentTarget, expanded ? "collapse" : "expand", expanded ? "Reduce comparison" : "Expand comparison");
  });
  scale.addEventListener("click", () => {
    shared = !shared;
    scale.setAttribute("aria-pressed", String(shared));
    refresh();
  });
  for (const [id, mode] of [["compare-luma", false], ["compare-rgb", true]]) {
    $(id).addEventListener("click", () => {
      rgb = mode;
      $("compare-luma").setAttribute("aria-pressed", String(!rgb));
      $("compare-rgb").setAttribute("aria-pressed", String(rgb));
      refresh();
    });
  }
  pause.addEventListener("click", () => {
    if (status().kind !== "live") return;
    held = held ? null : { status: status(), samples: new Map([...cards.keys()].map((id) => [id, sample(id)])) };
    refresh();
    if (!held) onSampleNeeded();
  });

  return {
    get open() { return opened; },
    get sampling() { return opened && !held; },
    close,
    refresh,
    reset() {
      held = null;
      clearCursor();
      board.cancelDrag();
    },
    sync(items) {
      const ids = new Set(items.map((item) => item.id));
      for (const id of cards.keys()) {
        if (ids.has(id)) continue;
        board.remove(id);
        cards.delete(id);
      }
      for (const item of items) {
        if (cards.has(item.id)) continue;
        const card = cardFor(item);
        cards.set(item.id, card);
        board.add(item.id, card.node);
      }
      refresh();
    },
  };
}
