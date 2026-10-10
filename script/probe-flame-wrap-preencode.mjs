import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	preparePreencodeInputs,
	preencodeSha,
	savePreencodeJson,
	verifyPreencodePins,
} from "./fixtures/flame-wrap-preencode-inputs.mjs";
import { installFlameWrapPreencodeObserver } from "./fixtures/flame-wrap-preencode-observer.mjs";
import { createFlameWrapEditorPage } from "./fixtures/flame-wrap-editor-browser.mjs";
import { flameWrapEditorRequest } from "./fixtures/flame-wrap-editor-request.mjs";
import {
	blazeEditorDeadline as deadline,
	blazeEditorRedact as redact,
} from "./fixtures/blaze-editor-lifecycle.mjs";
import { runPreencodeExport } from "./fixtures/flame-wrap-preencode-export.mjs";

const [mode, target] = process.argv.slice(2);
assert(
	["--prepare", "--run", "--prepare-q0", "--run-q0"].includes(mode),
	"Expected --prepare[-q0] [original-root] or --run[-q0] prepared-root (GPU lease required)",
);
assert(process.argv.length <= 4);
if (mode === "--prepare" || mode === "--prepare-q0") {
	const root = await mkdtemp(
		mode === "--prepare-q0"
			? "C:/tmps/flame-wrap-preencode-q0-"
			: "C:/tmps/flame-wrap-preencode-",
	);
	const prepared = await preparePreencodeInputs({
		sourceRoot: resolve(target ?? "C:/tmps/flame-wrap-editor-nl0MSk"),
		root,
	});
	if (mode === "--prepare-q0") {
		const { resolveVideoExportJson } = await import(
			pathToFileURL(join(prepared.pkg, "opencut_wasm_sync.js")).href
		);
		const request = {
			codec: "vp9",
			format: "webm",
			quality: "very_high",
			width: 192,
			height: 128,
			frameRate: { numerator: 24, denominator: 1 },
			videoQuantizer: 0,
		};
		const plan = JSON.parse(resolveVideoExportJson(JSON.stringify(request)));
		assert.equal(plan.kind, "vp9Quantizer");
		assert.equal(plan.quantizer, 0);
		assert(/^vp09\.00\./.test(plan.nativeConfig.codec));
		await savePreencodeJson(root, "q0-declaration.json", {
			request,
			plan,
			wasmSha256: prepared.wasmSha256,
			scope:
				"Single predeclared q0 default420 control using retained production Rust plan and native source. Full codec color/range selection also changes; not a pure quantization intervention or default420 repair.",
		});
	}
	console.log(
		JSON.stringify({
			ready: true,
			root,
			wasmSha256: prepared.wasmSha256,
			originalProjectSha256: prepared.originalProjectSha256,
			scope: "CPU preparation only; no Host/browser/GPU started",
		}),
	);
} else {
	assert(target, "Prepared root required");
	const root = resolve(target),
		prepared = JSON.parse(await readFile(join(root, "prepared.json"), "utf8"));
	assert.equal(root, resolve(prepared.root));
	const control =
		mode === "--run-q0"
			? JSON.parse(await readFile(join(root, "q0-declaration.json"), "utf8"))
			: undefined;
	if (control) {
		assert.equal(control.request.videoQuantizer, 0);
		assert.equal(control.wasmSha256, prepared.wasmSha256);
	}
	const controlSha256 = control
		? preencodeSha(await readFile(join(root, "q0-declaration.json")))
		: undefined;
	await verifyPreencodePins(prepared.pins);
	await verifyPreencodePins(prepared.copies);
	const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const temp = join(root, "temp");
	await mkdir(temp);
	const env = {
		...process.env,
		TMP: temp,
		TEMP: temp,
		TMPDIR: temp,
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
	};
	const bun =
		process.env.OPENCUT_BUN ??
		execFileSync("where.exe", ["bun"], { encoding: "utf8", windowsHide: true })
			.trim()
			.split(/\r?\n/)[0];
	const report = {
		ok: false,
		diagnosticComplete: false,
		root,
		sourceRoot: prepared.sourceRoot,
		wasmSha256: prepared.wasmSha256,
		control,
		controlSha256,
		console: [],
		pageErrors: [],
		httpFailures: [],
		externalRequests: [],
		browserClosed: false,
		hostClosed: false,
		scope: control
			? "Private retained-engine explicit q0 420 configuration-combination control; not default420 acceptance or pure quantization isolation"
			: "Private retained-engine default 420 diagnostic, target frame4 only; no rebuild, source edits, threshold changes or 444 inference",
	};
	let browser,
		page,
		child,
		closed,
		output = "",
		verified = false;
	try {
		child = spawn(
			bun,
			[join(workspace, "script/fixtures/flame-wrap-preencode-host.mjs"), root],
			{
				cwd: workspace,
				env,
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		closed = new Promise((done, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => done({ code, signal }));
		});
		void closed.catch(() => {});
		const ready = new Promise((done, reject) => {
			let lines = "";
			child.once("error", reject);
			child.once("close", () => reject(Error("Host closed before ready")));
			child.stdout.on("data", (bytes) => {
				const text = bytes.toString("utf8");
				output = (output + text).slice(-65536);
				lines += text;
				if (lines.length > 65536) {
					reject(Error("Host ready bound exceeded"));
					return;
				}
				while (lines.includes("\n")) {
					const at = lines.indexOf("\n"),
						line = lines.slice(0, at);
					lines = lines.slice(at + 1);
					try {
						const value = JSON.parse(line);
						if (value.ready && value.editorUrl) done(value.editorUrl);
					} catch {
						/* diagnostics */
					}
				}
			});
		});
		child.stderr.on("data", (bytes) => {
			output = (output + bytes.toString("utf8")).slice(-65536);
		});
		child.stdin.on("error", () => {});
		const editorUrl = await deadline(ready, 60000, "Retained Host readiness");
		const { chromium } = await import("./browser-probe-toolchain.mjs");
		browser = await chromium.launch({
			headless: true,
			env,
			args: [
				"--no-proxy-server",
				"--use-angle=swiftshader",
				"--enable-unsafe-swiftshader",
				"--disable-webgpu",
			],
		});
		report.browserVersion = browser.version();
		assert.equal(
			report.browserVersion,
			prepared.browserVersion,
			"Browser version changed from retained run",
		);
		page = await createFlameWrapEditorPage({
			browser,
			origin: new URL(editorUrl).origin,
			report,
			redact,
		});
		await page.addInitScript({
			content: `if(window===window.top) (${installFlameWrapPreencodeObserver.toString()})(${JSON.stringify({ timestamp: 166666, width: 192, height: 128 })});`,
		});
		await page.goto(editorUrl, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		await runPreencodeExport({
			page,
			request: flameWrapEditorRequest(editorUrl),
			prepared,
			report,
			control,
		});
		assert.equal(
			report.pageErrors.length,
			0,
			JSON.stringify(report.pageErrors),
		);
		verified = true;
	} catch (error) {
		report.failure = redact(error.stack ?? error);
	} finally {
		try {
			if (page)
				report.finalObserver = await deadline(
					page.evaluate(async () =>
						globalThis.__flameWrapPreencodeObserver?.cleanup(),
					),
					15000,
					"Final observer cleanup",
				);
		} catch (error) {
			report.observerCleanupError = redact(error);
		}
		try {
			if (browser)
				await deadline(browser.close(), 15000, "Owned browser close");
			report.browserClosed = true;
		} catch (error) {
			report.browserCloseError = redact(error);
		}
		if (child) {
			try {
				if (child.exitCode === null && child.signalCode === null)
					child.stdin.end(verified ? "verify\n" : "stop\n");
				report.hostExit = await deadline(closed, 25000, "Owned Host close");
				assert.equal(report.hostExit.code, 0, redact(output));
				report.hostClosed = true;
			} catch (error) {
				report.hostCloseError = redact(error);
				if (child.exitCode === null && child.signalCode === null) {
					child.kill();
					try {
						report.forcedHostExit = await deadline(
							closed,
							10000,
							"Owned Host forced close",
						);
					} catch (failure) {
						report.forcedCloseError = redact(failure);
					}
				}
			}
		}
		await savePreencodeJson(root, "host-output.json", { text: redact(output) });
		try {
			if (control)
				assert.equal(
					preencodeSha(await readFile(join(root, "q0-declaration.json"))),
					controlSha256,
				);
			await verifyPreencodePins(prepared.pins);
			await verifyPreencodePins(prepared.copies);
			report.inputsUnchanged = true;
			report.hostLifecycle = JSON.parse(
				await readFile(join(root, "host-lifecycle.json"), "utf8"),
			);
		} catch (error) {
			report.provenanceError = redact(error);
		}
		report.ok =
			verified &&
			report.browserClosed &&
			report.hostClosed &&
			report.inputsUnchanged &&
			report.hostLifecycle?.reopened === true &&
			!report.failure &&
			!report.observerCleanupError;
		await savePreencodeJson(root, "evidence.json", report);
		console.log(
			JSON.stringify({
				root,
				ok: report.ok,
				diagnosticComplete: report.diagnosticComplete,
				exportParityPassed: report.exportParityPassed,
				preencode: report.preencode,
				encoded: report.encoded,
				failure: report.failure,
			}),
		);
	}
	if (!report.ok) process.exitCode = 1;
}
