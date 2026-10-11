import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
	admitParticleAuthority,
	parseParticleAuthoritySelection,
	PARTICLE_AUTHORITY_LANE,
} from "./particle-editor-export-authority.mjs";
import {
	stageParticleAuthority,
	verifyParticleAuthorityStage,
	writeParticleAuthorityBootstrap,
} from "./particle-editor-export-authority-stage.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const clone = (value) => structuredClone(value);
let serial = 0;
async function fixture(change = () => {}, scaledBrowser = false) {
	const root = await mkdtemp(join(tmpdir(), "particle-authority-cpu-fixture-"));
	const captures = new Map();
	async function closure(name, files) {
		const directory = join(root, name);
		await mkdir(directory);
		const entries = [];
		for (const [path, bytes] of Object.entries(files).sort(([a], [b]) =>
			a < b ? -1 : a > b ? 1 : 0,
		)) {
			await writeFile(join(directory, path), bytes, { flag: "wx" });
			entries.push({ path, byteLength: bytes.length, sha256: hash(bytes) });
		}
		const result = {
			root: directory,
			files: entries,
			closureSha256: hash(JSON.stringify(entries)),
		};
		captures.set(name, result);
		return result;
	}
	const worker = Buffer.from("fixture worker; not executable authority"),
		glue = Buffer.from("fixture glue"),
		module = Buffer.from("fixture sync"),
		packed = Buffer.from("fixture packed");
	const sourceSync = await closure("sync", {
		"opencut_wasm_sync.js": module,
		"opencut_wasm_bg.js": glue,
		"opencut_wasm_bg.wasm": wasm,
		"package.json": Buffer.from("{}"),
		"opencut_wasm.d.ts": Buffer.from("fixture type"),
	});
	const bundler = await closure("bundler", {
		"opencut_wasm.js": Buffer.from("fixture wrapper"),
		"opencut_wasm_bg.js": glue,
		"opencut_wasm_bg.wasm": wasm,
		"package.json": Buffer.from("{}"),
		"opencut_wasm.d.ts": Buffer.from("fixture type"),
	});
	const packedSampler = await closure("packed", {
		"particle-sampler-wasm.mjs": packed,
		"opencut_wasm_bg.wasm": wasm,
		"particle-sampler-worker-entry.mjs": worker,
	});
	const toolchain = await closure("toolchain", {
		"empty.js": Buffer.alloc(0),
		"package-lock.json": Buffer.from("{}"),
	});
	const browser = await closure("browser", {
		...(scaledBrowser ? { "chrome.dll": Buffer.alloc(256, 100) } : {}),
		"chrome.exe": Buffer.from("fixture chrome"),
	});
	const ffmpegPath = join(root, "ffmpeg.fixture"),
		ffprobePath = join(root, "ffprobe.fixture");
	await writeFile(ffmpegPath, "ffmpeg-fixture", { flag: "wx" });
	await writeFile(ffprobePath, "ffprobe-fixture", { flag: "wx" });
	const nodePath = join(root, "node.fixture"),
		bunPath = join(root, "bun.fixture");
	await writeFile(nodePath, "node-fixture", { flag: "wx" });
	await writeFile(bunPath, "bun-fixture", { flag: "wx" });
	const parentPath = join(root, "producer.json");
	await writeFile(parentPath, "{}", { flag: "wx" });
	const identity = (layout, bytes) => {
		const roles =
			layout === "source-sync"
				? ["module", "glue", "wasm", "worker-entry"]
				: ["module", "wasm", "worker-entry"];
		const files = roles.map((role, i) => ({
			role,
			sha256: hash(bytes[i]),
			bytes: bytes[i].length,
		}));
		const unsigned = {
			version: 1,
			bindingVersion: "inline-wasm-v1",
			layout,
			runtime: { name: "bun", version: "1.4.2" },
			files,
			executionHash: hash("fixture execution " + layout),
			closureHash: hash(JSON.stringify(files)),
			publishedPolicyHash: hash("fixture published policy"),
			policyHash: hash("fixture policy"),
		};
		return { ...unsigned, identityHash: hash(JSON.stringify(unsigned)) };
	};
	const receipt = {
		schema: "particle-export-authority/v1",
		laneId: PARTICLE_AUTHORITY_LANE,
		nativeAuthority: {
			wasmSha256: hash(wasm),
			sourceCommit: "1".repeat(40),
			fixtureSourceSha256: hash("fixture source"),
		},
		parentReceipts: [{ path: parentPath, sha256: hash("{}") }],
		packages: { sourceSync, bundler, packedSampler },
		runtime: {
			node: {
				path: nodePath,
				sha256: hash("node-fixture"),
				version: "vfixture",
			},
			bun: { path: bunPath, sha256: hash("bun-fixture"), version: "1.4.2" },
		},
		toolchain,
		browser,
		executables: {
			chromium: {
				path: join(browser.root, "chrome.exe"),
				sha256: hash("fixture chrome"),
				version: "fixture",
			},
			ffmpeg: {
				path: ffmpegPath,
				sha256: hash("ffmpeg-fixture"),
				version: "fixture",
			},
			ffprobe: {
				path: ffprobePath,
				sha256: hash("ffprobe-fixture"),
				version: "fixture",
			},
		},
		productionIdentity: {
			sourceSync: identity("source-sync", [module, glue, wasm, worker]),
			packedSidecar: identity("packed-sidecar", [packed, wasm, worker]),
			adapterSha256: hash("fixture adapter"),
		},
	};
	change(receipt);
	const receiptPath = join(root, "authority.json"),
		raw = JSON.stringify(receipt);
	await writeFile(receiptPath, raw, { flag: "wx" });
	// This is an isolated simulated review registry for synthetic CPU fixtures.
	// It cannot modify the candidate's fixed production registry. The
	// canonical test binary replacement is explicit; this is not native acceptance.
	const source = new TextDecoder("utf8", { fatal: true }).decode(
		await readFile(
			new URL("./particle-editor-export-authority.mjs", import.meta.url),
		),
	);
	let testSource = source
		.replace(
			/authorityReceiptSha256:\s*(?:null|"[a-f0-9]{64}")/,
			`authorityReceiptSha256: "${hash(raw)}"`,
		)
		.replace(
			"084cf7310df5bfdc1b8e4ce3f64bcff842e1b23b9fd0ca57c1c7dcffc0d1fc12",
			hash(wasm),
		)
		.replace(
			'"./particle-editor-export-authority-identity.mjs"',
			JSON.stringify(
				new URL(
					"./particle-editor-export-authority-identity.mjs",
					import.meta.url,
				).href,
			),
		);
	if (scaledBrowser) {
		// Synthetic CPU policy scale; production cap and frozen DLL pin never change.
		testSource = testSource
			.replace("const MAX_FILE = 256 * 1024 * 1024", "const MAX_FILE = 128")
			.replace("byteLength: 301124096", "byteLength: 256")
			.replace(
				"0b69d34d08e1112d5e7de94e389d20e209a890e931863c734378b39b7394da13",
				hash(Buffer.alloc(256, 100)),
			);
	}
	const testModule = await import(
		`data:text/javascript;base64,${Buffer.from(testSource).toString("base64")}#fixture${serial++}`
	);
	const paths = {
		wasmSync: join(sourceSync.root, "opencut_wasm_sync.js"),
		samplerDirectory: packedSampler.root,
		toolchain: toolchain.root,
		bun: bunPath,
		node: nodePath,
		chromium: join(browser.root, "chrome.exe"),
		ffmpeg: ffmpegPath,
		ffprobe: ffprobePath,
	};
	const selection = parseParticleAuthoritySelection({
		authority: PARTICLE_AUTHORITY_LANE,
		"authority-receipt": receiptPath,
	});
	return {
		root,
		receipt,
		raw,
		receiptPath,
		paths,
		selection,
		testModule,
		captures,
		admit: () => testModule.admitParticleAuthority({ selection, paths }),
	};
}
test("no authority flags preserve a legacy selection; paired fixed lane only", () => {
	assert.deepEqual(parseParticleAuthoritySelection({}), { kind: "legacy-c3" });
	for (const options of [
		{ authority: PARTICLE_AUTHORITY_LANE },
		{ "authority-receipt": "C:/r.json" },
		{ authority: "", "authority-receipt": "" },
		{ authority: undefined, "authority-receipt": undefined },
		{ authority: "other", "authority-receipt": "C:/r.json" },
		{
			authority: PARTICLE_AUTHORITY_LANE,
			"authority-receipt": "relative.json",
		},
	])
		assert.throws(() => parseParticleAuthoritySelection(options));
});
test("production fixed trust anchor rejects an arbitrary receipt before executable admission", async () => {
	const f = await fixture();
	await assert.rejects(
		admitParticleAuthority({
			selection: f.selection,
			paths: f.paths,
		}),
		/Receipt is not independently approved/,
	);
});
test("isolated trusted fixture admits complete closure and immutable expectations", async () => {
	const f = await fixture(),
		authority = await f.admit();
	assert.ok(Object.isFrozen(authority.metadata.packages.sourceSync.files[0]));
	await authority.assertUnchanged();
	const bytes = authority.readCapturedFile(f.paths.wasmSync);
	bytes.fill(0);
	assert.equal(
		authority.readCapturedFile(f.paths.wasmSync).toString(),
		"fixture sync",
	);
	f.testModule.assertParticleAuthorityRuntime({
		authority,
		name: "bun",
		executable: f.paths.bun,
		version: "1.4.2",
	});
	assert.throws(() =>
		f.testModule.assertParticleAuthorityRuntime({
			authority,
			name: "bun",
			executable: f.paths.bun,
			version: "1.2.18",
		}),
	);
	assert.throws(
		() =>
			f.testModule.assertParticleAuthorityRuntime({
				authority: { ...authority },
				name: "bun",
				executable: f.paths.bun,
				version: "1.4.2",
			}),
		/Authentic/,
	);
});
test("new lane staging copies captured package bytes and rejects overwritten output", async () => {
	const f = await fixture(),
		authority = await f.admit(),
		output = join(f.root, "output");
	await mkdir(output);
	const remembered = new Map(),
		remember = async (path) => {
			const bytes = await readFile(path);
			remembered.set(path, bytes);
			return bytes;
		};
	const staged = await stageParticleAuthority({
		authority,
		root: output,
		remember,
	});
	assert.equal((await readFile(staged.wasmSync)).toString(), "fixture sync");
	assert.equal(remembered.size, 13);
	await verifyParticleAuthorityStage({ authority, root: output });
	await assert.rejects(
		stageParticleAuthority({ authority, root: output, remember }),
		/EEXIST/,
	);
	await writeFile(staged.bundlerEntry, "drift");
	await assert.rejects(
		verifyParticleAuthorityStage({ authority, root: output }),
		/Staged authority changed/,
	);
});
test("new lane bootstrap observes WASM before importing statically initialized Host", async () => {
	const f = await fixture(),
		authority = await f.admit(),
		output = join(f.root, "output");
	await mkdir(output);
	await writeParticleAuthorityBootstrap({
		authority,
		root: output,
		remember: readFile,
	});
	const bootstrap = await readFile(join(output, "host.mjs"), "utf8");
	assert.ok(
		bootstrap.indexOf("await admitParticleAuthorityHostContext") <
			bootstrap.indexOf("installParticleAuthorityBrowserObserver({"),
	);
	assert.ok(
		bootstrap.indexOf("installParticleAuthorityBrowserObserver({") <
			bootstrap.indexOf('await import("./host-body.mjs")'),
	);
	await assert.rejects(
		writeParticleAuthorityBootstrap({
			authority,
			root: output,
			remember: readFile,
		}),
		/EEXIST/,
	);
});
test("self-consistent rewritten receipt cannot reapprove its own digest", async () => {
	const f = await fixture();
	const changed = clone(f.receipt);
	changed.runtime.bun.version = "1.9.9";
	await writeFile(f.receiptPath, JSON.stringify(changed));
	await assert.rejects(f.admit(), /not independently approved/);
});
test("same-length wrong binary and wrong runtime executable fail predeclared hashes", async () => {
	for (const name of ["binary", "runtime"]) {
		const f = await fixture();
		const path =
			name === "binary"
				? join(f.receipt.packages.packedSampler.root, "opencut_wasm_bg.wasm")
				: f.paths.bun;
		const bytes = await readFile(path);
		bytes[0] ^= 1;
		await writeFile(path, bytes);
		await assert.rejects(
			f.admit(),
			name === "binary"
				? /Closure bytes changed/
				: /Runtime executable changed/,
		);
	}
});
test("unexpected closure file and escaped receipt paths reject", async () => {
	const f = await fixture();
	await writeFile(
		join(f.receipt.packages.sourceSync.root, "hidden.js"),
		"unexpected",
	);
	await assert.rejects(f.admit(), /Unaccounted/);
	const escaped = await fixture((receipt) => {
		receipt.packages.sourceSync.files[0].path = "../escaped.js";
	});
	await assert.rejects(escaped.admit());
});
test("authority mutation after admission fails against original immutable snapshot", async () => {
	const f = await fixture(),
		authority = await f.admit();
	await writeFile(f.paths.wasmSync, "modified");
	await assert.rejects(authority.assertUnchanged(), /Closure length changed/);
});
test("different compile/capture layout, runtime, identity digest or package role are not equivalent", async () => {
	for (const change of [
		(r) => {
			r.productionIdentity.packedSidecar.layout = "source-sync";
		},
		(r) => {
			r.productionIdentity.packedSidecar.runtime.version = "1.2.18";
		},
		(r) => {
			r.productionIdentity.packedSidecar.identityHash = "0".repeat(64);
		},
		(r) => {
			r.productionIdentity.sourceSync.files[0].sha256 = "0".repeat(64);
		},
		(r) => {
			r.extra = true;
		},
	]) {
		const f = await fixture(change);
		await assert.rejects(f.admit());
	}
});
test("compile baseline is a second independent anchor, not auto-approved by authority", async () => {
	const f = await fixture(),
		authority = await f.admit();
	await assert.rejects(
		f.testModule.admitParticleCompileBaseline({
			authority,
			receiptPath: "missing",
		}),
		/Compile baseline is not independently configured/,
	);
});

