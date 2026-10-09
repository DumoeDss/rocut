import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { resolveProgrammaticFrameJson } from "opencut-wasm";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { loadProgrammaticResources } from "../../apps/cli/src/programmatic/resources";
import { resolveHtmlDocumentCode } from "../../apps/cli/src/programmatic/document-resource";
import { htmlCaptureExpression } from "../../apps/cli/src/programmatic/html-document";
import { hyperframesMediaCases } from "./hyperframes-media-cases";

const [specPath, toolchainDirectory, control] = process.argv.slice(2);
if (control && !["--preview-control", "--rounding-control"].includes(control)) throw Error("Unknown diagnostic control");
if (!specPath || !toolchainDirectory) throw Error("Expected media compile spec and isolated toolchain");
const root = await mkdtemp(join(tmpdir(), "rocut-hf-media-diagnostic-"));
const context = { store: new FileProjectStore({ root: join(root, "project"), schemaVersion: 1 }), projectId: "diagnostic" };
const signal = new AbortController().signal;
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const browser = await chromium.launch({ headless: true });
try {
	const input = JSON.parse(await readFile(specPath, "utf8"));
	for (const [entryFile, cases] of Object.entries(hyperframesMediaCases)) {
	if (entryFile === "media-resource.html") continue; // Attachment bridge is exercised through the Host browser probe.
	if (control && entryFile !== "media.html") continue;
	const { source } = await compileProgrammaticProject({ action: "compile", input: { ...input, entryFile }, context, toolchainDirectory, signal, enqueue: task => task() });
	const resources = await loadProgrammaticResources(context, source.resources!, signal);
	let code = resolveHtmlDocumentCode(source, resources);
	if (control === "--preview-control") {
		const gate = /\.forceSync&&([\w$]+)>0\b/g;
		if ([...code.matchAll(gate)].length !== 1) throw Error("Preview negative-control seam changed");
		code = code.replace(gate, ".forceSync&&$1>.02");
	} else if (control === "--rounding-control") {
		const decoder = /Math\.round\(([\w$]+)\*1e6\)\/1e6/g;
		if ([...code.matchAll(decoder)].length !== 2) throw Error("Decoder negative-control seam changed");
		code = code.replace(decoder, "$1");
	}
	for (const [index, bottom] of cases) {
		if (control && index !== (control === "--preview-control" ? 1 : 18)) continue;
		const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
		try {
			const request = { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: index * 1200 };
			const { frame } = JSON.parse(resolveProgrammaticFrameJson(JSON.stringify(request)));
			await page.evaluate(htmlCaptureExpression(code, frame, resources));
			const png = await page.screenshot({ omitBackground: true });
			const actual = await page.evaluate(async (base64: string) => {
				const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
				const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
				const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
				ctx.drawImage(bitmap, 0, 0); bitmap.close();
				return [0, 32].map(top => {
					let value = 0;
					for (let bit = 0; bit < 6; bit++) {
						const rgba = [...ctx.getImageData(bit * 8 + 4, top + 8, 1, 1).data];
						if (rgba[3] === 0) return null;
						if (rgba[3] < 250 || rgba.slice(0, 3).some(v => v > 25 && v < 230)) throw Error(`Ambiguous source marker ${rgba}`);
						if (rgba[0] >= 230) value |= 1 << bit;
					}
					return value;
				});
			}, png.toString("base64"));
			const expected = control === "--preview-control" ? [null, 0] : control === "--rounding-control" ? [7, 18]
				: [index >= 17 && index < 37 ? 6 + (index - 17) * 2 : null, bottom];
			if (JSON.stringify(actual) !== JSON.stringify(expected)) {
				const media = await page.frames()[1].evaluate(() => [...document.querySelectorAll("video")].map(v => ({
					id: v.id, time: v.currentTime, duration: v.duration, ready: v.readyState,
					start: v.dataset.start, rate: v.dataset.playbackRate, visible: getComputedStyle(v).visibility,
				})));
				throw Error(JSON.stringify({ index, actual, expected, media }));
			}
			console.log(`HyperFrames ${control ?? entryFile} frame ${index}: ${JSON.stringify(actual)}`);
		} finally { await page.close(); }
	}
	}
} finally {
	await browser.close();
	if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("rocut-hf-media-diagnostic-")) throw Error("Unsafe fixture cleanup");
	await rm(root, { recursive: true, force: true });
}
