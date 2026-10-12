import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { createReferenceFixture } from "./fixtures/frost-reference-fixture.mjs";

const [receiptPath, outputDirectory, executablePath] = process.argv.slice(2);
assert(
	receiptPath && outputDirectory && executablePath,
	"Usage: node script/probe-frost-reference.mjs <matching-receipt> <new-output-directory> <chrome-executable>",
);
const root = resolve(outputDirectory),
	repo = fileURLToPath(new URL("../", import.meta.url));
assert(
	root.replaceAll("\\", "/").startsWith("C:/tmps/"),
	"Use an explicit private output under C:/tmps",
);
await mkdir(root); // A new directory only; no existing receipt or artifact is overwritten.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const save = (path, value) =>
	writeFile(join(root, path), JSON.stringify(value, null, 2), { flag: "wx" });
const baselineBytes = await readFile(receiptPath),
	baseline = JSON.parse(baselineBytes);
assert.equal(baseline.ok, true);
assert.equal(
	baseline.matching.allCurrentAndPrivateAndNormalProducerHashesEqual,
	true,
);
const abiBytes = await readFile(baseline.receipts.abi.path);
assert.equal(hash(abiBytes), baseline.receipts.abi.sha256);
const abi = JSON.parse(abiBytes);
const buildBytes = await readFile(baseline.receipts.build.path);
assert.equal(hash(buildBytes), baseline.receipts.build.sha256);
const buildReceipt = JSON.parse(buildBytes);
const fixture = createReferenceFixture();
const pins = {};
for (const [path, wanted] of Object.entries(buildReceipt.sourcePins)) {
	const actual = hash(await readFile(join(repo, path)));
	assert.equal(actual, wanted, `Current source drift: ${path}`);
	pins[join(repo, path)] = actual;
}
for (const path of [
	"script/probe-frost-reference.mjs",
	"script/fixtures/frost-reference-browser.mjs",
	"script/fixtures/frost-reference-fixture.mjs",
	"script/fixtures/frost-reference-math.mjs",
	"docs/evidence/frost-optical-fixture-v2.json",
	"script/browser-probe-toolchain.mjs",
])
	pins[join(repo, path)] = hash(await readFile(join(repo, path)));
await writeFile(join(root, "source.rgba"), fixture.source, { flag: "wx" });
for (const item of fixture.cases)
	await writeFile(join(root, `${item.id}.expected.rgba`), item.expected, {
		flag: "wx",
	});
const report = {
	ok: false,
	root,
	baselineSha256: hash(baselineBytes),
	pins,
	modes: [],
	scope:
		"Actual generated bindings and immutable WASM; serial WebGL/SwiftShader, eight active optical cases and two resolver bypasses. No editor, video or installed-app claim.",
};
const bootstrap = `import * as bindings from './bindings.mjs';
const response = await fetch('./module.wasm');
if (!response.ok) throw Error('Cannot load frozen WASM');
const bytes = new Uint8Array(await response.arrayBuffer());
const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
globalThis.__frostLoadedWasm = {status:response.status,bytes:bytes.length,
sha256:Array.from(digest,value=>value.toString(16).padStart(2,'0')).join(''),
boundary:'Actual fetch body hashed before compiling the same immutable bytes'};
const module = await WebAssembly.compile(bytes);
const imports = [...new Set(WebAssembly.Module.imports(module).map(value => value.module))];
if (imports.length !== 1 || imports[0] !== './opencut_wasm_bg.js') throw Error('Unexpected WASM imports');
const instance = await WebAssembly.instantiate(module, {'./opencut_wasm_bg.js': bindings});
bindings.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
export * from './bindings.mjs';`;

