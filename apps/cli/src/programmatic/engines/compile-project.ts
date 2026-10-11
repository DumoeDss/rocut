import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	loadProgrammaticResources,
	type ProgrammaticResourceStore,
} from "../resources";
import { readResourceFile, saveResourceBytes } from "../resource-bytes";
import {
	DOCUMENT_ID,
	parseCompileInput,
	validateBuildSource,
	withBuildResources,
} from "./build-source";
import { snapshotSourceFiles } from "./source-snapshot";
import { loadEngineToolchain } from "./toolchain";
import { selectThreeAssetDriver } from "./three-asset-features";
import { hyperframesFrameDriver } from "./hyperframes-driver";
import { ENGINE_VERSIONS } from "./engine-versions";
import { REMOTION_ENVIRONMENT, REMOTION_FRAME_DRIVER } from "./remotion-driver";
import { REMOTION_COMPILER_CHILD } from "./remotion-compiler-child";
import { REMOTION_MEDIA_WRAPPER } from "./remotion-media";
import { HYPERFRAMES_COMPILER_CHILD } from "./hyperframes-compiler-child";
import { runCompilerChild } from "./compiler-process";
import {
	HYPERFRAMES_GRAPH_PROFILE,
	hasHyperframesGraphProfile,
} from "../hyperframes-graph-provenance";
import {
	prepareThreeBuildProfile,
	assertThreeBuildProfile,
} from "./three-build-profile";
import {
	isBuildTextInput,
	parseBuildRevisionInput,
	reviseBuildArchive,
} from "./build-revision";
import type { PreparedRemotionCompile } from "../remotion-inspection-types";
import {
	readArchivedRemotionMetadataPolicy,
	readRemotionMetadataAdapter,
	remotionReceiptBinding,
	remotionSourceMetadataSpec,
} from "../remotion-metadata-archive";
import {
	REMOTION_METADATA_POLICY_SOURCE,
	validateRemotionMetadataPolicy,
	type RemotionMetadataPolicy,
} from "../remotion-metadata-policy";
import { REMOTION_METADATA_LIFETIME_SOURCE } from "../remotion-metadata-lifetime";

async function cleanupEngineStaging({
	staging,
	parent,
}: {
	staging: string;
	parent: string;
}) {
	if (
		dirname(staging) !== parent ||
		!basename(staging).startsWith("rocut-engine-build-")
	)
		throw Error("Unsafe engine staging cleanup");
	await rm(staging, { recursive: true, force: true });
}

