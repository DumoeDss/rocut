import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	validateBubbleEditorInputs,
	verifyBubbleEditorInputs,
} from "./fixtures/bubble-editor-provenance.mjs";
import { runBubbleEditorHost } from "./fixtures/bubble-editor-host.mjs";
import { runBubbleEditorChecks } from "./fixtures/bubble-editor-checks.mjs";
import { bubbleEditorContract as contract } from "./fixtures/bubble-editor-contract.mjs";
import { bubbleExportSave as save } from "./fixtures/bubble-export-preflight.mjs";
import {
	blazeEditorRequest as makeRequest,
	blazeEditorPoll as poll,
} from "./fixtures/blaze-editor-control.mjs";
import {
	blazeEditorDeadline as deadline,
	blazeEditorRedact as redact,
	closeBlazeEditorResources,
} from "./fixtures/blaze-editor-lifecycle.mjs";
import { observeBubbleEditorPage } from "./fixtures/bubble-editor-observe.mjs";
import { isBubbleEditorPointPreviewError } from "./fixtures/bubble-editor-observe.mjs";
import { assertBubbleEditorCommitCycle } from "./fixtures/bubble-editor-observe.mjs";

const ownPath = fileURLToPath(import.meta.url);
export function launchBubbleEditorHost({ root, configPath, config, env }) {
	const args = [ownPath, "--host", root, configPath];
	const child = spawn(config.bunPath, args, {
		cwd: config.snapshot,
		env,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "",
		stderr = "",
		pending = "";
	const closed = new Promise((done, reject) => {
		child.once("error", reject);
		child.once("close", (code, signal) => done({ code, signal }));
	});
	const ready = new Promise((done, reject) => {
		child.once("error", reject);
		child.once("close", (code) =>
			reject(Error(`Private Bubble UI Host closed before readiness: ${code}`)),
		);
		child.stdout.setEncoding("utf8").on("data", (text) => {
			stdout += text;
			pending += text;
			if (pending.length > 131072)
				return reject(Error("Host readiness line exceeded bound"));
			let newline;
			while ((newline = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, newline);
				pending = pending.slice(newline + 1);
				try {
					const value = JSON.parse(line);
					if (value.editorUrl) done(value.editorUrl);
				} catch {
					/* Host diagnostic */
				}
			}
		});
	});
	child.stderr.setEncoding("utf8").on("data", (text) => {
		stderr += text;
	});
	child.stdin.on("error", (error) => {
		stderr += String(error);
	});
	return {
		child,
		ready: deadline(ready, 90000, "Bubble UI Host startup"),
		closed,
		logs: () => ({ stdout: redact(stdout), stderr: redact(stderr) }),
	};
}
export function assertBubbleEditorBrowserErrors(evidence) {
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.externalRequests, []);
	assert.deepEqual(evidence.requestFailures, []);
	const rejections = evidence.httpFailures.filter(
		(item) => item.status === 409 && item.path === "/api/apply",
	);
	assert.equal(
		rejections.length,
		evidence.validatedRejections.filter((item) => item.boundary === "http-native").length,
		"Unexpected native validation rejection count",
	);
	assert(evidence.validatedRejections.every((item) => item.boundary === "local-dom-commit-rejection"
		? assertBubbleEditorCommitCycle(item.commitCycle, item.attempt) && item.applyWrites === 0 &&
			item.snapshotUnchanged === true && item.savedBytesUnchanged === true && item.draftVisible === true
		: item.boundary === "http-native" && item.body?.accepted === false && /Invalid Bubble trajectory: InvalidPointTime/.test(JSON.stringify(item.body))));
	assert.deepEqual(
		evidence.httpFailures.filter(
			(item) =>
				!(item.status === 409 && item.path === "/api/apply") &&
				!(
					item.status === 404 &&
					item.path === "/api/library/graph-editor-presets/user-presets"
				),
		),
		[],
	);
	const nativeIndices = new Set(evidence.localPointErrors.filter((error) =>
		evidence.validatedRejections.some((item) => item.attempt === error.attempt)).map((error) => error.consoleIndex));
	assert(evidence.consoleErrors.length <= evidence.httpFailures.length + nativeIndices.size);
	assert(
		evidence.consoleErrors.every((message, index) =>
			(nativeIndices.has(index) && isBubbleEditorPointPreviewError(message)) ||
			[
				"Failed to load resource: the server responded with a status of 404 (Not Found)",
				"Failed to load resource: the server responded with a status of 409 (Conflict)",
			].includes(message),
		),
	);
}
export async function runBubbleEditor(configPath) {
	const { config, inputs, provenance } = await validateBubbleEditorInputs(
		configPath,
		ownPath,
	);
	const root = await mkdtemp(
			join(config.artifactParent, "bubble-production-ui-"),
		),
		temp = join(root, "temp");
	await mkdir(temp);
	const env = {
		...process.env,
		TMP: temp,
		TEMP: temp,
		TMPDIR: temp,
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
	};
	const evidence = {
		ok: false,
		root,
		contract,
		provenance,
		mode: contract.mode,
		errors: [],
		consoleErrors: [],
		httpFailures: [],
		externalRequests: [],
		requestFailures: [],
		applyRequests: [],
		applyRejections: [],
		localPointErrors: [],
		warnings: [],
		validatedRejections: [],
	};
	let host,
		server,
		browser,
		page,
		completed = false;
	try {
		host = launchBubbleEditorHost({ root, configPath, config, env });
		const editorUrl = await host.ready,
			request = makeRequest(editorUrl);
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
		await observeBubbleEditorPage(page, editorUrl, evidence);
		await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
		await page
			.locator(
				`[data-testid="timeline-clip"][data-element-id="${contract.clipId}"]`,
			)
			.waitFor({ timeout: 120000 });
		await poll(async () => (await request("export")).surfaces === 1, 60000);
		await deadline(
			runBubbleEditorChecks({ page, request, root, evidence }),
			360000,
			"Bubble actual DOM authoring checks",
		);
		assertBubbleEditorBrowserErrors(evidence);
		completed = true;
	} catch (error) {
		evidence.failure = redact(error.stack ?? error);
		if (page) {
			await page
				.screenshot({ path: join(root, "failure.png") })
				.catch(() => {});
			await writeFile(
				join(root, "failure-ui.txt"),
				await page
					.locator("body")
					.innerText()
					.catch(() => ""),
				{ encoding: "utf8", flag: "wx" },
			);
		}
	} finally {
		evidence.cleanup = await closeBlazeEditorResources({
			host,
			browser,
			server,
			verify: completed,
		});
		if (host) {
			const logs = host.logs();
			await writeFile(join(root, "host-stdout.log"), logs.stdout, {
				encoding: "utf8",
				flag: "wx",
			});
			await writeFile(join(root, "host-stderr.log"), logs.stderr, {
				encoding: "utf8",
				flag: "wx",
			});
		}
	}
	try {
		assert(completed && !evidence.failure);
		assert(
			evidence.cleanup.hostClosed &&
				evidence.cleanup.browserClosed &&
				!evidence.cleanup.forced,
		);
		assert.deepEqual(evidence.cleanup.errors, []);
		const reopened = JSON.parse(
				await readFile(join(root, "reopened-after-ui.json"), "utf8"),
			),
			lifecycle = JSON.parse(
				await readFile(join(root, "host-lifecycle.json"), "utf8"),
			);
		assert(
			reopened.ok &&
				reopened.byteIdentical &&
				reopened.resourceStillAvailable &&
				lifecycle.hostClosed &&
				lifecycle.reopened &&
				!lifecycle.failure,
		);
		evidence.hostRestart = reopened;
		evidence.ok = true;
	} catch (error) {
		evidence.failure ??= redact(error.stack ?? error);
	}
	try {
		await verifyBubbleEditorInputs(inputs);
		evidence.inputHashesUnchanged = true;
	} catch (error) {
		evidence.ok = false;
		evidence.sourceFailure = redact(error.stack ?? error);
	}
	await save(root, "evidence.json", evidence);
	return {
		root,
		ok: evidence.ok,
		failure: evidence.failure,
		sourceFailure: evidence.sourceFailure,
	};
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(ownPath)) {
	if (process.argv[2] === "--host") {
		assert.equal(process.argv.length, 5);
		await runBubbleEditorHost(process.argv[3], process.argv[4]);
	} else if (process.argv[2] === "--validate") {
		assert.equal(process.argv.length, 4);
		const value = await validateBubbleEditorInputs(process.argv[3], ownPath);
		await verifyBubbleEditorInputs(value.inputs);
		console.log(JSON.stringify({ ok: true, provenance: value.provenance }));
	} else {
		assert.equal(
			process.argv.length,
			3,
			"Usage: node script/probe-bubble-editor.mjs [--validate] <private-export-config.json>",
		);
		const result = await runBubbleEditor(process.argv[2]);
		console.log(JSON.stringify(result));
		process.exitCode = result.ok ? 0 : 1;
	}
}
