"use strict";

const $ = (id) => document.getElementById(id);
const svgNS = "http://www.w3.org/2000/svg";

document.body.insertAdjacentHTML("afterbegin", `
<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><symbol id="i-logo" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.4" fill="currentColor" stroke="none"/><path d="m3.5 16 5-4.2 3.6 3.1 4-4.5 4.4 4.4"/></symbol>
<symbol id="i-workspace" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M10 9v11"/></symbol>
<symbol id="i-hash" viewBox="0 0 24 24"><path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16"/></symbol>
<symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="8.3" cy="9" r="1.3"/><path d="m3.5 16.5 4.5-4.1 4.2 3.6 3.8-4.5 4.5 4.3"/></symbol>
<symbol id="i-video" viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2.5"/><path d="m15 10 6-3v10l-6-3z"/></symbol>
<symbol id="i-stop" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24"><path d="M9 5v14m6-14v14" stroke-width="3"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24"><path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-camera" viewBox="0 0 24 24"><path d="M4 6h4l1.7-2h4.6L16 6h4a1.8 1.8 0 0 1 2 2v10a1.8 1.8 0 0 1-2 2H4a1.8 1.8 0 0 1-2-2V8a1.8 1.8 0 0 1 2-2Z"/><circle cx="12" cy="12.7" r="3.3"/></symbol>
<symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 4v16h18M7 16v-5m4 5V7m4 9v-3m4 3V5"/></symbol>
<symbol id="i-terminal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/></symbol>
<symbol id="i-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1.2-1.5 2.4m0 3h.01"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></symbol>
<symbol id="i-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></symbol>
<symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
<symbol id="i-minus" viewBox="0 0 24 24"><path d="M5 12h14"/></symbol>
<symbol id="i-maximize" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1"/></symbol>
<symbol id="i-restore" viewBox="0 0 24 24"><path d="M9 6V4h11v11h-2"/><rect x="4" y="8" width="12" height="12" rx="1"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></symbol>
<symbol id="i-panel" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></symbol>
<symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4m-6 2v4" stroke-width="3"/></symbol>
<symbol id="i-layers" viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5Zm9 9-9 5-9-5m18 4-9 5-9-5"/></symbol>
<symbol id="i-move" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18m-12-6 3-3 3 3m-6 12 3 3 3-3m-9-9-3 3 3 3m12-6 3 3-3 3"/></symbol>
<symbol id="i-palette" viewBox="0 0 24 24"><path d="M12 3c-5 0-9 3.5-9 8.8 0 4.2 3.2 8.4 8 8.4 1.5 0 2-.8 1.7-2-.5-1.8.9-2.5 2.6-2.4 3.6.1 5.7-2.1 5.7-5C21 6.1 16.7 3 12 3Z"/><path d="M7.5 11h.01M10 7.5h.01M14.2 7.2h.01m3.3 3h.01" stroke-width="2.8"/></symbol>
<symbol id="i-scan" viewBox="0 0 24 24"><path d="M3 9V4h5m8 0h5v5m0 6v5h-5m-8 0H3v-5m3-3h12"/></symbol>
<symbol id="i-wave" viewBox="0 0 24 24"><path d="M2 12h2.5l2.7-7 3.2 14 3.7-14 3 14 2.7-7H22"/></symbol>
<symbol id="i-activity" viewBox="0 0 24 24"><path d="M2 12h5l2.8-7 4.1 14 2.8-7H22"/></symbol>
<symbol id="i-archive" viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="13" rx="2"/><path d="M3 7h18V4H3zm6 5h6"/></symbol>
<symbol id="i-chip" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 3v3m6-3v3m-6 12v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/></symbol>
<symbol id="i-signal" viewBox="0 0 24 24"><path d="M4 19v-4m5 4v-7m5 7V8m5 11V4" stroke-width="2.5"/></symbol>
<symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v11m-4-4 4 4 4-4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></symbol>
<symbol id="i-dots" viewBox="0 0 24 24"><path d="M5 12h.01m7 0h.01m7 0h.01" stroke-width="3.4"/></symbol>
<symbol id="i-grip" viewBox="0 0 24 24"><path d="m8 19 11-11m-5 11 5-5m-11 0 6-6" stroke-width="1.5"/></symbol>
<symbol id="i-expand" viewBox="0 0 24 24"><path d="M9 4H4v5m11-5h5v5m0 6v5h-5M4 15v5h5"/></symbol>
<symbol id="i-collapse" viewBox="0 0 24 24"><path d="M4 9h5V4m11 5h-5V4m0 16v-5h5M9 20v-5H4"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></symbol>
<symbol id="i-warning" viewBox="0 0 24 24"><path d="M10.4 4.8a1.8 1.8 0 0 1 3.2 0l7.3 12.7a1.8 1.8 0 0 1-1.6 2.7H4.7a1.8 1.8 0 0 1-1.6-2.7zM12 9v4m0 3.3h.01"/></symbol>
<symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 18.5v-12A2 2 0 0 1 5 4.5h4.2l2.1 2.4H19a2 2 0 0 1 2 2v9.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z"/></symbol>
<symbol id="i-flask" viewBox="0 0 24 24"><path d="M10 3h4m-3 0v7l-5 7.5A2.1 2.1 0 0 0 7.8 21h8.4a2.1 2.1 0 0 0 1.8-3.5L13 10V3M8.6 15h6.8"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.3 3 7.6 7.5 9.5 4.5-1.9 7.5-5.2 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24"><path d="M19.5 9a7.7 7.7 0 1 0 .2 5m0-10v5h-5"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="m9 4 6 0m-5 0v5l-3 4v2h10v-2l-3-4V4m-2 11v6"/></symbol>
<symbol id="i-popout" viewBox="0 0 24 24"><path d="M13 4h7v7m0-7-9 9m-2-7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></symbol>
<symbol id="i-dock" viewBox="0 0 24 24"><path d="M5 12h14v7H5zM12 3v8m-3-3 3 3 3-3"/></symbol>
</svg>
`);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}

