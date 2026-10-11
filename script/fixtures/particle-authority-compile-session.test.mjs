import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const repository =
	process.env.PARTICLE_SPLIT_REPO_ROOT ?? resolve(directory, "../..");
const { build } = createRequire(join(repository, "package.json"))("esbuild");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
globalThis.__particleC2Processes = [{ closed: true }];
let hostArguments,
	hostCloseCalls = 0,
	closeFailure;
const tokens = [
	"first-private-token",
	"second-private-token",
	"third-private-token",
];
let hostCount = 0;
globalThis.__particleSplitCpuStartHost = async (args) => {
	hostArguments = args;
	return {
		token: tokens[hostCount++ % tokens.length],
		editorUrl: "http://127.0.0.1:12345/editor/",
		automation: {
			clips: async () => globalThis.__particleSplitCpuClips,
			tracks: async () => [],
		},
		close: async () => {
			hostCloseCalls++;
			if (closeFailure) throw closeFailure;
		},
	};
};
globalThis.__particleSplitCpuArchive = {};
const stubs = {
	host: "export const startHost = args => globalThis.__particleSplitCpuStartHost(args);",
	"target-registry":
		"export class TargetRegistry { constructor(path) { this.path = path; } }",
	"particle-c4-export-support.mjs":
		"export const treeManifest = async () => ({files: []});",
	"three-particle-provenance":
		"export const parseThreeParticleArchive = () => globalThis.__particleSplitCpuArchive;",
};
async function bundle(entry, extra = {}) {
	const result = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		plugins: [
			{
				name: "cpu-only-producer-dependencies",
				setup(builder) {
					const declarations = { ...stubs, ...extra };
					builder.onResolve({ filter: /.*/ }, (args) => {
						if (args.path.startsWith("node:"))
							return { path: args.path, external: true };
						const key = Object.keys(declarations).find(
							(name) => args.path.endsWith("/" + name) || args.path === name,
						);
						if (key) return { path: key, namespace: "cpu-stub" };
						if (
							args.kind === "entry-point" ||
							args.path.startsWith("./particle-authority-compile-session")
						)
							return;
						throw Error("Unexpected CPU producer dependency: " + args.path);
					});
					builder.onLoad({ filter: /.*/, namespace: "cpu-stub" }, (args) => ({
						contents: declarations[args.path],
						loader: "js",
					}));
				},
			},
		],
	});
	return import(
		"data:text/javascript;base64," +
			Buffer.from(result.outputFiles[0].text).toString("base64") +
			"#" +
			Math.random()
	);
}
const { createParticleCompileSession } = await bundle(
	join(directory, "particle-authority-compile-session.ts"),
);
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "particle-split-cpu-"));
	return createParticleCompileSession({
		rootArgument: root,
		toolchainDirectory: join(root, "toolchain"),
		authorityContextPath: join(root, "context.json"),
	});
}

test("Host lifecycle, empty browser slots, token redaction and failed close ownership are unchanged", async () => {
	hostCount = 0;
	hostCloseCalls = 0;
	closeFailure = undefined;
	const session = await fixture();
	globalThis.__particleC2Processes[0].closed = false;
	assert.throws(() => session.allClosed(), /Compiler children/);
	globalThis.__particleC2Processes[0].closed = true;
	// The required launcher's array is captured when the session is constructed.
	for (let i = 0; i < 3; i++) {
		await session.openHost();
		assert.equal(hostArguments.htmlBrowserExecutable, "");
		assert.equal(hostArguments.htmlFrameConnectionFile, "");
		assert.equal(hostArguments.projectRoot, session.projectRoot);
		assert.equal(
			hostArguments.engineToolchainDirectory,
			session.toolchainDirectory,
		);
		assert.equal(session.redacted(tokens.join(" ")).includes(tokens[i]), false);
		await session.closeHost();
	}
	assert.equal(session.opened, 3);
	assert.equal(session.closed, 3);
	assert.equal(session.host, undefined);
	assert.equal(hostCloseCalls, 3);
	await session.openHost();
	closeFailure = Error("close rejected");
	await assert.rejects(session.closeHost(), /close rejected/);
	assert.ok(session.host);
	assert.equal(session.closed, 3);
	closeFailure = undefined;
	await session.closeHost();
});

