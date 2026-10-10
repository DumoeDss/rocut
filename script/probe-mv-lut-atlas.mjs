import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, writeFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const flags = process.argv.slice(2);
assert.ok(
	flags.length === 1 && ["--cpu-only", "--browser-only"].includes(flags[0]),
	"Explicit --cpu-only or --browser-only gate required",
);
const mode = flags[0];
const referenceRoot = process.env.ROCUT_TEST_MV_REFERENCE;
assert.ok(
	referenceRoot && isAbsolute(referenceRoot),
	"Supply absolute ROCUT_TEST_MV_REFERENCE checkout path",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const template = join(referenceRoot, "skills/vocaloid-style-mv/template");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function actual(path) {
	const stat = await lstat(path);
	assert.ok(
		stat.isFile() && !stat.isSymbolicLink(),
		"Actual ordinary fixture resource required",
	);
	assert.ok(stat.size <= 4 * 1024 * 1024);
	return readFile(path);
}
const main = await actual(join(template, "engine/core/main.js"));
const json = await actual(join(template, "assets/style/palettes.json"));
const palettes = JSON.parse(
	new TextDecoder("utf-8", { fatal: true }).decode(json).replace(/^\uFEFF/, ""),
);
assert.ok(Array.isArray(palettes.palettes));
const paletteId = "assets/style/palettes.json";
const inputs = [
	{
		id: paletteId,
		kind: "analysis",
		mimeType: "application/json",
		bytes: json,
	},
];
const images = [],
	bindings = [];
for (const palette of palettes.palettes) {
	for (const path of [palette.lut, palette.lut_duotone]) {
		assert.ok(typeof path === "string");
		const absolute = resolve(template, path);
		const rel = relative(template, absolute);
		assert.ok(
			rel && !rel.startsWith("..") && !isAbsolute(rel),
			"LUT source must remain in reference template",
		);
		const bytes = await actual(absolute);
		const sha256 = hash(bytes);
		images.push({
			path,
			resourceId: path,
			sha256,
			bytes: bytes.toString("base64"),
		});
		bindings.push({ path, resourceId: path });
		inputs.push({ id: path, kind: "image", mimeType: "image/png", bytes });
	}
}
const resources = inputs.map(({ id, kind, mimeType, bytes }) => ({
	id,
	kind,
	mimeType,
	byteLength: bytes.length,
	sha256: hash(bytes),
	attachmentKey: "programmatic-sha256-" + hash(bytes),
}));
let offset = 0;
const byteLayout = inputs.map(({ id, bytes }) => {
	const part = { resourceId: id, offset, length: bytes.length };
	offset += bytes.length;
	return part;
});
const data = {
	reference: {
		id: "core/main.js",
		code: new TextDecoder("utf-8", { fatal: true }).decode(main),
		sha256: hash(main),
	},
	palette: {
		resourceId: paletteId,
		sha256: hash(json),
		bytes: json.toString("base64"),
	},
	images,
	metadata: {
		settings: { paletteResource: paletteId, images: bindings },
		resources,
		byteLayout,
	},
};
if (mode === "--cpu-only") {
	console.log(
		JSON.stringify(
			{
				stage: "LUT atlas fixture/byte inventory prepared",
				browserExecuted: false,
				wasmExecuted: false,
				cargoExecuted: false,
				nativeAcceptancePassed: false,
				referenceSha256: hash(main),
				paletteSha256: hash(json),
				resourceCount: resources.length,
				totalBinaryBytes: offset,
				resources,
				scope:
					"Actual fixture inventory only; no native byte admission, decoded facts, LUT pixels, GL post, full movie or export acceptance",
			},
			null,
			2,
		),
	);
	process.exit(0);
}
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY,
	browserExecutable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE,
	rustSource = process.env.ROCUT_TEST_RUST_SOURCE;
assert.ok(
	[isolated, browserExecutable, rustSource].every(
		(path) => path && isAbsolute(path),
	),
	"Supply absolute fresh private WASM/browser/source snapshot paths",
);
const nodeSourcePaths = [
	"script/probe-mv-lut-atlas.mjs",
	"script/browser-probe-toolchain.mjs",
	"script/fixtures/mv-lut-atlas-native-build.mjs",
	"script/fixtures/mv-lut-atlas-native-identities.mjs",
	"script/fixtures/mv-fall-evidence.mjs",
	"script/fixtures/mv-tunnel-native-identities.mjs",
];
const nodeSources = await Promise.all(
	nodeSourcePaths.map(async (path) => ({
		path,
		sha256: hash(await actual(join(root, path))),
	})),
);
const [
	{ chromium, createServer },
	{ buildLutAtlasNative },
	{ fallWasmIdentity, fallServedIdentity },
	{ tunnelFileIdentity },
	{ lutCompiledCheckpoint },
] = await Promise.all([
	import("./browser-probe-toolchain.mjs"),
	import("./fixtures/mv-lut-atlas-native-build.mjs"),
	import("./fixtures/mv-fall-evidence.mjs"),
	import("./fixtures/mv-tunnel-native-identities.mjs"),
	import("./fixtures/mv-lut-atlas-native-identities.mjs"),
]);
const wasmIdentity = await fallWasmIdentity(isolated);
const rustOptions = {
	root,
	directory: rustSource,
	manifestSha256: wasmIdentity.sourceManifestSha256,
};
const rustIdentity = await lutCompiledCheckpoint(rustOptions);
for (const path of [
	"rust/crates/editor-api/src/mv_lut_atlas.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_layout.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_bridge.rs",
	"rust/crates/editor-api/src/mv_lut_atlas_transport.rs",
	"rust/wasm/src/mv_lut_atlas.rs",
])
	assert.ok(
		rustIdentity.currentFrozenSources.some((entry) => entry.path === path),
		"Fresh compiled LUT adapter source missing: " + path,
	);
const glue = await readFile(join(isolated, "opencut_wasm.js"), "utf8");
const owner = glue.match(
	/export class MvLutAtlasOwner[\s\S]*?(?=\nexport class |\nexport function |$)/,
);
assert.ok(owner, "Private fresh WASM lacks actual LUT owner");
assert.doesNotMatch(
	owner[0],
	/passArray8ToWasm/,
	"LUT owner generated glue copies unbounded Uint8Array before native preflight",
);
const browserIdentity = await tunnelFileIdentity(browserExecutable);
const artifact = await mkdtemp(join(tmpdir(), "rocut-lut-native-"));
const web = join(artifact, "web");
let browser, server;
try {
	const sources = await buildLutAtlasNative({ root, isolated, output: web });
	const servedIdentity = await fallServedIdentity(web);
	server = await createServer({
		root: web,
		configFile: false,
		logLevel: "error",
		cacheDir: join(artifact, "vite-cache"),
		optimizeDeps: { noDiscovery: true, include: [] },
		server: { host: "127.0.0.1", hmr: false, port: 0 },
	});
	await server.listen();
	const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
	browser = await chromium.launch({
		headless: true,
		executablePath: browserExecutable,
		args: ["--disable-gpu-rasterization"],
	});
	const page = await browser.newPage();
	const errors = [],
		external = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (/^https?:$/.test(url.protocol) && url.origin !== origin) {
			external.push(url.origin);
			return route.abort();
		}
		return route.continue();
	});
	await page.addInitScript((input) => {
		globalThis.__lutAtlasInput = input;
	}, data);
	await page.goto(
		origin + "/script/fixtures/mv-lut-atlas-native-browser.html",
		{ waitUntil: "commit" },
	);
	await page.waitForFunction(
		() => globalThis.__lutAtlasResult !== undefined,
		undefined,
		{ timeout: 60000 },
	);
	const result = await page.evaluate(() => globalThis.__lutAtlasResult);
	assert.equal(errors.length, 0, errors.join("\n"));
	assert.equal(external.length, 0, external.join("\n"));
	assert.equal(result.status, "passed", result.error);
	assert.equal(result.maxChannelError, 0);
	assert.equal(result.requiredAlias, "P4");
	assert.equal(result.nativeRowByteLength, 1024);
	assert.ok(result.negativeCount >= 8);
	assert.deepEqual(
		await fallWasmIdentity(isolated),
		wasmIdentity,
		"Private WASM changed during gate",
	);
	assert.deepEqual(
		await lutCompiledCheckpoint(rustOptions),
		rustIdentity,
		"Rust snapshot/current sources changed during gate",
	);
	assert.deepEqual(
		await fallServedIdentity(web),
		servedIdentity,
		"Served bundle changed during gate",
	);
	for (const { path, sha256 } of sources)
		assert.equal(
			(await tunnelFileIdentity(join(root, path))).sha256,
			sha256,
			"Loaded source changed during gate",
		);
	for (const { path, sha256 } of nodeSources)
		assert.equal(
			hash(await actual(join(root, path))),
			sha256,
			"Node launcher source changed during gate",
		);
	const evidence = {
		result,
		wasmIdentity,
		rustIdentity,
		browserIdentity,
		servedIdentity,
		sources,
		nodeSources,
		resources,
		referenceSha256: hash(main),
		paletteSha256: hash(json),
		browserExecuted: true,
		scope:
			"Exact native resource admission + original 256x16 atlas pixels + P4 resolve + row pixel binding/negatives only; no full GL post/movie/export claim",
	};
	await writeFile(
		join(artifact, "evidence.json"),
		JSON.stringify(evidence, null, 2),
		"utf8",
	);
	console.log(JSON.stringify({ artifact, ...evidence }, null, 2));
} finally {
	if (browser) await browser.close();
	if (server) await server.close();
}
