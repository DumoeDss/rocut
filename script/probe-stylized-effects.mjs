import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chromium,
	createServer,
	wasm,
	topLevelAwait,
} from "./browser-probe-toolchain.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const generators = process.argv.includes("--generators");
const peel = process.argv.includes("--peel");
const spatial = process.argv.includes("--spatial");
const magnify = process.argv.includes("--magnify");
const displacement = process.argv.includes("--displacement");
const wave = process.argv.includes("--wave");
const encodingIndex = process.argv.indexOf("--spatial-encoding");
const replay = encodingIndex >= 0 ? process.argv[encodingIndex + 1] : undefined;
if (
	encodingIndex >= 0 &&
	(!replay || !/^\.artifacts\/spatial-effects\/run-[a-zA-Z0-9]+$/.test(replay))
)
	throw Error("Expected a private spatial-effects artifact path");
if (
	[
		generators,
		peel,
		spatial,
		magnify,
		displacement,
		wave,
		Boolean(replay),
	].filter(Boolean).length > 1
)
	throw Error("Choose one probe mode");
const entry = replay
	? "script/fixtures/spatial-encoding-probe.html"
	: `script/fixtures/${wave ? "wave" : displacement ? "displacement" : magnify ? "magnify" : spatial ? "spatial" : peel ? "peel" : generators ? "generator" : "stylized"}-browser-probe.html`;
const parent = join(
	root,
	".artifacts",
	replay
		? "spatial-encoding"
		: wave
			? "wave-effects"
			: displacement
				? "displacement-effects"
				: magnify
					? "magnify-effects"
					: spatial
						? "spatial-effects"
						: peel
							? "peel-transition"
							: generators
								? "stylized-generators"
								: "stylized-effects",
);
await mkdir(parent, { recursive: true });
const artifacts = await mkdtemp(join(parent, "run-"));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(join(root, "fixture-source.json"));
const manifest = JSON.parse(manifestBytes);
for (const file of manifest.files) {
	if (digest(await readFile(join(root, file.path))) !== file.sha256)
		throw Error(`Stale fixture manifest: ${file.path}`);
}
await writeFile(join(artifacts, "source-manifest.json"), manifestBytes, {
	flag: "wx",
});
const server = await createServer({
	root,
	configFile: false,
	cacheDir: join(artifacts, "vite-cache"),
	logLevel: "error",
	plugins: [wasm(), topLevelAwait()],
	optimizeDeps: { entries: [entry] },
	resolve: {
		alias: {
			"opencut-wasm": join(root, "rust/wasm/pkg/opencut_wasm.js"),
			mediabunny: join(root, "packages/editor-classic/node_modules/mediabunny"),
		},
	},
	server: { host: "127.0.0.1", port: 0, hmr: false },
});
let browser;
try {
	await server.listen();
	browser = await chromium.launch({
		headless: true,
		executablePath:
			process.env.ROCUT_PROBE_BROWSER_PATH || chromium.executablePath(),
		args: [
			"--enable-unsafe-webgpu",
			"--enable-unsafe-swiftshader",
			"--use-angle=swiftshader",
			"--use-gl=angle",
		],
	});
	const page = await browser.newPage(),
		errors = [],
		externalRequests = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", async (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.hostname !== "127.0.0.1") {
			externalRequests.push(url.origin);
			await route.abort();
		} else await route.continue();
	});
	const address = server.httpServer.address();
	await page.goto(
		`http://127.0.0.1:${address.port}/${entry}${replay ? `?artifact=${encodeURIComponent(replay)}` : ""}`,
		{
			waitUntil: "commit",
		},
	);
	await page.waitForFunction(() => globalThis.__stylizedResult, undefined, {
		timeout: 120000,
	});
	const result = await page.evaluate(() => globalThis.__stylizedResult);
	const media = await page.evaluate(() => ({
		video: globalThis.__stylizedVideoBase64,
		sheet: globalThis.__stylizedSheet,
		expected: globalThis.__stylizedExpectedBase64,
		variants: globalThis.__stylizedEncodingVariants,
	}));
	for (const variant of media.variants ?? []) {
		if (!replay || !/^[a-z0-9]+$/.test(variant.name))
			throw Error("Invalid encoding variant");
		const directory = join(artifacts, variant.name);
		await mkdir(directory);
		await writeFile(
			join(directory, "spatial.webm"),
			Buffer.from(variant.video, "base64"),
			{ flag: "wx" },
		);
		for (const file of ["expected.rgba", "contact-sheet.png"])
			await writeFile(
				join(directory, file),
				await readFile(join(root, replay, file)),
				{ flag: "wx" },
			);
	}
	if (media.expected)
		await writeFile(
			join(artifacts, "expected.rgba"),
			Buffer.from(media.expected, "base64"),
			{ flag: "wx" },
		);
	if (media.video)
		await writeFile(
			join(
				artifacts,
				spatial || magnify || displacement || wave
					? "spatial.webm"
					: peel
						? "peel.webm"
						: generators
							? "generators.webm"
							: "filters.webm",
			),
			Buffer.from(media.video, "base64"),
			{ flag: "wx" },
		);
	if (media.sheet)
		await writeFile(
			join(artifacts, "contact-sheet.png"),
			Buffer.from(media.sheet.split(",")[1], "base64"),
			{ flag: "wx" },
		);
	await writeFile(
		join(artifacts, "evidence.json"),
		JSON.stringify(
			{
				...result,
				errors,
				externalRequests,
				browser: await browser.version(),
				backend: "private Chromium WebGPU/SwiftShader, no Host/Electron",
				sourceCommit: manifest.sourceCommit,
				sourceWorktreeClean: false,
				sourceManifestSha256: digest(manifestBytes),
				wasmSha256: digest(
					await readFile(join(root, "rust/wasm/pkg/opencut_wasm_bg.wasm")),
				),
			},
			null,
			2,
		) + "\n",
		{ flag: "wx" },
	);
	console.log(JSON.stringify({ ...result, artifacts }));
	if (!result.ok || errors.length || externalRequests.length)
		throw Error(`Browser probe failed; evidence retained at ${artifacts}`);
} finally {
	await browser?.close();
	await server.close();
}