test("Host API preserves POST/GET, exact signal, revision and opacity assertions", async () => {
	const session = await fixture();
	await session.openHost();
	const source = { code: "CPU source" };
	globalThis.__particleSplitCpuClips = [
		{
			id: "particle-model",
			editing: { programmatic: source, params: { opacity: 0.85 } },
		},
	];
	const requests = [];
	const oldFetch = globalThis.fetch;
	globalThis.fetch = async (url, options) => {
		requests.push({ url: String(url), options });
		return Response.json(
			url.pathname.endsWith("/apply")
				? { accepted: true, revision: 2 }
				: { revision: 2 },
		);
	};
	try {
		assert.equal((await session.currentSource(source)).id, "particle-model");
		await session.apply(1, [{ kind: "CPU operation" }], "CPU key");
		assert.equal(requests[0].url, "http://127.0.0.1:12345/editor/api/apply");
		assert.equal(requests[0].options.method, "POST");
		assert.equal(requests[0].options.signal, session.signal);
		assert.deepEqual(JSON.parse(requests[0].options.body), {
			expectedRevision: 1,
			operations: [{ kind: "CPU operation" }],
			idempotencyKey: "CPU key",
		});
		assert.equal(requests[1].options.method, undefined);
		globalThis.__particleSplitCpuClips[0].editing.params.opacity = 0.55;
		await assert.rejects(session.currentSource(source));
		globalThis.fetch = async () =>
			new Response("CPU server failure", { status: 409 });
		await assert.rejects(
			session.request("apply", {}),
			/apply returned 409: CPU server failure/,
		);
	} finally {
		globalThis.fetch = oldFetch;
		await session.closeHost();
	}
});

test("resource verification enforces bytes/hash and packed archive identity/adapter", async () => {
	const session = await fixture();
	await session.openHost();
	const bytes = new Uint8Array([1, 2, 3]);
	const resource = { id: "lock", byteLength: 3, sha256: digest(bytes) };
	const identity = { runtime: "CPU packed fixture" };
	const source = {
		resources: [],
		build: { inputs: [], toolchainLock: resource },
	};
	session.admittedAuthority = {
		authority: {
			metadata: {
				productionIdentity: {
					packedSidecar: identity,
					adapterSha256: "CPU adapter",
				},
			},
		},
	};
	globalThis.__particleSplitCpuArchive = {
		samplerIdentity: identity,
		adapterSha256: "CPU adapter",
	};
	const oldFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(bytes);
	try {
		assert.deepEqual(await session.verifyResources(source), [
			{ ...resource, verifiedBytes: 3 },
		]);
		assert.equal(session.checks[0].label, "actual production archive identity");
		globalThis.__particleSplitCpuArchive = {
			samplerIdentity: { runtime: "wrong" },
			adapterSha256: "CPU adapter",
		};
		await assert.rejects(session.verifyResources(source));
		globalThis.__particleSplitCpuArchive = {
			samplerIdentity: identity,
			adapterSha256: "wrong",
		};
		await assert.rejects(session.verifyResources(source));
		globalThis.fetch = async () => new Response(new Uint8Array([1, 2]));
		await assert.rejects(session.verifyResources(source));
		globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 4]));
		await assert.rejects(session.verifyResources(source));
	} finally {
		globalThis.fetch = oldFetch;
		await session.closeHost();
	}
});

