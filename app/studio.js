"use strict";

const api = window.studio;
const maxWidgets = 12;
const methodDrag = "application/x-citra-methods";
const shell = document.querySelector(".shell");
const canvas = document.createElement("canvas");
const cameraPixels = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const state = {
  catalog: [],
  methods: new Map(),
  marked: new Set(),
  collapsed: new Set(["geometry", "color", "edges", "frequency", "restore", "regions", "coding"]),
  widgets: [],
  selected: "source",
  nextId: 1,
  generation: 0,
  kind: "idle",
  source: null,
  reference: null,
  stream: null,
  focus: false,
  inspector: window.innerWidth >= 1180,
  tab: "hist",
  rgb: false,
  engine: null,
  busy: false,
  work: null,
  samples: new Map(),
  latencies: [],
  completions: [],
  events: [],
  measurement: null,
  liveFrames: 0,
  skipped: 0,
  lastFrame: 0,
  frameCost: 0,
  clearAfterTask: false,
};

let cameraTicket = 0;
let frameCallback = 0;
let renderTimer = 0;
let toastTimer = 0;
let lastTelemetry = 0;
let connecting;

function selectedWidget() {
  return state.widgets.find((widget) => widget.id === state.selected);
}

function jobFor(widget) {
  return { id: widget.id, method: widget.method.id, params: { ...widget.params } };
}

function parameterDefaults(method) {
  return Object.fromEntries(method.params.map((item) => [item.key, item.default]));
}

function addEvent(message, failed = false) {
  state.events.push({ message, failed, date: new Date() });
  if (state.events.length > 42) state.events.shift();
  if (state.tab === "debug" && state.inspector) drawEvents();
}

function notify(message, failed = false) {
  clearTimeout(toastTimer);
  const toast = $("toast");
  toast.replaceChildren(icon(failed ? "warning" : "check"), element("span", "", message));
  toast.classList.toggle("error", failed);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, failed ? 5200 : 2800);
}

function fail(message) {
  addEvent(message, true);
  notify(message, true);
}

function engineStatus(failed = false) {
  $("engine-indicator").className = "indicator" + (failed ? " failed" : state.engine ? " connected" : "");
  $("engine-caption").textContent = failed ? "Engine error" : state.engine ? "Python " + state.engine.python + " · Ready" : "Starting Python…";
  $("popover-status").classList.toggle("ready", !!state.engine && !failed);
}

async function warmEngine() {
  try {
    state.engine = await api.hello();
    engineStatus();
    addEvent("Python " + state.engine.python + " engine connected.");
  } catch (error) {
    engineStatus(true);
    fail(error.message);
  } finally {
    drawTelemetry(true);
  }
}

function searchText(method) {
  return [method.name, method.description, ...method.params.flatMap((spec) => spec.options || [])].join(" ").toLowerCase();
}

function drawLibrary() {
  const query = $("search").value.trim().toLowerCase();
  const groups = document.createDocumentFragment();
  let count = 0;
  for (const group of state.catalog) {
    const filtered = group.methods.filter((method) => !query || searchText(method).includes(query));
    if (!filtered.length) continue;
    count += filtered.length;
    const section = element("section", "method-group");
    const heading = element("button", "method-heading");
    heading.type = "button";
    heading.append(icon(group.icon), element("span", "", group.name), icon("chevron"));
    const items = element("div", "method-items");
    items.id = "group-" + group.id;
    items.hidden = !query && state.collapsed.has(group.id);
    heading.setAttribute("aria-controls", items.id);
    heading.setAttribute("aria-expanded", String(!items.hidden));
    heading.addEventListener("click", () => {
      items.hidden = !items.hidden;
      heading.setAttribute("aria-expanded", String(!items.hidden));
      if (items.hidden) state.collapsed.add(group.id);
      else state.collapsed.delete(group.id);
    });

    for (const method of filtered) {
      const row = element("button", "method-row");
      row.type = "button";
      row.draggable = true;
      row.dataset.method = method.id;
      row.title = method.description;
      row.append(icon(group.icon), element("span", "", method.name), icon("plus"));
      row.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (state.marked.has(method.id)) state.marked.delete(method.id);
          else state.marked.add(method.id);
          drawBatch();
        } else {
          addWidgets([method.id]);
        }
      });
      row.addEventListener("dragstart", (event) => {
        const selection = state.marked.has(method.id) ? [...state.marked] : [method.id];
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(methodDrag, JSON.stringify(selection));
      });
      items.append(row);
    }
    section.append(heading, items);
    groups.append(section);
  }
  if (!count && query) groups.append(element("p", "search-empty", "No matching methods."));
  $("method-list").replaceChildren(groups);
  $("method-count").textContent = String(count);
  drawBatch();
}

function drawBatch() {
  for (const row of document.querySelectorAll(".method-row")) {
    const marked = state.marked.has(row.dataset.method);
    row.classList.toggle("marked", marked);
    row.setAttribute("aria-pressed", String(marked));
    replaceIcon(row.lastElementChild, marked ? "check" : "plus");
  }
  $("batch-bar").hidden = !state.marked.size;
  $("batch-count").textContent = state.marked.size + " selected";
}

