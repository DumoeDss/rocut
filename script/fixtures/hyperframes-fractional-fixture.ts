import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import { createHyperframesFxTarget } from "../../apps/cli/src/programmatic/hyperframes-fx-target";

export interface FractionalRequest {
	sampleRate: number;
	sourceRate?: number;
	sourceFrames?: number;
	totalFrames?: number;
	startFrames?: number;
	offsetFrames?: number;
	durationFrames?: number;
	elapsedFrames?: number;
	mode?: "native-buffer-fallback" | "web-audio-loop-probe-not-upstream";
}
export interface FractionalResult {
	mode: string;
	calls: number[][];
	scheduled: boolean;
	source: number[];
	pcm: number[];
	sourceLoop: boolean;
}
const digest = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");
const startAnchor =
	"function oR(e,t){let{elapsed:n,mediaStart:r,scheduledAt:i,globalRate:o,mediaRate:a,clipDuration:s}=t,l=Number.isFinite(s)&&s>0,u=s*a;if(n>=0){let d=n*a,m=u-d;return l&&m<=0?!1:(l?e.start(0,d+r,m):e.start(0,d+r),!0)}let f=-n/o;return l?e.start(i+f,r,u):e.start(i+f,r),!0}";

function extract(source: string, begin: string, end: string) {
	assert.equal(
		source.split(begin).length,
		2,
		"Pinned exporter function changed",
	);
	const from = source.indexOf(begin),
		to = source.indexOf(end, from + begin.length);
	assert.ok(to > from, "Pinned exporter function boundary changed");
	return source.slice(from, to);
}

export async function createFractionalOracle(
	toolchain: string,
	engine: string,
	controller: AbortController,
) {
	const core = join(toolchain, "node_modules/@hyperframes/core");
	for (const [directory, name] of [
		[core, "@hyperframes/core"],
		[engine, "@hyperframes/engine"],
	]) {
		const manifest = JSON.parse(
			await readFile(join(directory!, "package.json"), "utf8"),
		);
		assert.equal(manifest.version, "0.8.139");
		assert.equal(manifest.name, name);
	}
	const runtime = await import(
		pathToFileURL(join(core, "dist/generated/runtime-inline.js")).href
	);
	const script = runtime.getHyperframeRuntimeScript() as string;
	assert.equal(
		script.split(startAnchor).length,
		2,
		"Pinned native start helper changed",
	);
	const engineAudio = await readFile(
		join(engine, "dist/services/audioMixer.js"),
		"utf8",
	);
	const filterSource =
		'import {clampFadesToDuration} from "@fractional/fade";\n' +
		extract(
			engineAudio,
			"function formatFilterNumber(value)",
			"/** Build an FFmpeg-compatible",
		) +
		extract(
			engineAudio,
			"export function buildFadeFilters(track)",
			"/** One track:",
		) +
		extract(
			engineAudio,
			"export function buildTrackInputFilter(track, index, volumeFilter, totalDuration)",
			"// Absolute paths are omitted",
		);
	const sources = {
		"@fractional/media": join(core, "dist/runtime/media.js"),
		"@fractional/fade": join(core, "dist/audioFade.js"),
	};
	const built = await Bun.build({
		entrypoints: [
			fileURLToPath(
				new URL("./hyperframes-fractional-browser.mjs", import.meta.url),
			),
		],
		target: "browser",
		format: "iife",
		plugins: [
			{
				name: "pinned-fractional-oracle",
				setup(build) {
					build.onResolve({ filter: /^@fractional\// }, ({ path }) =>
						path === "@fractional/export-filter"
							? { path, namespace: "fractional-native" }
							: { path: sources[path as keyof typeof sources] },
					);
					build.onLoad(
						{ filter: /.*/, namespace: "fractional-native" },
						() => ({ contents: filterSource, loader: "js" }),
					);
				},
			},
		],
	});
	if (!built.success || built.outputs.length !== 1)
		throw Error(`Fractional oracle bundle failed: ${built.logs}`);
	const bundle = await built.outputs[0]!.text();
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	const browser = await launchFrameBrowser(
		chromium.executablePath(),
		controller.signal,
	);
	try {
		const target = await createHyperframesFxTarget(
			browser,
			controller.signal,
			(error) => controller.abort(error),
		);
		await target.evaluate(
			`window.rocutNativeFractionalStart=(${startAnchor});`,
		);
		await target.evaluate(bundle);
		return {
			provenance: {
				coreVersion: "0.8.139",
				nativeStartHelperSha256: digest(startAnchor),
				nativeRuntimeSha256: digest(script),
				engineAudioMixerSha256: digest(engineAudio),
				extractedExportFilterSha256: digest(filterSource),
				bundleSha256: digest(bundle),
				browser: await browser.send("Browser.getVersion"),
			},
			async render(request: FractionalRequest) {
				return (await target.evaluate(
					`window.rocutFractionalOracle.render(${JSON.stringify(request)})`,
				)) as FractionalResult;
			},
			async mediaClock(request: FractionalRequest) {
				return (await target.evaluate(
					`window.rocutFractionalOracle.mediaClock(${JSON.stringify(request)})`,
				)) as { currentTime: number; sourceFrame: number; loop: boolean };
			},
			async exportFilter(request: FractionalRequest) {
				return (await target.evaluate(
					`window.rocutFractionalOracle.exportFilter(${JSON.stringify(request)})`,
				)) as string;
			},
			close: () => browser.close(),
		};
	} catch (error) {
		await browser.close();
		throw error;
	}
}