test("checkpoint binds unchanged raw project bytes and refuses overwrite or invalid UTF-8", async () => {
	const session = await fixture();
	await session.openHost();
	await mkdir(session.projectRoot);
	const bytes = Buffer.from('{"CPU":"原始字节"}\n');
	await writeFile(join(session.projectRoot, "project.json"), bytes, {
		flag: "wx",
	});
	const oldFetch = globalThis.fetch;
	globalThis.fetch = async () => Response.json({ revision: 2 });
	try {
		const record = await session.checkpoint("CPU-checkpoint", 2);
		assert.equal(record.sha256, digest(bytes));
		assert.equal(record.bytes, bytes.length);
		assert.deepEqual(
			await readFile(join(session.root, "CPU-checkpoint-project.json")),
			bytes,
		);
		await assert.rejects(session.checkpoint("CPU-checkpoint", 2), {
			code: "EEXIST",
		});
		await writeFile(
			join(session.projectRoot, "project.json"),
			new Uint8Array([255]),
		);
		await assert.rejects(session.checkpoint("bad", 2), TypeError);
	} finally {
		globalThis.fetch = oldFetch;
		await session.closeHost();
	}
});

test("entry restores absent author and closes Host after workflow failure, with redacted failure output", async () => {
	const root = await mkdtemp(join(tmpdir(), "particle-split-entry-cpu-"));
	await mkdir(join(root, "author"));
	const previous = process.argv;
	const beforeClose = hostCloseCalls;
	process.argv = [
		previous[0],
		"CPU-only-entry",
		root,
		join(root, "toolchain"),
		join(root, "context.json"),
	];
	try {
		await assert.rejects(
			bundle(join(directory, "particle-authority-compile-host.ts"), {
				"particle-authority-compile-inputs":
					"export const admitParticleCompileInputs = async s => { s.rootValidated = true; return {}; };",
				"particle-authority-compile-workflow":
					"import {rename} from 'node:fs/promises'; export const compileParticleBaseline = async s => { await s.openHost(); await rename(s.author,s.retainedAuthor); s.authorMoved=true; throw Error(s.host.token); };",
				"particle-authority-prepare-contract.mjs":
					"export const PARTICLE_BASELINE_CONTRACT = {}; export const particleClosureFiles = () => [];",
			}),
			/private-host-token/,
		);
		const failure = JSON.parse(
			await readFile(join(root, "failure.json"), "utf8"),
		);
		assert.equal(failure.authorMoved, false);
		assert.equal(failure.opened, 1);
		assert.equal(failure.closed, 1);
		assert.equal(hostCloseCalls, beforeClose + 1);
		assert.equal(
			tokens.some((token) => JSON.stringify(failure).includes(token)),
			false,
		);
		await assert.rejects(readFile(join(root, "author-retained")), {
			code: "ENOENT",
		});
		await mkdir(join(root, "author", "restored-proof"));
	} finally {
		process.argv = previous;
	}
});
test("entry keeps both author directories and reports cleanup aggregation on restoration collision", async () => {
	const root = await mkdtemp(join(tmpdir(), "particle-split-cleanup-cpu-"));
	await mkdir(join(root, "author"));
	const previous = process.argv;
	process.argv = [
		previous[0],
		"CPU-only-entry",
		root,
		join(root, "toolchain"),
		join(root, "context.json"),
	];
	try {
		await assert.rejects(
			bundle(join(directory, "particle-authority-compile-host.ts"), {
				"particle-authority-compile-inputs":
					"export const admitParticleCompileInputs = async s => { s.rootValidated = true; return {}; };",
				"particle-authority-compile-workflow":
					"import {rename,mkdir} from 'node:fs/promises'; export const compileParticleBaseline = async s => { await s.openHost(); await rename(s.author,s.retainedAuthor); s.authorMoved=true; await mkdir(s.author); throw Error('CPU workflow failed'); };",
				"particle-authority-prepare-contract.mjs":
					"export const PARTICLE_BASELINE_CONTRACT = {}; export const particleClosureFiles = () => [];",
			}),
			/C4 fixture and ownership cleanup failed/,
		);
		const failure = JSON.parse(
			await readFile(join(root, "failure.json"), "utf8"),
		);
		assert.equal(failure.authorMoved, true);
		assert.equal(failure.opened, 1);
		assert.equal(failure.closed, 1);
		await mkdir(join(root, "author", "preserved-proof"));
		await mkdir(join(root, "author-retained", "preserved-proof"));
	} finally {
		process.argv = previous;
	}
});
