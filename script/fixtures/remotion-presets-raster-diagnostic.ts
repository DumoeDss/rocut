import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as wasm from "opencut-wasm";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import { resolveHtmlDocumentCode } from "../../apps/cli/src/programmatic/document-resource";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { FileProjectStore } from "../../apps/cli/src/file-store";

const [root, id, toolchainDirectory] = process.argv.slice(2);
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const specification = JSON.parse(await readFile(join(root, id, "rocut-compile.json"), "utf8"));
const context = { store: new FileProjectStore({ root: join(root, "store"), schemaVersion: 1 }), projectId: "remotion-preset-probe" };
const signal = AbortSignal.timeout(120000);
const source = (await compileProgrammaticProject({ action: "compile", input: specification, toolchainDirectory,
  context, signal, enqueue: task => task() })).source;
const resources = await loadProgrammaticResources(context, source.resources ?? [], signal);
const code = resolveHtmlDocumentCode(source, resources);
const decode = (png: Buffer) => execFileSync(process.env.ROCUT_TEST_FFMPEG!, ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
  { input: png, windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
function compare(a: Buffer, b: Buffer) {
  let max = 0, alphaMax = 0, sum = 0, changed = 0, aboveTwo = 0;
  for (let i = 0; i < a.length; i += 4) {
    alphaMax = Math.max(alphaMax, Math.abs(a[i + 3] - b[i + 3]));
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i + c] * a[i + 3] / 255 - b[i + c] * b[i + 3] / 255);
      max = Math.max(max, delta); sum += delta; if (delta > 0) changed++; if (delta > 2) aboveTwo++;
    }
  }
  return { bitExact: a.equals(b), max, alphaMax, mean: sum / (a.length / 4 * 3), changed, aboveTwo };
}
const records = [];
const modes = process.env.ROCUT_RASTER_MODE ? [process.env.ROCUT_RASTER_MODE] : ["default", "software"];
for (const mode of modes) {
  if (!["default", "software", "raster-only"].includes(mode)) throw Error("Unknown diagnostic raster mode");
  const snapshots: Buffer[] = [];
  for (let processIndex = 0; processIndex < 2; processIndex++) {
    const profile = await mkdtemp(join(root, id, "diagnostic-profile-"));
    // Match production's full Chrome executable and launch flags. Only the CDP
    // transport is a pipe for Playwright; no hidden Playwright default flags.
    const browser = await chromium.launch({ executablePath: chromium.executablePath(), ignoreDefaultArgs: true,
      args: ["--headless=new", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run",
        "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update",
        "--disable-sync", "--disable-default-apps", "--mute-audio",
        ...(mode === "software" ? ["--disable-gpu", "--disable-gpu-rasterization"]
          : mode === "raster-only" ? ["--disable-gpu-rasterization"] : []), "about:blank"] });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const page = await browser.newPage();
        try {
          const session = await page.context().newCDPSession(page);
          await session.send("Network.enable"); await session.send("Page.enable");
          await session.send("Network.setBlockedURLs", { urls: ["http://*", "https://*", "file://*", "ftp://*", "ws://*", "wss://*"] });
          await session.send("Emulation.setDeviceMetricsOverride", { width: source.width, height: source.height, deviceScaleFactor: 1, mobile: false });
          await session.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
          const mapped = JSON.parse(wasm.resolveProgrammaticFrameJson(JSON.stringify({ source, clipStart: 0, clipDuration: source.durationFrames * 4000, trimStart: 0, timelineTime: 0 })));
          const result = await session.send("Runtime.evaluate", { expression: htmlCaptureExpression(code, mapped.frame, resources), awaitPromise: true, returnByValue: true });
          if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
          await session.send("Page.getLayoutMetrics");
          const png = await session.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
          const bytes = Buffer.from(png.data, "base64"); snapshots.push(decode(bytes));
          await writeFile(join(root, id, "frames", `diagnostic-${mode}-${processIndex}-${attempt}.png`), bytes);
        } finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
  const record = { id, mode, sameProcessA: compare(snapshots[0], snapshots[1]), sameProcessB: compare(snapshots[2], snapshots[3]), acrossProcesses: compare(snapshots[0], snapshots[2]) };
  records.push(record); console.log(JSON.stringify(record));
}
await writeFile(join(root, id, `raster-diagnostic${process.env.ROCUT_RASTER_MODE ? "-" + process.env.ROCUT_RASTER_MODE : ""}.json`), JSON.stringify(records, null, 2));
