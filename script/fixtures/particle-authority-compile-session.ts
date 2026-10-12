import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import type { ProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
import type { admitParticleCompileHostContext } from "./particle-authority-compile-context.mjs";
import { treeManifest } from "../particle-c4-export-support.mjs";
import { parseThreeParticleArchive } from "../../apps/cli/src/programmatic/three-particle-provenance";

interface ParticleCompileReplies {
	context: {
		revision: number;
		programmaticBuilds: { configured: boolean; engines: { engine: string }[] };
		programmaticResources: { kinds: string[] };
	};
	apply: { accepted: boolean; revision: number };
	"programmatic/resources/import": { resource: ProgrammaticResource };
	"programmatic/build/compile": { source: ProgrammaticSource };
	"programmatic/build/rebuild": {
		source: ProgrammaticSource;
		reusedDocument: boolean;
	};
}

export function createParticleCompileSession({
	rootArgument,
	toolchainDirectory,
	authorityContextPath,
}: {
	rootArgument: string | undefined;
	toolchainDirectory: string;
	authorityContextPath: string;
}) {
	const parent = resolve(dirname(rootArgument || "."));
	const root = resolve(rootArgument || ".");
	const projectRoot = join(root, "project");
	const author = join(root, "author");
	const retainedAuthor = join(root, "author-retained");
	const signal = AbortSignal.timeout(180000);
	const hash = (value: Uint8Array | string) =>
		createHash("sha256").update(value).digest("hex");
	const samePath = (a: string, b: string) =>
		resolve(a).toLowerCase() === resolve(b).toLowerCase();
	const childOf = (directory: string, candidate: string) => {
		const tail = relative(directory, candidate);
		return (
			tail !== "" &&
			tail !== ".." &&
			!tail.startsWith(`..${sep}`) &&
			!isAbsolute(tail)
		);
	};
	const processes = Reflect.get(globalThis, "__particleC2Processes") as {
		closed: boolean;
	}[];
	const secrets = new Set<string>();
	const checks: unknown[] = [];
	const snapshots: {
		label: string;
		bytes: number;
		sha256: string;
		revision: number;
	}[] = [];
	let host: RunningHost | undefined;
	let opened = 0;
	let closed = 0;
	let authorMoved = false;
	let rootValidated = false;
	let admittedAuthority!: Awaited<
		ReturnType<typeof admitParticleCompileHostContext>
	>;

	async function absent(path: string) {
		try {
			await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		throw Error(`Refusing an existing private fixture target: ${path}`);
	}

	async function plain(path: string, directory: boolean) {
		assert.ok(
			childOf(root, path),
			"Fixture path must remain inside its private root",
		);
		const stat = await lstat(path);
		assert.equal(
			stat.isSymbolicLink(),
			false,
			"Fixture input must not be a link/junction",
		);
		assert.equal(directory ? stat.isDirectory() : stat.isFile(), true);
		assert.ok(
			samePath(await realpath(path), path),
			"Fixture input must not be redirected",
		);
	}

	function allClosed() {
		assert.ok(
			Array.isArray(processes),
			"The launcher's child-process observer is required",
		);
		assert.ok(
			processes.length > 0 && processes.every((entry) => entry.closed),
			"Compiler children must be closed",
		);
	}

	async function openHost() {
		assert.equal(host, undefined);
		host = await startHost({
			projectRoot,
			registry: new TargetRegistry(join(root, "registry")),
			engineToolchainDirectory: toolchainDirectory,
			htmlBrowserExecutable: "",
			htmlFrameConnectionFile: "",
		});
		secrets.add(host.token);
		opened++;
	}

	async function closeHost() {
		if (!host) return;
		await host.close();
		host = undefined;
		closed++;
	}

	function endpoint(route: string) {
		assert.ok(host);
		return new URL(`api/${route}`, host.editorUrl);
	}

	async function request(route: string, input?: unknown) {
		const response = await fetch(endpoint(route), {
			...(input === undefined
				? {}
				: { method: "POST", body: JSON.stringify(input) }),
			signal,
		});
		if (!response.ok)
			throw Error(
				`${route} returned ${response.status}: ${await response.text()}`,
			);
		return response;
	}

	async function json<Route extends keyof ParticleCompileReplies>(
		route: Route,
		input?: unknown,
	): Promise<ParticleCompileReplies[Route]> {
		return (await request(route, input)).json();
	}

	async function revision() {
		const value = (await json("context")).revision;
		assert.ok(Number.isSafeInteger(value) && value >= 0);
		return value as number;
	}

	async function currentSource(expected: ProgrammaticSource) {
		assert.ok(host);
		const clips = await host.automation.clips();
		assert.equal(clips.length, 1);
		assert.equal(clips[0].id, "particle-model");
		assert.deepEqual(clips[0].editing?.programmatic, expected);
		assert.equal(clips[0].editing?.params.opacity, 0.85);
		return clips[0];
	}

	async function checkpoint(label: string, expectedRevision: number) {
		const bytes = await readFile(join(projectRoot, "project.json"));
		JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
		const actualRevision = await revision();
		assert.equal(actualRevision, expectedRevision);
		await writeFile(join(root, `${label}-project.json`), bytes, { flag: "wx" });
		const record = {
			label,
			fullProjectManifest: await treeManifest(projectRoot),
			bytes: bytes.length,
			sha256: hash(bytes),
			revision: actualRevision,
		};
		snapshots.push(record);
		return record;
	}

	async function verifyResources(source: ProgrammaticSource) {
		assert.ok(source.build && source.resources);
		const resources = [
			...source.resources,
			...source.build.inputs,
			source.build.toolchainLock,
		];
		const verified: unknown[] = [];
		for (const resource of resources) {
			const bytes = new Uint8Array(
				await (
					await request("programmatic/resources/load", resource)
				).arrayBuffer(),
			);
			assert.equal(bytes.length, resource.byteLength);
			assert.equal(hash(bytes), resource.sha256);
			if (resource.id === source.build.toolchainLock.id) {
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
				checks.push({ label: "actual production archive identity", archived });
			}
			verified.push({ ...resource, verifiedBytes: bytes.length });
		}
		return verified;
	}

	async function apply(
		expectedRevision: number,
		operations: unknown[],
		idempotencyKey: string,
	) {
		const receipt = await json("apply", {
			expectedRevision,
			operations,
			idempotencyKey,
		});
		assert.equal(receipt.accepted, true);
		assert.equal(receipt.revision, expectedRevision + 1);
		assert.equal(await revision(), expectedRevision + 1);
		return receipt;
	}

	function redacted(value: unknown): string {
		let text = String(value);
		for (const secret of secrets)
			text = text.replaceAll(secret, "[private-host-token]");
		return text;
	}

	return {
		rootArgument,
		toolchainDirectory,
		authorityContextPath,
		parent,
		root,
		projectRoot,
		author,
		retainedAuthor,
		signal,
		hash,
		samePath,
		childOf,
		processes,
		checks,
		snapshots,
		absent,
		plain,
		allClosed,
		openHost,
		closeHost,
		request,
		json,
		revision,
		currentSource,
		checkpoint,
		verifyResources,
		apply,
		redacted,
		get host() {
			return host;
		},
		get opened() {
			return opened;
		},
		get closed() {
			return closed;
		},
		get authorMoved() {
			return authorMoved;
		},
		set authorMoved(value: boolean) {
			authorMoved = value;
		},
		get rootValidated() {
			return rootValidated;
		},
		set rootValidated(value: boolean) {
			rootValidated = value;
		},
		get admittedAuthority() {
			return admittedAuthority;
		},
		set admittedAuthority(
			value: Awaited<ReturnType<typeof admitParticleCompileHostContext>>,
		) {
			admittedAuthority = value;
		},
	};
}
export type ParticleCompileSession = ReturnType<
	typeof createParticleCompileSession
>;
