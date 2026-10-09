import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, createServer } from "./browser-probe-toolchain.mjs";
import { buildNativeAudioExportProbe } from "./native-audio-export-build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!isolated || !isAbsolute(isolated))
	throw Error("Provide the genuine isolated ROCUT_TEST_WASM_DIRECTORY");
const artifacts = await mkdtemp(join(tmpdir(), "rocut-mv-composite-post-"));
const output = join(artifacts, "web");
await buildNativeAudioExportProbe(
	root,
	isolated,
	output,
	"mv-composite-post-browser",
);
const server = await createServer({
	root: output,
	configFile: false,
	logLevel: "error",
	cacheDir: join(artifacts, "vite-cache"),
	optimizeDeps: { noDiscovery: true, include: [] },
	server: { host: "127.0.0.1", hmr: false, port: 0 },
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		executablePath: chromium.executablePath(),
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage(),
		errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1")
			await route.abort();
		else await route.continue();
	});
	await page.goto(
		`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/mv-composite-post-browser.html`,
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(() => globalThis.__mvCompositePost, undefined, {
		timeout: 120000,
	});
	const { sheet, ...result } = await page.evaluate(
		() => globalThis.__mvCompositePost,
	);
	if (sheet)
		await writeFile(
			join(artifacts, "contact-sheet.png"),
			Buffer.from(sheet.split(",")[1], "base64"),
		);
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(
			{ ...result, errors, browser: await browser.version() },
			null,
			2,
		),
	);
	console.log(JSON.stringify({ ...result, errors, artifacts }, null, 2));
	if (!result.passed || errors.length)
		throw Error("Composite post probe failed; inspect retained evidence");
} finally {
	await browser?.close();
	await server.close();
}
