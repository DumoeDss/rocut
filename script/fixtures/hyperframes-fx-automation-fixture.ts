import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import { createHyperframesFxTarget } from "../../apps/cli/src/programmatic/hyperframes-fx-target";

export interface FxAutomationPoint {
	t: number;
	v: number;
	curve?: number;
	viaX?: number;
	viaY?: number;
}
export interface FxAutomationLane {
	target: string;
	points: FxAutomationPoint[];
}
export interface FxAutomationRequest {
	name?: string;
	chain: { version: 1; nodes: Record<string, unknown>[] };
	automation?: unknown;
	sampleRate: number;
	sampleTimes?: number[];
	scheduledAt?: number;
	elapsed?: number;
	rate?: number;
}
export interface FxAutomationMetadata {
	chain: FxAutomationRequest["chain"];
	parsed: { version: 1; lanes: FxAutomationLane[] };
	automation: { version: 1; lanes: FxAutomationLane[] };
	tailSeconds: number;
	staticTailSeconds: number;
}
export interface FxAutomationInspection extends FxAutomationMetadata {
	lanes: {
		target: string;
		range: { min: number; max: number; scale: string };
		samples: { time: number; value: number }[];
	}[];
	targets: {
		target: string;
		range: { min: number; max: number; scale: string } | null;
		params: {
			initialValue: number;
			automationRate: string;
			mapped: { value: number; mapped: number }[];
		}[];
	}[];
}
export interface FxAutomationRender extends FxAutomationMetadata {
	frames: number;
	scheduledTargetCount: number;
	events: {
		target: string;
		index: number;
		kind: string;
		time: number;
		value?: number;
		values?: number[];
		duration?: number;
	}[];
}
export const fxAutomationDigest = (bytes: Buffer | string) =>
	createHash("sha256").update(bytes).digest("hex");

/** Test-only oracle; no Rust implementation contributes expected values. */
export async function createFxAutomationOracle(
	toolchainDirectory: string,
	controller: AbortController,
) {
	const core = join(toolchainDirectory, "node_modules/@hyperframes/core");
	const manifest = JSON.parse(
		await readFile(join(core, "package.json"), "utf8"),
	);
	assert.equal(manifest.name, "@hyperframes/core");
	assert.equal(manifest.version, "0.8.139");
	const sources = {
		"@oracle/automation": join(core, "dist/audioAutomation.js"),
		"@oracle/registry": join(core, "dist/audioFx.js"),
		"@oracle/graph": join(core, "dist/audio/audioFxGraph.js"),
		"@oracle/scheduler": join(core, "dist/audio/audioFxAutomation.js"),
		"@oracle/tail": join(core, "dist/audio/audioFxTail.js"),
	};
	const sourceSha256: Record<string, string> = {};
	for (const [name, path] of Object.entries(sources))
		sourceSha256[name] = fxAutomationDigest(await readFile(path));
	const bundle = await Bun.build({
		entrypoints: [
			fileURLToPath(
				new URL("./hyperframes-fx-automation-browser.mjs", import.meta.url),
			),
		],
		target: "browser",
		format: "iife",
		plugins: [
			{
				name: "native-fx-automation-oracle",
				setup(build) {
					build.onResolve({ filter: /^@oracle\// }, ({ path }) => {
						const resolved = sources[path as keyof typeof sources];
						if (!resolved) throw Error("Unknown native FX oracle module");
						return { path: resolved };
					});
				},
			},
		],
	});
	if (!bundle.success || bundle.outputs.length !== 1)
		throw Error(`Native FX oracle bundle failed: ${bundle.logs}`);
	const code = await bundle.outputs[0]!.text();
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	const executable = chromium.executablePath() as string;
	const browser = await launchFrameBrowser(executable, controller.signal);
	try {
		const target = await createHyperframesFxTarget(
			browser,
			controller.signal,
			(error) => controller.abort(error),
		);
		await target.evaluate(code);
		return {
			executable,
			provenance: {
				coreVersion: manifest.version,
				sourceSha256,
				bundleSha256: fxAutomationDigest(code),
				browser: await browser.send("Browser.getVersion"),
			},
			async inspect(request: FxAutomationRequest) {
				return (await target.evaluate(
					`window.rocutFxAutomationOracle.inspect(${JSON.stringify(request)})`,
				)) as FxAutomationInspection;
			},
			async render(request: FxAutomationRequest, input: Buffer) {
				await target.evaluate(
					`window.rocutFxAutomationOracle.configure(${input.length})`,
				);
				for (let offset = 0; offset < input.length; offset += 65536)
					await target.evaluate(
						`window.rocutFxAutomationOracle.put(${offset},${JSON.stringify(input.subarray(offset, offset + 65536).toString("base64"))})`,
					);
				const result = (await target.evaluate(
					`window.rocutFxAutomationOracle.render(${JSON.stringify(request)})`,
				)) as FxAutomationRender;
				const pcm = Buffer.alloc(result.frames * 8);
				for (let offset = 0; offset < pcm.length; offset += 65536) {
					const count = Math.min(65536, pcm.length - offset);
					const encoded = await target.evaluate(
						`window.rocutFxAutomationOracle.read(${offset},${count})`,
					);
					assert.equal(typeof encoded, "string");
					const chunk = Buffer.from(encoded as string, "base64");
					assert.equal(chunk.length, count);
					chunk.copy(pcm, offset);
				}
				return { ...result, pcm, sha256: fxAutomationDigest(pcm) };
			},
			close: () => browser.close(),
		};
	} catch (error) {
		await browser.close();
		throw error;
	}
}
