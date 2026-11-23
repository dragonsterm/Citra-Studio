const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, Tray } = require("electron");
const { rename, unlink, writeFile } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { EngineBridge } = require("./bridge.cjs");
const catalog = require("../engine/methods.json");

const index = path.join(__dirname, "index.html");
const indexURL = pathToFileURL(index).href;
const iconPath = path.join(__dirname, "icon.ico");
const photoExtensions = ["png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"];
const availableMethods = new Set(catalog.flatMap((group) => group.methods.map((method) => method.id)));
const actionFlags = { "--pick-photo": "pick", "--start-webcam": "webcam", "--telemetry": "telemetry" };
const exportFormats = {
  ".png": { name: "PNG image", extensions: ["png"] },
  ".jpg": { name: "JPEG image", extensions: ["jpg", "jpeg"] },
  ".webp": { name: "WebP image", extensions: ["webp"] },
};

let window;
let tray;
let engine;
let quitting = false;
let jumpList = "Unavailable";
const actions = [];

function reveal() {
  if (!window) return;
  window.setSkipTaskbar(false);
  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();
}

function hideToTray() {
  if (!window) return;
  window.webContents.send("studio:action", "suspend");
  window.setSkipTaskbar(true);
  window.hide();
}

function postAction(action) {
  reveal();
  if (window?.webContents.isLoadingMainFrame()) actions.push(action);
  else window?.webContents.send("studio:action", action);
}

function acceptLaunch(argv) {
  const flag = argv.find((argument) => Object.hasOwn(actionFlags, argument));
  if (flag) {
    if (!window) actions.push(actionFlags[flag]);
    else postAction(actionFlags[flag]);
  } else {
    reveal();
  }
}

function setupWindowsActions() {
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("Citra Studio");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Citra Studio", click: reveal },
    { label: "Pick a photo…", click: () => postAction("pick") },
    { label: "Start webcam", click: () => postAction("webcam") },
    { label: "Show telemetry", click: () => postAction("telemetry") },
    { type: "separator" },
    { label: "Hide to tray", click: hideToTray },
    { label: "Exit Citra Studio", click: () => app.quit() },
  ]));
  tray.on("click", reveal);
  if (!app.isPackaged || process.platform !== "win32") return;

  // The portable wrapper is the stable path. The extracted app disappears on exit.
  const program = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  jumpList = app.setJumpList([{ type: "tasks", items: [
    { type: "task", title: "Pick a photo", program, args: "--pick-photo", iconPath: program, iconIndex: 0,
      description: "Open a local image in Citra Studio" },
    { type: "task", title: "Start webcam", program, args: "--start-webcam", iconPath: program, iconIndex: 0,
      description: "Start a live processing session" },
    { type: "task", title: "Show telemetry", program, args: "--telemetry", iconPath: program, iconIndex: 0,
      description: "Inspect the processing pipeline" },
  ] }]);
}

function configureSession() {
  const local = session.defaultSession;
  local.setPermissionCheckHandler((contents, permission, origin, details) =>
    contents === window?.webContents && contents.getURL() === indexURL &&
    permission === "media" && details.mediaType === "video");
  local.setPermissionRequestHandler((contents, permission, callback, details) => {
    const onlyVideo = details.mediaTypes?.length === 1 && details.mediaTypes[0] === "video";
    callback(contents === window?.webContents && contents.getURL() === indexURL &&
      details.isMainFrame && permission === "media" && onlyVideo);
  });
}

function createWindow() {
  window = new BrowserWindow({
    title: "Citra Studio",
    width: 1430,
    height: 900,
    minWidth: 760,
    minHeight: 570,
    frame: false,
    backgroundColor: "#151519",
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("did-finish-load", () => {
    for (const action of actions.splice(0)) window.webContents.send("studio:action", action);
  });
  window.on("ready-to-show", () => window.show());
  window.on("minimize", () => window.webContents.send("studio:action", "suspend"));
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideToTray();
  });
  for (const event of ["maximize", "unmaximize"]) {
    window.on(event, () => window.webContents.send("studio:window-state", window.isMaximized()));
  }
  window.on("closed", () => { window = null; });
  window.loadFile(index);
}

function handle(channel, action) {
  ipcMain.handle("studio:" + channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== indexURL ||
        event.senderFrame?.parent) {
      return { error: "Invalid window." };
    }
    try {
      const result = await action(...args);
      return { result };
    } catch (error) {
      return { error: String(error.message || error).slice(0, 400) };
    }
  });
}

function rendererReply(reply) {
  const { binary, ok, ...fields } = reply;
  if (binary) fields.data = new Uint8Array(binary);
  return fields;
}

