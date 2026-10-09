import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { startHost, type RunningHost } from "../../apps/cli/src/host";
import { TargetRegistry } from "../../apps/cli/src/target-registry";
import type { ProgrammaticSource } from "../../packages/editor-contracts/src/programmatic";
import type { ProgrammaticResource } from "../../packages/editor-contracts/src/programmatic-resources";
import { threeModel } from "./three-assets";

// The launcher owns pinned Bun/WASM/sampler/toolchain setup. Chromium/ffmpeg
// argv slots are accepted for its shared interface but never used here.
const [rootArgument, toolchainDirectory] = process.argv.slice(2);
const parent = resolve("C:/tmps/rocut-stylized-f6XU4z");
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
const processes = (globalThis as any).__particleC2Processes as {
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

async function json(route: string, input?: unknown): Promise<any> {
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

async function run() {
	assert.equal(process.versions.bun, "1.2.18");
	assert.ok(rootArgument && isAbsolute(rootArgument));
	assert.ok(samePath(dirname(root), parent));
	assert.ok(basename(root).startsWith("particle-c4-"));
	assert.ok(samePath(await realpath(root), root));
	const rootStat = await lstat(root);
	assert.equal(rootStat.isSymbolicLink(), false);
	assert.equal(rootStat.isDirectory(), true);
	rootValidated = true;
	assert.ok(
		childOf(parent, resolve(tmpdir())) || samePath(parent, tmpdir()),
		"Compiler scratch must stay under the approved temporary parent",
	);
	assert.ok(toolchainDirectory && isAbsolute(toolchainDirectory));
	await plain(author, true);
	await plain(join(author, "particle-scene.ts"), false);
	await plain(join(root, "particle-object.mjs"), false);
	for (const path of [
		projectRoot,
		join(root, "registry"),
		retainedAuthor,
		join(root, "model.glb"),
	])
		await absent(path);
	const authorHash = hash(await readFile(join(author, "particle-scene.ts")));
	const templateHash = hash(await readFile(join(root, "particle-object.mjs")));
	const { particleThree } = await import(
		pathToFileURL(join(root, "particle-object.mjs")).href
	);
	let result: unknown;
	let failure: unknown;
	try {
		await openHost();
		const context = await json("context");
		assert.equal(context.programmaticBuilds.configured, true);
		assert.ok(
			context.programmaticBuilds.engines.some(
				(entry: any) => entry.engine === "three",
			),
		);
		assert.ok(context.programmaticResources.kinds.includes("model"));
		const base = await checkpoint("baseline", 0);
		const model = threeModel();
		await writeFile(join(root, "model.glb"), model, { flag: "wx" });
		const imported = await json("programmatic/resources/import", {
			filePath: join(root, "model.glb"),
			id: "fixture-model.glb",
			kind: "model",
			mimeType: "model/gltf-binary",
		});
		const resource = imported.resource as ProgrammaticResource;
		assert.equal(resource.sha256, hash(model));
		assert.equal(resource.byteLength, model.length);
		assert.equal(resource.kind, "model");
		const makeShot = (scatterDistance: number, size: number) =>
			particleThree({
				sourceDirectory: author,
				model: resource,
				settings: { width: 320, height: 240, durationFrames: 121, seed: 7391 },
				inputProps: {
					rotationSpeed: [0, 0, 0],
					motion: { scatterDistance, size, driftAmplitude: 0 },
				},
			});
		const initialShot = makeShot(1.5, 2.5);
		const initial = await json("programmatic/build/compile", initialShot.spec);
		const first = initial.source as ProgrammaticSource;
		assert.deepEqual(first.build?.capabilities, ["particle-surface-v1"]);
		assert.equal(first.build?.engine, "three");
		assert.deepEqual(
			first.resources?.find((entry) => entry.kind === "model"),
			resource,
		);
		const initialResources = await verifyResources(first);
		const prepared = await checkpoint("compiled-unapplied", 0);
		assert.equal(
			prepared.sha256,
			base.sha256,
			"Resource import/compile must not mutate project content",
		);
		allClosed();
		await writeFile(
			join(root, "initial-source.json"),
			JSON.stringify(first, null, 2) + "\n",
			{ encoding: "utf8", flag: "wx" },
		);
		const firstReceipt = await apply(
			0,
			[
				{
					kind: "create-track",
					track: {
						id: "particle-track",
						name: "Particle C4",
						kind: "graphic",
						hidden: false,
					},
				},
				{
					kind: "create-clip",
					clip: {
						id: "particle-model",
						trackId: "particle-track",
						startTime: 0,
						duration: 484000,
						trimStart: 0,
						trimEnd: 0,
						editing: {
							type: "graphic",
							name: "Private particle fixture",
							definitionId: "programmatic",
							params: { opacity: 0.85 },
							effects: initialShot.effects,
							programmatic: first,
						},
					},
				},
			],
			"particle-c4-create",
		);
		await currentSource(first);
		const created = await checkpoint("created", 1);
		await closeHost();
		await openHost();
		await currentSource(first);
		const firstReopen = await checkpoint("first-reopen", 1);
		assert.equal(
			firstReopen.sha256,
			created.sha256,
			"Reopen must preserve persisted project bytes",
		);
		checks.push({
			label:
				"Real resource import, production compile, HTTP apply and FileProjectStore reopen",
			receipt: firstReceipt,
			resources: initialResources,
			projectBytesPreserved: true,
		});

		// A new author spec goes through compile. Never edit archived build props
		// and call rebuild to disguise an authoring change as an identical rebuild.
		const revised = await json(
			"programmatic/build/compile",
			makeShot(0.75, 3.25).spec,
		);
		const second = revised.source as ProgrammaticSource;
		assert.notDeepEqual(second, first);
		assert.notEqual(
			second.resources?.find((entry) => entry.kind === "document")?.sha256,
			first.resources?.find((entry) => entry.kind === "document")?.sha256,
		);
		assert.deepEqual(second.build?.inputs, first.build?.inputs);
		assert.deepEqual(second.build?.toolchainLock, first.build?.toolchainLock);
		assert.deepEqual(second.build?.capabilities, ["particle-surface-v1"]);
		assert.deepEqual(
			second.resources?.find((entry) => entry.kind === "model"),
			resource,
		);
		assert.equal(
			(second.build?.inputProps as any).motion.scatterDistance,
			0.75,
		);
		assert.equal((second.build?.inputProps as any).motion.size, 3.25);
		const revisedResources = await verifyResources(second);
		const revisedUnapplied = await checkpoint("recompiled-unapplied", 1);
		assert.equal(revisedUnapplied.sha256, firstReopen.sha256);
		const beforeEdit = await currentSource(first);
		const secondReceipt = await apply(
			1,
			[
				{
					kind: "update-clip",
					clipId: "particle-model",
					patch: { editing: { ...beforeEdit.editing, programmatic: second } },
				},
			],
			"particle-c4-replace-source",
		);
		await currentSource(second);
		const changed = await checkpoint("changed", 2);
		await writeFile(
			join(root, "revised-source.json"),
			JSON.stringify(second, null, 2) + "\n",
			{ encoding: "utf8", flag: "wx" },
		);
		await closeHost();
		await openHost();
		await currentSource(second);
		const secondReopen = await checkpoint("second-reopen", 2);
		assert.equal(secondReopen.sha256, changed.sha256);
		checks.push({
			label:
				"Explicit parameter recompile and full source replacement survive second reopen",
			receipt: secondReceipt,
			resources: revisedResources,
			originalSourceUnmodified: true,
			projectBytesPreserved: true,
		});

		// Exact validated paths only. This private author's directory is restored
		// in finally even if archive rebuild or any integrity assertion fails.
		await plain(author, true);
		await absent(retainedAuthor);
		assert.ok(childOf(root, author) && childOf(root, retainedAuthor));
		await rename(author, retainedAuthor);
		authorMoved = true;
		await absent(author);
		for (const [label, source] of [
			["original", first],
			["revised", second],
		] as const) {
			const rebuilt = await json("programmatic/build/rebuild", source);
			assert.deepEqual(rebuilt.source, source);
			assert.equal(rebuilt.reusedDocument, true);
			await verifyResources(rebuilt.source);
			await currentSource(second);
			assert.equal(await revision(), 2);
			allClosed();
			checks.push({
				label: `${label} source rebuilds unchanged from attachments while author directory is absent`,
				reusedDocument: true,
			});
		}
		const afterRebuild = await checkpoint("archive-rebuilt", 2);
		assert.equal(afterRebuild.sha256, secondReopen.sha256);
		result = {
			version: 1,
			scope:
				"Private real Host/FileProjectStore/API persistence and archive rebuild; no UI, Electron capture or video export",
			root,
			runtime: { bun: process.versions.bun, executable: process.execPath },
			checks,
			snapshots,
			model: {
				origin: "locally generated threeModel GLB; no user resource",
				resource,
			},
			templateSha256: templateHash,
			authorSha256: authorHash,
			toolchainPackageLockSha256: hash(
				await readFile(join(toolchainDirectory, "package-lock.json")),
			),
			inputPolicy: {
				freshPrivateProjectRequired: true,
				sharedRegistryUsed: false,
				installedDependenciesChanged: false,
				sharedApplicationRestarted: false,
				userDataTouched: false,
				artifactDeletionPerformed: false,
			},
		};
	} catch (error) {
		failure = error;
	} finally {
		const errors: unknown[] = [];
		if (authorMoved) {
			try {
				await plain(retainedAuthor, true);
				await absent(author);
				await rename(retainedAuthor, author);
				authorMoved = false;
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			await closeHost();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length)
			failure = new AggregateError(
				failure ? [failure, ...errors] : errors,
				"C4 fixture and ownership cleanup failed",
			);
	}
	if (failure) throw failure;
	assert.equal(authorMoved, false);
	assert.equal(host, undefined);
	assert.equal(opened, 3);
	assert.equal(closed, opened);
	assert.equal(
		hash(await readFile(join(author, "particle-scene.ts"))),
		authorHash,
	);
	assert.equal(
		hash(await readFile(join(root, "particle-object.mjs"))),
		templateHash,
	);
	allClosed();
	return {
		...(result as object),
		ownership: {
			hostsOpened: opened,
			hostsClosed: closed,
			authorRestored: true,
			children: processes,
		},
	};
}

function redacted(value: unknown): string {
	let text = String(value);
	for (const secret of secrets)
		text = text.replaceAll(secret, "[private-host-token]");
	return text;
}

try {
	const evidence = await run();
	await writeFile(
		join(root, "evidence.json"),
		JSON.stringify(evidence, null, 2) + "\n",
		{ encoding: "utf8", flag: "wx" },
	);
	console.log(
		JSON.stringify({
			status: "passed",
			checks: checks.length,
			hostsOpened: opened,
			hostsClosed: closed,
			children: processes.length,
			evidence: join(root, "evidence.json"),
		}),
	);
} catch (error) {
	// A bad argument must not authorize writes outside the dedicated C4 root.
	if (rootValidated) {
		await writeFile(
			join(root, "failure.json"),
			JSON.stringify(
				{
					error: redacted(error),
					stack: redacted((error as Error)?.stack),
					checks,
					snapshots,
					opened,
					closed,
					authorMoved,
					processes,
				},
				null,
				2,
			),
			{ encoding: "utf8", flag: "wx" },
		);
	}
	throw new Error(redacted(error));
}
