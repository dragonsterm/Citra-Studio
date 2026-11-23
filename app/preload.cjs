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
  save: (job, name) => ask("export", job, name),
  window: (action) => ask("window", action),
  onAction: (callback) => watch("action", callback),
  onWindowState: (callback) => watch("window-state", callback),
});
