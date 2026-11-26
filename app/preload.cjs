const { contextBridge, ipcRenderer, webUtils } = require("electron");

async function ask(channel, ...args) {
  const { result, error } = await ipcRenderer.invoke("studio:" + channel, ...args);
  if (error) throw new Error(error);
  return result;
}

function watch(channel, callback) {
  const listener = (_, value) => callback(value);
  ipcRenderer.on("studio:" + channel, listener);
  return () => ipcRenderer.removeListener("studio:" + channel, listener);
}

if (window.location.pathname.endsWith("/comparison.html")) {
  contextBridge.exposeInMainWorld("compareWindow", {
    initial: () => ask("compare-initial"),
    dock: (settings) => ask("compare-dock", settings),
    inspect: (id) => ask("compare-inspect", id),
    changeSettings: (settings) => ipcRenderer.send("studio:compare-settings", settings),
    onData: (callback) => watch("compare-data", callback),
  });
} else {
  contextBridge.exposeInMainWorld("studio", {
    catalog: () => ask("catalog"),
    hello: () => ask("hello"),
    choosePhoto: () => ask("choose-photo", false),
    chooseReference: () => ask("choose-photo", true),
    clearReference: () => ask("clear-reference"),
    dropPhoto: (file) => {
      const filePath = webUtils.getPathForFile(file);
      return ask("drop-photo", filePath);
    },
    sample: () => ask("sample"),
    clear: () => ask("clear"),
    snapshot: (dimensions, data) => ask("snapshot", dimensions, data),
    render: (request, bytes) => ask("render", request, bytes),
    save: (request, name) => ask("export", request, name),
    window: (action) => ask("window", action),
    onAction: (callback) => watch("action", callback),
    onWindowState: (callback) => watch("window-state", callback),
    popOutComparison: (data, settings) => ask("compare-popout", data, settings),
    focusComparison: () => ask("compare-focus"),
    sendComparisonData: (data) => ipcRenderer.send("studio:compare-data", data),
    onComparisonSampling: (callback) => watch("compare-sampling", callback),
    onComparisonReturn: (callback) => watch("compare-return", callback),
    onComparisonInspect: (callback) => watch("compare-inspect", callback),
  });
}
