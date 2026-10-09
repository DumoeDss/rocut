import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { chromium, createServer, wasm, topLevelAwait } from "./browser-probe-toolchain.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2] || !process.env.ROCUT_TEST_FFMPEG || !process.env.ROCUT_TEST_FFPROBE)
	throw Error("Provide isolated toolchain directory and ROCUT_TEST_FFMPEG / ROCUT_TEST_FFPROBE");
const temporary = await mkdtemp(join(tmpdir(), "rocut-offthread-export-"));
const require = createRequire(new URL("../packages/editor-classic/package.json", import.meta.url));
const host = spawn("bun", ["--preload", "./script/fixtures/local-wasm-preload.mjs", "script/fixtures/offthread-frame-host.ts", process.argv[2]], {
	cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
	env: { ...process.env, TEMP: temporary, TMP: temporary, TMPDIR: temporary,
		ROCUT_PROBE_HDR: process.argv.includes("--hdr") ? "1" : "0",
		ELFTIA_HTML_FRAME_CONNECTION_FILE: "", ROCUT_HTML_BROWSER_PATH: chromium.executablePath() },
});
const exited = new Promise(resolve => host.once("close", resolve));
let browser, server;
try {
	const endpoint = await new Promise((resolve, reject) => {
		let output = "";
		const timeout = setTimeout(() => reject(Error("Offthread fixture startup timeout")), 45000);
		const fail = error => { clearTimeout(timeout); reject(error); };
		host.once("error", fail); host.once("exit", () => fail(Error("Offthread fixture exited")));
		host.stderr.on("data", data => process.stderr.write(data));
		host.stdout.on("data", data => {
			output += String(data);
			for (const line of output.split("\n")) {
				try {
					const value = JSON.parse(line);
					if (value.endpoint) { clearTimeout(timeout); resolve(value.endpoint); }
				} catch {}
			}
		});
	});
	server = await createServer({ root, configFile: false, cacheDir: join(temporary, "vite-cache"), logLevel: "error",
		plugins: [wasm(), topLevelAwait()], optimizeDeps: { entries: ["script/fixtures/offthread-browser-probe.html"] },
		resolve: { alias: { "opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js"),
			mediabunny: join(dirname(require.resolve("mediabunny")), "../modules/src/index.js") } },
		server: { host: "127.0.0.1", hmr: false, port: 0, proxy: { "/api": { target: endpoint } } },
	});
	await server.listen();
	browser = await chromium.launch({ headless: true });
	const page = await browser.newPage();
	const errors = [];
	page.on("pageerror", error => errors.push(error.message));
	page.on("console", message => { if (message.text().startsWith("HTML probe:")) console.log(message.text()); });
	await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/offthread-browser-probe.html`, { waitUntil: "commit", timeout: 90000 });
	await page.waitForFunction(() => globalThis.__offthreadResult, undefined, { timeout: 180000 });
	const result = await page.evaluate(() => globalThis.__offthreadResult);
	if (result.error || errors.length) throw Error(JSON.stringify({ result, errors }));
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser?.close(); await server?.close();
	if (host.exitCode === null && !host.killed) host.stdin.end("stop\n");
	await exited;
	const leaked = (await readdir(temporary)).filter(name => name.startsWith("rocut-"));
	if (leaked.length) throw Error(`Offthread fixture leaked ${leaked.join(", ")}`);
	if (dirname(temporary) !== resolve(tmpdir()) || !basename(temporary).startsWith("rocut-offthread-export-")) throw Error("Unsafe export fixture cleanup");
	await rm(temporary, { recursive: true, force: true });
}
