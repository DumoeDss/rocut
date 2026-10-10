import { expect, test } from "bun:test";
import {
	copyFile,
	mkdir,
	mkdtemp,
	rm,
	stat,
	utimes,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { nativeFxFixture } from "../../../../script/fixtures/hyperframes-fx-executor-fixture";
import {
	HYPERFRAMES_TOOLCHAIN,
	REMOTION_TOOLCHAIN,
} from "../programmatic/engines/engine-versions";
import { loadEngineToolchain } from "../programmatic/engines/toolchain";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import { hyperframesGraphFileIdentity } from "../programmatic/hyperframes-graph-file-identity";
import {
	assertHyperframesGraphProvenance,
	hyperframesGraphBrowserIdentity,
	prepareHyperframesGraphIdentity,
} from "../programmatic/hyperframes-graph-identity";
import {
	HYPERFRAMES_GRAPH_PROFILE,
	hyperframesGraphCompileIdentity,
	verifyHyperframesGraphArchive,
} from "../programmatic/hyperframes-graph-provenance";
import {
	describeResource,
	saveResourceBytes,
} from "../programmatic/resource-bytes";
import { resourceDigest } from "../programmatic/resources";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const wasmDirectory = process.env.ROCUT_TEST_WASM_DIRECTORY;
const native = test.skipIf(!toolchain || !wasmDirectory);
const wasmOnly = test.skipIf(!wasmDirectory);
const signal = () => new AbortController().signal;

async function ownDirectory() {
	return mkdtemp(join(resolve(tmpdir()), "rocut-graph-identity-test-"));
}
async function cleanup(directory: string) {
	if (
		dirname(directory) !== resolve(tmpdir()) ||
		!basename(directory).startsWith("rocut-graph-identity-test-")
	)
		throw Error("Unsafe graph identity test cleanup");
	await rm(directory, { recursive: true, force: true });
}
function lockResource(data: unknown): ResolvedProgrammaticResource {
	return lockBytes(new TextEncoder().encode(JSON.stringify(data)).buffer);
}
function lockBytes(body: ArrayBuffer): ResolvedProgrammaticResource {
	return {
		resource: describeResource(
			{
				id: "_rocut/toolchain-lock.json",
				kind: "source",
				mimeType: "application/octet-stream",
			},
			body.byteLength,
			resourceDigest(body),
		),
		body,
	};
}
async function archive(lock: ResolvedProgrammaticResource) {
	const resourceStore = {
		projectId: "graph-identity-test",
		store: new InMemoryProjectStore(),
	};
	await saveResourceBytes(resourceStore, lock);
	const source = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "_rocut/compiled.html",
		width: 64,
		height: 64,
		frameRate: { numerator: 25, denominator: 1 },
		durationFrames: 8,
		seed: 0,
		audio: { version: 1, mode: "native", profile: HYPERFRAMES_GRAPH_PROFILE },
		build: {
			version: 1,
			engine: "hyperframes",
			engineVersion: "0.8.139",
			entryFile: "index.html",
			inputs: [],
			toolchainLock: lock.resource,
		},
	} as ProgrammaticSource;
	return { source, resourceStore };
}

test("decoder identity hashes stable contents rather than path or metadata", async () => {
	const directory = await ownDirectory();
	try {
		const a = join(directory, "a.bin"),
			b = join(directory, "b.bin");
		await writeFile(a, "decoder-content-A");
		await copyFile(a, b);
		const first = await hyperframesGraphFileIdentity(a, signal());
		expect(await hyperframesGraphFileIdentity(b, signal())).toEqual(first);
		expect(Object.keys(first).sort()).toEqual(["byteLength", "sha256"]);
		const before = await stat(a);
		await writeFile(a, "decoder-content-B");
		await utimes(a, before.atime, before.mtime);
		const changed = await hyperframesGraphFileIdentity(a, signal());
		expect(changed.byteLength).toBe(first.byteLength);
		expect(changed.sha256).not.toBe(first.sha256);
		await writeFile(b, "");
		await expect(hyperframesGraphFileIdentity(b, signal())).rejects.toThrow(
			"Invalid graph decoder executable size",
		);
		await expect(
			hyperframesGraphFileIdentity("relative.exe", signal()),
		).rejects.toThrow("absolute executable paths");
		await expect(
			hyperframesGraphFileIdentity(
				join(directory, "private-path-missing.exe"),
				signal(),
			),
		).rejects.toThrow(
			/^Cannot read configured graph decoder executable identity$/,
		);
		const aborted = new AbortController();
		aborted.abort(Error("intentional identity cancellation"));
		await expect(
			hyperframesGraphFileIdentity(a, aborted.signal),
		).rejects.toThrow("intentional identity cancellation");
	} finally {
		await cleanup(directory);
	}
});

