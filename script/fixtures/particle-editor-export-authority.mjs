import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { assertParticleReceiptSamplerIdentity as samplerIdentity } from "./particle-editor-export-authority-identity.mjs";

export const PARTICLE_AUTHORITY_LANE = "new-084cf-20261011";
export const CANONICAL_PARTICLE_WASM_SHA256 =
	"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12";
// Only a separately reviewed source change may fill either slot. No option/env
// or digest computed from the inputs being admitted can configure this registry.
const trustedLane = Object.freeze({
	laneId: PARTICLE_AUTHORITY_LANE,
	authorityReceiptSha256:
		"321f18c7b7468707e8a01ee74bdd8385ec16e27a305c7b467f6262a9789e97bb",
	baselineReceiptSha256: null,
});
const HASH = /^[a-f0-9]{64}$/;
const MAX_RECEIPT = 4 * 1024 * 1024;
const MAX_FILE = 256 * 1024 * 1024;
// Exact immutable browser file from the independently frozen browser closure.
// No other role, path, length or digest can use this exception.
const frozenBrowserDll = Object.freeze({
	path: "chrome.dll",
	byteLength: 301124096,
	sha256: "0b69d34d08e1112d5e7de94e389d20e209a890e931863c734378b39b7394da13",
});
const admittedAuthorities = new WeakSet();
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const samePath = (a, b) =>
	process.platform === "win32"
		? resolve(a).toLowerCase() === resolve(b).toLowerCase()
		: resolve(a) === resolve(b);
