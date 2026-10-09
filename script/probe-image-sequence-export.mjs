import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";
import { startImageSequenceHost } from "./fixtures/image-sequence-host-process.mjs";
import { verifyImageSequenceExport } from "./fixtures/image-sequence-export-verify.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG;
const ffprobe = process.env.ROCUT_TEST_FFPROBE;
if (![isolated, ffmpeg, ffprobe].every((value) => value && isAbsolute(value)))
	throw Error(
		"Configure absolute private ROCUT_TEST_WASM_DIRECTORY and ROCUT_TEST_FFMPEG/FFPROBE",
	);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-image-sequence-export-"));
const output = join(artifacts, "web");
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"image-sequence-host-browser",
	{ base: "./" },
);
let host, browser;
let phase = "host-import-and-reopen";
const redact = (value) =>
	String(value).replace(
		/http:\/\/127\.0\.0\.1:\d+\/[^\s"']+/g,
		"[private Host URL]",
	);
try {
	host = await startImageSequenceHost({ root, artifacts, output });
	phase = "browser-render-and-encode";
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(redact(error.message)));
	await page.addInitScript((source) => {
		Reflect.set(globalThis, "__importedSequenceSource", source);
	}, host.ready.source);
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (
			/^https?:$/.test(url.protocol) &&
			url.origin !== new URL(host.ready.editorUrl).origin
		)
			await route.abort();
		else await route.continue();
	});
	await page.goto(
		new URL(
			"script/fixtures/image-sequence-host-browser.html",
			host.ready.editorUrl,
		).href,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(
		() => globalThis.__imageSequenceHostResult,
		undefined,
		{ timeout: 180000 },
	);
	const { bytes, wrongTrimBytes, ...result } = await page.evaluate(
		() => globalThis.__imageSequenceHostResult,
	);
	const browserEvidence = JSON.parse(
		redact(
			JSON.stringify({ ...result, errors, browser: await browser.version() }),
		),
	);
	await writeFile(
		join(artifacts, "browser-evidence.json"),
		JSON.stringify(browserEvidence, null, 2),
	);
	if (!result.passed || errors.length)
		throw Error(JSON.stringify({ ...browserEvidence, artifacts }));
	const file = join(artifacts, "sequence.webm"),
		wrongTrimFile = join(artifacts, "wrong-trim.webm");
	await writeFile(file, Buffer.from(bytes));
	await writeFile(wrongTrimFile, Buffer.from(wrongTrimBytes));
	phase = "independent-decode";
	const decoded = verifyImageSequenceExport({
		file,
		wrongTrimFile,
		ffmpeg,
		ffprobe,
	});
	const sha = (body) => createHash("sha256").update(body).digest("hex");
	const report = {
		...browserEvidence,
		encodedExportTested: true,
		decoded,
		host: host.ready.proof,
		wasmSha256: sha(await readFile(join(isolated, "opencut_wasm_bg.wasm"))),
		exports: [
			{ file, byteLength: bytes.length, sha256: sha(Buffer.from(bytes)) },
			{
				file: wrongTrimFile,
				byteLength: wrongTrimBytes.length,
				sha256: sha(Buffer.from(wrongTrimBytes)),
			},
		],
		artifacts,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	const failure = {
		passed: false,
		phase,
		error: redact(error instanceof Error ? error.stack : error),
		artifacts,
	};
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(failure, null, 2),
	);
	console.error(JSON.stringify(failure, null, 2));
	process.exitCode = 1;
} finally {
	try {
		await browser?.close();
	} finally {
		await host?.stop();
	}
}