test("browser identity admits only bounded actual version fields, never arbitrary CDP metadata", () => {
	const browser = {
		product: "Chrome/151.0.7922.34",
		revision: "revision",
		jsVersion: "15.1",
		protocolVersion: "1.3",
		userAgent: "ignored",
		secret: "must-not-escape",
	};
	const identity = hyperframesGraphBrowserIdentity(browser);
	const { product, revision, jsVersion, protocolVersion } = browser;
	expect(identity).toEqual({ product, revision, jsVersion, protocolVersion });
	expect(Object.isFrozen(identity)).toBe(true);
	for (const value of [undefined, "", "unsafe\r\nheader", "x".repeat(513)])
		expect(() =>
			hyperframesGraphBrowserIdentity({ ...browser, product: value }),
		).toThrow("Invalid actual");
});

wasmOnly(
	"legacy HyperFrames and Remotion locks do not require native FX files or graph identity",
	async () => {
		const directory = await ownDirectory();
		try {
			const packages = {
				...REMOTION_TOOLCHAIN,
				...HYPERFRAMES_TOOLCHAIN,
			};
			const entries: Record<string, { version: string; integrity: string }> =
				{};
			for (const [name, version] of Object.entries(packages)) {
				await mkdir(join(directory, "node_modules", name), { recursive: true });
				await writeFile(
					join(directory, "node_modules", name, "package.json"),
					JSON.stringify({ name, version }),
				);
				entries[`node_modules/${name}`] = { version, integrity: "sha512-AAAA" };
			}
			await writeFile(
				join(directory, "package-lock.json"),
				JSON.stringify({ packages: entries }),
			);
			for (const engine of ["hyperframes", "remotion"] as const) {
				const result = await loadEngineToolchain({ directory:directory, engine:engine, signal:signal() });
				const lock = JSON.parse(new TextDecoder().decode(result.lock.body));
				expect(lock.audioGraph).toBeUndefined();
				expect(Object.keys(lock)).toEqual(["version", "packages", "adapter"]);
			}
			await expect(
				loadEngineToolchain({ directory:directory, engine:"hyperframes", signal:signal(), audioProfile:HYPERFRAMES_GRAPH_PROFILE }
				),
			).rejects.toThrow();
			await expect(
				loadEngineToolchain({ directory:directory, engine:"remotion", signal:signal(), audioProfile:HYPERFRAMES_GRAPH_PROFILE }
				),
			).rejects.toThrow("requires the HyperFrames");
		} finally {
			await cleanup(directory);
		}
	},
);

native(
	"graph archive pins reviewed compile identity; legacy lock bytes remain unchanged",
	async () => {
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: toolchain!,
			signal: signal(),
		});
		const legacy = await loadEngineToolchain({ directory:toolchain!, engine:"hyperframes", signal:signal() }
		);
		const graph = await loadEngineToolchain({ directory:toolchain!, engine:"hyperframes", signal:signal(), audioProfile:HYPERFRAMES_GRAPH_PROFILE }
		);
		const lock = JSON.parse(new TextDecoder().decode(graph.lock.body));
		expect(lock.audioGraph).toEqual(hyperframesGraphCompileIdentity(runtime));
		const { audioGraph: _identity, ...oldShape } = lock;
		expect(new TextDecoder().decode(legacy.lock.body)).toBe(
			JSON.stringify(oldShape),
		);
		expect(graph.lock.resource.sha256).not.toBe(legacy.lock.resource.sha256);
		expect(JSON.stringify(lock.audioGraph)).not.toContain(toolchain!);
		expect(JSON.stringify(lock.audioGraph)).not.toContain("https://");
		expect(lock.audioGraph.browser).toBeUndefined();
		expect(() => hyperframesGraphCompileIdentity({ ...runtime })).toThrow(
			"reviewed native runtime",
		);
		const initial = await archive(graph.lock);
		expect(
			await verifyHyperframesGraphArchive({
				...initial,
				runtime,
				signal: signal(),
			}),
		).toEqual(lock.audioGraph);
		for (const audioGraph of [
			undefined,
			{ ...lock.audioGraph, runtimeSha256: "0".repeat(64) },
			{ ...lock.audioGraph, adapterSha256: "0".repeat(64) },
			{ ...lock.audioGraph, unrecognized: true },
		]) {
			const invalid = await archive(lockResource({ ...lock, audioGraph }));
			await expect(
				verifyHyperframesGraphArchive({
					...invalid,
					runtime,
					signal: signal(),
				}),
			).rejects.toThrow("explicitly recompile");
		}
		const legacySource = {
			...initial.source,
			audio: { version: 1 as const, mode: "native" as const },
		};
		await expect(
			verifyHyperframesGraphArchive({
				...initial,
				source: legacySource,
				runtime,
				signal: signal(),
			}),
		).rejects.toThrow("explicitly declared");
		for (const body of [
			new Uint8Array([0xff]).buffer,
			new TextEncoder().encode("{").buffer,
			new TextEncoder().encode(JSON.stringify({ ...lock, version: 2 })).buffer,
		]) {
			const invalid = await archive(lockBytes(body));
			await expect(
				verifyHyperframesGraphArchive({
					...invalid,
					runtime,
					signal: signal(),
				}),
			).rejects.toThrow("Invalid HyperFrames graph archive lock");
		}
		const reference = {
			projectId: initial.resourceStore.projectId,
			key: graph.lock.resource.attachmentKey,
		};
		const attachment =
			(await initial.resourceStore.store.loadAttachment(reference))!;
		const corrupt = new Uint8Array(attachment.body.slice(0));
		corrupt[0] ^= 1;
		await initial.resourceStore.store.saveAttachment({
			...reference,
			metadata: attachment.metadata,
			body: corrupt.buffer,
		});
		await expect(
			verifyHyperframesGraphArchive({ ...initial, runtime, signal: signal() }),
		).rejects.toThrow("integrity mismatch");
		const aborted = new AbortController();
		aborted.abort(Error("archive identity cancelled"));
		await expect(
			verifyHyperframesGraphArchive({
				...initial,
				runtime,
				signal: aborted.signal,
			}),
		).rejects.toThrow("archive identity cancelled");
	},
);

