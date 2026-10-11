import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	resolveHtmlProbeWasmBinding,
	assertHtmlProbeWasmIdentity,
	createHtmlProbeWasmPlugin,
	HTML_PRIVATE_WASM_ID,
	resolveHtmlProbeArtifactDirectory,
	snapshotHtmlProbeSources,
	saveHtmlProbeEvidence,
} from "./html-probe-wasm-binding.mjs";
import {
	chromium,
	createServer,
	build,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmBinding = resolveHtmlProbeWasmBinding(
	process.env.ROCUT_TEST_WASM_DIRECTORY,
);
const artifactDirectory = resolveHtmlProbeArtifactDirectory(
	process.env.ROCUT_PROBE_ARTIFACTS,
);
const classicRequire = createRequire(
	new URL("../packages/editor-classic/package.json", import.meta.url),
);
// Resolve through the workspace, whether dependencies are hoisted or local.
const mediabunnyEntry = join(
	dirname(classicRequire.resolve("mediabunny")),
	"../modules/src/index.js",
);
const threeResources = process.argv.includes("--three-resources");
const asciiThree = process.argv.includes("--ascii-three");
const ditherThree = process.argv.includes("--dither-three");
const styledThree = asciiThree || ditherThree;
const meshoptThree = process.argv.includes("--meshopt-three");
const threeScene = process.argv.includes("--three-scene") || styledThree || meshoptThree;
const fixture = ditherThree
	? "dither-three-browser-probe.html"
	: asciiThree
		? "ascii-three-browser-probe.html"
		: meshoptThree
			? "meshopt-three-browser-probe.html"
			: threeScene
			? "three-scene-browser-probe.html"
			: threeResources
				? "three-resource-browser-probe.html"
				: "html-frame-browser-probe.html";
const resultKey = ditherThree
	? "__ditherThreeResult"
	: asciiThree
		? "__asciiThreeResult"
		: meshoptThree
			? "__meshoptThreeResult"
			: threeScene
			? "__threeSceneResult"
			: threeResources
				? "__threeResourceResult"
				: "__htmlResult";
const sourceInputs =
	!threeScene && !threeResources
		? snapshotHtmlProbeSources(root, [
				"script/probe-html-frames.mjs",
				"script/html-probe-wasm-binding.mjs",
				"script/fixtures/local-wasm-preload.mjs",
				`script/fixtures/${fixture}`,
				`script/fixtures/${fixture.replace(/\.html$/, ".ts")}`,
				"script/fixtures/hyperframes-browser-probe.ts",
				"script/fixtures/remotion-browser-probe.ts",
				"script/fixtures/remotion-pinned-build-probe.ts",
				"script/fixtures/remotion-video-browser-probe.ts",
				"apps/cli/src/programmatic/engines/compile-project.ts",
				"apps/cli/src/programmatic/engines/remotion-compiler-child.ts",
				"apps/cli/src/programmatic/engines/remotion-driver.ts",
				"apps/cli/src/programmatic/engines/toolchain.ts",
				"apps/cli/src/programmatic/remotion-inspection-driver.ts",
				"apps/cli/src/programmatic/remotion-inspection-project.ts",
				"apps/cli/src/programmatic/remotion-inspection-service.ts",
				"apps/cli/src/programmatic/remotion-inspection-snapshot.ts",
				"apps/cli/src/programmatic/remotion-metadata-archive.ts",
				"apps/cli/src/programmatic/remotion-metadata-contract.ts",
				"apps/cli/src/programmatic/remotion-metadata-json.ts",
				"apps/cli/src/programmatic/remotion-metadata-lifetime.ts",
				"apps/cli/src/programmatic/remotion-metadata-policy.ts",
				"apps/cli/src/programmatic/remotion-metadata-receipt.ts",
				"apps/cli/src/programmatic/remotion-metadata-validation.ts",
			])
		: undefined;
const privateTemp = await mkdtemp(join(tmpdir(), "rocut-frame-probe-"));
const executablePath =
	process.env.ROCUT_PROBE_BROWSER_PATH || chromium.executablePath();
const profiles = async () =>
	(await readdir(privateTemp)).filter((name) =>
		name.startsWith("rocut-html-frame-"),
	);
const before = new Set(await profiles());
const host = spawn(
	"bun",
	[
		"--preload",
		"./script/fixtures/local-wasm-preload.mjs",
		...(process.env.ROCUT_PROBE_TRACE === "1"
			? ["--preload", "./script/fixtures/browser-phase-trace.mjs"]
			: []),
		"script/fixtures/html-frame-host.ts",
	],
	{
		cwd: root,
		windowsHide: true,
		env: {
			...process.env,
			TEMP: privateTemp,
			TMP: privateTemp,
			TMPDIR: privateTemp,
			...(ditherThree
				? { ROCUT_PROBE_STATIC_DIR: join(privateTemp, "editor") }
				: {}),
			ROCUT_HTML_BROWSER_PATH: process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE
				? ""
				: executablePath,
		},
		stdio: ["pipe", "pipe", "pipe"],
	},
);
const exited = new Promise((resolve) => host.once("exit", resolve));
let server, browser, hostWasmIdentity;
try {
	const editorUrl = await new Promise((resolve, reject) => {
		let text = "";
		const deadline = setTimeout(
			() => reject(Error("HTML fixture host startup timed out")),
			20000,
		);
		host.once("error", reject);
		host.once("exit", () => {
			clearTimeout(deadline);
			reject(Error("HTML fixture host exited"));
		});
		host.stderr.on("data", (chunk) => process.stderr.write(chunk));
		host.stdout.on("data", (chunk) => {
			text += chunk.toString();
			for (const line of text.split("\n")) {
				try {
					const value = JSON.parse(line);
					if (value.wasmIdentity) hostWasmIdentity = value.wasmIdentity;
					if (value.editorUrl) {
						clearTimeout(deadline);
						if (wasmBinding) {
							try {
								assertHtmlProbeWasmIdentity(wasmBinding, hostWasmIdentity);
							} catch (error) {
								reject(error);
								return;
							}
						}
						resolve(value.editorUrl);
					}
				} catch {}
			}
		});
	});
	const viteOptions = {
		root,
		cacheDir: join(privateTemp, "vite-cache"),
		configFile: false,
		logLevel: "error",
		plugins: [
			...(wasmBinding ? [createHtmlProbeWasmPlugin(wasmBinding)] : []),
			wasm(),
			topLevelAwait(),
		],
		optimizeDeps: {
			entries: [`script/fixtures/${fixture}`],
		},
		resolve: {
			alias: {
				"opencut-wasm": wasmBinding
					? HTML_PRIVATE_WASM_ID
					: join(root, "rust/wasm/pkg/opencut_wasm.js"),
				mediabunny: mediabunnyEntry,
			},
		},
		server: {
			host: "127.0.0.1",
			hmr: false,
			port: 0,
			...(wasmBinding ? { fs: { allow: [root, wasmBinding.directory] } } : {}),
			proxy: {
				"/api": {
					target: new URL(editorUrl).origin,
					rewrite: (path) => new URL(`.${path}`, editorUrl).pathname,
				},
			},
		},
	};
	if (ditherThree) {
		await build({
			...viteOptions,
			base: "./",
			build: {
				outDir: join(privateTemp, "editor"),
				emptyOutDir: false,
				rollupOptions: { input: join(root, "script/fixtures", fixture) },
			},
		});
	} else {
		server = await createServer(viteOptions);
		await server.listen();
	}
	browser = await chromium.launch({
		headless: true,
		executablePath,
		args:
			process.env.ROCUT_PROBE_SWIFTSHADER === "1"
				? [
						"--enable-unsafe-webgpu",
						"--enable-unsafe-swiftshader",
						"--use-angle=swiftshader",
						"--use-gl=angle",
					]
				: [],
	});
	const page = await browser.newPage();
	const redact = (value) =>
		String(value).replaceAll(new URL(editorUrl).pathname, "/[session]/");
	if (ditherThree)
		await page.addInitScript((apiBase) => {
			globalThis.__probeApiBase = apiBase;
		}, new URL("api", editorUrl).pathname);
	if (process.env.ROCUT_PROBE_NATIVE_ONLY === "1")
		await page.addInitScript(() => {
			globalThis.__nativeOnly = true;
		});
	await page.addInitScript(
		(fontPath) => {
			globalThis.__resourceFontPath = fontPath;
		},
		join(root, "apps/web/public/motion-text/fonts/ibm-plex-mono-medium.ttf"),
	);
	if (process.env.ROCUT_PROBE_ENGINE_DOCUMENT)
		await page.addInitScript((documentPath) => {
			globalThis.__engineDocumentPath = documentPath;
		}, process.env.ROCUT_PROBE_ENGINE_DOCUMENT);
	if (process.env.ROCUT_PROBE_ENGINE_SPEC)
		await page.addInitScript(
			(spec) => {
				globalThis.__engineBuildSpec = spec;
			},
			JSON.parse(await readFile(process.env.ROCUT_PROBE_ENGINE_SPEC, "utf8")),
		);
	const errors = [];
	const externalRequests = [];
	if (styledThree)
		await page.route("**/*", async (route) => {
			const url = new URL(route.request().url());
			if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1") {
				externalRequests.push(url.origin);
				await route.abort();
			} else await route.continue();
		});
	page.on("pageerror", (error) => errors.push(redact(error.message)));
	const scriptFailure = new Promise((_, reject) => {
		page.on("pageerror", (error) => reject(Error(redact(error.message))));
		page.on("response", (response) => {
			if (
				response.status() >= 500 &&
				response.request().resourceType() === "script"
			)
				reject(
					Error(
						`Browser fixture module failed: ${redact(new URL(response.url()).pathname)}`,
					),
				);
		});
	});
	// Register before navigation so an early module error is never unhandled.
	scriptFailure.catch(() => {});
	page.on("console", (message) => {
		if (message.text().startsWith("HTML probe:"))
			console.log(redact(message.text()));
	});
	await page.goto(
		ditherThree
			? new URL(`script/fixtures/${fixture}`, editorUrl).href
			: `http://127.0.0.1:${server.httpServer.address().port}/script/fixtures/${fixture}`,
		{ timeout: 90000, waitUntil: "commit" },
	);
	// Cold, isolated Vite transforms have their own startup budget. Do not charge
	// module compilation against the multi-frame behavioral test's watchdog.
	if (!threeScene && !threeResources)
		await Promise.race([
			scriptFailure,
			page.waitForFunction(() => globalThis.__htmlProbeStarted, undefined, {
				timeout: 120000,
			}),
		]);
	await Promise.race([
		scriptFailure,
		page.waitForFunction((key) => globalThis[key], resultKey, {
			timeout: styledThree ? 300000 : 180000,
		}),
	]);
	const result = await page.evaluate((key) => globalThis[key], resultKey);
	if (wasmBinding) {
		assertHtmlProbeWasmIdentity(
			wasmBinding,
			await page.evaluate(() => globalThis.__htmlProbeWasmIdentity),
		);
		assertHtmlProbeWasmIdentity(wasmBinding, hostWasmIdentity);
		result.wasmIdentity = wasmBinding.identity;
	}
	if (result.error || errors.length || externalRequests.length)
		throw Error(redact(JSON.stringify({ result, errors, externalRequests })));
	if (threeScene && artifactDirectory) {
		const artifacts = artifactDirectory;
		if (styledThree)
			await writeFile(
				join(artifacts, "expected.rgba"),
				Buffer.from(
					await page.evaluate(() => globalThis.__threeExpectedBase64),
					"base64",
				),
				{ flag: "wx" },
			);
		await writeFile(
			join(
				artifacts,
				ditherThree
					? "dither-three.webm"
					: asciiThree
						? "ascii-three.webm"
						: meshoptThree
							? "meshopt-three.webm"
							: "three.webm",
			),
			Buffer.from(
				await page.evaluate(() => globalThis.__threeVideoBase64),
				"base64",
			),
			{ flag: "wx" },
		);
		await writeFile(
			join(
				artifacts,
				styledThree
					? "contact-sheet.png"
					: meshoptThree
						? "meshopt-three.png"
						: "three.png",
			),
			Buffer.from(
				await page.evaluate(
					(key) => globalThis[key],
				meshoptThree ? "__meshoptPreviewBase64" : "__threePreviewBase64",
					),
				"base64",
			),
			{ flag: "wx" },
		);
		await writeFile(
			join(artifacts, "evidence.json"),
			JSON.stringify(
				{
					...result,
					externalRequests,
					browser: browser.version(),
					frameBackend: "private-chromium",
					electronTested: false,
				},
				null,
				2,
			) + "\n",
			{ flag: "wx" },
		);
	}
	if (!threeScene && !threeResources && artifactDirectory) {
		await saveHtmlProbeEvidence({
			directory: artifactDirectory,
			result,
			binding: wasmBinding,
			browser: browser.version(),
			frameBackend: process.env.ELFTIA_HTML_FRAME_CONNECTION_FILE
				? "external-host-connection"
				: "private-chromium",
			root,
			sourceInputs,
		});
	}
	console.log(JSON.stringify(result, null, 2));
} finally {
	await browser?.close();
	await server?.close();
	host.stdin.end("stop\n");
	await exited;
	const leaked = (await profiles()).filter((name) => !before.has(name));
	if (leaked.length)
		throw Error(
			`HTML browser profile cleanup failed: ${leaked.length} remaining`,
		);
	// Only our freshly allocated fixture tree; never another session's profiles.
	await rm(privateTemp, { recursive: true, force: true });
}
