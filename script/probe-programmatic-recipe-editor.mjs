import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildRecipeEditor,
	verifyRecipeSourceInputs,
} from "./fixtures/programmatic-recipe-editor-build.mjs";
import { checkRecipeEditor } from "./fixtures/programmatic-recipe-editor-checks.mjs";
import {
	resolveHtmlProbeWasmBinding,
	assertHtmlProbeWasmIdentity,
	snapshotHtmlProbeSources,
} from "./html-probe-wasm-binding.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binding = resolveHtmlProbeWasmBinding(
	process.env.ROCUT_TEST_WASM_DIRECTORY,
);
assert.ok(
	binding,
	"Explicit private ROCUT_TEST_WASM_DIRECTORY is required; no shared fallback",
);
const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE,
	temporary = process.env.TEMP;
assert.ok(
	executable && isAbsolute(executable),
	"Explicit absolute ROCUT_TEST_BROWSER_EXECUTABLE required",
);
assert.ok(lstatSync(executable).isFile(), "Browser executable missing");
assert.ok(
	temporary && isAbsolute(temporary) && lstatSync(temporary).isDirectory(),
	"Explicit existing absolute TEMP required",
);
const artifact = await mkdtemp(join(temporary, "rocut-recipe-editor-"));
console.log(
	JSON.stringify({ artifact, state: "building-private-recipe-fixture" }),
);
const { output, sourceInputs: browserSourceInputs } = await buildRecipeEditor({
	root,
	artifact,
	binding,
});
const sourceInputs = [
	...browserSourceInputs,
	...snapshotHtmlProbeSources(root, [
		"script/probe-programmatic-recipe-editor.mjs",
		"script/fixtures/programmatic-recipe-editor-build.mjs",
		"script/fixtures/programmatic-recipe-editor-checks.mjs",
		"script/html-probe-wasm-binding.mjs",
		"script/browser-probe-toolchain.mjs",
	]),
];
await writeFile(
	join(artifact, "build-identity.json"),
	JSON.stringify({ binding: binding.identity, sourceInputs }, null, 2),
	{ flag: "wx" },
);
if (process.env.ROCUT_RECIPE_EDITOR_BUILD_ONLY !== "1") {
	const { chromium, createServer } =
		await import("./browser-probe-toolchain.mjs");
	let browser, server, page;
	const errors = [],
		externalRequests = [],
		resourceErrors = [];
	try {
		server = await createServer({
			root: output,
			configFile: false,
			cacheDir: join(artifact, "serve-cache"),
			logLevel: "error",
			optimizeDeps: { noDiscovery: true, include: [] },
			server: { host: "127.0.0.1", port: 0, hmr: false },
		});
		await server.listen();
		const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
		browser = await chromium.launch({
			headless: true,
			executablePath: executable,
		});
		page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("response", (response) => {
			if (response.status() >= 400)
				resourceErrors.push({ status: response.status(), url: response.url() });
		});
		await page.route("**/*", (route) => {
			const url = route.request().url();
			if (url.startsWith(origin + "/") || /^(data|blob):/.test(url))
				return route.continue();
			externalRequests.push(url);
			return route.abort("blockedbyclient");
		});
		await page.goto(
			`${origin}/script/fixtures/programmatic-recipe-editor-browser.html`,
		);
		const result = await checkRecipeEditor({ page, artifact });
		const observed = await page.evaluate(
			() => globalThis.__htmlProbeWasmIdentity,
		);
		assertHtmlProbeWasmIdentity(binding, observed);
		verifyRecipeSourceInputs({ root, inputs: sourceInputs });
		await page.evaluate(() => globalThis.__recipeEditorProbe.dispose());
		assert.deepEqual(errors, []);
		assert.deepEqual(externalRequests, []);
		assert.deepEqual(resourceErrors, []);
		const sourceHashes = result.sources.map((source) =>
			createHash("sha256").update(JSON.stringify(source)).digest("hex"),
		);
		await writeFile(
			join(artifact, "verification.json"),
			JSON.stringify(
				{
					state: "passed",
					...result,
					sourceHashes,
					sourceInputs,
					wasmIdentity: observed,
					browser: executable,
					errors,
					externalRequests,
					resourceErrors,
					scope:
						"Real browser recipe panel, in-memory ProjectStore, native transactions/history, Rust solid recipe canvas preview. No Bun mocks, installed Electron, compiled HTML preview, final export, or visual basic-field form acceptance.",
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		console.log(
			JSON.stringify({
				artifact,
				state: "passed",
				checks: result.checks.length,
				sourceHashes,
			}),
		);
	} catch (error) {
		await writeFile(
			join(artifact, "failure.json"),
			JSON.stringify(
				{
					state: "failed",
					error: String(error.stack ?? error),
					errors,
					externalRequests,
					resourceErrors,
					sourceInputs,
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		if (page)
			await page
				.screenshot({ path: join(artifact, "failure.png"), fullPage: true })
				.catch(() => {});
		throw error;
	} finally {
		await browser?.close();
		await server?.close();
	}
} else
	console.log(
		JSON.stringify({ artifact, state: "build-only-not-browser-verified" }),
	);