function makeTile(widget) {
  const id = widget?.id || "source";
  const title = widget?.method.name || "Original source";
  const node = element("article", widget ? "tile" : "tile source");
  node.dataset.widget = id;
  const header = element("header", "tile-header");
  const label = element("button", "tile-label");
  label.type = "button";
  label.dataset.dragHandle = "";
  label.title = "Select or drag to move. Alt+arrow keys also move this widget.";
  label.setAttribute("aria-pressed", "false");
  const mark = icon(widget ? widget.method.icon : "image");
  label.append(mark, element("span", "", title));
  label.addEventListener("click", () => selectWidget(id));
  const save = button("download", "Save " + title.toLowerCase());
  save.addEventListener("click", () => saveResult(widget));
  const pin = button("pin", "Pin " + title.toLowerCase());
  pin.dataset.cardPin = title.toLowerCase();
  pin.setAttribute("aria-pressed", "false");
  pin.addEventListener("click", () => workspaceBoard.togglePin(id));
  const expand = button("expand", "Focus " + title.toLowerCase());
  expand.addEventListener("click", () => {
    const exit = state.focus && state.selected === id;
    selectWidget(id);
    setFocus(!exit);
  });
  header.append(label, pin, save, expand);
  if (widget) {
    const remove = button("close", "Remove " + title.toLowerCase());
    remove.addEventListener("click", () => removeWidget(id));
    header.append(remove);
  }

  const media = element("div", "tile-media");
  const img = element("img");
  img.alt = title;
  img.hidden = true;
  img.draggable = false;
  const placeholder = element("div", "tile-placeholder");
  const placeholderMark = icon("scan");
  const placeholderText = element("span", "", "Waiting for processing…");
  placeholder.append(placeholderMark, placeholderText);
  media.append(img, placeholder);
  const video = widget ? null : document.createElement("video");
  if (video) {
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.draggable = false;
    video.hidden = true;
    video.setAttribute("aria-label", "Original webcam video");
    media.append(video);
  }
  media.addEventListener("click", () => selectWidget(id));
  const meta = element("footer", "tile-meta");
  const dimensions = element("span", "", "—");
  const timing = element("span", "", widget ? "—" : "Original");
  meta.append(dimensions, timing);
  const grip = button("grip", "Drag to resize. Press Enter to change width.", "resize-grip");
  node.append(header, media, meta, grip);

  let span = 1;
  let drag;
  function columns() {
    return Number(getComputedStyle(node.parentElement).getPropertyValue("--columns").trim()) || 1;
  }
  function cycleWidth() {
    const cols = columns();
    setSize(span >= cols ? 1 : span + 1);
  }
  function setSize(width, height) {
    span = width;
    node.style.setProperty("--span", width);
    if (height !== undefined) node.style.setProperty("--tile-height", height + "px");
  }
  grip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    grip.setPointerCapture(event.pointerId);
    const cols = columns();
    drag = { x: event.clientX, y: event.clientY, span: Math.min(cols, span), height: media.offsetHeight,
      cols, unit: node.parentElement.clientWidth / cols, moved: false };
  });
  grip.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    drag.moved = true;
    const width = Math.min(drag.cols, Math.max(1, drag.span + Math.round(dx / Math.max(60, drag.unit / 2))));
    const height = Math.min(490, Math.max(100, drag.height + dy));
    setSize(width, height);
  });
  function endResize() {
    if (drag && !drag.moved) cycleWidth();
    drag = null;
  }
  grip.addEventListener("pointerup", endResize);
  grip.addEventListener("lostpointercapture", () => { drag = null; });
  grip.addEventListener("click", (event) => {
    if (event.detail === 0) cycleWidth();
  });
  grip.addEventListener("dblclick", () => {
    setSize(1);
    node.style.removeProperty("--tile-height");
  });
  return { node, img, video, mark, placeholder, placeholderMark, placeholderText, dimensions, timing, label, save, expand, url: null };
}

const sourceTile = makeTile();
const workspaceBoard = createCardBoard({
  grid: $("tiles"), scroll: $("tile-scroll"), shelf: $("pinned-tiles"), pinnedGrid: $("pinned-tile-grid"),
  onMoveStart: () => { if (state.focus) setFocus(false); },
});
workspaceBoard.add("source", sourceTile.node);

const comparison = createWorkspaceComparison({
  api,
  snapshot: comparisonSnapshot,
  inspect(id) {
    if (id !== "source" && !state.widgets.some((widget) => widget.id === id)) return;
    selectWidget(id);
    setInspector(true, "hist");
    if (window.innerWidth < 1180) {
      comparison.close(false);
      $("hist-tab").focus();
    }
  },
  onSampleNeeded: scheduleStill,
  onError: fail,
});

function comparisonSnapshot() {
  const status = { kind: state.kind, frame: state.liveFrames, measurement: state.measurement, generation: state.generation };
  const source = readSample("source");
  const items = [{
    id: "source", title: "Original source", icon: "image", description: "Reference distribution",
    sample: source ? { stats: source.stats, error: source.error } : null,
  }];
  for (const widget of state.widgets) {
    const entry = readSample(widget.id, widget);
    const values = entry?.params || widget.params;
    const description = widget.method.params
      .filter((spec) => spec.type !== "text" && (!spec.when || spec.when.values.includes(values[spec.when.key])))
      .slice(0, 2)
      .map((spec) => spec.type === "select" ? values[spec.key] : spec.label + " " + values[spec.key]);
    items.push({
      id: widget.id, title: widget.method.name, icon: widget.method.icon,
      description: description.join(" · ") || "Fixed calculation",
      sample: entry ? { stats: entry.stats, ms: entry.ms, error: entry.error } : null,
    });
  }
  return { status, items };
}

