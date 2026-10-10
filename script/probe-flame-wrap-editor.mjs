import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { flameWrapEditorRequest as requestClient } from "./fixtures/flame-wrap-editor-request.mjs";
import { blazeEditorDeadline as deadline } from "./fixtures/blaze-editor-lifecycle.mjs";
import { runFlameWrapEditorChecks } from "./fixtures/flame-wrap-editor-checks.mjs";
import { createFlameWrapEditorPage } from "./fixtures/flame-wrap-editor-browser.mjs";
import { prepareFlameWrapEditorInputs } from "./fixtures/flame-wrap-editor-inputs.mjs";
import { bundleFlameWrapEditorHost } from "./fixtures/flame-wrap-editor-bundle.mjs";

const [pkg, creator, buildReceipt, stage = "full"] = process.argv.slice(2);
assert.equal(
	process.argv.length,
	stage === "full" ? 5 : 6,
	"Expected private-pkg Creator/flame-wrap.mjs production-build-evidence.json [ui-only|full-444]",
);
assert(["full", "ui-only", "full-444"].includes(stage));
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = await mkdtemp("C:/tmps/flame-wrap-editor-");
const temp = join(root, "temp");
await mkdir(temp);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const redact = (value) =>
	String(value).replace(/https?:\/\/[^\s"'<>]+/g, "[private URL redacted]");
let inputs;
try {
	inputs = await prepareFlameWrapEditorInputs({
		pkg,
		creator,
		buildReceipt,
		stage,
		root,
		entryFile: fileURLToPath(import.meta.url),
		workspace,
	});
} catch (error) {
	console.error(
		JSON.stringify({
			phase: "flame-wrap-editor-preflight-rejected",
			root,
			code: error.code,
		}),
	);
	process.exit(1);
}
const { build, pinned } = inputs;
const artifacts = {
	root,
	clipId: "flame-static",
	effectId: "template-flame-wrap",
	width: 192,
	height: 128,
	finalTicks: 40000,
	usePresentationObserver: true,
	projectPath: join(root, "project/project.json"),
	videoChroma: stage === "full-444" ? "444" : "420",
};
const configPath = join(root, "config.json");
await writeFile(
	configPath,
	JSON.stringify({
		editorDist: build.editorDist,
		expectedFile: join(root, "flame-wrap-editor-final-expected.json"),
		wasmSha256: build.wasmSha256,
	}),
	{ flag: "wx" },
);
const bun =
	process.env.OPENCUT_BUN ||
	execFileSync("where.exe", ["bun"], { encoding: "utf8", windowsHide: true })
		.trim()
		.split(/\r?\n/)[0];
const env = {
	...process.env,
	TMP: temp,
	TEMP: temp,
	TMPDIR: temp,
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
};
const report = {
	ok: false,
	root,
	buildReceipt,
	preflight: inputs.validation,
	wasmSha256: build.wasmSha256,
	stage,
	scope: `Real production Vite editor, private actual Host, parameter UI/history/reload${stage !== "ui-only" ? ` and same-project VP9 ${artifacts.videoChroma} export` : "; export not executed"}. Browser WebGL SwiftShader; not Electron, alpha master, installed plugin or hardware acceptance.`,
	console: [],
	pageErrors: [],
	httpFailures: [],
	externalRequests: [],
	browserClosed: false,
	hostClosed: false,
	startedAt: new Date().toISOString(),
};
let browser,
	page,
	host,
	hostClosed,
	hostOutput = "",
	hostErrors = "",
	verify = false;
try {
	console.log(JSON.stringify({ phase: "flame-wrap-editor-started", root }));
	report.bundle = await bundleFlameWrapEditorHost({
		bun,
		workspace,
		pkg,
		root,
		creator,
		configPath,
		env,
	});
	host = spawn(bun, [join(root, "editor-host.mjs")], {
		cwd: workspace,
		windowsHide: true,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	hostClosed = new Promise((done, reject) => {
		host.once("error", reject);
		host.once("close", (code, signal) => done({ code, signal }));
	});
	hostClosed.catch(() => {});
	let lineBuffer = "";
	const ready = new Promise((done, reject) => {
		host.once("error", reject);
		host.once("close", (code) =>
			reject(Error(`Host closed before readiness: ${code}`)),
		);
		host.stdout.on("data", (bytes) => {
			hostOutput += bytes.toString();
			lineBuffer += bytes.toString();
			if (lineBuffer.length > 131072) {
				reject(Error("Host readiness exceeds bound"));
				return;
			}
			let newline;
			while ((newline = lineBuffer.indexOf("\n")) >= 0) {
				const line = lineBuffer.slice(0, newline);
				lineBuffer = lineBuffer.slice(newline + 1);
				try {
					const value = JSON.parse(line);
					if (value.ready && value.editorUrl) done(value.editorUrl);
				} catch {
					/* Other diagnostics are not readiness. */
				}
			}
		});
	});
	host.stderr.on("data", (bytes) => {
		hostErrors += bytes.toString();
	});
	host.stdin.on("error", (error) => {
		hostErrors += String(error);
	});
	const editorUrl = await deadline(ready, 60000, "Private Host readiness");
	const origin = new URL(editorUrl).origin;
	const request = requestClient(editorUrl);
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
	page = await createFlameWrapEditorPage({ browser, origin, report, redact });
	await page.goto(editorUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
	const ui = await runFlameWrapEditorChecks({ page, request, artifacts });
	report.ui = ui.evidence;
	assert(ui.evidence.ok && ui.expectedFrames.length > 1);
	if (stage !== "ui-only") {
		const { runFlameWrapEditorExport } =
			await import("./fixtures/flame-wrap-editor-export.mjs");
		report.export = await runFlameWrapEditorExport({
			page,
			request,
			artifacts,
			expectedFrames: ui.expectedFrames,
		});
		assert(report.export.ok);
	} else
		report.export = {
			ok: false,
			run: false,
			scope: "UI-only diagnostic, export not executed",
		};
	assert.equal(report.pageErrors.length, 0, JSON.stringify(report.pageErrors));
	verify = true;
} catch (error) {
	report.failure = redact(error.stack ?? error);
	if (error.bundleReceipt) report.bundle = error.bundleReceipt;
	try {
		if (page) {
			await page.screenshot({ path: join(root, "failed-ui-audit.png") });
			report.failedUiAudit =
				"failed-ui-audit.png (UI observation only, not pixel oracle)";
			report.canvasObservation = await page.evaluate(() =>
				[...document.querySelectorAll("canvas")].map((canvas) => ({
					width: canvas.width,
					height: canvas.height,
					rect: canvas.getBoundingClientRect().toJSON(),
				})),
			);
		}
	} catch (failure) {
		report.failedUiAuditError = redact(failure);
	}
} finally {
	try {
		if (browser) await deadline(browser.close(), 15000, "Owned browser close");
		report.browserClosed = true;
	} catch (error) {
		report.browserCloseError = redact(error);
	}
	if (host) {
		try {
			if (host.exitCode === null && host.signalCode === null)
				host.stdin.end(verify ? "verify\n" : "stop\n");
			report.hostExit = await deadline(
				hostClosed,
				25000,
				"Private Host close/reopen",
			);
			assert.equal(report.hostExit.code, 0, redact(hostErrors));
			report.hostClosed = true;
		} catch (error) {
			report.hostCloseError = redact(error);
			if (host.exitCode === null && host.signalCode === null) {
				host.kill();
				try {
					report.forcedHostExit = await deadline(
						hostClosed,
						10000,
						"Owned Host forced close",
					);
				} catch (failure) {
					report.forcedCloseError = redact(failure);
				}
			}
		}
	}
	await writeFile(join(root, "host.log"), redact(hostOutput + hostErrors), {
		flag: "wx",
	});
	try {
		for (const file of [...pinned, ...build.frozen, ...build.textModules])
			assert.equal(sha(await readFile(file.path)), file.sha256, file.path);
		report.inputsUnchanged = true;
		if (verify)
			report.hostVerification = JSON.parse(
				await readFile(join(root, "host-lifecycle.json"), "utf8"),
			);
	} catch (error) {
		report.provenanceError = redact(error);
	}
	report.ok =
		verify &&
		report.browserClosed &&
		report.hostClosed &&
		report.inputsUnchanged &&
		report.hostVerification?.verified === true &&
		!report.failure &&
		!report.provenanceError;
	report.finishedAt = new Date().toISOString();
	report.pinned = pinned;
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			phase: "flame-wrap-editor-finished",
			root,
			ok: report.ok,
			failure: report.failure,
			hostCloseError: report.hostCloseError,
			provenanceError: report.provenanceError,
		}),
	);
}
if (!report.ok) process.exitCode = 1;
