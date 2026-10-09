import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ProgrammaticSource, ResolvedProgrammaticResource } from "@opencut/editor-contracts";
import { loadProgrammaticResources, type ProgrammaticResourceStore } from "../resources";
import { readResourceFile, saveResourceBytes } from "../resource-bytes";
import { DOCUMENT_ID, parseCompileInput, validateBuildSource, withBuildResources } from "./build-source";
import { snapshotSourceFiles } from "./source-snapshot";
import { loadEngineToolchain } from "./toolchain";
import { hyperframesFrameDriver } from "./hyperframes-driver";
import { ENGINE_VERSIONS } from "./engine-versions";
import { REMOTION_ENVIRONMENT, REMOTION_FRAME_DRIVER } from "./remotion-driver";
import { REMOTION_COMPILER_CHILD } from "./remotion-compiler-child";
import { REMOTION_MEDIA_WRAPPER } from "./remotion-media";
import { HYPERFRAMES_COMPILER_CHILD } from "./hyperframes-compiler-child";
import { THREE_FRAME_DRIVER } from "./three-driver";
import { THREE_PARTICLE_FRAME_DRIVER } from "./three-particle-driver";
import { runCompilerChild } from "./compiler-process";
import { HYPERFRAMES_GRAPH_PROFILE, hasHyperframesGraphProfile } from "../hyperframes-graph-provenance";
import { assertCurrentThreeParticleAdapter, assertThreeParticleCompileIdentity, hasThreeParticleCapability, loadThreeParticleRuntime, parseThreeParticleArchive } from "../three-particle-provenance";
import { isBuildTextInput, parseBuildRevisionInput, reviseBuildArchive } from "./build-revision";

export async function compileProgrammaticProject({ action, input, toolchainDirectory, context, signal, enqueue }: {
	action: "compile" | "rebuild" | "revise"; input: unknown; toolchainDirectory: string;
	context: ProgrammaticResourceStore; signal: AbortSignal;
	enqueue: <T>(task: () => Promise<T>) => Promise<T>;
}) {
	let source: ProgrammaticSource, inputs: ResolvedProgrammaticResource[];
	let parsed: ReturnType<typeof parseCompileInput> | undefined;
	let revision: ReturnType<typeof parseBuildRevisionInput> | undefined;
	signal.throwIfAborted();
	if (action === "compile") { parsed = parseCompileInput(input); source = parsed.source; }
	else if (action === "revise") { revision = parseBuildRevisionInput(input); source = revision.source; }
	else { validateBuildSource(input); source = input; }
	if (!source.build || source.build.engineVersion !== ENGINE_VERSIONS[source.build.engine]) throw Error("No compatible build archive");
	// Existing builds read the declared archive before native discovery. A missing or
	// contradictory particle identity must not be silently filled from this Host.
	let threeArchive;
	if (action !== "compile" && source.build.engine === "three") {
		const archived = await loadProgrammaticResources(context, [...source.build.inputs, source.build.toolchainLock], signal);
		const lock = archived.pop()!;
		threeArchive = { inputs: archived, lock, particle: parseThreeParticleArchive(source, lock.body) };
		if (threeArchive.particle) assertCurrentThreeParticleAdapter(threeArchive.particle);
	}
	const particleRuntime = hasThreeParticleCapability(source) ? await loadThreeParticleRuntime(signal, threeArchive?.particle?.samplerIdentity) : undefined;
	const toolchain = await loadEngineToolchain(toolchainDirectory, source.build.engine, signal,
		hasHyperframesGraphProfile(source) ? HYPERFRAMES_GRAPH_PROFILE : undefined, particleRuntime);
	if (source.build.engine === "three") {
		const currentParticle = parseThreeParticleArchive(source, toolchain.lock.body);
		if (threeArchive?.particle) assertThreeParticleCompileIdentity(threeArchive.particle, currentParticle);
	}
	if (action === "compile") {
		inputs = await snapshotSourceFiles(parsed!.sourceDirectory, source, signal);
	} else {
		const archived = threeArchive?.inputs ?? await loadProgrammaticResources(context, [...source.build.inputs, source.build.toolchainLock], signal);
		const previousLock = threeArchive?.lock ?? archived.pop()!;
		if (previousLock.resource.sha256 !== toolchain.lock.resource.sha256) throw Error("Archived toolchain differs; explicitly compile with the new toolchain instead");
		inputs = archived;
	}
	if (revision) ({ source, inputs } = reviseBuildArchive({ revision, inputs }));
	source = withBuildResources(source, inputs.map(i => i.resource), toolchain.lock.resource);
	const renderResources = (source.resources ?? []).filter(resource => resource.id !== source.documentId);
	// Existing content-addressed attachments must exist and match their descriptors.
	await loadProgrammaticResources(context, renderResources, signal);
	const parent = resolve(tmpdir()), staging = await mkdtemp(join(parent, "rocut-engine-build-"));
	try {
		const project = join(staging, "project");
		await mkdir(project);
		for (const item of inputs) {
			signal.throwIfAborted();
			if (isBuildTextInput(item.resource.id))
				new TextDecoder("utf-8", { fatal: true }).decode(item.body);
			const path = join(project, item.resource.id);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, new Uint8Array(item.body), { flag: "wx" });
		}
		const outputFile = join(staging, "compiled.html");
		await runCompilerChild({
			engine: source.build!.engine,
			project, outputFile, files: inputs.map(i => i.resource.id), entryFile: source.build!.entryFile,
			width: source.width, height: source.height, frameRate: source.frameRate, durationFrames: source.durationFrames,
			compilerEntry: toolchain.compilerEntry, parserEntry: toolchain.parserEntry,
			toolchainRoot: toolchain.root,
			nativeAudio: source.audio !== undefined,
			runtimeNotices: toolchain.runtimeNotices,
			driver: source.build!.engine === "hyperframes" ? hyperframesFrameDriver(source.frameRate)
				: source.build!.engine === "three" ? (particleRuntime ? THREE_PARTICLE_FRAME_DRIVER : THREE_FRAME_DRIVER) : REMOTION_FRAME_DRIVER,
			environment: REMOTION_ENVIRONMENT,
			mediaWrapper: source.build!.engine === "remotion" ? REMOTION_MEDIA_WRAPPER : undefined,
			spec: { compositionId: source.build!.compositionId, inputProps: source.build!.inputProps,
				width: source.width, height: source.height, frameRate: source.frameRate, durationFrames: source.durationFrames },
		}, signal, source.build!.engine === "hyperframes" ? HYPERFRAMES_COMPILER_CHILD : REMOTION_COMPILER_CHILD);
		const document = await readResourceFile(outputFile, { id: DOCUMENT_ID, kind: "document", mimeType: "text/html" }, signal);
		const result = { ...source, code: "", documentId: DOCUMENT_ID, resources: [document.resource, ...renderResources] };
		validateBuildSource(result);
		const saved = await enqueue(async () => {
			for (const item of [...inputs, toolchain.lock]) await saveResourceBytes(context, item, signal);
			return saveResourceBytes(context, document, signal);
		});
		signal.throwIfAborted();
		return { source: result, reusedDocument: saved.reused };
	} finally {
		if (dirname(staging) !== parent || !basename(staging).startsWith("rocut-engine-build-")) throw Error("Unsafe engine staging cleanup");
		await rm(staging, { recursive: true, force: true });
	}
}