function setPreview(tile, item, bytes) {
  if (!bytes || item.offset < 0 || item.length < 1 || item.offset + item.length > bytes.length) return;
  const nextURL = URL.createObjectURL(new Blob([bytes.subarray(item.offset, item.offset + item.length)], { type: item.mime }));
  const previous = tile.url;
  tile.url = nextURL;
  tile.img.src = nextURL;
  tile.img.hidden = false;
  tile.placeholder.hidden = true;
  if (previous) URL.revokeObjectURL(previous);
}

function clearPreview(tile) {
  if (tile.url) URL.revokeObjectURL(tile.url);
  tile.url = null;
  tile.img.removeAttribute("src");
  tile.img.hidden = true;
  tile.placeholder.hidden = true;
  tile.dimensions.textContent = "—";
}

function placeholder(tile, text, isError = false) {
  clearPreview(tile);
  tile.placeholder.hidden = false;
  tile.placeholder.classList.toggle("error", isError);
  replaceIcon(tile.placeholderMark, isError ? "warning" : "scan");
  tile.placeholderText.textContent = text;
  tile.timing.textContent = isError ? "Needs input" : "—";
}

function setFocus(enabled) {
  state.focus = enabled;
  $("layout-toggle").setAttribute("aria-pressed", String(enabled));
  replaceIcon($("layout-toggle"), enabled ? "collapse" : "grid", enabled ? "Return to grid layout" : "Toggle focus layout");
  syncSelection();
}

function syncSelection() {
  workspaceBoard.feature(state.focus ? state.selected : null);
  for (const [id, tile] of [["source", sourceTile], ...state.widgets.map((widget) => [widget.id, widget.tile])]) {
    const selected = id === state.selected;
    tile.node.classList.toggle("selected", selected);
    tile.label.setAttribute("aria-pressed", String(selected));
    replaceIcon(tile.expand, selected && state.focus ? "collapse" : "expand");
  }
}

function selectWidget(id) {
  if (state.selected !== id) {
    state.selected = id;
    syncSelection();
    drawInspection();
    scheduleStill();
  }
}

function addWidgets(ids) {
  let last;
  for (const id of ids) {
    const method = state.methods.get(id);
    if (!method) continue;
    if (state.widgets.length >= maxWidgets) {
      notify("The workspace holds up to 12 result widgets.", true);
      break;
    }
    const widget = { id: "w" + state.nextId++, method, params: parameterDefaults(method), revision: 0,
      rendered: -1, result: null, error: null };
    widget.tile = makeTile(widget);
    state.widgets.push(widget);
    workspaceBoard.add(widget.id, widget.tile.node);
    last = widget;
  }
  if (!last) return;
  state.marked.clear();
  drawBatch();
  comparison.refresh();
  syncStage();
  selectWidget(last.id);
  addEvent(last.method.name + (ids.length > 1 ? " and selected methods added." : " added."));
  if (state.kind === "idle") notify("Method queued. Choose a source to start.");
  scheduleStill();
}

function removeWidget(id) {
  const index = state.widgets.findIndex((widget) => widget.id === id);
  if (index < 0) return;
  const [widget] = state.widgets.splice(index, 1);
  clearPreview(widget.tile);
  workspaceBoard.remove(id);
  state.samples.delete(id);
  comparison.refresh();
  if (state.selected === id) selectWidget(state.widgets[Math.min(index, state.widgets.length - 1)]?.id || "source");
  addEvent(widget.method.name + " removed.");
  syncStage();
  scheduleStill();
}

function syncStage() {
  const live = state.kind === "live";
  const active = state.kind !== "idle";
  const ready = active && (!live || state.liveFrames > 0);
  $("welcome").hidden = active;
  $("active-stage").hidden = !active;
  $("source-name").textContent = state.source?.name || "";
  $("active-count").textContent = state.widgets.length + (state.widgets.length === 1 ? " result" : " results");
  document.querySelector(".stage-corner span:last-child").textContent =
    state.widgets.length ? state.widgets.length + " METHODS QUEUED" : "READY FOR INPUT";
  $("source-dot").className = "live-dot" + (live ? " live" : active ? " ready" : "");
  $("source-state").textContent = live ? "Webcam live" : active ? "Photo loaded" : "No source";
  $("footer-detail").textContent = active ? dimensionsText(state.source) : "Local processing";

  for (const id of ["open-photo", "welcome-photo", "dock-photo", "sample", "reference", "clear-reference"]) $(id).disabled = state.busy;
  for (const id of ["welcome-camera", "toggle-camera", "dock-camera"]) {
    $(id).disabled = state.busy;
    $(id).classList.toggle("active", live);
    if (id !== "welcome-camera") replaceIcon($(id), live ? "stop" : "video", live ? "Stop webcam" : "Start webcam");
  }
  $("dock-snapshot").disabled = state.busy || !live || !ready;
  $("dock-save").disabled = state.busy || !ready || !!selectedWidget()?.error;
  $("dock-clear").disabled = state.busy || !active;
  sourceTile.save.disabled = state.busy || !ready;
  for (const widget of state.widgets) widget.tile.save.disabled = state.busy || !ready || !!widget.error;
  syncSelection();
}

