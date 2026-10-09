import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadConvergeReference } from "./fixtures/mv-converge-reference.ts";
import { decodeConverge } from "./fixtures/mv-converge-decode.mjs";

const args = process.argv.slice(2);
if (
	args.length > 1 ||
	args.some(
		(arg) =>
			!["--browser-only", "--native-export-only", "--diagnostic-only"].includes(
				arg,
			),
	)
)
	throw Error(
		"Use no arguments, --browser-only, --native-export-only, or --diagnostic-only",
	);
const mode = args[0]?.slice(2) ?? "full",
	root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exportEnabled = mode === "full" || mode === "native-export-only";
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE,
	ffmpeg = process.env.ROCUT_TEST_FFMPEG,
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
const reference = await loadConvergeReference(referenceRoot),
	artifacts = await mkdtemp(join(tmpdir(), "rocut-converge-")),
	output = join(artifacts, "web");
console.log(JSON.stringify({ artifacts, mode }));
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-converge-browser",
);
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
		errors = [],
		pngs = new Set();
	page.on("pageerror", (error) => errors.push(error.message));
	const diagnosticFiles = new Set();
	await page.exposeFunction(
		"__writeConvergeDiagnostic",
		async (label, kind, body) => {
			if (
				typeof label !== "string" ||
				!/^[a-z0-9-]{1,80}$/.test(label) ||
				!["actual", "expected", "plan", "trace"].includes(kind)
			)
				throw Error("Invalid converge diagnostic identity");
			const key = `${label}-${kind}`;
			if (
				diagnosticFiles.has(key) ||
				diagnosticFiles.size >= 24 ||
				typeof body !== "string" ||
				body.length > 32 * 1024 * 1024
			)
				throw Error("Duplicate or oversized converge diagnostic payload");
			const isPng = kind === "actual" || kind === "expected";
			let data;
			if (isPng) {
				if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body))
					throw Error("Invalid diagnostic PNG encoding");
				data = Buffer.from(body, "base64");
				if (
					data.length < 33 ||
					!data
						.subarray(0, 8)
						.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
					data.readUInt32BE(16) !== 1920 ||
					data.readUInt32BE(20) !== 1080
				)
					throw Error("Diagnostic PNG dimensions/format differ");
			} else {
				JSON.parse(body);
				data = body;
			}
			diagnosticFiles.add(key);
			await writeFile(
				join(artifacts, `${key}.${isPng ? "png" : "json"}`),
				data,
				{ flag: "wx" },
			);
		},
	);
	if (exportEnabled)
		await page.exposeFunction(
			"__writeConvergeOraclePng",
			async (frame, base64) => {
				if (
					!Number.isInteger(frame) ||
					frame < 0 ||
					frame >= 12 ||
					pngs.has(frame)
				)
					throw Error("Invalid or duplicate converge oracle frame");
				if (
					typeof base64 !== "string" ||
					base64.length > 32 * 1024 * 1024 ||
					!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
				)
					throw Error("Invalid bounded converge PNG payload");
				const body = Buffer.from(base64, "base64");
				if (
					body.length < 33 ||
					!body
						.subarray(0, 8)
						.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
					body.toString("ascii", 12, 16) !== "IHDR" ||
					body.readUInt32BE(16) !== 1920 ||
					body.readUInt32BE(20) !== 1080
				)
					throw Error("Converge oracle must be native 1920x1080 PNG");
				pngs.add(frame);
				await writeFile(
					join(artifacts, `oracle-${String(frame).padStart(2, "0")}.png`),
					body,
					{ flag: "wx" },
				);
			},
		);
	await page.addInitScript(
		({ reference, mode }) => {
			window.__convergeReference = reference;
			window.__convergeAcceptanceMode = mode;
		},
		{ reference, mode },
	);
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-converge-browser.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(() => globalThis.__mvConverge, undefined, {
			timeout: 300000,
		});
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__mvConvergeProgress)
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
	const { bytes, ...result } = await page.evaluate(
		() => globalThis.__mvConverge,
	);
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
		throw Error(JSON.stringify(report));
	}
	let decoded;
	if (exportEnabled) {
		const file = join(artifacts, "converge.webm");
		await writeFile(file, Buffer.from(bytes));
		try {
			if (pngs.size !== 12) throw Error("Missing fixed converge oracle frames");
			decoded = decodeConverge({
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
	console.log(JSON.stringify(verified, null, 2));
	if (decoded && !decoded.passed)
		throw Error(
			`Converge codec quality gate failed; all frame statistics retained at ${join(artifacts, "verification.json")}`,
		);
} finally {
	await browser?.close();
	await server.close();
}
