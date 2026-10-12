const fs = require("node:fs");
const path = require("node:path");
// Diagnostic writes are authorized only by the runner's already validated root.
// This marker precedes Electron require, argument checks and shared helper load.
const bootRoot = process.env.ROCUT_WHOLEGRAPH_BOOT_ROOT;
const normalized = value => path.resolve(value).toLowerCase();
if (!bootRoot || !path.isAbsolute(bootRoot) ||
    !["C:/tmps", "E:/AI/ChatAI/Agents/VibeCodingProjects/elftia/elftia/elftia/.artifacts"].some(parent => normalized(path.dirname(bootRoot)) === normalized(parent)) ||
    !/^electron-wholegraph-png-[a-zA-Z0-9._-]+$/.test(path.basename(bootRoot))) throw Error("Private boot diagnostic root required");
const bootStat = fs.lstatSync(bootRoot);
if (!bootStat.isDirectory() || bootStat.isSymbolicLink() || normalized(fs.realpathSync.native(bootRoot)) !== normalized(bootRoot)) throw Error("Private boot diagnostic root redirected");
fs.writeFileSync(path.join(bootRoot, "early-entry.json"), JSON.stringify({ reached: true, stage: "before-electron-require", argumentCount: process.argv.length, cwdIsPrivateRoot: normalized(process.cwd()) === normalized(bootRoot) }), { flag: "wx" });
const failEarly = error => {
  const text = String(error?.stack ?? error).replace(/https?:\/\/\S+/g, "[URL]").split(/\r?\n/).slice(0, 12).join("\n");
  try { fs.writeFileSync(path.join(bootRoot, "startup-failure.json"), JSON.stringify({ failure: text }), { flag: "wx" }); } catch { /* preserve first failure */ }
  process.exit(1);
};
process.on("uncaughtException", failEarly);
process.on("unhandledRejection", failEarly);
const { app, BrowserWindow } = require("electron");
const { privateWholegraphOutputRoot } = require("./electron-wholegraph-png-output-root.cjs");
const [url, root, mode] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) throw Error("Private local fixture only");
privateWholegraphOutputRoot(root);
fs.writeFileSync(path.join(root, "main-entry.json"), JSON.stringify({ reached: true, cwd: process.cwd(), profile: path.join(root, "profile"), relatedKeyPresence: Object.fromEntries(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "TEMP", "TMP", "TMPDIR"].map(name => [name, Object.keys(process.env).some(key => key.toUpperCase() === name)])) }), { flag: "wx" });
app.setPath("userData", path.join(root, "profile"));
app.setPath("sessionData", path.join(root, "session"));
app.setPath("logs", path.join(root, "logs"));
app.commandLine.appendSwitch("disable-webgpu");
app.commandLine.appendSwitch("use-angle", "swiftshader");
app.commandLine.appendSwitch("enable-unsafe-swiftshader");
app.commandLine.appendSwitch("no-proxy-server");
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 128, height: 128, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  if (mode === "--standalone") {
    const report = { ok: false, host: { versions: process.versions, windows: [{ visible: window.isVisible(), sandbox: window.webContents.getLastWebPreferences().sandbox, nodeIntegration: window.webContents.getLastWebPreferences().nodeIntegration }], profile: app.getPath("userData") }, externalRequests: [], errors: [] };
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fs.writeFileSync(path.join(root, "standalone-result.json"), JSON.stringify(report), { flag: "wx" });
      window.destroy();
      app.exit(code);
    };
    const deadline = setTimeout(() => { report.failure = "Standalone main absolute deadline30s"; finish(2); }, 30000);
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      const forbidden = /^https?:/.test(details.url) && !details.url.startsWith(url);
      if (forbidden) report.externalRequests.push(new URL(details.url).origin);
      callback({ cancel: forbidden });
    });
    try {
      await window.loadURL(url);
      report.result = await window.webContents.executeJavaScript(`(async()=>{const end=Date.now()+25000;while(typeof globalThis.run!=='function'){if(Date.now()>end)throw Error('Standalone run readiness deadline');await new Promise(r=>setTimeout(r,25));}return await globalThis.run();})()`);
      report.ok = report.result.cleanup.gpuDisposed && Object.values(report.result.controls).every(Boolean) && !report.externalRequests.length;
      finish(report.ok ? 0 : 1);
    } catch (error) { report.failure = String(error.stack ?? error); finish(1); }
    return;
  }
  await window.loadURL(url);
});
app.on("window-all-closed", () => app.quit());