export async function compileProgrammaticProject({
	action,
	input,
	toolchainDirectory,
	context,
	signal,
	enqueue,
	prepared,
}: {
	action: "compile" | "rebuild" | "revise";
	input: unknown;
	toolchainDirectory: string;
	context: ProgrammaticResourceStore;
	signal: AbortSignal;
	enqueue: <T>(task: () => Promise<T>) => Promise<T>;
	prepared?: PreparedRemotionCompile;
}) {
	let source: ProgrammaticSource, inputs: ResolvedProgrammaticResource[];
	let parsed: ReturnType<typeof parseCompileInput> | undefined;
	let revision: ReturnType<typeof parseBuildRevisionInput> | undefined;
	signal.throwIfAborted();
	if (prepared) {
		if (action !== "compile" || prepared.source.build?.engine !== "remotion")
			throw Error("Invalid prepared compilation");
		validateBuildSource(prepared.source);
		source = prepared.source;
	} else if (action === "compile") {
		parsed = parseCompileInput(input);
		source = parsed.source;
	} else if (action === "revise") {
		revision = parseBuildRevisionInput(input);
		source = revision.source;
	} else {
		validateBuildSource(input);
		source = input;
	}
	if (
		!source.build ||
		source.build.engineVersion !== ENGINE_VERSIONS[source.build.engine]
	)
		throw Error("No compatible build archive");
	// Existing builds read the declared archive before native discovery. A missing or
	// contradictory particle identity must not be silently filled from this Host.
	const threeProfile = await prepareThreeBuildProfile({
		action,
		source,
		context,
		signal,
	});
	let remotionArchive:
		| {
				inputs: ResolvedProgrammaticResource[];
				lock: ResolvedProgrammaticResource;
				policy: RemotionMetadataPolicy;
		  }
		| undefined;
	if (action !== "compile" && source.build.engine === "remotion") {
		const document = source.resources?.find(
			(resource) => resource.id === source.documentId,
		);
		if (!document)
			throw Error("Remotion rebuild requires the archived compiled document");
		const archived = await loadProgrammaticResources(
			context,
			[...source.build.inputs, source.build.toolchainLock, document],
			signal,
		);
		const compiled = archived.pop()!,
			lock = archived.pop()!;
		remotionArchive = {
			inputs: archived,
			lock,
			policy: readArchivedRemotionMetadataPolicy({
				source: source,
				lock: lock.body,
				document: compiled.body,
			}),
		};
		if (
			action === "revise" &&
			remotionArchive.policy.profile === "metadata-pinned-v1"
		)
			throw Error(
				"Pinned Remotion revision requires fresh metadata inspection; inspect again",
			);
	}
	const toolchain = await loadEngineToolchain({
		directory: toolchainDirectory,
		engine: source.build.engine,
		signal: signal,
		audioProfile: hasHyperframesGraphProfile(source)
			? HYPERFRAMES_GRAPH_PROFILE
			: undefined,
		particleRuntime: threeProfile?.particleRuntime,
		liquidRuntime: threeProfile?.liquidRuntime,
		audioTiming: source.audio?.timing,
		remotionMetadataProfile: prepared
			? "metadata-pinned-v1"
			: (remotionArchive?.policy.profile ?? "legacy-unpinned"),
	});
	if (
		prepared &&
		prepared.toolchainLockSha256 !== toolchain.lock.resource.sha256
	)
		throw Error("Inspected toolchain changed; inspect again");
	assertThreeBuildProfile({
		profile: threeProfile,
		source,
		lock: toolchain.lock.body,
	});
	if (action === "compile") {
		inputs =
			prepared?.inputs ??
			(await snapshotSourceFiles(parsed!.sourceDirectory, source, signal));
	} else {
		const archived =
			threeProfile?.archive?.inputs ??
			remotionArchive?.inputs ??
			(await loadProgrammaticResources(
				context,
				[...source.build.inputs, source.build.toolchainLock],
				signal,
			));
		const previousLock =
			threeProfile?.archive?.lock ?? remotionArchive?.lock ?? archived.pop()!;
		if (previousLock.resource.sha256 !== toolchain.lock.resource.sha256)
			throw Error(
				"Archived toolchain differs; explicitly compile with the new toolchain instead",
			);
		inputs = archived;
	}
	if (revision) ({ source, inputs } = reviseBuildArchive({ revision, inputs }));
	source = withBuildResources(
		source,
		inputs.map((i) => i.resource),
		toolchain.lock.resource,
	);
	let remotionMetadata: RemotionMetadataPolicy | undefined;
	if (source.build!.engine === "remotion") {
		if (prepared) {
			if (!prepared.metadataReceipt)
				throw Error(
					"Inspected Remotion metadata receipt missing; inspect again",
				);
			const adapter = readRemotionMetadataAdapter({
				lock: toolchain.lock.body,
				profile: "metadata-pinned-v1",
			});
			remotionMetadata = {
				profile: "metadata-pinned-v1",
				adapter,
				binding: remotionReceiptBinding({
					source: source,
					adapter: adapter,
					inspectionRevision: prepared.metadataReceipt.inspectionRevision,
				}),
				receipt: prepared.metadataReceipt,
			};
		} else
			remotionMetadata = remotionArchive?.policy ?? {
				profile: "legacy-unpinned",
				adapter: readRemotionMetadataAdapter({
					lock: toolchain.lock.body,
					profile: "legacy-unpinned",
				}),
			};
		validateRemotionMetadataPolicy({
			spec: remotionSourceMetadataSpec(source),
			policy: remotionMetadata,
		});
	}
	const renderResources = (source.resources ?? []).filter(
		(resource) => resource.id !== source.documentId,
	);
	// Existing content-addressed attachments must exist and match their descriptors.
	await loadProgrammaticResources(context, renderResources, signal);
	const parent = resolve(tmpdir()),
		staging = await mkdtemp(join(parent, "rocut-engine-build-"));
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
		await runCompilerChild(
			{
				engine: source.build!.engine,
				project,
				outputFile,
				files: inputs.map((i) => i.resource.id),
				entryFile: source.build!.entryFile,
				width: source.width,
				height: source.height,
				frameRate: source.frameRate,
				durationFrames: source.durationFrames,
				compilerEntry: toolchain.compilerEntry,
				parserEntry: toolchain.parserEntry,
				toolchainRoot: toolchain.root,
				nativeAudio: source.audio !== undefined,
				runtimeNotices: toolchain.runtimeNotices,
				driver:
					source.build!.engine === "hyperframes"
						? hyperframesFrameDriver(source.frameRate)
						: source.build!.engine === "three"
							? selectThreeAssetDriver({
									driver: threeProfile!.driver,
									modelFeatures: !!toolchain.threeFeatures,
									nativeProfile: !!(
										threeProfile!.particleRuntime || threeProfile!.liquidRuntime
									),
									resources: source.resources ?? [],
								})
							: REMOTION_FRAME_DRIVER,
				liquidObject: threeProfile?.liquidCompiler,
				environment: REMOTION_ENVIRONMENT,
				mediaWrapper:
					source.build!.engine === "remotion"
						? REMOTION_MEDIA_WRAPPER
						: undefined,
				remotionMetadata,
				metadataPolicySource:
					source.build!.engine === "remotion"
						? REMOTION_METADATA_POLICY_SOURCE
						: undefined,
				metadataLifetimeSource:
					source.build!.engine === "remotion"
						? REMOTION_METADATA_LIFETIME_SOURCE
						: undefined,
				spec: {
					compositionId: source.build!.compositionId,
					inputProps: source.build!.inputProps,
					width: source.width,
					height: source.height,
					frameRate: source.frameRate,
					durationFrames: source.durationFrames,
				},
			},
			signal,
			source.build!.engine === "hyperframes"
				? HYPERFRAMES_COMPILER_CHILD
				: REMOTION_COMPILER_CHILD,
		);
		const document = await readResourceFile(
			outputFile,
			{ id: DOCUMENT_ID, kind: "document", mimeType: "text/html" },
			signal,
		);
		const result = {
			...source,
			code: "",
			documentId: DOCUMENT_ID,
			resources: [document.resource, ...renderResources],
		};
		validateBuildSource(result);
		const saved = await enqueue(async () => {
			for (const item of [...inputs, toolchain.lock])
				await saveResourceBytes(context, item, signal);
			return saveResourceBytes(context, document, signal);
		});
		signal.throwIfAborted();
		return {
			source: result,
			reusedDocument: saved.reused,
			...(remotionMetadata
				? {
						runtimeMetadata: {
							status: remotionMetadata.profile,
							adapter: remotionMetadata.adapter,
							...(remotionMetadata.receipt ? { receiptVersion: 1 } : {}),
						},
					}
				: {}),
		};
	} finally {
		await cleanupEngineStaging({ staging, parent });
	}
}
