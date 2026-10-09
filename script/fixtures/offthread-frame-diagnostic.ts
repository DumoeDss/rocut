import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { renderHtmlPng } from "../../apps/cli/src/programmatic/html-rasterizer";
import { runVideoDecoderProcess } from "../../apps/cli/src/programmatic/video-decoder-process";
import { prepareRemotionProbe } from "./prepare-remotion-probe";

const toolchainDirectory = process.argv[2], ffmpeg = process.env.ROCUT_TEST_FFMPEG, ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (!toolchainDirectory || !ffmpeg || !ffprobe) throw Error("Expected isolated toolchain and explicit native decoder test paths");
const root = await mkdtemp(join(tmpdir(), "rocut-offthread-probe-"));
const require = createRequire(new URL("../../apps/vite-example/package.json", import.meta.url));
const { chromium } = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const context = { store: new FileProjectStore({ root: join(root, "target"), schemaVersion: 1 }), projectId: "offthread" };
try {
	const spec = await prepareRemotionProbe(join(root, "author"));
	const compile = async (mode: string) => (await compileProgrammaticProject({
		action: "compile", input: { ...spec, inputProps: { mode } }, toolchainDirectory, context,
		signal: new AbortController().signal, enqueue: task => task(),
	})).source;
	const source = await compile("offthread-video");
	const render = (input = source, index = 23, native = true) => renderHtmlPng({
		executable: chromium.executablePath(), resourceStore: context, signal: AbortSignal.timeout(15000),
		nativeVideoDecoder: native ? { ffmpeg, ffprobe } : undefined,
		request: { source: input, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: index * 4000 },
	});
	const readMarkers = async (png: Buffer) => {
		const file = join(root, "frame.png");
		await writeFile(file, png);
		const raw = await runVideoDecoderProcess({ executable: ffmpeg, signal: AbortSignal.timeout(8000), maxBytes: 64 * 64 * 4,
			args: ["-v", "error", "-nostdin", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"] });
		return [0, 32].map(top => {
			let frame = 0;
			for (let bit = 0; bit < 6; bit++) {
				const offset = ((top + 8) * 64 + bit * 8 + 4) * 4;
				if (!raw[offset + 3]) return null;
				if (raw[offset] > 230) frame |= 1 << bit;
			}
			return frame;
		});
	};
	for (const index of [23, 5, 6, 24, 25, 4, 0, 8, 15, 16, 23]) {
		const actual = await readMarkers(await render(source, index));
		const expected = [index >= 5 && index < 25 ? 6 + (index - 5) * 2 : null, 12 + index % 8];
		if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(JSON.stringify({ index, actual, expected }));
		console.log(`Offthread native frame ${index}: ${JSON.stringify(actual)}`);
	}
	for (const [mode, expected] of [["offthread-corrupt-video", "decoder failed"], ["offthread-audible-video", "explicitly muted"]]) {
		const bad = await compile(mode);
		let error: unknown;
		try { await render(bad); } catch (cause) { error = cause; }
		if (!String(error).includes(expected)) throw Error(`Unexpected ${mode}: ${String(error)}`);
	}
	let unavailable: unknown;
	try { await render(source, 23, false); } catch (cause) { unavailable = cause; }
	if (!String(unavailable).includes("requires the native frame bridge")) throw Error(`Missing decoder silently succeeded: ${String(unavailable)}`);
	const html5 = await compile("video");
	const html5Markers = await readMarkers(await render(html5, 23, false));
	if (JSON.stringify(html5Markers) !== "[42,19]") throw Error(`Html5Video regression: ${JSON.stringify(html5Markers)}`);
	// Remove the original author path from consideration: rebuild must use the
	// serialized source archive and attachment store, not the input directory.
	await rename(join(root, "author"), join(root, "author-moved"));
	const rebuilt = await compileProgrammaticProject({ action: "rebuild", input: JSON.parse(JSON.stringify(source)),
		toolchainDirectory, context, signal: AbortSignal.timeout(30000), enqueue: task => task() });
	if (!rebuilt.reusedDocument) throw Error("Offthread archive did not reproduce the compiled document");
	const rebuiltMarkers = await readMarkers(await render(rebuilt.source));
	if (JSON.stringify(rebuiltMarkers) !== "[42,19]") throw Error(`Offthread archive frame mismatch: ${JSON.stringify(rebuiltMarkers)}`);
	console.log("Offthread native compile/frame/error/unconfigured/recovery/archive and Html5Video regression checks passed");
} finally {
	if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith("rocut-offthread-probe-")) throw Error("Unsafe offthread probe cleanup");
	await rm(root, { recursive: true, force: true });
}
