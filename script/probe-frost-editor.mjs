import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	preflightFrostEditor,
	assertFrostInputPins,
} from "./fixtures/frost-editor-preflight.mjs";
import {
	assertPrivateFrostHost,
	prepareFrostEditorProject,
} from "./fixtures/frost-editor-project.mjs";
import { runFrostEditorChecks } from "./fixtures/frost-editor-checks.mjs";
import { runFrostEditorExport } from "./fixtures/frost-editor-export.mjs";
import { poll } from "./fixtures/flame-wrap-editor-controls.mjs";
import { flameWrapEditorRequest } from "./fixtures/flame-wrap-editor-request.mjs";
import { createFlameWrapEditorPage } from "./fixtures/flame-wrap-editor-browser.mjs";
import {
	blazeEditorDeadline,
	blazeEditorRedact,
} from "./fixtures/blaze-editor-lifecycle.mjs";

const [configPath, mode = "--preflight"] = process.argv.slice(2);
assert(
	["--preflight", "--live", "--export"].includes(mode) && configPath,
	"Expected config.json [--preflight|--live|--export]",
);
const configBytes = await readFile(configPath);
const config = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(configBytes),
);
const exportAttempt = config.exportAttempt ?? "first";
assert(/^[a-z0-9-]+$/.test(exportAttempt));
const entryFile = fileURLToPath(import.meta.url);
const inputs = await preflightFrostEditor({ ...config, entryFile });
if (mode === "--preflight") {
	console.log(
		JSON.stringify({
			ok: true,
			mode,
			frostModules: inputs.frostModules.length,
			verifiedBuildFiles: inputs.validation.files.length,
			wasmSha256: inputs.build.wasmSha256,
			browserRun: false,
			hostRun: false,
			scope: inputs.scope,
		}),
	);
} else {
	const artifacts = {
		root: resolve(config.root),
		projectPath: resolve(config.projectPath),
		width: 192,
		height: 128,
		clipId: "frost-static",
		disabledClipId: "frost-disabled",
		effectId: "template-frost",
		finalTicks: 40000,
		usePresentationObserver: true,
	};
	const url = new URL(config.editorUrl);
	assert(
		["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
			url.protocol === "http:",
	);
	const request = flameWrapEditorRequest(url.href);
	await assertPrivateFrostHost({ request, artifacts });
	const report = {
		ok: false,
		mode,
		preflight: inputs.validation,
		console: [],
		pageErrors: [],
		externalRequests: [],
		httpFailures: [],
		browserClosed: false,
		hostOwned: false,
		hostCloseReopenVerified: false,
		exportRun: false,
		scope:
			mode === "--export"
				? "Own browser on matching private Host; same-project production export and independent media decode/preview parity, not independent optical oracle"
				: "Own browser on caller-supplied matching private Host; UI/history/reload presentation copy only",
	};
	let browser;
	try {
		await assertPrivateFrostHost({ request, artifacts });
		if (config.prepare === true)
			report.prepared = await prepareFrostEditorProject({
				...config,
				request,
				artifacts,
			});
		const { chromium } = await import("./browser-probe-toolchain.mjs");
		browser = await chromium.launch({
			headless: true,
			args: [
				"--no-proxy-server",
				"--use-angle=swiftshader",
				"--enable-unsafe-swiftshader",
				"--disable-webgpu",
			],
		});
		report.browserVersion = browser.version();
		const page = await createFlameWrapEditorPage({
			browser,
			origin: url.origin,
			report,
			redact: blazeEditorRedact,
		});
		await page.goto(url.href, {
			waitUntil: "domcontentloaded",
			timeout: 60000,
		});
		if (mode === "--export") {
			report.exportAttempted = true;
			await poll(async () => (await request("export")).surfaces === 1);
			const expectedFrames = JSON.parse(
				await readFile(
					join(artifacts.root, "frost-editor-expected-frames.json"),
					"utf8",
				),
			);
			report.exports = [];
			for (const videoChroma of ["420", "444"]) {
				const root = join(
					artifacts.root,
					`frost-export-${videoChroma}-${exportAttempt}`,
				);
				await mkdir(root);
				try {
					report.exports.push(
						await runFrostEditorExport({
							page,
							request,
							artifacts: { ...artifacts, root, videoChroma },
							expectedFrames,
						}),
					);
				} catch (error) {
					report.exports.push({
						ok: false,
						videoChroma,
						failure: blazeEditorRedact(error.stack ?? error),
					});
				}
			}
			report.exportRun = report.exports.some(
				(item) => item.encodingAndPreviewParity,
			);
		} else
			report.ui = (
				await runFrostEditorChecks({ page, request, artifacts })
			).evidence;
	} catch (error) {
		report.failure = blazeEditorRedact(error.stack ?? error);
	} finally {
		try {
			if (browser)
				await blazeEditorDeadline(
					browser.close(),
					15000,
					"Owned Frost browser close",
				);
			report.browserClosed = Boolean(browser);
		} catch (error) {
			report.browserCloseError = blazeEditorRedact(error);
		}
		try {
			assert.deepEqual(
				await readFile(configPath),
				configBytes,
				"Runner config changed",
			);
			await assertFrostInputPins(inputs);
			report.inputsUnchanged = true;
		} catch (error) {
			report.inputFailure = blazeEditorRedact(error.stack ?? error);
		}
		report.ok =
			(mode === "--export"
				? report.exports?.every((item) => item.ok)
				: report.ui?.ok === true) &&
			report.browserClosed &&
			report.inputsUnchanged &&
			!report.failure;
		await writeFile(
			join(
				artifacts.root,
				mode === "--export"
					? `frost-editor-export-${exportAttempt}-run-evidence.json`
					: "frost-editor-run-evidence.json",
			),
			JSON.stringify(report, null, 2),
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				ok: report.ok,
				root: artifacts.root,
				failure: report.failure,
			}),
		);
	}
	if (!report.ok) process.exitCode = 1;
}
