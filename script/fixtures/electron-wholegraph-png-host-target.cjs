const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

/** This seam never discovers/reuses an existing page or touches its WASM globals. */
async function executeIsolatedHostTarget({ electron, url, gpuLeaseConfirmed, timeoutMs = 60000 }) {
  assert.equal(gpuLeaseConfirmed, true, "Explicit Root GPU/UI lock required");
  assert(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url), "Private loopback fixture only");
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
  const { BrowserWindow, session } = electron;
  const originalWindows = BrowserWindow.getAllWindows();
  const originalIds = originalWindows.map(w => w.id);
  const partition = "rocut-wholegraph-selected-" + randomUUID();
  const ownSession = session.fromPartition(partition, { cache: false });
  assert.notEqual(ownSession, session.defaultSession, "Default Host session forbidden");
  assert.equal(ownSession.getStoragePath(), null, "Persistent session forbidden");
  const report = { ok: false, errors: [], externalRequests: [], target: { partition, persistent: false }, cleanup: {} };
  const origin = new URL(url).origin;
  let window, timer, operation;
  try {
    ownSession.webRequest.onBeforeRequest((details, callback) => {
      const u = new URL(details.url);
      const allowed = u.origin === origin || u.protocol === "data:" || u.protocol === "blob:";
      if (!allowed) report.externalRequests.push(u.protocol === "http:" || u.protocol === "https:" ? u.origin : u.protocol);
      callback({ cancel: !allowed });
    });
    window = new BrowserWindow({ show: false, width: 128, height: 128, webPreferences: {
      session: ownSession, sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, webSecurity: true, devTools: false,
    } });
    const wc = window.webContents, prefs = wc.getLastWebPreferences();
    assert.equal(wc.session, ownSession);
    assert.equal(window.isVisible(), false);
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    assert(!prefs.preload, "Host preload must not enter the fixture");
    assert(!originalIds.includes(window.id), "New webContents required");
    report.target.windowId = window.id; report.target.webContentsId = wc.id;
    report.target.sandbox = prefs.sandbox; report.target.contextIsolation = prefs.contextIsolation;
    report.target.nodeIntegration = prefs.nodeIntegration;
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, destination) => { if (destination !== url) event.preventDefault(); });
    wc.on("render-process-gone", (_event, details) => report.errors.push("owned-renderer-gone:" + details.reason));
    operation = (async () => {
      await window.loadURL(url);
      return wc.executeJavaScript(`(async()=>{
        if (typeof process !== 'undefined' || typeof require !== 'undefined') throw Error('Fixture sandbox boundary failed');
        const end=Date.now()+25000;
        while(typeof globalThis.run!=='function'){if(Date.now()>end)throw Error('Isolated fixture readiness deadline');await new Promise(r=>setTimeout(r,25));}
        try { return { fixtureResult: await globalThis.run(), backendPolicy: globalThis.fixtureBackendPolicy }; }
        catch(error) { return { fixtureFailure: String(error?.stack ?? error), backendPolicy: globalThis.fixtureBackendPolicy }; }
      })()`);
    })();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Owned Host target deadline")), timeoutMs); });
    const outcome = await Promise.race([operation, deadline]);
    report.backendPolicy = outcome.backendPolicy;
    if (outcome.fixtureFailure) throw Error(outcome.fixtureFailure);
    report.result = outcome.fixtureResult;
    assert.equal(report.backendPolicy.semantics, "fallback-capability-limited");
    assert(report.backendPolicy.getterCalls > 0, "GPU capability filter must actually execute");
    report.ok = report.result.cleanup.gpuDisposed === true && Object.values(report.result.controls).every(v => v === true) && !report.errors.length && !report.externalRequests.length;
  } catch (error) { report.failure = String(error?.stack ?? error).replace(/https?:\/\/\S+/g, "[URL]"); }
  finally {
    clearTimeout(timer);
    if (window) {
      try { if (!window.isDestroyed()) window.destroy(); report.cleanup.ownedWindowDestroyed = window.isDestroyed(); }
      catch (e) { report.errors.push("owned-window-cleanup:" + String(e)); }
    }
    if (operation) {
      let drainTimer;
      report.cleanup.executionDrained = await Promise.race([
        operation.then(() => true, () => true),
        new Promise(resolve => { drainTimer = setTimeout(() => resolve(false), 2000); }),
      ]);
      clearTimeout(drainTimer);
    }
    try {
      await ownSession.closeAllConnections(); await ownSession.clearStorageData(); await ownSession.clearCache();
      report.cleanup.privateSessionCleared = true;
    } catch (e) { report.errors.push("owned-session-cleanup:" + String(e)); }
    try { ownSession.webRequest.onBeforeRequest(null); report.cleanup.privateInterceptorRemoved = true; }
    catch (e) { report.errors.push("owned-interceptor-cleanup:" + String(e)); }
    const after = BrowserWindow.getAllWindows();
    report.cleanup.originalWindowsUnchanged = originalWindows.every(w => after.includes(w) && !w.isDestroyed());
    report.cleanup.ownedWindowAbsent = !window || !after.includes(window);
    report.cleanup.originalWindowIds = originalIds;
    report.ok = report.ok && report.cleanup.ownedWindowDestroyed === true && report.cleanup.executionDrained === true &&
      report.cleanup.privateSessionCleared === true && report.cleanup.originalWindowsUnchanged === true && report.cleanup.ownedWindowAbsent === true && !report.errors.length;
  }
  return report;
}
module.exports = { executeIsolatedHostTarget };