function blankResults() {
  for (const widget of state.widgets) {
    widget.rendered = -1;
    widget.result = widget.error = null;
    placeholder(widget.tile, "Waiting for processing…");
  }
}

function resetPipeline() {
  workspaceBoard.cancelDrag();
  state.generation += 1;
  state.samples.clear();
  state.measurement = null;
  state.lastFrame = state.frameCost = state.liveFrames = state.skipped = 0;
  state.latencies.length = state.completions.length = 0;
  blankResults();
}

function detachCamera() {
  if (frameCallback) sourceTile.video.cancelVideoFrameCallback(frameCallback);
  frameCallback = 0;
  for (const track of state.stream?.getTracks() || []) track.stop();
  state.stream = null;
  sourceTile.video.srcObject = null;
  sourceTile.video.hidden = true;
  canvas.width = canvas.height = 1;
}

function showIdle() {
  resetPipeline();
  state.kind = "idle";
  state.source = null;
  clearPreview(sourceTile);
  syncStage();
  drawInspection();
  drawTelemetry(true);
  comparison.refresh();
}

function showPhoto(reply, kind) {
  detachCamera();
  resetPipeline();
  state.kind = kind;
  state.source = { name: reply.name, width: reply.width, height: reply.height };
  if (state.engine) engineStatus();
  setPreview(sourceTile, reply.items[0], reply.data);
  replaceIcon(sourceTile.mark, "image");
  sourceTile.dimensions.textContent = dimensionsText(state.source);
  sourceTile.timing.textContent = "Original";
  state.samples.set("source", { stats: reply.stats, revision: 0, at: performance.now() });
  syncStage();
  drawInspection();
  drawTelemetry(true);
  comparison.refresh();
  addEvent(reply.name + " opened (" + dimensionsText(reply) + ").");
}

async function withTask(task) {
  if (state.busy) return;
  state.busy = true;
  syncStage();
  try {
    if (connecting) await connecting;
    if (state.work) await state.work;
    await task();
  } catch (error) {
    fail(error.message);
  } finally {
    if (state.clearAfterTask && state.kind === "idle") {
      try { await api.clear(); } catch (error) { addEvent(error.message, true); }
    }
    state.clearAfterTask = false;
    state.busy = false;
    syncStage();
    scheduleStill();
  }
}

function choosePhoto(file) {
  return withTask(async () => {
    const reply = file ? await api.dropPhoto(file) : await api.choosePhoto();
    if (reply) showPhoto(reply, "photo");
  });
}

function openSample() {
  return withTask(async () => showPhoto(await api.sample(), "sample"));
}

function invalidateReferenceResults() {
  for (const widget of state.widgets) {
    if (["arithmetic", "boolean", "matching"].includes(widget.method.id)) widget.revision++;
  }
  const reference = state.reference;
  $("reference-caption").textContent = reference
    ? reference.name + " · " + dimensionsText(reference)
    : "Optional input for two-image methods.";
  $("clear-reference").classList.toggle("hidden", !reference);
}

function chooseReference() {
  return withTask(async () => {
    const result = await api.chooseReference();
    if (!result) return;
    state.reference = result;
    invalidateReferenceResults();
    addEvent("Reference photo loaded.");
  });
}

function clearReference() {
  return withTask(async () => {
    await api.clearReference();
    state.reference = null;
    invalidateReferenceResults();
    addEvent("Reference photo removed.");
  });
}

function startWebcam() {
  if (state.kind === "live" || state.busy) return;
  return withTask(async () => {
    const ticket = ++cameraTicket;
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Webcam capture is unavailable.");
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      });
      if (ticket !== cameraTicket) return;
      sourceTile.video.srcObject = stream;
      await sourceTile.video.play();
      if (ticket !== cameraTicket) return;
      await api.clear();
      if (ticket !== cameraTicket) return;
      resetPipeline();
      clearPreview(sourceTile);
      state.stream = stream;
      state.kind = "live";
      state.source = { name: "Webcam", width: sourceTile.video.videoWidth, height: sourceTile.video.videoHeight };
      sourceTile.video.hidden = false;
      replaceIcon(sourceTile.mark, "video");
      sourceTile.dimensions.textContent = dimensionsText(state.source);
      sourceTile.timing.textContent = "LIVE";
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (state.stream === stream) stopWebcam("Webcam disconnected.");
        }, { once: true });
      }
      syncStage();
      drawInspection();
      comparison.refresh();
      addEvent("Webcam started.");
      scheduleFrame();
    } catch (error) {
      const messages = {
        NotAllowedError: "Camera permission is blocked. Check Windows camera privacy settings.",
        NotFoundError: "No webcam was found.",
        NotReadableError: "The webcam is unavailable or in use by another app.",
      };
      throw new Error(messages[error.name] || error.message);
    } finally {
      if (stream && state.stream !== stream) {
        for (const track of stream.getTracks()) track.stop();
        sourceTile.video.srcObject = null;
      }
    }
  });
}

function stopWebcam(message = "Webcam stopped.") {
  cameraTicket++;
  if (state.kind !== "live") return;
  detachCamera();
  showIdle();
  addEvent(message);
  if (state.busy) state.clearAfterTask = true;
  else void withTask(() => api.clear());
}

