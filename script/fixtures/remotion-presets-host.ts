import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

const [scaffold, toolchainDirectory, styleToolchainDirectory, assetDirectory, root] = process.argv.slice(2);
if (![scaffold, toolchainDirectory, styleToolchainDirectory, assetDirectory, root].every(Boolean)) throw Error("Provide scaffold, engine toolchain, style toolchain, default assets and output paths");
const { stageRocutPreset } = await import(pathToFileURL(join(scaffold, "scripts/stage-rocut-preset.mjs")).href);
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const dataUrl = async (file: string, mime: string) => `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
const cover = await dataUrl(join(assetDirectory, "cover.jpg"), "image/jpeg");
const texture = await dataUrl(join(assetDirectory, "stardust.png"), "image/png");
await writeFile(join(root, "asset-provenance.json"), JSON.stringify({
  cover: { originalUrl: "https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?q=80&w=400&auto=format&fit=crop",
    sha256: createHash("sha256").update(await readFile(join(assetDirectory, "cover.jpg"))).digest("hex") },
  texture: { originalUrl: "https://www.transparenttextures.com/patterns/stardust.png",
    sha256: createHash("sha256").update(await readFile(join(assetDirectory, "stardust.png"))).digest("hex") },
  gallery: "Original bundled WeChat reference PNGs, supplied through VerticalTicker's existing columns props",
}, null, 2));
const gallery = await Promise.all(["1x1", "3x4", "4x3"].map(name => dataUrl(join(scaffold, "src/compositions/vendored-wechat/reference", name + ".png"), "image/png")));
const cases: [string, Record<string, unknown>][] = [
  ["ClaudeTyper", {}], ["ProceduralFish", {}], ["RulerProgress", {}],
  ["VerticalTicker", { columns: [{ items: gallery, durationInSeconds: 10, direction: -1 }, { items: [...gallery].reverse(), durationInSeconds: 8, direction: 1 }] }],
  ["VinylPlayer", { coverUrl: cover, textureUrl: texture }], ["WeChatChat", {}],
];
const context = { store: new FileProjectStore({ root: join(root, "store"), schemaVersion: 1 }), projectId: "remotion-preset-probe" };
const results: { id: string; source: ProgrammaticSource; firstFrame: number; randomFrames: number[]; hashes: string[];
  archiveRebuilt: boolean; repeatPixelsExact: boolean; rebuiltPixelsExact: boolean }[] = [];
const errors: { id: string; error: string }[] = [];
const pixelHash = (png: Buffer) => {
  const pixels = execFileSync(process.env.ROCUT_TEST_FFMPEG!, ["-v", "error", "-f", "image2pipe", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { input: png, windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
  return createHash("sha256").update(pixels).digest("hex");
};
for (const [id, inputProps] of cases) {
  if (process.env.ROCUT_TEST_PRESETS && !process.env.ROCUT_TEST_PRESETS.split(",").includes(id)) continue;
  try {
    const outputDirectory = join(root, id);
    const { specification } = await stageRocutPreset({ outputDirectory, compositionId: id, inputProps, toolchainDirectory, styleToolchainDirectory });
    const compile = (action: "compile" | "rebuild", input: unknown) => compileProgrammaticProject({ action, input,
      toolchainDirectory, context, signal: AbortSignal.timeout(60000), enqueue: task => task() });
    const source = (await compile("compile", specification)).source;
    const pngDirectory = join(outputDirectory, "frames"); await mkdir(pngDirectory);
    const firstFrame = Math.floor(source.durationFrames / 2), randomFrames = [source.durationFrames - 1, 0, firstFrame, 0];
    const hashes: string[] = [];
    const render = (input: ProgrammaticSource, frame: number) => renderHtmlPng({ executable: chromium.executablePath(),
      resourceStore: context, signal: AbortSignal.timeout(25000), request: { source: input, clipStart: 0,
        clipDuration: input.durationFrames * 4000, trimStart: 0, timelineTime: frame * 4000 } });
    for (const frame of [...randomFrames, firstFrame + 1, firstFrame + 2]) {
      const png = await render(source, frame);
      assert.equal(png.readUInt32BE(16), source.width); assert.equal(png.readUInt32BE(20), source.height);
      hashes.push(pixelHash(png));
      await writeFile(join(pngDirectory, `attempt-${hashes.length}-${frame}.png`), png);
      await writeFile(join(pngDirectory, `${frame}.png`), png);
    }
    const repeatPixelsExact = hashes[1] === hashes[3];
    if (!repeatPixelsExact) errors.push({ id, error: "Random/reverse frame 0 pixels differ; inspect retained attempts (not accepted as bit-exact)" });
    assert.notEqual(hashes[0], hashes[1], `${id}: end/start picture did not change`);
    await rename(specification.sourceDirectory, join(outputDirectory, "author-moved"));
    const rebuilt = await compile("rebuild", JSON.parse(JSON.stringify(source)));
    assert.equal(rebuilt.reusedDocument, true);
    const rebuiltPng = await render(rebuilt.source, firstFrame);
    await writeFile(join(pngDirectory, `rebuilt-${firstFrame}.png`), rebuiltPng);
    const rebuiltPixelsExact = pixelHash(rebuiltPng) === hashes[2];
    if (!rebuiltPixelsExact) errors.push({ id, error: "Archive rebuild pixels differ; inspect retained rebuilt PNG (not accepted as bit-exact)" });
    results.push({ id, source, firstFrame, randomFrames, hashes, archiveRebuilt: true, repeatPixelsExact, rebuiltPixelsExact });
    console.log(JSON.stringify({ preset: id, compile: true, randomFrames, archiveRebuilt: true, nativePng: true, repeatPixelsExact, rebuiltPixelsExact }));
  } catch (error) {
    errors.push({ id, error: String(error) }); console.log(JSON.stringify({ preset: id, error: String(error) }));
  }
}
await writeFile(join(root, "native-results.json"), JSON.stringify({ results, errors }, null, 2));
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/api/presets") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(results)); return; }
    const match = /^\/api\/frames\/([A-Za-z]+)\/(\d+)\.png$/.exec(request.url ?? "");
    if (match && results.some(result => result.id === match[1])) {
      const png = await readFile(join(root, match[1], "frames", match[2] + ".png"));
      response.setHeader("content-type", "image/png"); response.end(png); return;
    }
    response.writeHead(404).end();
  } catch (error) { response.writeHead(500).end(String(error)); }
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address(); if (!address || typeof address === "string") throw Error("No preset probe address");
console.log(JSON.stringify({ endpoint: `http://127.0.0.1:${address.port}`, nativeRendered: results.length, errors }));
await new Promise<void>(done => { process.stdin.once("data", () => done()); process.stdin.once("end", done); process.stdin.resume(); });
process.stdin.pause(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
if (errors.length) process.exitCode = 1;
