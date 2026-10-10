import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { blazeEditorContract as uiContract } from "./fixtures/blaze-editor-contract.mjs";
import {
	blazeEditorDigest,
	blazeEditorPoll,
	blazeEditorRequest,
	blazeEditorWrite as save,
} from "./fixtures/blaze-editor-control.mjs";
import {
	blazeEditorDeadline,
	blazeEditorRedact,
	closeBlazeEditorResources,
	launchBlazeEditorHost,
} from "./fixtures/blaze-editor-lifecycle.mjs";
import { runBlazeEditorChecks } from "./fixtures/blaze-editor-checks.mjs";
import { assertBlazeEditorBytes } from "./fixtures/blaze-editor-persistence.mjs";
import {
	blazeEditorExportJobs,
	blazeEditorExportThresholds,
} from "./fixtures/blaze-editor-export-contract.mjs";
import {
	validateBlazeEditorExportInputs,
	verifyBlazeEditorExportInputHashes,
} from "./fixtures/blaze-editor-export-provenance.mjs";
import {
	observeBlazeEditorExportPage,
	assertBlazeEditorExportBrowserErrors,
} from "./fixtures/blaze-editor-export-browser.mjs";
import { runBlazeEditorExportChecks } from "./fixtures/blaze-editor-export-checks.mjs";
import { blazeEditorProjectFiles } from "./fixtures/blaze-editor-export-persistence.mjs";
import { decodeBlazeEditorExport } from "./fixtures/blaze-editor-export-decode.mjs";

assert.equal(
	process.argv.length,
	3,
	"Usage: node <snapshot>/script/probe-blaze-editor-export.mjs <export-config.json>",
);
const sourceRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const validated = await validateBlazeEditorExportInputs(
	process.argv[2],
	sourceRoot,
);
const { config, provenance, exportConfig, exportProvenance, inputs } =
	validated;
const root = await mkdtemp(join(config.artifactParent, "blaze-editor-export-")),
	temp = join(root, "temp");
await mkdir(temp);
const evidence = {
	ok: false,
	kind: "blaze-ui-authored-production-export",
	root,
	provenance,
	exportProvenance,
	scope: uiContract,
	thresholds: blazeEditorExportThresholds,
	plannedJobs: blazeEditorExportJobs,
	errors: [],
	consoleErrors: [],
	httpFailures: [],
	externalRequests: [],
	warnings: [],
};
const env = {
	...process.env,
	TMP: temp,
	TEMP: temp,
	TMPDIR: temp,
	ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
};
let host,
	browser,
	server,
	page,
	uiReady = false,
	exported = false;
try {
	host = launchBlazeEditorHost({
		snapshot: config.snapshot,
		root,
		configPath: exportConfig.uiConfigPath,
		env,
	});
	evidence.hostCommand = { command: host.command, args: host.args };
	const editorUrl = await host.ready,
		request = blazeEditorRequest(editorUrl);
	const { chromium } = await import("./browser-probe-toolchain.mjs");
	server = await chromium.launchServer({
		executablePath: config.executablePath,
		headless: true,
		env,
		args: [
			"--no-proxy-server",
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	browser = await chromium.connect(server.wsEndpoint(), { timeout: 30000 });
	evidence.browser = browser.version();
	page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
	});
	await observeBlazeEditorExportPage(page, editorUrl, evidence);
	await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${uiContract.staticId}"]`,
		)
		.waitFor({ timeout: 120000 });
	await blazeEditorPoll(async () => (await request("export")).surfaces === 1);
	await blazeEditorDeadline(
		runBlazeEditorChecks({ page, root, request, evidence }),
		240000,
		"Frozen Blaze UI authoring sequence",
	);
	uiReady = true;
	await blazeEditorDeadline(
		runBlazeEditorExportChecks({
			root,
			page,
			request,
			editorUrl,
			snapshot: config.snapshot,
			evidence,
		}),
		660000,
		"Blaze six independent export requests",
	);
	assertBlazeEditorExportBrowserErrors(evidence);
	exported = true;
} catch (error) {
	evidence.failure = blazeEditorRedact(error.stack ?? error);
	if (page)
		await page.screenshot({ path: join(root, "failure.png") }).catch(() => {});
} finally {
	evidence.cleanup = await closeBlazeEditorResources({
		browser,
		server,
		host,
		verify: uiReady,
	});
	if (host) {
		const logs = host.logs();
		await save(root, "host-stdout.log", logs.stdout);
		await save(root, "host-stderr.log", logs.stderr);
		evidence.hostLogSha256 = {
			stdout: blazeEditorDigest(logs.stdout),
			stderr: blazeEditorDigest(logs.stderr),
		};
	}
}
try {
	assert(
		exported && !evidence.failure,
		evidence.failure ?? "UI production exports did not complete",
	);
	assert(
		evidence.cleanup.browserClosed &&
			evidence.cleanup.hostClosed &&
			!evidence.cleanup.forced,
	);
	assert.deepEqual(evidence.cleanup.errors, []);
	const reopened = JSON.parse(
		await readFile(join(root, "reopened-after-edit.json"), "utf8"),
	);
	const lifecycle = JSON.parse(
		await readFile(join(root, "host-lifecycle.json"), "utf8"),
	);
	assert(
		reopened.ok && reopened.byteIdentical && reopened.resourceStillAvailable,
	);
	assert(
		lifecycle.hostClosed && lifecycle.reopenedAfterEdits && !lifecycle.error,
	);
	assert.deepEqual(reopened.snapshot, evidence.exportBaseline.snapshot);
	assertBlazeEditorBytes(
		await readFile(join(root, "project-final-ui.json")),
		await readFile(join(root, "project/project.json")),
		"after-browser-close-host-reopen",
	);
	assert.deepEqual(
		await blazeEditorProjectFiles(join(root, "project")),
		evidence.exportReadOnly.at(-1).files,
	);
	evidence.hostRestart = reopened;
	evidence.independentDecodes = [];
	for (const job of evidence.exportJobs)
		evidence.independentDecodes.push(
			await decodeBlazeEditorExport({
				root,
				ffmpegDirectory: exportConfig.ffmpegDirectory,
				...job,
				reference: evidence.independentExpected.segments.find(
					(reference) => reference.segment === job.spec.id,
				),
			}),
		);
	assert.equal(evidence.independentDecodes.length, 6);
	assert(
		evidence.independentDecodes.every((result) => result.ok),
		"Independent FFmpeg decode failed a frozen gate",
	);
	evidence.scope = { ...uiContract, videoExportTested: true };
	evidence.checks.push(
		"six independent default/444 production exports",
		"independent canonical PNG decoding and frozen CPU oracle",
		"default FFmpeg decode and fixed pixel/timing gates",
		"all export stages and Host reopen preserve complete project bytes and revision",
	);
	evidence.ok = true;
} catch (error) {
	evidence.failure ??= blazeEditorRedact(error.stack ?? error);
} finally {
	try {
		await verifyBlazeEditorExportInputHashes(inputs);
		evidence.inputHashesUnchanged = true;
	} catch (error) {
		evidence.ok = false;
		evidence.sourceFailure = blazeEditorRedact(error.stack ?? error);
	}
	await save(root, "evidence.json", evidence);
	console.log(
		JSON.stringify({
			root,
			ok: evidence.ok,
			failure: evidence.failure,
			sourceFailure: evidence.sourceFailure,
		}),
	);
}
process.exitCode = evidence.ok ? 0 : 1;