function toggleWebcam() {
  return state.kind === "live" ? stopWebcam() : startWebcam();
}

function clearSource() {
  if (state.kind === "live") return stopWebcam();
  if (state.kind === "idle") return;
  return withTask(async () => {
    await api.clear();
    showIdle();
    addEvent("Source removed.");
  });
}

function captureFrame(edge) {
  const video = sourceTile.video;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const factor = Math.min(1, edge / Math.max(w, h), Math.sqrt(1280 * 960 / (w * h)));
  const width = Math.max(1, Math.round(w * factor));
  const height = Math.max(1, Math.round(h * factor));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  cameraPixels.drawImage(video, 0, 0, width, height);
  return { width, height, pixels: cameraPixels.getImageData(0, 0, width, height).data };
}

function freezeFrame() {
  if (state.kind !== "live") return;
  return withTask(async () => {
    const frame = captureFrame(1280);
    if (!frame) throw new Error("Wait for a webcam frame.");
    const reply = await api.snapshot({ width: frame.width, height: frame.height }, frame.pixels);
    showPhoto(reply, "snapshot");
  });
}

function saveResult(widget = selectedWidget()) {
  if (state.kind === "idle" || (state.kind === "live" && !state.liveFrames)) return;
  return withTask(async () => {
    const title = state.kind === "photo" ? state.source.name.replace(/\.[^.]+$/, "") : state.source.name;
    const suffix = widget ? widget.method.name : "Original";
    const saved = await api.save(widget ? jobFor(widget) : null, title + " - " + suffix);
    if (saved) {
      addEvent("Saved " + saved.name + " (" + dimensionsText(saved) + ").");
      notify("Saved " + saved.name);
    }
  });
}

function inspectorWantsStats() {
  return state.inspector && state.tab === "hist";
}

function readSample(id, widget = state.widgets.find((entry) => entry.id === id)) {
  const sample = state.samples.get(id);
  return sample?.revision === (widget?.revision ?? 0) ? sample : undefined;
}

function wantedSamples(now = 0) {
  const wanted = new Set();
  if (comparison.sampling) {
    wanted.add("source");
    for (const widget of state.widgets) wanted.add(widget.id);
  }
  if (inspectorWantsStats()) wanted.add(state.selected);
  return [...wanted].filter((id) => {
    const sample = readSample(id);
    return !sample || (now && now - sample.at >= 235);
  });
}

function scheduleStill(delay = 22) {
  if (state.kind === "idle" || state.kind === "live" || state.busy || state.work) return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (state.kind === "idle" || state.kind === "live" || state.busy || state.work) return;
    const inspectMany = new Set(wantedSamples());
    const widgets = state.widgets.filter((widget) => widget.rendered !== widget.revision || inspectMany.has(widget.id));
    for (const widget of widgets) inspectMany.add(widget.id);
    if (inspectMany.size) process(widgets, [...inspectMany]);
  }, delay);
}

function scheduleFrame() {
  if (state.kind !== "live" || document.hidden || frameCallback) return;
  frameCallback = sourceTile.video.requestVideoFrameCallback((now) => {
    frameCallback = 0;
    if (state.kind !== "live" || document.hidden) return;
    scheduleFrame();
    const interval = Math.max(state.widgets.length ? 59 : 120, state.frameCost * 1.18);
    if (now - state.lastFrame < interval || state.busy) return;
    if (state.work) {
      state.skipped++;
      return;
    }
    const edge = state.frameCost > 125 ? 480 : state.frameCost > 65 || state.widgets.length > 6 ? 640 : 850;
    const frame = captureFrame(edge);
    if (!frame) return;
    state.lastFrame = now;
    process(state.widgets, wantedSamples(now), frame);
  });
}

