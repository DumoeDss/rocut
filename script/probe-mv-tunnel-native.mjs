import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { loadTunnelReference } from "./fixtures/mv-tunnel-reference.ts";
import { loadTunnelPostReference } from "./fixtures/mv-tunnel-post-reference.ts";
import { TUNNEL_FONTS } from "./fixtures/mv-tunnel-matrix.ts";
import { buildTunnelNative } from "./fixtures/mv-tunnel-native-build.mjs";
import {
	tunnelRustIdentity,
	tunnelFileIdentity,
} from "./fixtures/mv-tunnel-native-identities.mjs";
import {
	fallWasmIdentity,
	fallServedIdentity,
} from "./fixtures/mv-fall-evidence.mjs";
import { saveTunnelDiagnosticArtifacts } from "./fixtures/mv-tunnel-native-diagnostic-artifacts.mjs";
import { saveTunnelRaceArtifacts } from "./fixtures/mv-tunnel-race-artifacts.mjs";

const arguments_ = process.argv.slice(2);
assert.ok(
	arguments_.length >= 1 &&
		["--browser-only", "--frame4-grain-diagnostic"].includes(arguments_[0]),
	"Explicit browser-only gate or frame4 grain diagnostic required; export is separate",
);
const frame4GrainDiagnostic = arguments_[0] === "--frame4-grain-diagnostic";
const original = process.env.ROCUT_TEST_MV_REFERENCE,
	isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE,
	rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
