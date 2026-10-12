import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import { admitParticleAuthorityHostContext } from "./particle-editor-export-authority-stage.mjs";
import {
	parseThreeParticleArchive,
	loadThreeParticleRuntime,
} from "../../apps/cli/src/programmatic/three-particle-provenance";
import { inside, plain, treeManifest } from "../particle-c4-export-support.mjs";

const [root, toolchain, chromium, authorityContextPath] = process.argv.slice(2);
const observed = (globalThis as any).__particleC2Processes as {
	closed: boolean;
}[];
const secrets = new Set<string>();
const digest = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
const redact = (value: unknown) => {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-capability]");
	return text.replace(/https?:\/\/[^\s"'<>]+/g, "[URL redacted]");
};
const write = (name: string, value: unknown) =>
	writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", {
		flag: "wx",
	});
const json = async (name: string) =>
	JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(
			await readFile(join(root, name)),
		),
	);
const byId = <T extends { id: string }>(items: readonly T[]) =>
	[...items].sort((a, b) => a.id.localeCompare(b.id));
let host: RunningHost | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let validated = false;
let failure: unknown;
let failed = false;
const options = {
	projectRoot: join(root, "project"),
	staticDir: join(root, "editor"),
	registry: new TargetRegistry(join(root, "registry")),
	engineToolchainDirectory: toolchain,
	htmlBrowserExecutable: chromium,
	htmlFrameConnectionFile: "",
};
async function snapshot() {
	assert.ok(host);
	return {
		clips: byId(await host.automation.clips()),
		tracks: byId(await host.automation.tracks()),
		revision: await host.automation.revision(),
	};
}
async function open() {
	host = await startHost(options);
	secrets.add(host.token);
	secrets.add(host.editorUrl);
	return host;
}
try {
	const admittedAuthority = authorityContextPath
		? await admitParticleAuthorityHostContext({
				root,
				path: authorityContextPath,
				executable: process.execPath,
				version: process.versions.bun,
			})
		: undefined;
	if (admittedAuthority) {
		const observer = Reflect.get(
			globalThis,
			"__particleAuthorityWasmObservation",
		);
		assert.ok(observer, "Authority bootstrap must precede static sync imports");
		await write(
			"host-actual-wasm-authority.json",
			await observer.assertConsumed(),
		);
		const runtime = await loadThreeParticleRuntime(
			AbortSignal.timeout(15000),
			admittedAuthority.authority.metadata.productionIdentity.packedSidecar,
		);
		assert.deepEqual(
			runtime.samplerIdentity,
			admittedAuthority.authority.metadata.productionIdentity.packedSidecar,
		);
		await write("host-packed-particle-authority.json", {
			runtime,
			actualWorkerClosedBeforeReceipt: true,
		});
	} else assert.equal(process.versions.bun, "1.2.18");
	assert.ok(
		[root, toolchain, chromium].every((path) => path && isAbsolute(path)),
	);
	assert.ok(inside("C:/tmps", root));
	await plain(root, true);
	await plain(join(root, "project"), true);
	assert.ok(Array.isArray(observed), "Direct-child observer must be active");
	validated = true;
	await open();
	assert.ok(host);
	const initial = await snapshot();
	const clip = initial.clips.find((entry) => entry.id === "particle-model");
	assert.ok(clip);
	const source = clip.editing?.programmatic;
	assert.ok(source);
	assert.ok(source.build);
	assert.ok(source.build.capabilities?.includes("particle-surface-v1"));
	assert.equal(source.build.engine, "three");
	assert.equal(initial.revision, 2);
	assert.equal(clip.editing?.params.opacity, 0.85);
	if (admittedAuthority)
		assert.equal(
			digest(Buffer.from(JSON.stringify(source))),
			admittedAuthority.baseline.metadata.sourceSha256,
		);
	const verifiedResources = [];
	for (const resource of [
		...(source.resources ?? []),
		...source.build.inputs,
		source.build.toolchainLock,
	]) {
		const response: Response = await fetch(
			new URL("api/programmatic/resources/load", host.editorUrl),
			{
				method: "POST",
				body: JSON.stringify(resource),
				signal: AbortSignal.timeout(15000),
			},
		);
		assert.ok(response.ok, "Archived particle resource must load through Host");
		const bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
		assert.equal(bytes.length, resource.byteLength);
		assert.equal(digest(bytes), resource.sha256);
		if (admittedAuthority && resource.id === source.build.toolchainLock.id) {
			const archived = parseThreeParticleArchive(
				source,
				bytes.buffer as ArrayBuffer,
			);
			assert.ok(archived);
			assert.deepEqual(
				archived.samplerIdentity,
				admittedAuthority.authority.metadata.productionIdentity.packedSidecar,
			);
			assert.equal(
				archived.adapterSha256,
				admittedAuthority.authority.metadata.productionIdentity.adapterSha256,
			);
			await write("host-archived-particle-authority.json", {
				archived,
				authorityReceiptSha256:
					admittedAuthority.authority.authorityReceiptSha256,
				productionCaptureRequiresArchivedIdentity: true,
			});
		}
		verifiedResources.push({
			id: resource.id,
			sha256: resource.sha256,
			bytes: bytes.length,
		});
	}
	await write("initial-state.json", initial);
	if (admittedAuthority)
		assert.equal(
			digest(await readFile(join(root, "initial-state.json"))),
			admittedAuthority.baseline.metadata.fullStateSha256,
		);
	await write("host-resources.json", { verifiedResources });
	await write("host-ready.pending-private.json", {
		token: host.token,
		editorUrl: host.editorUrl,
	});
	await rename(
		join(root, "host-ready.pending-private.json"),
		join(root, "host-ready.private.json"),
	);
	await new Promise<void>((done) => {
		process.stdin.once("data", () => done());
		process.stdin.once("end", () => done());
		process.once("SIGTERM", () => done());
		watchdog = setTimeout(() => {
			failed = true;
			failure = Error("Editor Host watchdog elapsed");
			done();
		}, 1_800_000);
	});
	let aborted = false;
	try {
		const marker = await json("probe-abort.json");
		assert.equal(marker.status, "failed");
		aborted = true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (aborted) {
		await write("host-aborted.json", {
			probeStatus: "failed",
			successStateVerificationSkipped: true,
			reason:
				"Explicit runner failure marker; this does not convert the failed acceptance run to a pass",
		});
	} else {
		const expected = await json("expected-final-state.json");
		assert.deepEqual(
			await snapshot(),
			expected,
			"Attached Host state must equal full final UI snapshot",
		);
		const beforeReopen = admittedAuthority
			? await treeManifest(join(root, "project"))
			: undefined;
		await host.close();
		host = undefined;
		const reopened = await open();
		await write("host-reopened.private.json", {
			token: reopened.token,
			editorUrl: reopened.editorUrl,
		});
		assert.deepEqual(
			await snapshot(),
			expected,
			"Fresh FileProjectStore reopen must preserve complete UI state and revision",
		);
		await write("host-reopened-state.json", await snapshot());
		if (admittedAuthority) {
			assert.deepEqual(
				await treeManifest(join(root, "project")),
				beforeReopen,
				"Reopen must preserve complete project and attachment bytes",
			);
			await write("host-reopen-project-stability.json", {
				completeProjectUnmodified: true,
				beforeReopen,
			});
			await write(
				"host-actual-wasm-authority-final.json",
				await Reflect.get(
					globalThis,
					"__particleAuthorityWasmObservation",
				).assertConsumed(),
			);
			await admittedAuthority.authority.assertUnchanged();
		}
	}
} catch (error) {
	failed = true;
	failure = error;
} finally {
	clearTimeout(watchdog);
	try {
		await host?.close();
	} catch (error) {
		failed = true;
		failure = new AggregateError(
			[failure, error].filter(Boolean),
			"Host close failed",
		);
	}
	if (validated) {
		const deadline = Date.now() + 5000;
		while (observed.some((entry) => !entry.closed) && Date.now() < deadline)
			await new Promise((done) => setTimeout(done, 50));
		const allClosed = observed.every((entry) => entry.closed);
		await write("host-children.json", {
			processes: observed,
			allObservedDirectChildrenClosed: allClosed,
			scope: "Observed direct children only; no arbitrary descendant inference",
		});
		if (!allClosed) {
			failed = true;
			failure = new AggregateError(
				[failure, Error("Direct children remain open")].filter(Boolean),
			);
		}
		if (failed)
			await write("host-failure.json", {
				error: redact(failure),
				stack: redact((failure as Error)?.stack),
			});
	}
}
if (failed) {
	console.error(redact(failure));
	process.exitCode = 1;
}
