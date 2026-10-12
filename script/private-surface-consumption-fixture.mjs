import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve, sep, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { privateRuntimeConsumptionFixture } from "./private-runtime-consumption-fixture.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function sourcePins() {
	const result = spawnSync(
		"git",
		[
			"ls-files",
			"--cached",
			"--others",
			"--exclude-standard",
			"--",
			"apps/vite-example",
			"packages/editor-classic",
			"packages/editor-contracts",
			"packages/editor-ports",
			"script/surface-wasm-package.mjs",
			"script/pack-runtime.mjs",
		],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	assert.equal(result.status, 0);
	return Object.fromEntries(
		result.stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.sort()
			.filter((id) => existsSync(join(repoRoot, id)))
			.map((id) => [id, hash(readFileSync(join(repoRoot, id)))]),
	);
}
async function command(command, args, cwd, env, logFile) {
	const child = spawn(command, args, {
		cwd,
		env,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	const collect = (chunk) => {
		output += chunk;
		if (output.length > 8 * 1024 * 1024) child.kill();
	};
	child.stdout.on("data", collect);
	child.stderr.on("data", collect);
	const code = await new Promise((accept, reject) => {
		child.once("error", reject);
		child.once("exit", accept);
	});
	writeFileSync(logFile, output, { flag: "wx" });
	assert.equal(
		code,
		0,
		`${command} failed; see ${logFile}\n${output.slice(-1500)}`,
	);
}
export async function browserProbe(surface, corePath, browserPath) {
	const require = createRequire(
		join(repoRoot, "apps/vite-example/package.json"),
	);
	const { chromium } = require("@playwright/test");
	const server = createServer((request, response) => {
		try {
			const file = resolve(
				surface,
				"." +
					decodeURIComponent(
						new URL(request.url, "http://private.invalid").pathname,
					),
			);
			if (!file.startsWith(surface + sep)) {
				response.writeHead(403);
				response.end();
				return;
			}
			const mime =
				{
					".html": "text/html",
					".js": "text/javascript",
					".wasm": "application/wasm",
					".css": "text/css",
					".json": "application/json",
					".svg": "image/svg+xml",
					".png": "image/png",
				}[extname(file)] || "application/octet-stream";
			const bytes = readFileSync(file);
			response.writeHead(200, { "content-type": mime });
			response.end(bytes);
		} catch {
			response.writeHead(404);
			response.end();
		}
	});
	await new Promise((accept) => server.listen(0, "127.0.0.1", accept));
	const origin = "http://127.0.0.1:" + server.address().port,
		errors = [],
		externalRequests = [],
		httpFailures = [];
	let browser;
	try {
		browser = await chromium.launch({
			headless: true,
			executablePath: browserPath,
		});
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			serviceWorkers: "block",
		});
		await context.route("**/*", (route) => {
			const url = new URL(route.request().url());
			if (!["http:", "https:"].includes(url.protocol) || url.origin === origin)
				return route.continue();
			externalRequests.push(url.origin + url.pathname);
			return route.abort();
		});
		await context.addInitScript(() => {
			const capture = (result) => {
				const instance = result.instance || result;
				if (instance.exports?.validateProgrammaticResourcesJson)
					globalThis.__privateSurfaceCore = instance.exports;
			};
			for (const name of ["instantiate", "instantiateStreaming"]) {
				const original = WebAssembly[name];
				if (original)
					WebAssembly[name] = async function (...args) {
						const result = await Reflect.apply(original, WebAssembly, args);
						capture(result);
						return result;
					};
			}
		});
		const page = await context.newPage();
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("response", (response) => {
			if (response.status() >= 400)
				httpFailures.push({
					path: new URL(response.url()).pathname,
					status: response.status(),
				});
		});
		await page.goto(origin + "/surface-evidence.html", {
			waitUntil: "domcontentloaded",
		});
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="surface-evidence-harness"]')
					?.getAttribute("data-status") === "ready",
			null,
			{ timeout: 30000 },
		);
		const result = await page.evaluate(
			async ({ corePath }) => {
				const wasm = globalThis.__privateSurfaceCore;
				if (!wasm) throw Error("Built editor core instance not observed");
				// This is the selected generated glue's verified malloc/return/free ABI,
				// operating on the production editor's observed instance, not another WASM.
				const call = (input) => {
					const bytes = new TextEncoder().encode(JSON.stringify(input));
					const ptr = wasm.__wbindgen_malloc(bytes.length, 1);
					new Uint8Array(wasm.memory.buffer).set(bytes, ptr);
					const [output, length] = wasm.validateProgrammaticResourcesJson(
						ptr,
						bytes.length,
					);
					try {
						return JSON.parse(
							new TextDecoder("utf-8", { fatal: true }).decode(
								new Uint8Array(wasm.memory.buffer, output, length),
							),
						);
					} finally {
						wasm.__wbindgen_free(output, length, 1);
					}
				};
				const descriptor = {
					id: "built-surface-svg",
					kind: "model",
					mimeType: "image/svg+xml",
					byteLength: 1,
					sha256: "0".repeat(64),
					attachmentKey: "programmatic-sha256-" + "0".repeat(64),
				};
				const svg = call([descriptor]),
					negative = call([
						{ ...descriptor, mimeType: "application/not-a-model" },
					]);
				const digest = await crypto.subtle.digest(
					"SHA-256",
					await (await fetch("/" + corePath)).arrayBuffer(),
				);
				const coreHash = Array.from(new Uint8Array(digest), (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
				const ledger = JSON.parse(
					document.querySelector('[data-testid="surface-evidence-ledger"]')
						.textContent,
				);
				return {
					svg,
					negative,
					coreHash,
					ledger,
					coreInstance: "observed-production-WebAssembly-instantiation",
					projectProof:
						"existing-force-none-SurfaceEvidenceHarness-created-and-persisted-seed-projects",
					notMounted: true,
				};
			},
			{ corePath },
		);
		assert.deepEqual(result.svg, []);
		assert.ok(result.negative.length > 0);
		assert.ok(result.ledger.calls.some((item) => item.kind === "ready"));
		assert.deepEqual(errors, []);
		assert.deepEqual(externalRequests, []);
		assert.deepEqual(httpFailures, []);
		return {
			status: "pass",
			...result,
			errors,
			externalRequests,
			httpFailures,
			browserCloseAwaited: true,
			ownedServerClosed: true,
		};
	} finally {
		if (browser) await browser.close();
		await new Promise((accept) => server.close(accept));
	}
}
export async function privateSurfaceConsumptionFixture(
	wasmPackageDirectory,
	browserPath,
) {
	assert.ok(isAbsolute(wasmPackageDirectory));
	assert.ok(isAbsolute(browserPath));
	const root = mkdtempSync("C:/tmps/rocut-private-surface-consumption-"),
		surface = join(root, "surface");
	console.log(JSON.stringify({ root, step: "formal-vite-build" }));
	const canonicalFile = join(repoRoot, "rust/wasm/pkg/opencut_wasm_bg.wasm"),
		canonicalBefore = hash(readFileSync(canonicalFile)),
		before = sourcePins();
	writeFileSync(
		join(root, "source-pins-before.json"),
		JSON.stringify(before, null, 2),
		{ flag: "wx" },
	);
	try {
		await command(
			process.platform === "win32" ? "bun.exe" : "bun",
			["run", "--cwd", "apps/vite-example", "build"],
			repoRoot,
			{
				...process.env,
				C4_VITE_OUT_DIR: surface,
				ROCUT_SURFACE_WASM_PACKAGE_DIR: wasmPackageDirectory,
				VITE_R2_BUILD_MARKER: "private-svg-surface-smoke",
			},
			join(root, "vite-build.log"),
		);
		await command(
			process.execPath,
			[
				"script/check-distributable-boundary.mjs",
				join(surface, "module-graph.json"),
			],
			repoRoot,
			process.env,
			join(root, "distributable-boundary.log"),
		);
		const receipt = JSON.parse(
				readFileSync(join(surface, "surface-wasm-package.json"), "utf8"),
			),
			selectedHash = hash(
				readFileSync(join(wasmPackageDirectory, "opencut_wasm_bg.wasm")),
			);
		assert.equal(
			hash(readFileSync(join(surface, receipt.coreWasm.path))),
			selectedHash,
		);
		assert.equal(receipt.coreWasm.sha256, selectedHash);
		const after = sourcePins();
		writeFileSync(
			join(root, "source-pins-after.json"),
			JSON.stringify(after, null, 2),
			{ flag: "wx" },
		);
		const drift = Object.keys({ ...before, ...after }).filter(
			(key) => before[key] !== after[key],
		);
		assert.equal(
			drift.length,
			0,
			"Surface producer source pins changed during build: " + drift.join(", "),
		);
		assert.equal(hash(readFileSync(canonicalFile)), canonicalBefore);
		let browser;
		try {
			browser = await browserProbe(surface, receipt.coreWasm.path, browserPath);
			assert.equal(browser.coreHash, selectedHash);
			writeFileSync(
				join(root, "browser-consumption.json"),
				JSON.stringify(browser, null, 2),
				{ flag: "wx" },
			);
		} catch (error) {
			writeFileSync(
				join(root, "browser-failure.json"),
				JSON.stringify({ status: "failed", error: String(error) }, null, 2),
				{ flag: "wx" },
			);
			browser = { status: "failed", error: String(error) };
		}
		console.log(JSON.stringify({ root, step: "matched-surface-runtime-pack" }));
		const runtime = await privateRuntimeConsumptionFixture(
			wasmPackageDirectory,
			surface,
		);
		assert.equal(hash(readFileSync(canonicalFile)), canonicalBefore);
		const result = {
			status:
				browser.status === "pass"
					? "pass"
					: "built-and-packed-browser-probe-failed",
			root,
			surface,
			runtime,
			coreWasm: receipt.coreWasm,
			browserStatus: browser.status,
			canonicalSha256Unchanged: canonicalBefore,
			sourcePinsStable: true,
			scope: "private-surface-core-and-runtime-consumption-not-P8-release",
		};
		writeFileSync(join(root, "receipt.json"), JSON.stringify(result, null, 2), {
			flag: "wx",
		});
		return result;
	} catch (error) {
		writeFileSync(
			join(root, "failure.json"),
			JSON.stringify(
				{
					status: "failed-without-gate-bypass",
					error: String(error),
					canonicalBefore,
					canonicalAfter: hash(readFileSync(canonicalFile)),
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		throw Error(`${error.message}\nRetained surface fixture: ${root}`, {
			cause: error,
		});
	}
}
/** Resume only the real previously-built surface after the explicitly reviewed
 * manifest-control fix. Preserve its initial failure and before/after pins. */
export async function resumePrivateSurfaceConsumptionFixture(
	root,
	wasmPackageDirectory,
	browserPath,
) {
	assert.ok(isAbsolute(root));
	assert.ok(isAbsolute(wasmPackageDirectory));
	assert.ok(isAbsolute(browserPath));
	const controls = [
		"script/pack-runtime.mjs",
		"script/surface-wasm-package.mjs",
	];
	const before = JSON.parse(
		readFileSync(join(root, "source-pins-before.json"), "utf8"),
	);
	const after = JSON.parse(
		readFileSync(join(root, "source-pins-after.json"), "utf8"),
	);
	const current = sourcePins();
	const drift = Object.keys({ ...before, ...after }).filter(
		(key) => before[key] !== after[key],
	);
	assert.ok(
		drift.every((key) => controls.includes(key)),
		"Only the reviewed manifest-control source drift may resume",
	);
	const frontendKeys = Object.keys(after).filter(
		(key) => !controls.includes(key),
	);
	assert.ok(
		frontendKeys.every((key) => current[key] === after[key]),
		"Frontend source changed since formal surface build",
	);
	const controlBefore = Object.fromEntries(
		controls.map((key) => [key, current[key]]),
	);
	writeFileSync(
		join(root, "pack-control-pins-before.json"),
		JSON.stringify(controlBefore, null, 2),
		{ flag: "wx" },
	);
	const surface = join(root, "surface"),
		receipt = JSON.parse(
			readFileSync(join(surface, "surface-wasm-package.json"), "utf8"),
		);
	const selectedHash = hash(
		readFileSync(join(wasmPackageDirectory, "opencut_wasm_bg.wasm")),
	);
	assert.equal(
		hash(readFileSync(join(surface, receipt.coreWasm.path))),
		selectedHash,
	);
	assert.equal(receipt.coreWasm.sha256, selectedHash);
	const gate = spawnSync(
		process.execPath,
		[
			"script/check-distributable-boundary.mjs",
			join(surface, "module-graph.json"),
		],
		{ cwd: repoRoot, encoding: "utf8" },
	);
	assert.equal(gate.status, 0, gate.stderr);
	let browser;
	try {
		browser = await browserProbe(surface, receipt.coreWasm.path, browserPath);
		assert.equal(browser.coreHash, selectedHash);
		writeFileSync(
			join(root, "browser-consumption.json"),
			JSON.stringify(browser, null, 2),
			{ flag: "wx" },
		);
	} catch (error) {
		browser = { status: "failed", error: String(error) };
		writeFileSync(
			join(root, "browser-failure.json"),
			JSON.stringify(browser, null, 2),
			{ flag: "wx" },
		);
	}
	const runtime = await privateRuntimeConsumptionFixture(
		wasmPackageDirectory,
		surface,
	);
	const final = sourcePins(),
		controlAfter = Object.fromEntries(controls.map((key) => [key, final[key]]));
	writeFileSync(
		join(root, "pack-control-pins-after.json"),
		JSON.stringify(controlAfter, null, 2),
		{ flag: "wx" },
	);
	assert.deepEqual(
		controlAfter,
		controlBefore,
		"Pack control source changed during consumption",
	);
	assert.ok(
		frontendKeys.every((key) => final[key] === after[key]),
		"Frontend source changed during consumption",
	);
	const initialFailure = JSON.parse(
		readFileSync(join(root, "failure.json"), "utf8"),
	);
	const canonicalHash = hash(
		readFileSync(join(repoRoot, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
	);
	assert.equal(canonicalHash, initialFailure.canonicalBefore);
	const result = {
		status:
			browser.status === "pass"
				? "pass"
				: "built-and-packed-browser-probe-failed",
		root,
		surface,
		runtime,
		coreWasm: receipt.coreWasm,
		browserStatus: browser.status,
		canonicalSha256Unchanged: canonicalHash,
		sourcePinsStable: false,
		frontendSourcePinsStable: true,
		packControlSourcePinsStable: true,
		reviewedControlDrift: drift.map((path) => ({
			path,
			before: before[path],
			after: after[path],
		})),
		initialFailureRetained: "failure.json",
		scope: "private-surface-core-and-runtime-consumption-not-P8-release",
	};
	writeFileSync(join(root, "receipt.json"), JSON.stringify(result, null, 2), {
		flag: "wx",
	});
	return result;
}
if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	try {
		const result =
			process.argv[2] === "--browser-only"
				? await (async () => {
						const root = resolve(process.argv[3]),
							surface = join(root, "surface"),
							receipt = JSON.parse(
								readFileSync(
									join(surface, "surface-wasm-package.json"),
									"utf8",
								),
							);
						const result = await browserProbe(
							surface,
							receipt.coreWasm.path,
							process.argv[4],
						);
						assert.equal(result.coreHash, receipt.coreWasm.sha256);
						writeFileSync(
							join(root, "browser-consumption.json"),
							JSON.stringify(result, null, 2),
							{ flag: "wx" },
						);
						return {
							status: result.status,
							root,
							browserProof: "browser-consumption.json",
						};
					})()
				: process.argv[2] === "--resume"
					? await resumePrivateSurfaceConsumptionFixture(
							process.argv[3],
							process.argv[4],
							process.argv[5],
						)
					: await privateSurfaceConsumptionFixture(
							process.argv[2],
							process.argv[3],
						);
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
