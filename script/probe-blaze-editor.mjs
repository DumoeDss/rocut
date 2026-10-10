import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlazeEditorInputs } from "./fixtures/blaze-editor-provenance.mjs";
import { blazeEditorContract as contract } from "./fixtures/blaze-editor-contract.mjs";
import {
	blazeEditorDigest,
	blazeEditorPoll,
	blazeEditorRequest,
	blazeEditorWrite,
} from "./fixtures/blaze-editor-control.mjs";
import {
	blazeEditorDeadline,
	blazeEditorRedact,
	closeBlazeEditorResources,
	launchBlazeEditorHost,
} from "./fixtures/blaze-editor-lifecycle.mjs";
import { runBlazeEditorChecks } from "./fixtures/blaze-editor-checks.mjs";

assert.equal(
	process.argv.length,
	3,
	"Usage: node <derived>/script/probe-blaze-editor.mjs <private-run-config.json>",
);
const configPath = process.argv[2],
	sourceRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const { config, provenance } = await validateBlazeEditorInputs(
	configPath,
	sourceRoot,
);
const root = await mkdtemp(join(config.artifactParent, "blaze-editor-")),
	temp = join(root, "temp");
await mkdir(temp);
const evidence = {
	ok: false,
	root,
	scope: contract,
	provenance,
	mode: "real-editor-parameters-history-persistence-only",
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
	readyForHostVerification = false;
try {
	host = launchBlazeEditorHost({
		snapshot: config.snapshot,
		root,
		configPath,
		env,
	});
	evidence.hostCommand = { command: host.command, args: host.args };
	const editorUrl = await host.ready;
	const request = blazeEditorRequest(editorUrl);
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
	await page.route(
		(url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
		async (route) => {
			evidence.externalRequests.push(new URL(route.request().url()).origin);
			await route.abort();
		},
	);
	page.on("pageerror", (error) =>
		evidence.errors.push(blazeEditorRedact(error.message)),
	);
	page.on("console", (message) => {
		if (message.type() === "error")
			evidence.consoleErrors.push(blazeEditorRedact(message.text()));
		if (message.type() === "warning")
			evidence.warnings.push(blazeEditorRedact(message.text()));
	});
	page.on("response", (response) => {
		if (response.status() >= 400)
			evidence.httpFailures.push({
				status: response.status(),
				path:
					"/" +
					new URL(response.url()).pathname.slice(
						new URL(editorUrl).pathname.length,
					),
			});
	});
	await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
	await page
		.locator(
			`[data-testid="timeline-clip"][data-element-id="${contract.staticId}"]`,
		)
		.waitFor({ timeout: 120000 });
	await blazeEditorPoll(async () => (await request("export")).surfaces === 1);
	await blazeEditorDeadline(
		runBlazeEditorChecks({ page, root, request, evidence }),
		240000,
		"Blaze editor checks",
	);
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.externalRequests, []);
	assert.deepEqual(
		evidence.httpFailures.filter(
			(failure) =>
				!(
					failure.status === 404 &&
					failure.path === "/api/library/graph-editor-presets/user-presets"
				),
		),
		[],
	);
	assert(evidence.consoleErrors.length <= evidence.httpFailures.length);
	assert(
		evidence.consoleErrors.every(
			(message) =>
				message ===
				"Failed to load resource: the server responded with a status of 404 (Not Found)",
		),
	);
	readyForHostVerification = true;
} catch (error) {
	evidence.failure = blazeEditorRedact(error.stack ?? error);
	if (page) {
		await page.screenshot({ path: join(root, "failure.png") }).catch(() => {});
		await blazeEditorWrite(
			root,
			"failure-ui.txt",
			await page
				.locator("body")
				.innerText()
				.catch(() => ""),
		);
	}
} finally {
	evidence.cleanup = await closeBlazeEditorResources({
		browser,
		server,
		host,
		verify: readyForHostVerification,
	});
	if (host) {
		const logs = host.logs();
		await blazeEditorWrite(root, "host-stdout.log", logs.stdout);
		await blazeEditorWrite(root, "host-stderr.log", logs.stderr);
		evidence.hostLogSha256 = {
			stdout: blazeEditorDigest(logs.stdout),
			stderr: blazeEditorDigest(logs.stderr),
		};
	}
	if (
		readyForHostVerification &&
		evidence.cleanup.errors.length === 0 &&
		!evidence.cleanup.forced
	) {
		try {
			const reopened = JSON.parse(
				await readFile(join(root, "reopened-after-edit.json"), "utf8"),
			);
			const lifecycle = JSON.parse(
				await readFile(join(root, "host-lifecycle.json"), "utf8"),
			);
			assert(
				reopened.ok &&
					reopened.byteIdentical &&
					reopened.resourceStillAvailable,
			);
			assert(
				lifecycle.hostClosed &&
					lifecycle.reopenedAfterEdits &&
					!lifecycle.error,
			);
			evidence.hostRestart = reopened;
			evidence.ok = true;
		} catch (error) {
			evidence.failure = blazeEditorRedact(error.stack ?? error);
		}
	}
	await blazeEditorWrite(root, "evidence.json", evidence);
	console.log(
		JSON.stringify({ root, ok: evidence.ok, failure: evidence.failure }),
	);
}
process.exitCode = evidence.ok ? 0 : 1;
