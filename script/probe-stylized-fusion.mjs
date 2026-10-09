import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "./browser-probe-toolchain.mjs";
import { runFusion } from "./fixtures/stylized-fusion-run.mjs";
import { runSpatialEditor } from "./fixtures/spatial-editor-checks.mjs";
import { runDistortionEditor } from "./fixtures/distortion-editor-checks.mjs";
import { runRevealEditor } from "./fixtures/reveal-editor-checks.mjs";
import { runSweepScrollEditor } from "./fixtures/sweep-scroll-editor-checks.mjs";
import { runMeshScenesEditor } from "./fixtures/mesh-scenes-editor-checks.mjs";
import { runShatterEditor } from "./fixtures/shatter-editor-checks.mjs";
import { runClothEditor } from "./fixtures/cloth-editor-checks.mjs";

const require = createRequire(
	new URL("../apps/vite-example/package.json", import.meta.url),
);
const { build } = await import(pathToFileURL(require.resolve("vite")).href);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [templates, toolchain, executablePath] = process.argv.slice(2);
const spatial = process.argv[5] === "--spatial";
const distortion = process.argv[5] === "--distortion";
const reveal = process.argv[5] === "--reveal";
const sweepScroll = process.argv[5] === "--sweep-scroll";
const meshScenes = process.argv[5] === "--mesh-scenes";
const shatter = process.argv[5] === "--shatter";
const cloth = process.argv[5] === "--cloth";
const mode =
	process.argv[5] === undefined
		? "fusion"
		: {
				"--spatial": "spatial",
				"--distortion": "distortion",
				"--reveal": "reveal",
				"--sweep-scroll": "sweep-scroll",
				"--mesh-scenes": "mesh-scenes",
				"--shatter": "shatter",
				"--cloth": "cloth",
			}[process.argv[5]];
assert(
	process.argv.length <= 5 || (process.argv.length === 6 && mode !== undefined),
	"Unknown probe mode",
);
assert(
	[templates, toolchain, executablePath].every((p) => p && isAbsolute(p)),
	"Expected absolute Creator template, private toolchain and Chromium paths",
);
const parent = join(
	root,
	mode === "fusion"
		? ".artifacts/stylized-fusion"
		: `.artifacts/${mode}-editor`,
);
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const privateTemp = join(artifacts, "temp");
await mkdir(privateTemp);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const templateSource = await readFile(join(templates, "templates.mjs"), "utf8");
const needsRevealTemplate =
	reveal || /from\s+["']\.\/reveal\.mjs["']/.test(templateSource);
const needsSweepScrollTemplate =
	sweepScroll || /from\s+["']\.\/sweep-scroll\.mjs["']/.test(templateSource);
const needsMeshTemplate =
	meshScenes ||
	shatter ||
	/from\s+["']\.\/mesh-scenes\.mjs["']/.test(templateSource);
const needsClothTemplate =
	cloth || /from\s+["']\.\/cloth-scenes\.mjs["']/.test(templateSource);
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files)
	assert.equal(
		digest(await readFile(join(root, file.path))),
		file.sha256,
		`Source changed without provenance update: ${file.path}`,
	);
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const evidence = {
	ok: false,
	mode,
	sourceCommit: manifest.sourceCommit,
	sourceWorktreeClean: false,
	sourceManifestSha256: digest(manifestBytes),
	wasmSha256: digest(
		await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
	),
	toolchainLockSha256: digest(
		await readFile(join(toolchain, "package-lock.json")),
	),
	templates: Object.fromEntries(
		await Promise.all(
			[
				"templates.mjs",
				"scene.ts",
				"spatial.mjs",
				"wave.mjs",
				...(needsRevealTemplate ? ["reveal.mjs"] : []),
				...(needsSweepScrollTemplate ? ["sweep-scroll.mjs"] : []),
				...(needsMeshTemplate ? ["mesh-scenes.mjs"] : []),
				...(needsClothTemplate ? ["cloth-scenes.mjs"] : []),
			].map(async (name) => [
				name,
				digest(await readFile(join(templates, name))),
			]),
		),
	),
	backend: "private-chromium-swiftshader",
	installedPluginTested: false,
	electronTested: false,
	checks: [],
	errors: [],
	externalRequests: [],
};
console.log(JSON.stringify({ phase: "preparing", artifacts }));
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/local-wasm-preload.mjs",
		mode === "fusion"
			? "script/fixtures/stylized-fusion-host.ts"
			: `script/fixtures/${mode}-editor-host.ts`,
		artifacts,
		templates,
		toolchain,
		executablePath,
	],
	{
		cwd: root,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			TEMP: privateTemp,
			TMP: privateTemp,
			TMPDIR: privateTemp,
			ELFTIA_HTML_FRAME_CONNECTION_FILE: "",
		},
	},
);
const exited = new Promise((resolve) => host.once("exit", resolve));
let browser, page, privateEditorUrl;
const redact = (value) =>
	String(value)
		.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]")
		.replace(/\/[a-f0-9]{40,}\/(?=api\/|assets\/)/g, "/[session]/");
