import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchFrameBrowser } from "../../apps/cli/src/programmatic/chromium-process";
import { createHyperframesFxTarget } from "../../apps/cli/src/programmatic/hyperframes-fx-target";

export interface BusPcmOracleRequest {
	name: string;
	sampleRate: number;
	frames: number;
	rawVolume: string | null;
	automation: string | null;
	scheduledAt: number;
	elapsed: number;
	rate: number;
}

export interface BusPcmOracleMetadata {
	staticGain: number;
	staticParamValue: number;
	frames: number;
	events: {
		kind: string;
		time: number;
		value?: number;
		duration?: number;
		values?: number[];
	}[];
}

const digest = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");
const rawGainAnchor =
	'function Us(e){let t=e?.getAttribute("data-volume"),n=t?parseFloat(t):1;return Number.isFinite(n)?n:1}';
const scheduleAnchor =
	"function Ra(e,t,n){let r=hb(Rb(e));r&&Ju([{param:t.gain}],r,so.scale,n)}";

/** Private browser only. Caller owns the AbortController and wall-clock deadline.
 * Source bundling is test transport, never a second schedule implementation. */
export async function createBusPcmOracle(
	toolchainDirectory: string,
	controller: AbortController,
) {
	const core = join(toolchainDirectory, "node_modules/@hyperframes/core");
	const manifest = JSON.parse(
		await readFile(join(core, "package.json"), "utf8"),
	);
	assert.equal(manifest.version, "0.8.139");
	assert.equal(manifest.name, "@hyperframes/core");
	const runtime = await import(
		pathToFileURL(join(core, "dist/generated/runtime-inline.js")).href
	);
	const script = runtime.getHyperframeRuntimeScript() as string;
	for (const anchor of [rawGainAnchor, scheduleAnchor]) {
		assert.equal(
			script.split(anchor).length,
			2,
			"Pinned native bus helper changed",
		);
	}
	const sources = {
		"@oracle/native-automation": join(core, "dist/audioAutomation.js"),
		"@oracle/native-scheduler": join(core, "dist/audio/audioFxAutomation.js"),
		"@oracle/native-gain": join(core, "dist/audioGain.js"),
	};
	const sourceSha256: Record<string, string> = {};
	for (const [name, path] of Object.entries(sources))
		sourceSha256[name] = digest(await readFile(path));
	const built = await Bun.build({
		entrypoints: [
			fileURLToPath(
				new URL("./hyperframes-bus-pcm-oracle-browser.mjs", import.meta.url),
			),
		],
		target: "browser",
		format: "iife",
		plugins: [
			{
				name: "native-bus-oracle",
				setup(build) {
					build.onResolve({ filter: /^@oracle\// }, ({ path }) => {
						const resolved = sources[path as keyof typeof sources];
						if (!resolved) throw Error("Unknown native oracle source");
						return { path: resolved };
					});
				},
			},
		],
	});
	if (!built.success || built.outputs.length !== 1)
		throw Error(`Bus oracle bundle failed: ${built.logs}`);
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
		await target.evaluate(`window.rocutNativeBusRawGain = (${rawGainAnchor});`);
		await target.evaluate(bundle);
		return {
			provenance: {
				coreVersion: manifest.version,
				sourceSha256,
				rawGainHelperSha256: digest(rawGainAnchor),
				busScheduleHelperSha256: digest(scheduleAnchor),
				bundleSha256: digest(bundle),
				browser: await browser.send("Browser.getVersion"),
			},
			async run(request: BusPcmOracleRequest) {
				const metadata = (await target.evaluate(
					`window.rocutBusPcmOracle.render(${JSON.stringify(request)})`,
				)) as BusPcmOracleMetadata;
				assert.equal(metadata.frames, request.frames);
				const pcm = Buffer.alloc(request.frames * 8);
				for (let offset = 0; offset < pcm.length; offset += 65536) {
					const count = Math.min(65536, pcm.length - offset);
					const encoded = await target.evaluate(
						`window.rocutBusPcmOracle.read(${offset},${count})`,
					);
					assert.equal(typeof encoded, "string");
					const chunk = Buffer.from(encoded as string, "base64");
					assert.equal(chunk.length, count);
					chunk.copy(pcm, offset);
				}
				return { ...metadata, pcm, sha256: digest(pcm) };
			},
			close: () => browser.close(),
		};
	} catch (error) {
		await browser.close();
		throw error;
	}
}

export function busPcmOracleCases(sampleRate: number): BusPcmOracleRequest[] {
	const result: BusPcmOracleRequest[] = [];
	const add = (
		name: string,
		points: unknown[] | null,
		extra: Partial<BusPcmOracleRequest> = {},
	) =>
		result.push({
			name,
			sampleRate,
			frames: Math.ceil(sampleRate * 0.16),
			rawVolume: "0.37suffix",
			automation: points
				? JSON.stringify({ version: 1, lanes: [{ target: "volume", points }] })
				: null,
			scheduledAt: 0,
			elapsed: 0,
			rate: 1,
			...extra,
		});
	for (const raw of ["0.37suffix", "0x10", "Infinity", "9", "-1", ".25e+1junk"])
		add(`raw-${result.length}`, null, { rawVolume: raw });
	add("constant", [
		{ t: 0.02, v: 2.3, curve: 1 },
		{ t: 0.1, v: 2.3 },
	]);
	add("linear-zero", [
		{ t: 0, v: 0.1 },
		{ t: 0.100017, v: 1.7 },
	]);
	add("linear-late-first-point", [
		{ t: 0.020013, v: 0.2 },
		{ t: 0.100017, v: 1.7 },
	]);
	add("curve-zero", [
		{ t: 0, v: 0, curve: 0.5 },
		{ t: 0.100017, v: 1 },
	]);
	add("curve-late-seed", [
		{ t: 0.020013, v: 0.2, curve: 0.5 },
		{ t: 0.100017, v: 1.7 },
	]);
	add("curve-negative-via", [
		{ t: 0, v: 0, viaX: 0.5, viaY: 0.001 },
		{ t: 0.100017, v: 1 },
	]);
	add("curve-overshoot", [
		{ t: 0, v: 10 ** (12 / 20), viaX: 0.5, viaY: 0.001 },
		{ t: 0.100017, v: 0 },
	]);
	add(
		"nonzero-clock-linear",
		[
			{ t: 0, v: 0.1 },
			{ t: 0.2, v: 1.7 },
		],
		{ scheduledAt: 0.020013, elapsed: 0.05, rate: 2 },
	);
	add(
		"nonzero-clock-curve",
		[
			{ t: 0, v: 0.1, curve: -0.5 },
			{ t: 0.2, v: 1.7 },
		],
		{ scheduledAt: 0.020013, elapsed: 0.05, rate: 2 },
	);
	add("adjacent-curves", [
		{ t: 0, v: 0.1, curve: 0.5 },
		{ t: 0.050013, v: 1.7, curve: -0.5 },
		{ t: 0.100017, v: 0.4 },
	]);
	add("curve-then-ramp", [
		{ t: 0, v: 0.1, curve: 0.5 },
		{ t: 0.050013, v: 1.7 },
		{ t: 0.100017, v: 0.4 },
	]);
	add("subsample-curve", [
		{ t: 0.020013, v: 0.1, curve: 0.5 },
		{ t: 0.020019, v: 1.7 },
	]);
	return result;
}
