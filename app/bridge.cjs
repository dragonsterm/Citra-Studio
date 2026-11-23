const { spawn } = require("node:child_process");
const path = require("node:path");

const MAX_RESPONSE = 128 * 1024 * 1024;

class EngineBridge {
  constructor({ packaged, appPath, resourcesPath }) {
    this.command = packaged
      ? path.join(resourcesPath, "engine", "citra-engine.exe")
      : path.join(appPath, ".build", "venv", "Scripts", "python.exe");
    this.args = packaged ? [] : ["-u", path.join(appPath, "engine", "worker.py")];
    this.process = null;
    this.pending = null;
    this.lastError = "";
  }

  start() {
    if (this.process) return this.process;
    this.lastError = "";
    const child = spawn(this.command, this.args, {
      cwd: path.dirname(this.command),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
    });
    this.process = child;
    let lengths;
    let metadata;

    const fail = (message) => {
      if (this.process !== child) return;
      const suffix = this.lastError.trim().split(/\r?\n/).at(-1);
      this.stop(suffix ? message + " " + suffix : message);
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => { this.lastError = (this.lastError + text).slice(-2000); });
    child.on("error", (error) => fail(error.code === "ENOENT"
      ? "The Python engine is missing. Run the project build script."
      : "The Python engine could not start."));
    child.on("exit", (code) => fail("The Python engine stopped (" + (code ?? "interrupted") + "). Open the source again."));
    child.stdin.on("error", () => fail("The engine connection closed. Open the source again."));

    child.stdout.on("readable", () => {
      if (this.process !== child) return;
      try {
        if (!lengths) {
          const header = child.stdout.read(8);
          if (!header) return;
          lengths = [header.readUInt32LE(0), header.readUInt32LE(4)];
          if (!lengths[0] || lengths[0] > 512 * 1024 || lengths[1] > MAX_RESPONSE) {
            throw new Error("Invalid engine response size.");
          }
        }
        if (!metadata) {
          const json = child.stdout.read(lengths[0]);
          if (!json) return;
          metadata = JSON.parse(json.toString("utf8"));
        }
        const binary = lengths[1] ? child.stdout.read(lengths[1]) : null;
        if (lengths[1] && !binary) return;
        const reply = metadata;
        lengths = metadata = null;
        this.finish(reply.ok ? null : new Error(reply.error), { ...reply, binary });
      } catch (error) {
        fail(error.message);
      }
    });
    return child;
  }

  request(command, fields = {}, bytes, timeout = 30000) {
    if (this.pending) return Promise.reject(new Error("The engine is finishing another request."));
    const process = this.start();
    const json = Buffer.from(JSON.stringify({ command, ...fields }));
    const binary = bytes ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(json.length);
    header.writeUInt32LE(binary?.length ?? 0, 4);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop("The engine timed out. Open the source again."), timeout);
      this.pending = { resolve, reject, timer };
      process.stdin.cork();
      try {
        process.stdin.write(header);
        process.stdin.write(json);
        if (binary) process.stdin.write(binary);
      } catch (error) {
        this.stop(error.message);
      } finally {
        process.stdin.uncork();
      }
    });
  }

  finish(error, reply) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(reply);
  }

  stop(message = "The engine is closing.") {
    const child = this.process;
    this.process = null;
    this.finish(new Error(message));
    child?.stdin.destroy();
    child?.kill();
  }
}

module.exports = { EngineBridge };