const publicPath = (value) => {
	const pathname = new URL(value).pathname;
	const prefix = privateEditorUrl ? new URL(privateEditorUrl).pathname : "/";
	return pathname.startsWith(prefix)
		? "/" + pathname.slice(prefix.length)
		: pathname;
};
let hostError = "";
host.stderr.on("data", (chunk) => {
	hostError = (hostError + redact(chunk)).slice(-12000);
});
try {
	const editorUrl = await new Promise((resolve, reject) => {
		let buffered = "";
		const timer = setTimeout(
			() => reject(Error("Host startup deadline exceeded")),
			60000,
		);
		host.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		host.once("exit", (code) => {
			clearTimeout(timer);
			reject(Error(`Host exited ${code}: ${hostError}`));
		});
		host.stdout.on("data", (chunk) => {
			buffered += chunk.toString();
			let boundary;
			while ((boundary = buffered.indexOf("\n")) >= 0) {
				const line = buffered.slice(0, boundary);
				buffered = buffered.slice(boundary + 1);
				try {
					const message = JSON.parse(line);
					if (message.editorUrl) {
						clearTimeout(timer);
						resolve(message.editorUrl);
					}
				} catch {
					/* Only the private readiness envelope is consumed. */
				}
			}
		});
	});
	console.log(JSON.stringify({ phase: "host-ready" }));
	privateEditorUrl = editorUrl;
	let editorDist = join(privateTemp, "editor-dist");
	if (process.env.ROCUT_FUSION_EDITOR_DIST) {
		editorDist = resolve(process.env.ROCUT_FUSION_EDITOR_DIST);
		assert(isAbsolute(process.env.ROCUT_FUSION_EDITOR_DIST));
		const oldManifest = JSON.parse(
			await readFile(join(editorDist, "../../source-manifest.json")),
		);
		const rendererFiles = (value) =>
			value.files.filter(
				(f) => !f.path.startsWith("script/") && !f.path.startsWith("apps/cli/"),
			);
		assert.deepEqual(
			rendererFiles(oldManifest),
			rendererFiles(manifest),
			"Cached editor source differs",
		);
		const wasmFiles = (await readdir(join(editorDist, "assets"))).filter(
			(f) => f.startsWith("opencut_wasm_bg-") && f.endsWith(".wasm"),
		);
		assert.equal(wasmFiles.length, 1);
		assert.equal(
			digest(await readFile(join(editorDist, "assets", wasmFiles[0]))),
			evidence.wasmSha256,
		);
		evidence.reusedEditorDist = editorDist;
	}
	const viteOptions = {
		root: join(root, "apps/vite-example"),
		configFile: join(root, "apps/vite-example/vite.config.ts"),
		cacheDir: join(privateTemp, "vite-cache"),
		logLevel: "error",
		resolve: {
			alias: { "opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js") },
		},
		build: { outDir: editorDist, emptyOutDir: false },
	};
	// The production surface avoids dev-only optimizer reloads and tests the real
	// distributable entry. Output is private; this is not a release or install.
	if (!evidence.reusedEditorDist) {
		console.log(JSON.stringify({ phase: "building-private-editor" }));
		await build(viteOptions);
	}
	console.log(JSON.stringify({ phase: "editor-build-ready" }));
	browser = await chromium.launch({
		headless: true,
		executablePath,
		env: {
			...process.env,
			TEMP: privateTemp,
			TMP: privateTemp,
			TMPDIR: privateTemp,
		},
		args: [
			"--no-proxy-server",
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	evidence.browser = browser.version();
	page = await browser.newPage({
		viewport: { width: 1440, height: 1000 },
		deviceScaleFactor: 1,
	});
	// Do not intercept allowed loopback traffic; the browser talks to the actual
	// HTTP transport. Only external network is blocked by this fixture.
	await page.route(
		(url) => /^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1",
		async (route) => {
			const url = new URL(route.request().url());
			evidence.externalRequests.push(url.origin);
			await route.abort();
		},
	);
	const fatal = new Promise((_, reject) => {
		page.on("pageerror", (error) => reject(Error(redact(error.message))));
		page.on("response", (response) => {
			if (
				response.status() >= 500 &&
				["script", "stylesheet"].includes(response.request().resourceType())
			)
				reject(Error(`Editor module failed: ${publicPath(response.url())}`));
		});
	});
	fatal.catch(() => {});
	page.on("pageerror", (error) => evidence.errors.push(redact(error.message)));
	evidence.httpFailures = [];
	evidence.requests = [];
	const requests = new Map();
	page.on("request", (request) => {
		const path = publicPath(request.url());
		if (!path.startsWith("/api/")) return;
		const entry = { method: request.method(), path, at: Date.now() };
		requests.set(request, entry);
		evidence.requests.push(entry);
	});
	page.on("requestfinished", (request) => {
		const entry = requests.get(request);
		if (entry) entry.durationMs = Date.now() - entry.at;
	});
	page.on("requestfailed", (request) => {
		const entry = requests.get(request);
		if (entry) {
			entry.durationMs = Date.now() - entry.at;
			entry.error = request.failure()?.errorText;
		}
	});
	page.on("response", (response) => {
		const entry = requests.get(response.request());
		if (entry) entry.status = response.status();
		if (response.status() >= 400)
			evidence.httpFailures.push({
				path: publicPath(response.url()),
				status: response.status(),
			});
	});
	page.on("console", (message) => {
		if (message.type() === "error")
			evidence.errors.push(redact(message.text()));
	});
	evidence.editorTransport =
		"actual Host staticDir and authenticated URL, no Vite HTTP proxy";
	await page.goto(editorUrl, { waitUntil: "commit", timeout: 90000 });
	console.log(JSON.stringify({ phase: "editor-navigated" }));
	await Promise.race([
		fatal,
		page
			.locator(`[data-testid="timeline-clip"][data-element-id="${mode}-0"]`)
			.waitFor({ timeout: 120000 }),
	]);
	await page.waitForFunction(
		async () => (await (await fetch("api/export")).json()).surfaces === 1,
		undefined,
		{ timeout: 30000 },
	);
	await page.screenshot({ path: join(artifacts, "editor.png") });
	await writeFile(
		join(artifacts, "ui.txt"),
		await page.locator("body").innerText(),
		{ flag: "wx" },
	);
	evidence.checks.push({
		name: `persisted ${mode === "fusion" ? "mixed" : mode} project loaded by actual attached editor`,
		pass: true,
	});
	console.log(JSON.stringify({ phase: "attached" }));
	const agentRequest = async (route, body) => {
		const response = await fetch(new URL(`api/${route}`, editorUrl), {
			signal: AbortSignal.timeout(15000),
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
		});
		const value = await response.json();
		assert(
			response.ok,
			`${route}: ${response.status} ${JSON.stringify(value)}`,
		);
		return value;
	};
	if (cloth) await runClothEditor(page, artifacts, evidence, agentRequest);
	else if (shatter)
		await runShatterEditor(page, artifacts, evidence, agentRequest);
	else if (meshScenes)
		await runMeshScenesEditor(page, artifacts, evidence, agentRequest);
	else if (sweepScroll)
		await runSweepScrollEditor(page, artifacts, evidence, agentRequest);
	else if (reveal)
		await runRevealEditor(page, artifacts, evidence, agentRequest);
	else if (distortion)
		await runDistortionEditor(page, artifacts, evidence, agentRequest);
	else if (spatial)
		await runSpatialEditor(page, artifacts, evidence, agentRequest);
	else await runFusion(page, artifacts, evidence, agentRequest, publicPath);
	// HttpProjectStore explicitly maps an absent optional user library to null.
	const optionalLibrary404 = evidence.httpFailures.filter(
		(f) =>
			f.status === 404 &&
			f.path === "/api/library/graph-editor-presets/user-presets",
	);
	evidence.expectedHttpFailures = optionalLibrary404;
	// Native frame requests can be explicitly cancelled while a new graph/export
	// takes ownership. Pixel/history/reload/export postconditions above still must pass.
	const expectedFrameCancellations =
		mode !== "fusion"
			? evidence.errors.filter(
					(error) =>
						error ===
						"Failed to render preview frame: AbortError: Programmatic frame cancelled",
				)
			: [];
	evidence.expectedFrameCancellations = expectedFrameCancellations;
	const unexpectedErrors = evidence.errors.filter(
		(error) =>
			!expectedFrameCancellations.includes(error) &&
			(error !==
				"Failed to load resource: the server responded with a status of 404 (Not Found)" ||
				evidence.httpFailures.some(
					(f) => f.status === 404 && !optionalLibrary404.includes(f),
				)),
	);
	evidence.ok =
		unexpectedErrors.length === 0 && evidence.externalRequests.length === 0;
	assert(
		evidence.ok,
		JSON.stringify({
			errors: evidence.errors,
			externalRequests: evidence.externalRequests,
		}),
	);
	console.log(JSON.stringify({ phase: "attached", artifacts }));
} catch (error) {
	evidence.ok = false;
	evidence.failure = redact(error.stack ?? error);
	if (privateEditorUrl) {
		try {
			const response = await fetch(new URL("api/context", privateEditorUrl), {
				signal: AbortSignal.timeout(5000),
			});
			evidence.failureHostHealth = {
				status: response.status,
				exitCode: host.exitCode,
			};
			await response.arrayBuffer();
			const tasks = await fetch(new URL("api/editor-tasks", privateEditorUrl), {
				signal: AbortSignal.timeout(5000),
			});
			evidence.failureEditorTasks = await tasks.json();
		} catch (healthError) {
			evidence.failureHostHealth = {
				error: redact(healthError),
				exitCode: host.exitCode,
			};
		}
	}
	if (page) {
		await page
			.screenshot({ path: join(artifacts, "failure.png") })
			.catch(() => {});
		await writeFile(
			join(artifacts, "failure-ui.txt"),
			await page
				.locator("body")
				.innerText()
				.catch(() => ""),
		);
	}
	process.exitCode = 1;
} finally {
	await browser?.close();
	if (host.exitCode === null && host.signalCode === null)
		host.stdin.end("stop\n");
	await exited;
	if ((sweepScroll || meshScenes || shatter || cloth) && evidence.ok) {
		try {
			assert.equal(
				host.exitCode,
				0,
				"Private Host restart verification failed",
			);
			const restart = JSON.parse(
				await readFile(join(artifacts, "reopened-after-edit.json"), "utf8"),
			);
			assert.equal(
				restart.ok,
				true,
				"Edited project did not survive Host restart",
			);
			evidence[
				cloth
					? "clothRestart"
					: shatter
						? "shatterRestart"
						: meshScenes
							? "meshScenesRestart"
							: "sweepScrollRestart"
			] = restart;
		} catch (error) {
			evidence.ok = false;
			evidence.failure = redact(error.stack ?? error);
			process.exitCode = 1;
		}
	}
	if (hostError) evidence.hostDiagnostics = hostError;
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(evidence, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({ ok: evidence.ok, failure: evidence.failure, artifacts }),
	);
}
// Vite's build plugins can leave worker-pool handles alive after all owned
// servers/browsers/Host have closed. End only this standalone probe process.
process.exit(process.exitCode ?? 0);
