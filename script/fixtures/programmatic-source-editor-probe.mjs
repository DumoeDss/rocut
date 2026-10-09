import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import {
	chromium,
	build,
	createServer,
	wasm,
	topLevelAwait,
} from "../browser-probe-toolchain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!isolated) throw Error("Set ROCUT_TEST_WASM_DIRECTORY to private web WASM");
process.on("uncaughtException", (error) => {
	console.log(
		JSON.stringify({ state: "uncaught", error: String(error.stack) }),
	);
	process.exitCode = 1;
});
const artifact =
	process.env.ROCUT_SOURCE_EDITOR_ARTIFACT ??
	(await mkdtemp(join(tmpdir(), "rocut-source-editor-")));
console.log(JSON.stringify({ artifact, state: "building-panel-fixture" }));
const require = createRequire(join(root, "apps/vite-example/package.json"));
const { default: react } = await import(
	pathToFileURL(require.resolve("@vitejs/plugin-react")).href
);
const entry = join(isolated, "opencut_wasm.js").replaceAll("\\", "/");
const output = join(artifact, "web");
if (
	!process.env.ROCUT_SOURCE_EDITOR_ARTIFACT ||
	process.env.ROCUT_SOURCE_EDITOR_REBUILD === "1"
)
	await build({
		root,
		configFile: false,
		logLevel: "error",
		publicDir: false,
		css: { postcss: join(root, "apps/vite-example") },
		plugins: [
			react(),
			{
				name: "source-editor-private-wasm",
				enforce: "pre",
				resolveId(id) {
					if (id === "opencut-wasm") return "\0source-editor-wasm";
				},
				load(id) {
					if (id === "\0source-editor-wasm")
						return `import init from ${JSON.stringify(entry)}; await init(); export * from ${JSON.stringify(entry)};`;
				},
				generateBundle() {
					for (const id of this.getModuleIds())
						if (/[/\\]node_modules[/\\]opencut-wasm[/\\]/.test(id))
							throw Error("Shared WASM imported");
				},
			},
			wasm(),
			topLevelAwait(),
		],
		resolve: {
			dedupe: ["react", "react-dom"],
			alias: {
				mediabunny: join(
					dirname(require.resolve("mediabunny")),
					"../modules/src/index.js",
				),
			},
		},
		build: {
			outDir: output,
			emptyOutDir: false,
			target: "esnext",
			reportCompressedSize: false,
			rollupOptions: {
				input: join(
					root,
					"script/fixtures/programmatic-source-editor-browser.html",
				),
			},
		},
	});
console.log(JSON.stringify({ state: "panel-built" }));
if (process.env.ROCUT_SOURCE_EDITOR_BUILD_ONLY === "1") process.exit(0);
let server, browser;
const errors = [];
let checks = 0;
try {
	server = await createServer({
		root: output,
		configFile: false,
		cacheDir: join(artifact, "vite-cache"),
		logLevel: "error",
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	console.log(JSON.stringify({ state: "server-listening" }));
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
	});
	console.log(JSON.stringify({ state: "browser-launched" }));
	const page = await browser.newPage({
		viewport: { width: 1100, height: 900 },
	});
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/programmatic-source-editor-browser.html`,
	);
	const pixel = async (value) => {
		await page
			.getByTestId("pixel")
			.filter({ hasText: value })
			.waitFor({ timeout: 15000 });
		checks++;
	};
	await pixel("255,0,0,255");
	const editor = page.getByLabel("Canvas code", { exact: true });
	const original = await editor.inputValue();
	const green = original.replace("#ff0000", "#00ff00");
	await editor.fill(green);
	assert.equal(
		await page.getByTestId("committed-code").textContent(),
		original,
	);
	checks++;
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await pixel("0,255,0,255");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await pixel("255,0,0,255");
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await pixel("0,255,0,255");
	await editor.fill("saved draft A");
	await page.getByRole("button", { name: "Select clip B" }).click();
	await pixel("0,0,255,255");
	assert.ok((await editor.inputValue()).includes("#0000ff"));
	checks++;
	await page.getByRole("button", { name: "Select clip A" }).click();
	assert.equal(await editor.inputValue(), "saved draft A");
	checks++;
	await page.getByRole("button", { name: "External inline update" }).click();
	await pixel("255,255,0,255");
	assert.equal(await editor.inputValue(), "saved draft A");
	assert.equal(
		await page.getByRole("button", { name: "Apply", exact: true }).isDisabled(),
		true,
	);
	checks += 2;
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	assert.ok((await editor.inputValue()).includes("#ffff00"));
	checks++;
	await editor.fill("");
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await page
		.getByRole("alert")
		.filter({ hasText: "editing.programmatic" })
		.waitFor();
	checks++;
	assert.equal(await editor.inputValue(), "");
	checks++;
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await editor.fill("draft to copy before discard");
	await page.getByRole("button", { name: "External document update" }).click();
	const recovered = page.getByLabel("Previous inline draft (read-only)");
	await recovered.waitFor();
	assert.equal(await recovered.inputValue(), "draft to copy before discard");
	assert.equal(await recovered.isDisabled(), false);
	await recovered.focus();
	await page.keyboard.press("Control+A");
	assert.equal(
		await recovered.evaluate((el) =>
			el.value.slice(el.selectionStart, el.selectionEnd),
		),
		"draft to copy before discard",
	);
	checks += 3;
	assert.equal(
		await page.getByRole("button", { name: "Apply", exact: true }).isDisabled(),
		true,
	);
	checks++;
	await page.screenshot({
		path: join(artifact, "retained-readonly-draft.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	assert.equal(await recovered.count(), 0);
	checks++;
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await pixel("255,255,0,255");
	await page.screenshot({
		path: join(artifact, "source-panel.png"),
		fullPage: true,
	});
	await page.evaluate(() => globalThis.__sourceEditorProbe.dispose());
	assert.deepEqual(errors, []);
	checks++;
	await writeFile(
		join(artifact, "verification.json"),
		JSON.stringify(
			{ checks, errors, state: "passed", wasm: isolated },
			null,
			2,
		),
	);
	console.log(JSON.stringify({ artifact, state: "passed", checks }));
} finally {
	await browser?.close();
	await server?.close();
	console.log(JSON.stringify({ state: "browser-closed" }));
}