function process(widgets, inspectMany, frame) {
  const generation = state.generation;
  const revisions = new Map(widgets.map((widget) => [widget.id, widget.revision]));
  const request = { jobs: widgets.map(jobFor), inspectMany };
  if (frame) Object.assign(request, { width: frame.width, height: frame.height });
  const begin = performance.now();
  state.work = api.render(request, frame?.pixels).then((reply) => {
    if (generation !== state.generation) return;
    if (state.engine && $("engine-indicator").classList.contains("failed")) engineStatus();
    const now = performance.now();
    for (const item of reply.items) {
      const widget = state.widgets.find((tile) => tile.id === item.id);
      if (!widget || widget.revision !== revisions.get(widget.id)) continue;
      setPreview(widget.tile, item, reply.data);
      widget.rendered = widget.revision;
      widget.result = item;
      widget.error = null;
      widget.tile.dimensions.textContent = dimensionsText(item);
      widget.tile.timing.textContent = item.ms.toFixed(1) + " ms";
    }
    for (const issue of reply.issues) {
      const widget = state.widgets.find((tile) => tile.id === issue.id);
      if (!widget || widget.revision !== revisions.get(widget.id)) continue;
      if (widget.error !== issue.message) addEvent(widget.method.name + " · " + issue.message, true);
      widget.rendered = widget.revision;
      widget.result = null;
      widget.error = issue.message;
      placeholder(widget.tile, issue.message, true);
    }
    for (const id of inspectMany) {
      const widget = state.widgets.find((entry) => entry.id === id);
      if (id !== "source" && (!widget || widget.revision !== revisions.get(id))) continue;
      state.samples.set(id, { stats: reply.statsById[id] || null, revision: widget?.revision ?? 0,
        at: now, ms: widget?.result?.ms, error: widget?.error, params: widget ? { ...widget.params } : null });
    }
    if (inspectMany.includes(state.selected) && inspectorWantsStats()) drawStatistics();
    const elapsed = now - begin;
    state.measurement = { engine: reply.engineMs, elapsed, width: reply.width, height: reply.height };
    state.latencies.push(elapsed);
    if (state.latencies.length > 60) state.latencies.shift();
    if (frame) {
      state.liveFrames++;
      state.frameCost = state.frameCost ? 0.8 * state.frameCost + 0.2 * elapsed : elapsed;
      state.completions.push(now);
      if (state.completions.length > 20) state.completions.shift();
    }
    syncStage();
    drawTelemetry(!frame);
    if (inspectMany.length && comparison.sampling) comparison.refresh();
  }).catch((error) => {
    if (generation !== state.generation) return;
    engineStatus(true);
    fail(error.message);
    if (frame) stopWebcam("Live processing stopped.");
    else {
      for (const widget of widgets) {
        if (state.widgets.includes(widget) && widget.revision === revisions.get(widget.id)) {
          widget.rendered = widget.revision;
          widget.error = error.message;
          placeholder(widget.tile, error.message, true);
        }
      }
      for (const id of inspectMany) {
        const widget = state.widgets.find((entry) => entry.id === id);
        if (id === "source" || (widget && revisions.get(id) === widget.revision)) {
          state.samples.set(id, { stats: null, revision: widget?.revision ?? 0, at: performance.now(), error: error.message });
        }
      }
      if (inspectorWantsStats()) drawStatistics();
      comparison.refresh();
      syncStage();
    }
  }).finally(() => {
    state.work = null;
    scheduleStill();
  });
}

function setInspector(open, tab = state.tab) {
  state.inspector = open;
  shell.classList.toggle("inspector-closed", !open);
  $("toggle-inspector").setAttribute("aria-expanded", String(open));
  $("rail-workspace").classList.toggle("active", !open || tab !== "debug");
  $("rail-debug").classList.toggle("active", open && tab === "debug");
  setTab(tab);
}

function setTab(tab) {
  state.tab = tab;
  const hist = tab === "hist";
  $("hist-panel").hidden = !hist;
  $("debug-panel").hidden = hist;
  $("hist-tab").setAttribute("aria-selected", String(hist));
  $("debug-tab").setAttribute("aria-selected", String(!hist));
  $("hist-tab").tabIndex = hist ? 0 : -1;
  $("debug-tab").tabIndex = hist ? -1 : 0;
  $("rail-workspace").classList.toggle("active", !state.inspector || hist);
  $("rail-debug").classList.toggle("active", state.inspector && !hist);
  if (hist) {
    drawInspection();
    scheduleStill();
  } else {
    drawEvents();
    drawTelemetry(true);
  }
}

function drawInspection() {
  const widget = selectedWidget();
  $("inspect-title").textContent = widget?.method.name || "Original source";
  $("inspect-description").textContent = widget?.method.description ||
    (state.kind === "idle" ? "Open a source to view its pixel distribution." : "Pixel statistics for the active photo or webcam frame.");
  $("formula").hidden = !widget;
  $("formula").textContent = widget?.method.formula || "";
  $("params-section").hidden = !widget;
  drawParameters(widget);
  drawStatistics();
}

function relevant(spec, widget) {
  return !spec.when || spec.when.values.includes(widget.params[spec.when.key]);
}

function drawParameters(widget) {
  const parameters = $("parameters");
  parameters.replaceChildren();
  if (!widget) return;
  if (!widget.method.params.length) {
    parameters.append(element("p", "parameter-empty", "This method uses a fixed calculation."));
    return;
  }
  for (const spec of widget.method.params) {
    const label = element("label", "param");
    label.dataset.param = spec.key;
    label.hidden = !relevant(spec, widget);
    const heading = element("span", "param-heading");
    heading.append(element("span", "", spec.label));
    const input = document.createElement(spec.type === "select" ? "select" : "input");
    input.setAttribute("aria-label", spec.label);
    let output;
    if (spec.type === "select") {
      for (const option of spec.options) input.append(new Option(option, option));
    } else if (spec.type === "range") {
      Object.assign(input, { type: "range", min: spec.min, max: spec.max, step: spec.step });
      output = element("output", "", widget.params[spec.key]);
      heading.append(output);
    } else {
      Object.assign(input, { type: "text", maxLength: spec.maxLength, spellcheck: false });
    }
    input.value = widget.params[spec.key];
    input.addEventListener("input", () => {
      widget.params[spec.key] = spec.type === "range" ? Number(input.value) : input.value;
      widget.revision++;
      widget.error = null;
      if (output) output.value = input.value;
      if (widget.method.id === "channel") restrictChannels(widget);
      for (const item of widget.method.params) {
        const row = parameters.querySelector('[data-param="' + item.key + '"]');
        if (row) row.hidden = !relevant(item, widget);
      }
      scheduleStill(spec.type === "text" ? 165 : 30);
    });
    label.append(heading, input);
    parameters.append(label);
  }
  if (widget.method.id === "channel") restrictChannels(widget);
}

