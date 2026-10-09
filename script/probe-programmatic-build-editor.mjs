import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { buildAuthorEditor } from "./fixtures/programmatic-build-editor-build.mjs";
import {
	startAuthorHost,
	redactHostUrl,
} from "./fixtures/programmatic-build-editor-host-process.mjs";
import {
	checkAuthorEditor,
	checkLateCompilerReply,
} from "./fixtures/programmatic-build-editor-checks.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!isolated || !process.env.ROCUT_TEST_ENGINE_TOOLCHAIN)
	throw Error("Set private WASM and pinned engine toolchain directories");
const artifact = await mkdtemp(join(tmpdir(), "rocut-build-editor-"));
console.log(JSON.stringify({ artifact, state: "building" }));
let host, browser, page;
const errors = [],
	resourceErrors = [],
	checks = [];
try {
	const reuse = process.env.ROCUT_AUTHOR_EDITOR_REUSE_WEB;
	const output =
		reuse || (await buildAuthorEditor({ root, artifact, isolated }));
	// A reused build stays immutable; each Host gets a new directory with its own fixture JSON.
	let staticDir = output;
	if (reuse) {
		const { cp } = await import("node:fs/promises");
		staticDir = join(artifact, "web");
		await mkdir(staticDir);
		await cp(output, staticDir, {
			recursive: true,
			filter: (path) => !path.endsWith("author-fixture.json"),
		});
	}
	console.log(JSON.stringify({ state: "built" }));
	host = await startAuthorHost({
		root,
		artifact,
		output: staticDir,
		browserPath: chromium.executablePath(),
	});
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
	});
	page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
	page.on("pageerror", (error) => errors.push(redactHostUrl(error.message)));
	page.on("response", (response) => {
		if (response.status() >= 400)
			resourceErrors.push({
				status: response.status(),
				url: redactHostUrl(response.url()),
			});
	});
	const url = new URL(
		"script/fixtures/programmatic-build-editor-browser.html",
		host.ready.editorUrl,
	).href;
	await page.goto(url);
	console.log(JSON.stringify({ state: "page-opened" }));
	checks.push(...(await checkAuthorEditor({ page, artifact })));
	checks.push(await checkLateCompilerReply(page));
	await page.getByLabel("Author code", { exact: true }).waitFor();
	checks.push(await checkLateCompilerReply(page, { conflict: true }));
	await page.evaluate(() => globalThis.__buildEditorProbe.dispose());
	await page.goto(`${url}?noCompiler=1`);
	await page
		.getByLabel("Author code", { exact: true })
		.waitFor({ timeout: 30000 });
	await page
		.getByText("This host has no archived-source compiler bridge.", {
			exact: false,
		})
		.waitFor();
	assert.equal(
		await page
			.getByRole("button", { name: "Recompile and apply", exact: true })
			.isDisabled(),
		true,
	);
	assert.equal(
		await page.getByLabel("Author code", { exact: true }).isDisabled(),
		false,
	);
	checks.push(
		"Host without revise bridge exposes copyable source and disabled apply",
	);
	await page.evaluate(() => globalThis.__buildEditorProbe.dispose());
	assert.deepEqual(errors, []);
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(
			{
				state: "passed",
				checks,
				errors,
				metadata: host.ready.metadata,
				wasm: isolated,
				scope:
					"Real compiler/archive/PNG and editor UI; in-memory timeline, not installed Electron",
			},
			null,
			2,
		),
	);
	console.log(
		JSON.stringify({ artifact, state: "passed", checks: checks.length }),
	);
} catch (error) {
	const failure = {
		state: "failed",
		checks,
		errors,
		resourceErrors,
		error: redactHostUrl(error.stack ?? error),
	};
	await writeFile(
		join(artifact, "failure.json"),
		JSON.stringify(failure, null, 2),
	);
	if (page)
		await page
			.screenshot({ path: join(artifact, "failure.png"), fullPage: true })
			.catch(() => {});
	console.error(JSON.stringify(failure));
	process.exitCode = 1;
} finally {
	await browser?.close();
	await host?.stop();
	console.log(JSON.stringify({ state: "private-processes-closed" }));
}