test("ordinary closure admits an empty file only with its declared empty-content SHA", async () => {
	const f = await fixture(),
		authority = await f.admit(),
		entry = f.receipt.toolchain.files.find((file) => file.path === "empty.js");
	assert.equal(entry.byteLength, 0);
	assert.equal(
		entry.sha256,
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
	assert.equal(
		authority.readCapturedFile(join(f.paths.toolchain, "empty.js")).length,
		0,
	);
	await authority.assertUnchanged();
	await writeFile(join(f.paths.toolchain, "empty.js"), "changed");
	await assert.rejects(authority.assertUnchanged(), /Closure length changed/);
});

test("self-consistent empty-file description with wrong content SHA rejects", async () => {
	const f = await fixture((receipt) => {
		const entry = receipt.toolchain.files.find(
			(file) => file.path === "empty.js",
		);
		entry.sha256 = "0".repeat(64);
		receipt.toolchain.closureSha256 = hash(
			JSON.stringify(receipt.toolchain.files),
		);
	});
	await assert.rejects(f.admit(), /Closure bytes changed/);
});

test("ordinary closure still rejects negative, fractional and over-cap byte lengths", async () => {
	for (const byteLength of [-1, 0.5, 256 * 1024 * 1024 + 1]) {
		const f = await fixture((receipt) => {
			receipt.toolchain.files.find(
				(file) => file.path === "empty.js",
			).byteLength = byteLength;
			receipt.toolchain.closureSha256 = hash(
				JSON.stringify(receipt.toolchain.files),
			);
		});
		await assert.rejects(f.admit());
	}
});

test("sampler identity role still rejects zero bytes with self-consistent identity digests", async () => {
	const { assertParticleReceiptSamplerIdentity } =
		await import("./particle-editor-export-authority-identity.mjs");
	const f = await fixture(),
		identity = clone(f.receipt.productionIdentity.packedSidecar);
	identity.files[0].bytes = 0;
	identity.closureHash = hash(JSON.stringify(identity.files));
	const { identityHash: ignored, ...unsigned } = identity;
	assert.equal(typeof ignored, "string");
	identity.identityHash = hash(JSON.stringify(unsigned));
	assert.throws(() =>
		assertParticleReceiptSamplerIdentity(identity, "packed-sidecar", {
			name: "bun",
			version: "1.4.2",
		}),
	);
});

test("browser-only exact exception is reapplied by assertUnchanged and rejects byte drift", async () => {
	const f = await fixture(() => {}, true),
		authority = await f.admit();
	await authority.assertUnchanged();
	const path = join(f.receipt.browser.root, "chrome.dll"),
		bytes = await readFile(path);
	bytes[0] ^= 1;
	await writeFile(path, bytes);
	await assert.rejects(authority.assertUnchanged(), /Closure bytes changed/);
});