function sameRealPath(actual, expected) {
	// Bun 1.4.2 returns bare "E:" for realpath("E:\\"). Only a matching
	// absolute drive-root ancestor may use that representation; not a cwd path.
	if (process.platform === "win32" && /^[a-z]:$/i.test(actual))
		return (
			/^[a-z]:\\$/i.test(expected) &&
			actual.toLowerCase() === expected.slice(0, 2).toLowerCase()
		);
	return samePath(actual, expected);
}
const freeze = (value) => {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
};
function keys(value, expected) {
	assert.ok(
		value && typeof value === "object" && !Array.isArray(value),
		"Object required",
	);
	assert.deepEqual(
		Object.keys(value).sort(),
		[...expected].sort(),
		"Unknown or missing receipt fields",
	);
}
function digest(value) {
	assert.match(value, HASH, "SHA256 required");
}
function fileEntry(entry, role = "ordinary") {
	keys(entry, ["path", "byteLength", "sha256"]);
	assert.ok(
		typeof entry.path === "string" &&
			entry.path.length > 0 &&
			!isAbsolute(entry.path),
	);
	assert.ok(!entry.path.includes("\\") && !entry.path.includes(":"));
	assert.ok(
		entry.path
			.split("/")
			.every((part) => part && part !== "." && part !== ".."),
	);
	assert.ok(
		Number.isSafeInteger(entry.byteLength) &&
			entry.byteLength >= 0 &&
			(entry.byteLength <= MAX_FILE ||
				(role === "browser" &&
					entry.path === frozenBrowserDll.path &&
					entry.byteLength === frozenBrowserDll.byteLength &&
					entry.sha256 === frozenBrowserDll.sha256)),
	);
	digest(entry.sha256);
}
async function plain(path, directory) {
	assert.ok(
		typeof path === "string" && isAbsolute(path),
		"Explicit absolute path required",
	);
	const target = resolve(path);
	for (let current = target; ; current = dirname(current)) {
		const stat = await lstat(current);
		assert.equal(stat.isSymbolicLink(), false, "Redirected path rejected");
		assert.ok(
			sameRealPath(await realpath(current), current),
			"Redirected parent rejected",
		);
		if (dirname(current) === current) break;
	}
	const stat = await lstat(target);
	assert.ok(directory ? stat.isDirectory() : stat.isFile(), "Wrong file type");
	return target;
}
async function receiptBytes(path, expected) {
	digest(expected);
	await plain(path, false);
	const bytes = await readFile(path);
	assert.ok(
		bytes.length > 0 && bytes.length <= MAX_RECEIPT,
		"Receipt size rejected",
	);
	assert.equal(
		sha256(bytes),
		expected,
		"Receipt is not independently approved",
	);
	assert.ok(
		!(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191),
		"Receipt BOM rejected",
	);
	return {
		bytes,
		parsed: JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
	};
}
export function parseParticleAuthoritySelection(options) {
	const lane = options.authority,
		path = options["authority-receipt"];
	const hasLane = Object.hasOwn(options, "authority"),
		hasPath = Object.hasOwn(options, "authority-receipt");
	assert.equal(hasLane, hasPath, "Authority and receipt must be paired");
	if (!hasLane) return freeze({ kind: "legacy-c3" });
	assert.equal(
		lane,
		PARTICLE_AUTHORITY_LANE,
		"Unknown particle authority lane",
	);
	assert.ok(
		typeof path === "string" && isAbsolute(path),
		"Absolute authority receipt required",
	);
	return freeze({
		kind: "new-authority",
		laneId: lane,
		receiptPath: resolve(path),
	});
}
async function captureClosure(
	description,
	required,
	captures,
	exact = false,
	role = "ordinary",
) {
	keys(description, ["root", "files", "closureSha256"]);
	const root = await plain(description.root, true);
	assert.ok(Array.isArray(description.files) && description.files.length > 0);
	description.files.forEach((entry) => fileEntry(entry, role));
	const paths = description.files.map((entry) => entry.path);
	assert.deepEqual(paths, [...paths].sort(), "Closure files must be sorted");
	assert.equal(
		new Set(paths.map((path) => path.toLowerCase())).size,
		paths.length,
		"Canonical duplicate file",
	);
	for (const path of required)
		assert.ok(paths.includes(path), `Missing required closure role ${path}`);
	if (exact)
		assert.deepEqual(paths, [...required].sort(), "Unexpected packed sidecar");
	digest(description.closureSha256);
	assert.equal(
		sha256(JSON.stringify(description.files)),
		description.closureSha256,
		"Closure digest mismatch",
	);
	const actualPaths = [];
	async function walk(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			assert.equal(entry.isSymbolicLink(), false, "Closure link rejected");
			if (entry.isDirectory()) await walk(path);
			else {
				assert.ok(entry.isFile());
				actualPaths.push(relative(root, path).replaceAll("\\", "/"));
			}
		}
	}
	await walk(root);
	assert.deepEqual(
		actualPaths.sort(),
		paths,
		"Unaccounted or missing closure file",
	);
	for (const entry of description.files) {
		const path = await plain(join(root, entry.path), false);
		const bytes = await readFile(path);
		assert.equal(bytes.length, entry.byteLength, "Closure length changed");
		assert.equal(sha256(bytes), entry.sha256, "Closure bytes changed");
		const prior = captures.get(path);
		if (prior)
			assert.equal(
				sha256(prior.bytes),
				entry.sha256,
				"Conflicting closure admission",
			);
		captures.set(path, { bytes, expected: { ...entry }, root });
	}
	return root;
}
export async function admitParticleAuthority({ selection, paths }) {
	assert.equal(
		selection?.kind,
		"new-authority",
		"Explicit new authority required",
	);
	assert.equal(selection.laneId, trustedLane.laneId);
	assert.ok(
		trustedLane.authorityReceiptSha256,
		"Particle authority is not independently configured",
	);
	const { parsed: receipt } = await receiptBytes(
		selection.receiptPath,
		trustedLane.authorityReceiptSha256,
	);
	keys(receipt, [
		"schema",
		"laneId",
		"nativeAuthority",
		"parentReceipts",
		"packages",
		"runtime",
		"toolchain",
		"browser",
		"executables",
		"productionIdentity",
	]);
	assert.equal(receipt.schema, "particle-export-authority/v1");
	assert.equal(receipt.laneId, trustedLane.laneId);
	keys(receipt.nativeAuthority, [
		"wasmSha256",
		"sourceCommit",
		"fixtureSourceSha256",
	]);
	assert.equal(
		receipt.nativeAuthority.wasmSha256,
		CANONICAL_PARTICLE_WASM_SHA256,
	);
	assert.match(receipt.nativeAuthority.sourceCommit, /^[a-f0-9]{40}$/);
	digest(receipt.nativeAuthority.fixtureSourceSha256);
	assert.ok(
		Array.isArray(receipt.parentReceipts) && receipt.parentReceipts.length > 0,
	);
	const parents = new Set();
	for (const parent of receipt.parentReceipts) {
		keys(parent, ["path", "sha256"]);
		digest(parent.sha256);
		const path = await plain(parent.path, false);
		assert.ok(!parents.has(path));
		parents.add(path);
		assert.equal(
			sha256(await readFile(path)),
			parent.sha256,
			"Producer receipt changed",
		);
	}
	keys(receipt.packages, ["sourceSync", "bundler", "packedSampler"]);
	keys(receipt.runtime, ["node", "bun"]);
	keys(receipt.executables, ["chromium", "ffmpeg", "ffprobe"]);
	keys(paths, [
		"wasmSync",
		"samplerDirectory",
		"toolchain",
		"bun",
		"node",
		"chromium",
		"ffmpeg",
		"ffprobe",
	]);
	const captures = new Map();
	const sync = await captureClosure(
		receipt.packages.sourceSync,
		[
			"opencut_wasm_sync.js",
			"opencut_wasm_bg.js",
			"opencut_wasm_bg.wasm",
			"package.json",
			"opencut_wasm.d.ts",
		],
		captures,
	);
	await captureClosure(
		receipt.packages.bundler,
		[
			"opencut_wasm.js",
			"opencut_wasm_bg.js",
			"opencut_wasm_bg.wasm",
			"package.json",
			"opencut_wasm.d.ts",
		],
		captures,
	);
	const packed = await captureClosure(
		receipt.packages.packedSampler,
		[
			"particle-sampler-wasm.mjs",
			"opencut_wasm_bg.wasm",
			"particle-sampler-worker-entry.mjs",
		],
		captures,
		true,
	);
	const toolchain = await captureClosure(
		receipt.toolchain,
		["package-lock.json"],
		captures,
	);
	await captureClosure(receipt.browser, [], captures, false, "browser");
	assert.ok(samePath(paths.wasmSync, join(sync, "opencut_wasm_sync.js")));
	assert.ok(samePath(paths.samplerDirectory, packed));
	assert.ok(samePath(paths.toolchain, toolchain));
	for (const pkg of Object.values(receipt.packages))
		assert.equal(
			pkg.files.find((file) => file.path === "opencut_wasm_bg.wasm").sha256,
			CANONICAL_PARTICLE_WASM_SHA256,
		);
	for (const [name, runtime] of Object.entries({
		...receipt.runtime,
		...receipt.executables,
	})) {
		keys(runtime, ["path", "sha256", "version"]);
		digest(runtime.sha256);
		const path = await plain(runtime.path, false);
		assert.ok(samePath(paths[name], path));
		assert.equal(
			sha256(await readFile(path)),
			runtime.sha256,
			"Runtime executable changed",
		);
		assert.ok(
			typeof runtime.version === "string" && runtime.version.length > 0,
		);
	}
	assert.equal(receipt.runtime.bun.version, "1.4.2");
	keys(receipt.productionIdentity, [
		"sourceSync",
		"packedSidecar",
		"adapterSha256",
	]);
	digest(receipt.productionIdentity.adapterSha256);
	const runtime = { name: "bun", version: receipt.runtime.bun.version };
	samplerIdentity(
		receipt.productionIdentity.sourceSync,
		"source-sync",
		runtime,
	);
	samplerIdentity(
		receipt.productionIdentity.packedSidecar,
		"packed-sidecar",
		runtime,
	);
	for (const [name, pkg, mapping] of [
		[
			"sourceSync",
			receipt.packages.sourceSync,
			{
				module: "opencut_wasm_sync.js",
				glue: "opencut_wasm_bg.js",
				wasm: "opencut_wasm_bg.wasm",
			},
		],
		[
			"packedSidecar",
			receipt.packages.packedSampler,
			{ module: "particle-sampler-wasm.mjs", wasm: "opencut_wasm_bg.wasm" },
		],
	])
		for (const file of receipt.productionIdentity[name].files) {
			const entry =
				file.role === "worker-entry"
					? receipt.packages.packedSampler.files.find(
							(item) => item.path === "particle-sampler-worker-entry.mjs",
						)
					: pkg.files.find((item) => item.path === mapping[file.role]);
			assert.equal(file.sha256, entry.sha256);
			assert.equal(file.bytes, entry.byteLength);
		}
	const metadata = freeze(structuredClone(receipt));
	const admitted = Object.freeze({
		laneId: receipt.laneId,
		authorityReceiptSha256: trustedLane.authorityReceiptSha256,
		metadata,
		readCapturedFile(path) {
			const capture = captures.get(resolve(path));
			assert.ok(capture, "File not admitted");
			return Buffer.from(capture.bytes);
		},
		async assertOutputRoot(path) {
			const output = await plain(path, true);
			for (const input of [
				...Object.values(metadata.packages),
				metadata.toolchain,
				metadata.browser,
			]) {
				const forward = relative(input.root, output),
					reverse = relative(output, input.root);
				assert.ok(
					forward && (forward.startsWith("..") || isAbsolute(forward)),
					"Output inside immutable input",
				);
				assert.ok(
					reverse && (reverse.startsWith("..") || isAbsolute(reverse)),
					"Input inside output",
				);
			}
		},
		async assertUnchanged() {
			await receiptBytes(
				selection.receiptPath,
				trustedLane.authorityReceiptSha256,
			);
			const fresh = new Map();
			for (const pkg of Object.values(metadata.packages))
				await captureClosure(pkg, [], fresh);
			await captureClosure(metadata.toolchain, [], fresh);
			await captureClosure(metadata.browser, [], fresh, false, "browser");
			for (const runtime of Object.values({
				...metadata.runtime,
				...metadata.executables,
			})) {
				await plain(runtime.path, false);
				assert.equal(
					sha256(await readFile(runtime.path)),
					runtime.sha256,
					"Runtime drift",
				);
			}
			for (const parent of metadata.parentReceipts) {
				await plain(parent.path, false);
				assert.equal(sha256(await readFile(parent.path)), parent.sha256);
			}
		},
	});
	admittedAuthorities.add(admitted);
	return admitted;
}
export async function admitParticleCompileBaseline({ authority, receiptPath }) {
	assert.ok(
		admittedAuthorities.has(authority),
		"Authentic admitted authority required",
	);
	assert.equal(
		authority?.authorityReceiptSha256,
		trustedLane.authorityReceiptSha256,
	);
	assert.ok(
		trustedLane.authorityReceiptSha256 && trustedLane.baselineReceiptSha256,
		"Compile baseline is not independently configured",
	);
	await authority.assertUnchanged();
	const { parsed: receipt } = await receiptBytes(
		receiptPath,
		trustedLane.baselineReceiptSha256,
	);
	keys(receipt, [
		"schema",
		"laneId",
		"authorityReceiptSha256",
		"project",
		"sourceSha256",
		"fullStateSha256",
		"revision",
		"contract",
		"packedSamplerIdentity",
		"adapterSha256",
		"producerReceipt",
	]);
	assert.equal(receipt.schema, "particle-compile-baseline/v1");
	assert.equal(receipt.laneId, trustedLane.laneId);
	assert.equal(
		receipt.authorityReceiptSha256,
		authority.authorityReceiptSha256,
	);
	assert.equal(receipt.revision, 2);
	assert.deepEqual(receipt.contract, {
		frameCount: 121,
		fps: { numerator: 30, denominator: 1 },
		durationTicks: 484000,
		width: 1920,
		height: 1080,
		opacity: 0.85,
	});
	digest(receipt.sourceSha256);
	digest(receipt.fullStateSha256);
	assert.deepEqual(
		receipt.packedSamplerIdentity,
		authority.metadata.productionIdentity.packedSidecar,
	);
	assert.equal(
		receipt.adapterSha256,
		authority.metadata.productionIdentity.adapterSha256,
	);
	keys(receipt.producerReceipt, ["path", "sha256"]);
	digest(receipt.producerReceipt.sha256);
	await plain(receipt.producerReceipt.path, false);
	assert.equal(
		sha256(await readFile(receipt.producerReceipt.path)),
		receipt.producerReceipt.sha256,
	);
	await captureClosure(receipt.project, ["project.json"], new Map());
	return freeze({
		baselineReceiptSha256: trustedLane.baselineReceiptSha256,
		metadata: receipt,
	});
}
export function assertParticleAuthorityRuntime({
	authority,
	name,
	executable,
	version,
}) {
	assert.ok(
		admittedAuthorities.has(authority),
		"Authentic admitted authority required",
	);
	assert.equal(
		authority?.authorityReceiptSha256,
		trustedLane.authorityReceiptSha256,
	);
	assert.ok(trustedLane.authorityReceiptSha256, "Authority not configured");
	assert.ok(name === "node" || name === "bun");
	const expected = authority.metadata.runtime[name];
	assert.ok(samePath(executable, expected.path));
	assert.equal(version, expected.version);
}
