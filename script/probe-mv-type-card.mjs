import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { loadTypeCardReference } from "./fixtures/mv-type-card-reference.ts";
import { TYPE_CARD_FONTS } from "./fixtures/mv-type-card-source.ts";
import { decodeTypeCard } from "./fixtures/mv-type-card-decode.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
	isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG,
	ffprobe = process.env.ROCUT_TEST_FFPROBE;
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--native-export-only") || args.length > 1)
	throw Error("Only optional --native-export-only is supported");
const nativeExportOnly = args.includes("--native-export-only");
if (
	!isolated ||
	!isAbsolute(isolated) ||
	!referenceRoot ||
	!isAbsolute(referenceRoot) ||
	!ffmpeg ||
	!ffprobe
)
	throw Error(
		"Provide isolated absolute ROCUT_TEST_WASM_DIRECTORY and ROCUT_TEST_MV_REFERENCE plus native ROCUT_TEST_FFMPEG/FFPROBE",
	);
const reference = await loadTypeCardReference(referenceRoot),
	artifacts = await mkdtemp(
		join(
			tmpdir(),
			nativeExportOnly ? "rocut-type-card-native-" : "rocut-type-card-",
		),
	),
	output = join(artifacts, "web");
console.log(JSON.stringify({ artifacts }));
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-type-card-browser",
);
const fonts = new Map(
	await Promise.all(
		TYPE_CARD_FONTS.map(async ({ file }) => [
			file,
			await readFile(join(root, "apps/web/public/motion-text/fonts", file)),
		]),
	),
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
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	const oraclePngs = new Set();
	if (nativeExportOnly)
		await page.exposeFunction(
			"__writeTypeCardOraclePng",
			async (frame, base64) => {
				if (
					!Number.isInteger(frame) ||
					frame < 0 ||
					frame >= 12 ||
					oraclePngs.has(frame)
				)
					throw Error("Invalid or duplicate oracle frame number");
				if (
					typeof base64 !== "string" ||
					base64.length > 32 * 1024 * 1024 ||
					!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
				)
					throw Error("Invalid bounded PNG payload");
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
					throw Error("Oracle must be a native 1920x1080 PNG");
				oraclePngs.add(frame);
				await writeFile(
					join(artifacts, `oracle-${String(frame).padStart(2, "0")}.png`),
					body,
					{ flag: "wx" },
				);
			},
		);
	await page.addInitScript(
		({ reference, nativeExportOnly }) => {
			window.__typeCardReference = reference;
			window.__typeCardNativeExportOnly = nativeExportOnly;
		},
		{ reference, nativeExportOnly },
	);
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			return route.abort();
		if (url.pathname.startsWith("/type-card-fonts/")) {
			const body = fonts.get(
				decodeURIComponent(url.pathname.slice("/type-card-fonts/".length)),
			);
			if (!body) return route.abort();
			return route.fulfill({ status: 200, contentType: "font/ttf", body });
		}
		return route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-type-card-browser.html`,
		{ waitUntil: "commit" },
	);
	try {
		await page.waitForFunction(() => globalThis.__mvTypeCard, undefined, {
			timeout: 300000,
		});
	} catch (error) {
		const progress = await page
			.evaluate(() => globalThis.__mvTypeCardProgress)
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
					mode: nativeExportOnly ? "native-export-only" : "full",
				},
				null,
				2,
			),
		);
		throw error;
	}
	const { bytes, expectations, ...result } = await page.evaluate(
		() => globalThis.__mvTypeCard,
	);
	await page.screenshot({
		path: join(artifacts, "comparison.png"),
		fullPage: true,
	});
	const report = {
		...result,
		mode: nativeExportOnly ? "native-export-only" : "full",
		lowResolutionQualityGate: nativeExportOnly
			? "Not rerun or superseded; previously failed and remains unresolved"
			: "Evaluated separately by independent decoder below",
		errors,
		browser: await browser.version(),
		artifacts,
		wasm: isolated,
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
	const file = join(artifacts, "type-card.webm");
	await writeFile(file, Buffer.from(bytes));
	let decoded;
	try {
		if (nativeExportOnly) {
			if (oraclePngs.size !== 12)
				throw Error(
					"Native export did not persist all twelve original oracle frames",
				);
			decoded = decodeTypeCard({
				file,
				ffmpeg,
				ffprobe,
				oracleDirectory: artifacts,
				width: 1920,
				height: 1080,
			});
		} else {
			await writeFile(
				join(artifacts, "expected.json"),
				JSON.stringify(expectations),
			);
			decoded = decodeTypeCard({ file, ffmpeg, ffprobe, expectations });
		}
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
	const verified = {
		...report,
		passed: decoded.passed,
		decoded,
		exportedBytes: bytes.length,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(verified, null, 2),
	);
	console.log(JSON.stringify(verified, null, 2));
	if (!decoded.passed)
		throw Error(
			`Independent typeCard decode quality gate failed; all frame statistics saved at ${join(artifacts, "verification.json")}`,
		);
} finally {
	await browser?.close();
	await server.close();
}
