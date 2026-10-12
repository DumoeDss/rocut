import { createCaptureServer, sha } from "./canvas-capture-server.mjs";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [pkg, parent, backend = "webgpu", kind = "canvas"] =
	process.argv.slice(2);
if (
	!pkg ||
	!parent ||
	!["webgpu", "webgl"].includes(backend) ||
	!["canvas", "canvas-lifecycle", "flame-wrap"].includes(kind)
)
	throw Error(
		"Usage: node script/probe-canvas-capture.mjs <private-pkg> <artifact-parent> [webgpu|webgl] [canvas|canvas-lifecycle|flame-wrap]",
	);
const require = createRequire(join(root, "apps/vite-example/package.json"));
const { chromium } = require("@playwright/test");
const artifacts = await mkdtemp(
	join(resolve(parent), `${kind}-capture-${backend}-`),
);
const temp = join(artifacts, "temp");
await mkdir(temp);
const { frozen, server } = await createCaptureServer({
	root,
	pkg,
	runnerPath: fileURLToPath(import.meta.url),
	kind,
});
const resultKey = kind.startsWith("canvas")
	? "__canvasCaptureResult"
	: "__flameWrapResult";
const progressKey = kind.startsWith("canvas")
	? "__canvasCaptureProgress"
	: "__flameWrapProgress";
const report = {
	ok: false,
	artifacts,
	startedAt: new Date().toISOString(),
	backend,
	kind,
	scope:
		"Private explicit browser initialization of real generated glue/binary, no Vite or production TS renderer. Presentation pixels only.",
	frozen: [...frozen].map(([route, value]) => ({
		route,
		path: value.path,
		bytes: value.bytes.length,
		sha256: value.sha256,
	})),
	console: [],
	pageErrors: [],
	externalRequests: [],
	httpErrors: [],
	loadedWasm: [],
	wasmResponses: [],
	browserClosed: false,
	serverClosed: false,
};
let context, page;
const deadline = (promise, ms, label) => {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(Error(`${label} timed out`)), ms);
		}),
	]).finally(() => clearTimeout(timer));
};
try {
	await new Promise((ready, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", ready);
	});
	const origin = `http://127.0.0.1:${server.address().port}`;
	report.origin = origin;
	context = await chromium.launchPersistentContext(join(artifacts, "profile"), {
		headless: true,
		serviceWorkers: "block",
		env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
		args: [
			"--no-proxy-server",
			"--use-angle=swiftshader",
			"--enable-unsafe-swiftshader",
			...(backend === "webgpu"
				? ["--enable-unsafe-webgpu"]
				: ["--disable-webgpu"]),
		],
	});
	if (backend === "webgl")
		await context.addInitScript(() =>
			Object.defineProperty(Navigator.prototype, "gpu", {
				get: () => undefined,
			}),
		);
	await context.route("**/*", async (route) => {
		if (new URL(route.request().url()).origin === origin)
			await route.continue();
		else {
			report.externalRequests.push(route.request().url());
			await route.abort();
		}
	});
	page = await context.newPage();
	report.browserVersion = context.browser()?.version();
	let rejectFatal;
	const fatal = new Promise((_, reject) => {
		rejectFatal = reject;
	});
	// Attach before navigation so a trapped WASM future cannot cost the full wait.
	fatal.catch(() => {});
	page.on("console", (message) =>
		report.console.push({ type: message.type(), text: message.text() }),
	);
	page.on("pageerror", (error) => {
		report.pageErrors.push(String(error));
		rejectFatal(error);
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			report.httpErrors.push({
				url: response.url(),
				status: response.status(),
			});
		if (response.url().endsWith("/wasm.wasm"))
			report.wasmResponses.push({
				url: response.url(),
				status: response.status(),
			});
	});
	console.log(
		JSON.stringify({ phase: "canvas-capture-browser", artifacts, backend }),
	);
	await page.goto(`${origin}/?backend=${backend}`, {
		waitUntil: "commit",
		timeout: 30000,
	});
	await Promise.race([
		fatal,
		page.waitForFunction(
			(key) => Reflect.get(globalThis, key) !== undefined,
			resultKey,
			{ timeout: 240000 },
		),
	]);
	const checks = await page.evaluate(
		(key) => Reflect.get(globalThis, key),
		resultKey,
	);
	if (checks.loadedWasm) report.loadedWasm.push(checks.loadedWasm);
	await writeFile(
		join(artifacts, "frames.json"),
		JSON.stringify(checks, null, 2) + "\n",
	);
	const { frames, sources, ...summary } = checks;
	report.checks = summary;
	report.frameCount = frames.length;
	report.rawReceiptSha256 = sha(await readFile(join(artifacts, "frames.json")));
} catch (error) {
	report.failure = error.stack ?? String(error);
	try {
		const partial = await page?.evaluate(
			(key) => Reflect.get(globalThis, key),
			progressKey,
		);
		if (partial) {
			await writeFile(
				join(artifacts, "partial-frames.json"),
				JSON.stringify(partial, null, 2) + "\n",
			);
			report.partialProgress = {
				currentCase: partial.currentCase,
				frameCount: partial.frames.length,
				checks: partial.checks,
			};
		}
	} catch (readError) {
		report.partialProgressError = String(readError);
	}
} finally {
	try {
		if (context) await deadline(context.close(), 15000, "Owned browser close");
		report.browserClosed = true;
	} catch (error) {
		report.closeError = String(error);
	}
	try {
		await deadline(
			new Promise((ready, reject) =>
				server.close((error) => (error ? reject(error) : ready())),
			),
			15000,
			"Owned server close",
		);
		report.serverClosed = true;
	} catch (error) {
		report.serverCloseError = String(error);
	}
	report.inputsUnchanged = (
		await Promise.all(
			[...frozen.values()].map(
				async (entry) => sha(await readFile(entry.path)) === entry.sha256,
			),
		)
	).every(Boolean);
	report.ok =
		report.checks?.ok === true &&
		report.inputsUnchanged &&
		report.loadedWasm.length === 1 &&
		report.loadedWasm[0].sha256 === frozen.get("/wasm.wasm").sha256 &&
		!report.failure &&
		!report.console.some((entry) => entry.type === "error") &&
		!report.pageErrors.length &&
		!report.httpErrors.length &&
		!report.externalRequests.length &&
		report.wasmResponses.length === 1 &&
		report.wasmResponses[0].status === 200 &&
		report.browserClosed &&
		report.serverClosed;
	report.finishedAt = new Date().toISOString();
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(report, null, 2) + "\n",
	);
	console.log(
		JSON.stringify({
			phase: "canvas-capture-finished",
			artifacts,
			ok: report.ok,
			frameCount: report.frameCount,
			failure: report.failure ?? report.checks?.failure,
			failed: report.checks?.checks.filter((entry) => !entry.passed),
			pageErrors: report.pageErrors,
		}),
	);
}
if (!report.ok) process.exitCode = 1;