assert.ok(
	[original, isolated, browserExecutable, rustSource].every(
		(path) => path && isAbsolute(path),
	),
	"Require absolute reference/private fresh WASM/source-manifest/existing Chromium paths",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = await mkdtemp(join(tmpdir(), "rocut-tunnel-native-")),
	web = join(artifact, "web");
const reference = await loadTunnelReference(original),
	postReference = await loadTunnelPostReference(original),
	wasmIdentity = await fallWasmIdentity(isolated);
const glue = await readFile(join(isolated, "opencut_wasm.js"), "utf8");
assert.match(
	glue,
	/export function resolveProgrammaticFrameTunnelJson\(/,
	"Private WASM lacks required actual byte admission export",
);
const tunnelWrapper = glue.match(
	/export function resolveProgrammaticFrameTunnelJson\([\s\S]*?(?=\nexport |$)/,
);
assert.ok(tunnelWrapper, "Missing generated Tunnel wrapper");
assert.doesNotMatch(
	tunnelWrapper[0],
	/passArray8ToWasm/,
	"Generated wrapper copies an unbounded byte array before Rust admission",
);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
	currentScope: process.env.ROCUT_TEST_CURRENT_SOURCE_SCOPE ?? "native-scene",
};
const rustIdentity = await tunnelRustIdentity(rustOptions),
	browserIdentity = await tunnelFileIdentity(browserExecutable);
const fontBytes = {},
	fontIdentity = {};
for (const font of TUNNEL_FONTS) {
	if (fontBytes[font.file]) continue;
	const path = join(root, "apps/web/public/motion-text/fonts", font.file);
	fontIdentity[font.file] = await tunnelFileIdentity(path);
	fontBytes[font.file] = (await readFile(path)).toString("base64");
}
const sources = new Map();
for (const path of [
	"script/probe-mv-tunnel-native.mjs",
	"script/fixtures/mv-tunnel-native-build.mjs",
	"script/fixtures/mv-tunnel-native-identities.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/mv-fall-evidence.mjs",
	"script/fixtures/mv-ink-export-identities.mjs",
	"script/fixtures/mv-tunnel-reference.ts",
	"script/fixtures/mv-tunnel-post-reference.ts",
	"script/fixtures/mv-tunnel-native-diagnostic-artifacts.mjs",
	"script/fixtures/mv-tunnel-race-artifacts.mjs",
])
	sources.set(path, (await tunnelFileIdentity(join(root, path))).sha256);
console.log(
	JSON.stringify({
		artifact,
		scope: frame4GrainDiagnostic
			? "frame4 grain diagnosis only; no full matrix acceptance"
			: "426 serial native visits, 26 repeats, 20 scene and six post negatives; no export/installed Electron/globalFX gate",
	}),
);
let browser, server, timer;
try {
	for (const input of await buildTunnelNative({
		root,
		isolated,
		output: web,
	})) {
		if (sources.has(input.path))
			assert.equal(sources.get(input.path), input.sha256);
		sources.set(input.path, input.sha256);
	}
	const servedIdentity = await fallServedIdentity(web);
	server = await createServer({
		root: web,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifact, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: browserExecutable,
		args: ["--disable-gpu-rasterization", ...(process.env.ROCUT_TEST_TUNNEL_SOFTWARE_CANVAS ? ["--disable-accelerated-2d-canvas"] : [])],
	});
	const page = await browser.newPage(),
		errors = [],
		externalRequests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			externalRequests.push(url.origin);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript(
		(input) => {
			globalThis.__tunnelNativeInput = input;
		const diagIndex = Number(input.diagIndex);
		if (Number.isInteger(diagIndex) && diagIndex >= 0)
			globalThis.__tunnelDiagIndex = diagIndex;
		const preRoll = Number(input.diagPreRoll);
		if (Number.isInteger(preRoll) && preRoll > 0)
			globalThis.__tunnelDiagPreRoll = preRoll;
		const matrixCap = Number(input.matrixCap);
		if (Number.isInteger(matrixCap) && matrixCap > 0)
			globalThis.__tunnelMatrixCap = matrixCap;
		if (input.diagRepeatProbe)
			globalThis.__tunnelDiagRepeatProbe = 1;
		},
		{
			reference,
			postReference,
			fonts: TUNNEL_FONTS,
			fontBytes,
			frame4GrainDiagnostic,
		diagIndex: process.env.ROCUT_TEST_TUNNEL_DIAG_INDEX,
		diagPreRoll: process.env.ROCUT_TEST_TUNNEL_DIAG_PREROLL,
		matrixCap: process.env.ROCUT_TEST_TUNNEL_MATRIX_CAP,
		diagRepeatProbe: process.env.ROCUT_TEST_TUNNEL_REPEAT_PROBE,
			raceDiagnostics: Boolean(process.env.ROCUT_TEST_TUNNEL_RACE_DIAGNOSTICS),
			settleRealms: Boolean(process.env.ROCUT_TEST_TUNNEL_SETTLE_REALMS),
			frameDelayMs: Number(process.env.ROCUT_TEST_TUNNEL_FRAME_DELAY_MS) || 0,
		},
	);
	await page.goto(`${origin}/script/fixtures/mv-tunnel-native-browser.html`, {
		waitUntil: "commit",
	});
	let reading = false;
	timer = setInterval(async () => {
		if (reading) return;
		reading = true;
		try {
			console.log(
				JSON.stringify({
					event: "tunnel-progress",
					progress: await page.evaluate(
						() => globalThis.__tunnelNativeProgress,
					),
				}),
			);
		} catch {
		} finally {
			reading = false;
		}
	}, 30000);
	timer.unref();
	let result;
	try {
		await page.waitForFunction(
			() => globalThis.__tunnelNativeResult,
			undefined,
			{ timeout: 900000 },
		);
		result = await page.evaluate(() => globalThis.__tunnelNativeResult);
	} catch (error) {
		result = {
			passed: false,
			error: String(error),
			progress: await page
				.evaluate(() => globalThis.__tunnelNativeProgress)
				.catch(() => null),
		};
	} finally {
		clearInterval(timer);
	}
	let diagnosticFiles;
	const raceFailure = await saveTunnelRaceArtifacts({ page, artifact });
	if (frame4GrainDiagnostic && result.diagnosticComplete)
		diagnosticFiles = await saveTunnelDiagnosticArtifacts({
			page,
			artifact,
			result,
			originalMain: {
				main: postReference.main,
				functions: postReference.functions,
			},
		});
	const report = {
		artifact,
		result,
		raceFailure,
		experiment: {
			raceDiagnostics: Boolean(process.env.ROCUT_TEST_TUNNEL_RACE_DIAGNOSTICS),
			settleRealms: Boolean(process.env.ROCUT_TEST_TUNNEL_SETTLE_REALMS),
			softwareCanvas: Boolean(process.env.ROCUT_TEST_TUNNEL_SOFTWARE_CANVAS),
			frameDelayMs: Number(process.env.ROCUT_TEST_TUNNEL_FRAME_DELAY_MS) || 0,
		},
		errors,
		externalRequests,
		browser: browser.version(),
		browserIdentity,
		wasmIdentity,
		rustIdentity,
		servedIdentity,
		fontIdentity,
		sourceInputs: [...sources].map(([path, sha256]) => ({ path, sha256 })),
		referenceSources: reference.scripts.map(({ id, sha256 }) => ({
			id,
			sha256,
		})),
		postReferenceSha256: postReference.sha256,
		mainReference: {
			id: postReference.main.id,
			sha256: postReference.main.sha256,
			functions: postReference.functions.map(
				({ name, start, end, sha256 }) => ({ name, start, end, sha256 }),
			),
		},
		diagnosticFiles,
	};
	try {
		assert.deepEqual(
			await tunnelFileIdentity(browserExecutable),
			browserIdentity,
		);
		for (const [path, sha256] of sources)
			assert.equal((await tunnelFileIdentity(join(root, path))).sha256, sha256);
		for (const [file, identity] of Object.entries(fontIdentity))
			assert.deepEqual(
				await tunnelFileIdentity(
					join(root, "apps/web/public/motion-text/fonts", file),
				),
				identity,
			);
		assert.deepEqual(await loadTunnelReference(original), reference);
		assert.deepEqual(await loadTunnelPostReference(original), postReference);
		assert.deepEqual(await fallWasmIdentity(isolated), wasmIdentity);
		assert.deepEqual(await tunnelRustIdentity(rustOptions), rustIdentity);
		assert.deepEqual(await fallServedIdentity(web), servedIdentity);
		for (const { file, ...identity } of diagnosticFiles ?? [])
			assert.deepEqual(await tunnelFileIdentity(join(artifact, file)), identity);
		report.sourceIdentityStable = true;
	} catch (error) {
		report.sourceIdentityStable = false;
		report.identityError = String(error);
	}
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			artifact,
			passed: result.passed,
			diagnosticComplete: result.diagnosticComplete,
			mode: frame4GrainDiagnostic ? "frame4-grain-diagnostic" : "browser-only",
			observations: result.observations?.length,
			error: result.error,
			sourceIdentityStable: report.sourceIdentityStable,
		}),
	);
	assert.deepEqual(errors, []);
	assert.deepEqual(externalRequests, []);
	assert.equal(report.sourceIdentityStable, true, report.identityError);
	if (frame4GrainDiagnostic) {
		assert.equal(result.diagnosticComplete, true, result.error);
		assert.equal(result.fullMatrixTested, false);
		assert.equal(
			result.passed,
			undefined,
			"Diagnostic cannot claim full matrix acceptance",
		);
		assert.equal(diagnosticFiles.length, 8);
		assert.deepEqual(result.transportBoundary, { checks: 1 });
	} else {
		assert.equal(result.passed, true, result.error);
		const capped = Number.isInteger(
			Number(process.env.ROCUT_TEST_TUNNEL_MATRIX_CAP),
		);
		if (!capped) {
			assert.equal(result.observations.length, 426);
			assert.equal(result.repeats, 26);
			assert.equal(result.negatives.length, 26);
		}
		assert.deepEqual(result.transportBoundary, { checks: 1 });
		assert.equal(result.thresholds.maxChannelAtMost, 6);
		assert.equal(result.thresholds.maeLessThan, 0.025);
		assert.equal(result.exportTested, false);
		assert.equal(result.installedElectronTested, false);
		assert.equal(result.timelineGlobalFxTested, false);
	}
} catch (error) {
	await writeFile(
		join(artifact, "failure.txt"),
		String(error?.stack ?? error),
		{ flag: "wx" },
	);
	throw error;
} finally {
	clearInterval(timer);
	await browser?.close();
	await server?.close();
}