async function capture(label) {
	const diagnostic = label === "diagnostic",
		pkg = abi.packages[label];
	const mode = {
		label,
		ok: false,
		deliveredWasm: [],
		requests: [],
		pageErrors: [],
		consoleErrors: [],
		external: [],
		cleanup: {},
	};
	report.modes.push(mode);
	for (const [name, wanted] of Object.entries(pkg.pins)) {
		const path = join(pkg.path, name),
			actual = hash(await readFile(path));
		assert.equal(actual, wanted, `Package drift: ${path}`);
		pins[path] = actual;
	}
	const bytes = await readFile(join(pkg.path, "opencut_wasm_bg.wasm"));
	const bindings = await readFile(join(pkg.path, "opencut_wasm_bg.js"));
	const inputs = {
		diagnostic,
		width: fixture.width,
		height: fixture.height,
		source: [...fixture.source],
		cases: abi.resolverCalls.map((item) => ({
			id: item.id,
			input: item.input,
			expectedResolution: item.response,
		})),
	};
	const routes = new Map([
		[
			"/",
			[
				"text/html",
				'<!doctype html><link rel="icon" href="data:,"><script type="module" src="/probe.mjs"></script>',
			],
		],
		["/api.mjs", ["text/javascript", bootstrap]],
		["/bindings.mjs", ["text/javascript", bindings]],
		["/module.wasm", ["application/wasm", bytes]],
		["/inputs.json", ["application/json", JSON.stringify(inputs)]],
		[
			"/probe.mjs",
			[
				"text/javascript",
				await readFile(
					join(repo, "script/fixtures/frost-reference-browser.mjs"),
				),
			],
		],
	]);
	let context, server;
	try {
		server = createServer((request, response) => {
			const route = routes.get(request.url);
			mode.requests.push({
				method: request.method,
				path: request.url,
				accepted: Boolean(route),
			});
			if (!route || request.method !== "GET") {
				response.writeHead(404);
				response.end();
				return;
			}
			response.writeHead(200, {
				"Content-Type": route[0],
				"Cache-Control": "no-store",
			});
			response.end(route[1]);
		});
		await new Promise((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const origin = `http://127.0.0.1:${server.address().port}`;
		mode.origin = origin;
		context = await chromium.launchPersistentContext(
			join(root, `${label}-profile`),
			{
				executablePath,
				headless: true,
				serviceWorkers: "block",
				args: [
					"--no-proxy-server",
					"--disable-webgpu",
					"--use-angle=swiftshader",
					"--enable-unsafe-swiftshader",
				],
			},
		);
		mode.browserVersion = context.browser().version();
		await context.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (url.origin === origin || ["data:", "blob:"].includes(url.protocol))
				await route.continue();
			else {
				mode.external.push(url.origin);
				await route.abort();
			}
		});
		const page = await context.newPage();
		page.on("pageerror", (error) => mode.pageErrors.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") mode.consoleErrors.push(message.text());
		});
		await page.goto(origin, { waitUntil: "commit", timeout: 30000 });
		await page.waitForFunction(
			() => globalThis.__frostReferenceCapture !== undefined,
			null,
			{ timeout: 180000 },
		);
		mode.capture = await page.evaluate(
			() => globalThis.__frostReferenceCapture,
		);
		mode.deliveredWasm.push(
			await page.evaluate(() => globalThis.__frostLoadedWasm),
		);
		assert.equal(mode.capture.ok, true, mode.capture.failure);
		assert.equal(mode.capture.backend, "webgl");
		assert.equal(mode.capture.gpuDisposed, true);
		assert.equal(mode.capture.queryFreed, true);
		assert(mode.deliveredWasm.length > 0);
		for (const actual of mode.deliveredWasm) {
			assert.equal(actual.status, 200);
			assert.equal(
				actual.sha256,
				pkg.pins.opencut_wasm_bg_wasm ?? pkg.pins["opencut_wasm_bg.wasm"],
			);
		}
		assert.deepEqual(mode.pageErrors, []);
		assert.deepEqual(mode.consoleErrors, []);
		assert.deepEqual(mode.external, []);
		assert(mode.requests.every((request) => request.accepted));
		mode.ok = true;
	} catch (error) {
		mode.failure = String(error.stack ?? error);
	} finally {
		try {
			if (context) await context.close();
			mode.cleanup.browserClosed = true;
		} catch (error) {
			mode.cleanup.browserFailure = String(error);
			mode.ok = false;
		}
		try {
			if (server)
				await new Promise((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			mode.cleanup.serverClosed = true;
		} catch (error) {
			mode.cleanup.serverFailure = String(error);
			mode.ok = false;
		}
		await save(`${label}-capture.json`, mode);
	}
}
try {
	await capture("default");
	assert.equal(report.modes[0].ok, true, report.modes[0].failure);
	await capture("diagnostic");
	assert.equal(report.modes[1].ok, true, report.modes[1].failure);
	for (const [path, wanted] of Object.entries(pins))
		assert.equal(hash(await readFile(path)), wanted, `Post-run drift: ${path}`);
	report.inputsUnchanged = true;
	report.ok = true;
} catch (error) {
	report.failure = String(error.stack ?? error);
	process.exitCode = 1;
} finally {
	await save("capture-receipt.json", report);
	console.log(
		JSON.stringify({
			ok: report.ok,
			root,
			modes: report.modes.map(({ label, ok, failure }) => ({
				label,
				ok,
				failure,
			})),
		}),
	);
}
