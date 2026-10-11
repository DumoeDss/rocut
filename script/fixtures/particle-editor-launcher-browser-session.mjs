import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium } from "../browser-probe-toolchain.mjs";
import { readJson, writeJson } from "../particle-c4-export-support.mjs";
import { poll } from "./stylized-fusion-checks.mjs";
import {
	observeParticleFrames,
	runParticleEditorChecks,
} from "./particle-editor-checks.mjs";
import { installParticleAuthorityBrowserObserver } from "./particle-editor-export-authority-browser.mjs";
import { captureParticleAuthorityReferences } from "./particle-editor-authority-references.mjs";
import { assertParticleSnapshot } from "./particle-editor-contract.mjs";

/** Publish resource handles immediately so the caller's original finally owns them. */
export async function runParticleEditorBrowserSession({
	ready,
	options,
	root,
	env,
	evidence,
	authority,
	redact,
	session,
}) {
	const origin = new URL(ready.editorUrl).origin;
	const request = async (...args) => {
		const [route, body] = args;
		const response = await fetch(new URL(`api/${route}`, ready.editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		if (!response.ok) throw Error(`Host ${route} returned ${response.status}`);
		return response.json();
	};
	session.browser = await chromium.launch({
		headless: true,
		executablePath: options.chromium,
		env,
		timeout: 60000,
		args: [
			"--no-proxy-server",
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	const page = await session.browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
	});
	session.browserPage = page;
	if (authority)
		await page.addInitScript(installParticleAuthorityBrowserObserver, {
			expectedWasmSha256: authority.metadata.nativeAuthority.wasmSha256,
		});
	page.on("pageerror", (error) => evidence.errors.push(redact(error.message)));
	page.on("console", (message) => {
		if (message.type() === "error")
			evidence.consoleErrors.push(redact(message.text()));
	});
	page.on("response", (response) => {
		if (response.status() < 400) return;
		const path = new URL(response.url()).pathname;
		if (
			response.status() === 404 &&
			path.endsWith("/api/library/graph-editor-presets/user-presets")
		)
			return;
		evidence.httpFailures.push({
			status: response.status(),
			path: redact(path),
		});
	});
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			evidence.externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	const frames = observeParticleFrames(page);
	await page.goto(ready.editorUrl, { waitUntil: "load", timeout: 60000 });
	await page
		.locator('[data-testid="timeline-clip"][data-element-id="particle-model"]')
		.waitFor({ timeout: 60000 });
	await poll(async () => (await request("export")).surfaces === 1);
	await runParticleEditorChecks({ page, root, request, frames, evidence });

	if (authority) {
		const expected = await readJson(join(root, "expected-final-state.json"));
		assert.equal(expected.revision, 7);
		const disk = await readJson(join(root, "project/project.json"));
		const capture = await captureParticleAuthorityReferences({
			page,
			root,
			dimensions: disk.record.data.settings.canvasSize,
			frames,
			revision: expected.revision,
		});
		evidence.corePreviewReferences = evidence.previewReferences;
		evidence.previewReferences = capture.references;
		evidence.integerGeometry = capture.geometry;
		assertParticleSnapshot(
			{
				clips: await request("clips"),
				tracks: await request("tracks"),
				revision: (await request("context")).revision,
			},
			expected,
		);
		assert.deepEqual((await request("record")).record, disk.record);
		evidence.browserWasmObservation = await page.evaluate(() =>
			globalThis.__particleAuthorityWasmObservation.assertConsumed(),
		);
		await writeJson(
			join(root, "particle-browser-authority.json"),
			evidence.browserWasmObservation,
		);
	}
	evidence.frameRequests = frames.requests;
	evidence.browser = session.browser.version();
	assert.deepEqual(evidence.errors, []);
	assert.deepEqual(evidence.httpFailures, []);
	assert.deepEqual(evidence.externalRequests, []);
}
