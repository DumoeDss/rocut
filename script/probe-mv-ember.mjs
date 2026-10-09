import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";
import { attachEmberArtifacts } from "./fixtures/mv-ember-artifacts.mjs";
import { decodeEmber } from "./fixtures/mv-ember-decode.mjs";

const args = process.argv.slice(2);
if (
	args.length > 1 ||
	args.some(
		(arg) =>
			![
				"--browser-only",
				"--diagnostic-only",
				"--native-export-only",
				"--composition-only",
			].includes(arg),
	)
)
	throw Error(
		"Use no arguments, --browser-only, --diagnostic-only, --native-export-only or --composition-only",
	);
const mode = args[0]?.slice(2) ?? "full",
	root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportEnabled = mode === "full" || mode === "native-export-only";
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (
	!isolated ||
	!isAbsolute(isolated) ||
	!referenceRoot ||
	!isAbsolute(referenceRoot) ||
	(exportEnabled && (!ffmpeg || !ffprobe))
)
	throw Error(
		"Provide private absolute ROCUT_TEST_WASM_DIRECTORY/MV_REFERENCE and native FFMPEG/FFPROBE for export",
	);
if (!/^[Cc]:[\\/]/.test(tmpdir()))
	throw Error("Generated Ember artifacts require TEMP/TMP on C:");
const reference = await loadConvergeReference(referenceRoot),
	artifacts = await mkdtemp(join(tmpdir(), "rocut-ember-")),
	output = join(artifacts, "web");
const font = await readFile(
	join(root, "apps/web/public/motion-text/fonts/dot-gothic-16-regular.ttf"),
);
console.log(JSON.stringify({ artifacts, mode }));
await buildNativeAudioExportProbe(root, isolated, output, "mv-ember-browser");
const server = await createServer({
	root: output,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", hmr: false, port: 0 },
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage({
			viewport: { width: 1940, height: 480 },
		}),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const sinks = await attachEmberArtifacts(page, artifacts, exportEnabled);
	await page.addInitScript(
		({ reference, mode }) => {
			globalThis.__emberReference = reference;
			globalThis.__emberAcceptanceMode = mode;
		},
		{ reference, mode },
	);
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		if (url.pathname === "/ember-assets/dot-gothic-16-regular.ttf")
			return route.fulfill({
				status: 200,
				contentType: "font/ttf",
				body: font,
			});
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-ember-browser.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(() => globalThis.__mvEmber, undefined, {
			timeout: 300000,
		});
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__mvEmberProgress)
			.catch(() => null);
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify(
				{
					passed: false,
					error: String(error),
					progress,
					errors,
					artifacts,
					mode,
				},
				null,
				2,
			),
		);
		throw error;
	}
	const { bytes, ...result } = await page.evaluate(() => globalThis.__mvEmber);
	await page.screenshot({
		path: join(artifacts, "comparison.png"),
		fullPage: true,
	});
	const report = {
		...result,
		errors,
		artifacts,
		wasm: isolated,
		browser: await browser.version(),
	};
	await writeFile(
		join(artifacts, "browser-evidence.json"),
		JSON.stringify(report, null, 2),
	);
	if (!result.passed || errors.length) {
		await writeFile(
			join(artifacts, "verification.json"),
			JSON.stringify({ ...report, passed: false }, null, 2),
		);
		throw Error(`Ember browser parity failed; see ${artifacts}`);
	}
	let decoded;
	if (exportEnabled) {
		const file = join(artifacts, "ember.webm");
		await writeFile(file, Buffer.from(bytes), { flag: "wx" });
		try {
			if (sinks.frames.size !== 12)
				throw Error("Missing fixed Ember oracle PNGs");
			decoded = decodeEmber({
				file,
				ffmpeg,
				ffprobe,
				oracleDirectory: artifacts,
			});
		} catch (error) {
			await writeFile(
				join(artifacts, "verification.json"),
				JSON.stringify(
					{
						...report,
						passed: false,
						decodeError: String(error),
						exportedBytes: bytes.length,
					},
					null,
					2,
				),
			);
			throw error;
		}
	}
	const verified = {
		...report,
		...(decoded
			? { passed: decoded.passed, decoded, exportedBytes: bytes.length }
			: {}),
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(verified, null, 2),
	);
	console.log(
		JSON.stringify(
			{
				...verified,
				observations: undefined,
				provenance: undefined,
				oracleFrames: undefined,
				gpuObservations: undefined,
				decoded: decoded
					? {
							passed: decoded.passed,
							violations: decoded.violations,
							width: decoded.width,
							height: decoded.height,
							codec: decoded.codec,
							frames: decoded.frames.length,
						}
					: undefined,
			},
			null,
			2,
		),
	);
	if (decoded && !decoded.passed)
		throw Error(
			`Ember codec gate failed; retained all frame statistics at ${artifacts}`,
		);
} finally {
	await browser?.close();
	await server.close();
}