function icon(name) {
  const svg = svgNode("svg", { class: "icon", "aria-hidden": "true" });
  svg.append(svgNode("use", { href: "#i-" + name }));
  return svg;
}

function button(name, title, className = "icon-button") {
  const node = element("button", className);
  node.type = "button";
  node.title = title;
  node.setAttribute("aria-label", title);
  node.append(icon(name));
  return node;
}

function replaceIcon(node, name, label) {
  node.querySelector("use").setAttribute("href", "#i-" + name);
  if (label) {
    node.title = label;
    node.setAttribute("aria-label", label);
  }
}

function dimensionsText(object) {
  return object?.width && object?.height ? object.width + " × " + object.height : "—";
}

function chartBase(height, labels, description) {
  const svg = svgNode("svg", { viewBox: "0 0 248 " + height, role: "img", "aria-label": description });
  const bottom = height - 20;
  const left = 10, right = 238, top = 8;
  const guides = svgNode("g", { stroke: "#30303b", "stroke-width": ".65" });
  for (let i = 0; i < 5; i++) {
    const x = left + (right - left) * i / 4;
    guides.append(svgNode("path", { d: "M" + x + " " + top + "V" + bottom }));
  }
  for (let i = 0; i < 4; i++) {
    const y = top + (bottom - top) * i / 3;
    guides.append(svgNode("path", { d: "M" + left + " " + y + "H" + right }));
  }
  svg.append(guides);
  for (const [index, value] of labels.entries()) {
    const x = left + (right - left) * index / (labels.length - 1);
    const text = svgNode("text", { x, y: height - 6, fill: "#a5a5b2", "font-size": 8.5,
      "font-family": "Consolas,monospace", "text-anchor": index === 0 ? "start" : index === labels.length - 1 ? "end" : "middle" });
    text.textContent = value;
    svg.append(text);
  }
  return { svg, top, left, right, bottom };
}

function plotLine(graph, values, maximum, color, area = false) {
  const { svg, top, left, right, bottom } = graph;
  if (!values.length) return;
  const points = values.map((value, index) => {
    const x = left + (right - left) * (values.length === 1 ? 1 : index / (values.length - 1));
    const y = bottom - (bottom - top) * Math.min(1, value / maximum);
    return [x.toFixed(2), y.toFixed(2)];
  });
  const line = "M" + points.map((point) => point.join(" ")).join("L");
  if (area) svg.append(svgNode("path", { d: line + "L" + points.at(-1)[0] + " " + bottom +
    "L" + points[0][0] + " " + bottom + "Z", fill: color, "fill-opacity": ".19" }));
  if (points.length === 1) {
    svg.append(svgNode("circle", { cx: points[0][0], cy: points[0][1], r: 2.2, fill: color }));
  } else {
    svg.append(svgNode("path", { d: line, fill: "none", stroke: color, "stroke-width": "1.3", "stroke-linejoin": "round" }));
  }
}

function emptyChart(graph, message) {
  const text = svgNode("text", { x: 124, y: (graph.top + graph.bottom) / 2 + 3, "text-anchor": "middle",
    fill: "#a5a5b6", "font-size": 9, "font-family": "Consolas,monospace" });
  text.textContent = message;
  graph.svg.append(text);
}