native(
	"real private browser identity binds nonce, archive and decoder contents before/after render",
	async () => {
		const directory = await ownDirectory();
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(Error("Graph identity acceptance deadline")),
			55000,
		);
		try {
			const graph = await loadEngineToolchain({ directory:toolchain!, engine:"hyperframes", signal:controller.signal, audioProfile:HYPERFRAMES_GRAPH_PROFILE }
			);
			const stored = await archive(graph.lock);
			const native = await nativeFxFixture(wasmDirectory!);
			const decoder = {
				ffmpeg: join(directory, "ffmpeg.test-bytes"),
				ffprobe: join(directory, "ffprobe.test-bytes"),
			};
			// Byte-identity fixtures only: these files are never executed as decoders.
			await writeFile(decoder.ffmpeg, "test-ffmpeg-A");
			await writeFile(decoder.ffprobe, "test-ffprobe-A");
			const args = {
				...stored,
				toolchainDirectory: toolchain!,
				executable: native.executable,
				decoder,
				sessionNonce: "private-host-epoch-for-test-A",
				signal: controller.signal,
			};
			const mutableDecoder = { ...decoder };
			const preparing = prepareHyperframesGraphIdentity({
				...args,
				decoder: mutableDecoder,
			});
			mutableDecoder.ffmpeg = join(directory, "changed-selector-never-created");
			const first = await preparing;
			expect(first.decoder).toEqual(decoder);
			expect(Object.isFrozen(first.decoder)).toBe(true);
			expect(first.identity).toMatchObject({
				version: 1,
				profile: HYPERFRAMES_GRAPH_PROFILE,
				id: expect.stringMatching(/^[a-f0-9]{64}$/),
			});
			expect(first.provenance.browser.product).toMatch(/Chrome\//);
			expect(JSON.stringify(first.identity)).not.toContain(args.sessionNonce);
			expect(JSON.stringify(first.provenance)).not.toContain(directory);
			const relocated = {
				ffmpeg: join(directory, "relocated-ffmpeg"),
				ffprobe: join(directory, "relocated-ffprobe"),
			};
			await copyFile(decoder.ffmpeg, relocated.ffmpeg);
			await copyFile(decoder.ffprobe, relocated.ffprobe);
			const same = await prepareHyperframesGraphIdentity({
				...args,
				decoder: relocated,
			});
			expect(same.identity).toEqual(first.identity);
			const nextEpoch = await prepareHyperframesGraphIdentity({
				...args,
				sessionNonce: "private-host-epoch-for-test-B",
			});
			expect(nextEpoch.identity.id).not.toBe(first.identity.id);
			await first.verifyBeforeRender();
			await first.verifyAfterRender(first.provenance);
			expect(() =>
				assertHyperframesGraphProvenance(
					{ ...first.provenance, moduleSha256: "0".repeat(64) },
					first.provenance,
				),
			).toThrow("runtime identity changed");
			await expect(
				first.verifyAfterRender({
					...first.provenance,
					browser: { ...first.provenance.browser, product: "changed-browser" },
				}),
			).rejects.toThrow("runtime identity changed");
			const before = await stat(decoder.ffmpeg);
			await writeFile(decoder.ffmpeg, "test-ffmpeg-B");
			await utimes(decoder.ffmpeg, before.atime, before.mtime);
			await expect(first.verifyBeforeRender()).rejects.toThrow(
				"decoder identity changed",
			);
			await expect(first.verifyAfterRender(first.provenance)).rejects.toThrow(
				"decoder identity changed",
			);
			const changedDecoder = await prepareHyperframesGraphIdentity(args);
			expect(changedDecoder.identity.id).not.toBe(first.identity.id);
			const aborted = new AbortController();
			aborted.abort(Error("identity cancelled before browser"));
			await expect(
				prepareHyperframesGraphIdentity({ ...args, signal: aborted.signal }),
			).rejects.toThrow("identity cancelled before browser");
		} finally {
			clearTimeout(timer);
			await cleanup(directory);
		}
	},
	60000,
);