function restrictChannels(widget) {
  const select = $("parameters").querySelector('[data-param="component"] select');
  const fourth = [...select.options].find((option) => option.value === "4");
  fourth.disabled = widget.params.space !== "CMYK";
  if (fourth.disabled && widget.params.component === "4") {
    widget.params.component = "1";
    select.value = "1";
  }
}

function resetParameters() {
  const widget = selectedWidget();
  if (!widget) return;
  widget.params = parameterDefaults(widget.method);
  widget.revision++;
  widget.error = null;
  drawParameters(widget);
  scheduleStill();
}

function rows(target, entries) {
  const fragments = document.createDocumentFragment();
  for (const [key, value] of entries) {
    const row = element("div");
    row.append(element("dt", "", key), element("dd", "", typeof value === "boolean" ? (value ? "Yes" : "No") : value));
    fragments.append(row);
  }
  target.replaceChildren(fragments);
}

function drawStatistics() {
  const stats = readSample(state.selected)?.stats;
  const rgb = !!stats?.bins.R && state.rgb;
  const colors = { Y: "#929aff", R: "#ff797f", G: "#65dc9a", B: "#76aaff" };
  const channels = rgb ? ["R", "G", "B"] : ["Y"];
  const chart = chartBase(112, ["0", "64", "128", "192", "255"], "Pixel intensity histogram");
  if (stats) {
    const scale = Math.max(1, ...channels.flatMap((channel) => stats.bins[channel]));
    for (const channel of channels) plotLine(chart, stats.bins[channel], scale, colors[channel], !rgb);
  } else {
    emptyChart(chart, state.kind === "idle" ? "Awaiting source" : "Awaiting pixels");
  }
  $("histogram").replaceChildren(chart.svg);
  $("rgb-toggle").textContent = rgb ? "RGB" : "Y";
  $("rgb-toggle").disabled = !stats?.bins.R;
  $("rgb-toggle").setAttribute("aria-pressed", String(rgb));
  $("rgb-toggle").title = rgb ? "Switch to luminance" : "Switch to RGB channels";
  $("hist-legend").replaceChildren(...channels.flatMap((channel) => [
    element("span", channel === "Y" ? "legend-luma" : "legend-" + channel.toLowerCase()),
    document.createTextNode(channel === "Y" ? "Luminance" : channel),
  ]));
  $("inspect-format").textContent = stats ? (stats.bins.R ? "RGB 8-BIT" : "GRAY 8-BIT") : state.kind === "idle" ? "IDLE" : "—";
  for (const key of ["min", "max", "mean", "stddev"]) $("stat-" + key).textContent = stats ? String(stats[key]) : "—";
  const widget = selectedWidget();
  const entries = Object.entries(widget?.result?.details || {});
  $("calculation").hidden = !entries.length && !widget?.error;
  rows($("calculation"), widget?.error ? [["Status", widget.error]] : entries);
}

function drawTiming(target, height) {
  const max = Math.max(10, ...state.latencies);
  const graph = chartBase(height, ["Older", "Latest"], "Round-trip processing latency");
  plotLine(graph, state.latencies, max, "#858fff", true);
  if (!state.latencies.length) emptyChart(graph, "Waiting for a processed frame");
  target.replaceChildren(graph.svg);
}

function drawTelemetry(force = false) {
  const now = performance.now();
  if (!force && now - lastTelemetry < 300) return;
  lastTelemetry = now;
  const m = state.measurement;
  const elapsed = m ? m.elapsed.toFixed(1) + " ms" : "—";
  $("popover-latency").textContent = elapsed;
  $("popover-frames").textContent = String(state.liveFrames);
  if (!$("engine-popover").hidden) drawTiming($("popover-chart"), 68);
  if (state.tab !== "debug" || !state.inspector) return;
  $("debug-latency").textContent = elapsed;
  $("debug-engine").textContent = m ? m.engine.toFixed(1) + " ms" : "—";
  const stamps = state.completions;
  $("debug-fps").textContent = stamps.length > 1 ? ((stamps.length - 1) * 1000 / (stamps.at(-1) - stamps[0])).toFixed(1) + " fps" : "—";
  $("debug-frames").textContent = String(state.liveFrames);
  $("debug-skips").textContent = String(state.skipped);
  drawTiming($("latency-chart"), 92);
  rows($("debug-frame"), [
    ["Source", state.source?.name || "—"],
    ["Source dimensions", dimensionsText(state.source)],
    ["Processed frame", dimensionsText(m)],
    ["Pixel input", state.kind === "live" ? "RGBA8 → BGR8" : state.source ? "Decoded → BGR8" : "—"],
    ["Output widgets", state.widgets.length],
  ]);
  rows($("debug-runtime"), [
    ["Python", state.engine?.python || "—"],
    ["OpenCV", state.engine?.opencv || "—"],
    ["Electron", state.engine?.electron || "—"],
    ["Taskbar shortcuts", state.engine?.jumpList || "—"],
  ]);
  $("debug-methods").replaceChildren(...state.widgets.map((widget) => {
    const item = element("div", "debug-row" + (widget.error ? " error" : ""));
    item.append(element("span", "", widget.method.name),
      element("strong", "", widget.error ? "Check inputs" : widget.result ? widget.result.ms.toFixed(1) + " ms" : "Pending"));
    if (widget.error) item.title = widget.error;
    return item;
  }));
}