function checkJob(job) {
  if (!job || !availableMethods.has(job.method) ||
      typeof job.id !== "string" || job.id.length > 32 ||
      typeof job.params !== "object" || !job.params || Array.isArray(job.params)) {
    throw new Error("Invalid result widget.");
  }
  return job;
}

function checkPhoto(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) ||
      !photoExtensions.includes(path.extname(file).slice(1).toLowerCase())) {
    throw new Error("Choose a PNG, JPEG, WebP, BMP or TIFF photo.");
  }
  return file;
}

function checkFrame(dimensions, bytes) {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > 1280 * 960 || !ArrayBuffer.isView(bytes) ||
      bytes.byteLength !== width * height * 4) {
    throw new Error("Invalid webcam frame.");
  }
  return { width, height };
}

function wire() {
  handle("catalog", () => catalog);
  handle("hello", async () => {
    const reply = rendererReply(await engine.request("hello"));
    return { ...reply, electron: process.versions.electron, jumpList };
  });

  handle("choose-photo", async (reference) => {
    const selection = await dialog.showOpenDialog(window, {
      title: reference ? "Choose reference photo" : "Pick a photo",
      properties: ["openFile"],
      filters: [{ name: "Photos", extensions: photoExtensions }],
    });
    if (selection.canceled) return null;
    return rendererReply(await engine.request(reference ? "reference" : "photo", { path: checkPhoto(selection.filePaths[0]) }));
  });
  handle("drop-photo", async (file) => rendererReply(await engine.request("photo", { path: checkPhoto(file) })));
  handle("sample", async () => rendererReply(await engine.request("sample")));
  handle("clear", async () => { await engine.request("clear"); });
  handle("clear-reference", async () => { await engine.request("clearReference"); });
  handle("snapshot", async (dimensions, bytes) => rendererReply(await engine.request("snapshot", checkFrame(dimensions, bytes), bytes)));

  handle("render", async (request, bytes) => {
    if (!Array.isArray(request.jobs) || request.jobs.length > 12) throw new Error("Use at most 12 result widgets.");
    const jobs = request.jobs.map(checkJob);
    const inspect = typeof request.inspect === "string" ? request.inspect.slice(0, 32) : null;
    const inspectMany = Array.isArray(request.inspectMany)
      ? request.inspectMany.slice(0, 13).filter((id) => id === "source" || jobs.some((job) => job.id === id))
      : [];
    const dimensions = bytes ? checkFrame(request, bytes) : {};
    return rendererReply(await engine.request("render", { jobs, inspect, inspectMany, ...dimensions }, bytes));
  });

  handle("export", async (job, filename) => {
    if (job) checkJob(job);
    const preferred = job?.method === "compression"
      ? ({ JPEG: ".jpg", PNG: ".png", WebP: ".webp" }[job.params.variant] || ".png")
      : ".png";
    const formats = job?.method === "lsb" ? [".png"] : [preferred, ...Object.keys(exportFormats).filter((ext) => ext !== preferred)];
    const name = String(filename).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 130);
    const selected = await dialog.showSaveDialog(window, {
      title: "Save result image",
      defaultPath: (name || "Citra Studio") + preferred,
      filters: formats.map((ext) => exportFormats[ext]),
    });
    if (selected.canceled || !selected.filePath) return null;
    let extension = path.extname(selected.filePath).toLowerCase();
    const output = extension ? selected.filePath : selected.filePath + preferred;
    extension = extension === ".jpeg" ? ".jpg" : (extension || preferred);
    if (!formats.includes(extension)) throw new Error("Choose one of the image formats in the save dialog.");
    const { binary, width, height } = await engine.request("export", { job, extension }, undefined, 90000);
    const temporary = path.join(path.dirname(output), ".citra-" + randomUUID() + ".tmp");
    try {
      await writeFile(temporary, binary, { flag: "wx" });
      await rename(temporary, output);
    } finally {
      await unlink(temporary).catch(() => {});
    }
    return { name: path.basename(output), width, height };
  });

  handle("window", (action) => {
    if (action === "minimize") window.minimize();
    if (action === "maximize") window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === "close") window.close();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("id.citra.studio");
  app.on("second-instance", (_, argv) => acceptLaunch(argv));
  acceptLaunch(process.argv);
  app.whenReady().then(() => {
    engine = new EngineBridge({ packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath });
    configureSession();
    wire();
    createWindow();
    setupWindowsActions();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    quitting = true;
    engine?.stop();
    tray?.destroy();
    tray = null;
  });
}