function drawEvents() {
  $("event-log").replaceChildren(...state.events.toReversed().map((event) => {
    const li = element("li", event.failed ? "error" : "");
    const time = element("time", "", clock.format(event.date));
    time.dateTime = event.date.toISOString();
    li.append(time, element("span", "", event.message));
    return li;
  }));
}

function togglePopover(open = $("engine-popover").hidden) {
  $("engine-popover").hidden = !open;
  $("engine-status").setAttribute("aria-expanded", String(open));
  if (open) drawTelemetry(true);
}

function clearDrop() {
  $("dropzone").classList.remove("dropping");
}

$("dropzone").addEventListener("dragover", (event) => {
  const types = event.dataTransfer.types;
  if (types.includes(methodDrag) || types.includes("Files")) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    $("dropzone").classList.add("dropping");
  }
});
$("dropzone").addEventListener("dragleave", (event) => {
  if (!event.relatedTarget || !$("dropzone").contains(event.relatedTarget)) clearDrop();
});
$("dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  const transfer = event.dataTransfer;
  clearDrop();
  if (transfer.files.length) void choosePhoto(transfer.files[0]);
  else if (transfer.types.includes(methodDrag)) {
    try {
      const methods = JSON.parse(transfer.getData(methodDrag));
      if (Array.isArray(methods)) addWidgets(methods.slice(0, maxWidgets));
    } catch {
      notify("This drop does not contain a studio method.", true);
    }
  }
});
document.addEventListener("dragend", clearDrop);
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

for (const id of ["open-photo", "welcome-photo", "dock-photo"]) $(id).addEventListener("click", () => choosePhoto());
for (const id of ["toggle-camera", "welcome-camera", "dock-camera"]) $(id).addEventListener("click", toggleWebcam);
for (const [id, handler] of Object.entries({
  sample: openSample, "dock-clear": clearSource, "dock-snapshot": freezeFrame, "dock-save": () => saveResult(),
  "clear-reference": clearReference, reference: chooseReference, "reset-params": resetParameters,
  "add-batch": () => addWidgets([...state.marked]), "add-tile": () => $("search").focus(),
  "layout-toggle": () => setFocus(!state.focus), "toggle-inspector": () => setInspector(!state.inspector),
  "close-inspector": () => { setInspector(false); $("toggle-inspector").focus(); },
  "hist-tab": () => setTab("hist"), "debug-tab": () => setTab("debug"),
  "rgb-toggle": () => { state.rgb = !state.rgb; drawStatistics(); },
  "engine-status": () => togglePopover(), "open-debug": () => { togglePopover(false); setInspector(true, "debug"); },
  "rail-debug": () => setInspector(true, "debug"), "rail-workspace": () => setInspector(state.inspector, "hist"),
  home: () => { selectWidget("source"); setFocus(false); setInspector(state.inspector, "hist"); },
  help: () => $("help-dialog").showModal(), "close-help": () => $("help-dialog").close(),
  minimize: () => api.window("minimize"), maximize: () => api.window("maximize"), "close-window": () => api.window("close"),
})) $(id).addEventListener("click", handler);

$("search").addEventListener("input", drawLibrary);
$("search").addEventListener("keydown", (event) => {
  if (event.key === "Enter") document.querySelector(".method-items:not([hidden]) .method-row")?.focus();
  if (event.key === "Escape") { $("search").value = ""; drawLibrary(); }
});
document.querySelector(".inspector-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const target = event.key === "Home" ? "hist" : event.key === "End" ? "debug" : state.tab === "hist" ? "debug" : "hist";
  setTab(target);
  $(target + "-tab").focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!event.target.closest(".engine-anchor")) togglePopover(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) {
    togglePopover(false);
    if (!$("help-dialog").open && comparison.open) comparison.close();
  }
  if ($("help-dialog").open) return;
  if ((event.ctrlKey || event.metaKey) && ["o", "s"].includes(event.key.toLowerCase())) {
    event.preventDefault();
    if (event.key.toLowerCase() === "o") void choosePhoto();
    else void saveResult();
  } else if (event.key === "/" && !event.target.closest("input,select,textarea")) {
    event.preventDefault();
    $("search").focus();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.kind === "live") stopWebcam("Webcam stopped when the window was hidden.");
});
window.addEventListener("beforeunload", () => {
  detachCamera();
  clearPreview(sourceTile);
  for (const widget of state.widgets) clearPreview(widget.tile);
});

api.onAction((action) => {
  if (action === "pick") void choosePhoto();
  if (action === "webcam") void startWebcam();
  if (action === "telemetry") setInspector(true, "debug");
  if (action === "suspend") stopWebcam("Webcam stopped when the window was hidden.");
});
api.onWindowState((maximized) => replaceIcon($("maximize"), maximized ? "restore" : "maximize", maximized ? "Restore" : "Maximize"));
setInspector(state.inspector);
syncStage();
connecting = warmEngine().finally(() => { connecting = null; });
api.catalog().then((catalog) => {
  state.catalog = catalog;
  for (const group of catalog) {
    for (const method of group.methods) state.methods.set(method.id, { ...method, icon: group.icon });
  }
  drawLibrary();
}).catch((error) => fail(error.message));
