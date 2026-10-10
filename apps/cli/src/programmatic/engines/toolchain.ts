import { isAbsolute, join } from "node:path";
import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { describeResource, readResourceFile } from "../resource-bytes";
import { resourceDigest } from "../resources";
import {
	ENGINE_VERSIONS,
	HYPERFRAMES_TOOLCHAIN,
	REMOTION_TOOLCHAIN,
	THREE_TOOLCHAIN,
} from "./engine-versions";
import { LOCK_ID, sourceDescription } from "./build-source";
import { REMOTION_COMPILER_CHILD } from "./remotion-compiler-child";
import { REMOTION_FRAME_DRIVER, REMOTION_ENVIRONMENT } from "./remotion-driver";
import { REMOTION_MEDIA_WRAPPER } from "./remotion-media";
import { HTML_MEDIA_BOOTSTRAP } from "../html-media";
import { HYPERFRAMES_FRAME_DRIVER } from "./hyperframes-driver";
import { HYPERFRAMES_COMPILER_CHILD } from "./hyperframes-compiler-child";
import { OFFTHREAD_BOOTSTRAP } from "../offthread-bootstrap";
import { NATIVE_VIDEO_COLOR_ADAPTER } from "../video-color";
import { REMOTION_AUDIO_BOOTSTRAP } from "../remotion-audio-bootstrap";
import { HYPERFRAMES_AUDIO_BOOTSTRAP } from "../hyperframes-audio-bootstrap";
import { HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP } from "../hyperframes-audio-graph-bootstrap";
import { HYPERFRAMES_NATIVE_HISTORY_CAPTURE } from "../hyperframes-native-history-capture";
import { REMOTION_PRODUCED_THUMBNAIL_CAPTURE } from "../remotion-produced-thumbnail-capture";
import { loadHyperframesFxRuntime } from "../hyperframes-fx-runtime";
import {
	HYPERFRAMES_GRAPH_PROFILE,
	hyperframesGraphCompileIdentity,
} from "../hyperframes-graph-provenance";
import {
	hyperframesGraphTimingIdentity,
	type HyperframesGraphTiming,
} from "../hyperframes-graph-timing";
import type { ThreeParticleRuntime } from "../three-particle-provenance";
import type { ThreeLiquidObjectRuntime } from "../three-liquid-object-identity";
import { threeToolchainProfile } from "./three-toolchain-profile";
import {
	REMOTION_METADATA_POLICY_SOURCE,
	type RemotionMetadataProfile,
} from "../remotion-metadata-policy";
import { REMOTION_METADATA_LIFETIME_SOURCE } from "../remotion-metadata-lifetime";

export async function loadEngineToolchain({
	directory,
	engine,
	signal,
	audioProfile,
	particleRuntime,
	liquidRuntime,
	audioTiming,
	remotionMetadataProfile = "legacy-unpinned",
}: {
	directory: string;
	engine: keyof typeof ENGINE_VERSIONS;
	signal: AbortSignal;
	audioProfile?: typeof HYPERFRAMES_GRAPH_PROFILE;
	particleRuntime?: ThreeParticleRuntime;
	liquidRuntime?: ThreeLiquidObjectRuntime;
	audioTiming?: HyperframesGraphTiming;
	remotionMetadataProfile?: RemotionMetadataProfile;
}) {
	if (!isAbsolute(directory))
		throw Error("Engine toolchain path must be absolute");
	if (engine !== "remotion" && remotionMetadataProfile !== "legacy-unpinned")
		throw Error("Pinned metadata profile requires Remotion");
	if (
		audioProfile !== undefined &&
		(audioProfile !== HYPERFRAMES_GRAPH_PROFILE || engine !== "hyperframes")
	)
		throw Error(
			"Graph audio toolchain identity requires the HyperFrames graph profile",
		);
	if (
		(particleRuntime !== undefined || liquidRuntime !== undefined) &&
		engine !== "three"
	)
		throw Error(
			"Native toolchain identity requires an explicit Three capability",
		);
	if (
		hyperframesGraphTimingIdentity(audioTiming) &&
		audioProfile !== HYPERFRAMES_GRAPH_PROFILE
	)
		throw Error(
			"Native exporter timing requires the HyperFrames graph profile",
		);
	const root = await realpath(directory);
	const core = join(root, "node_modules/@hyperframes/core");
	const isRecord = (value: unknown): value is Record<string, unknown> =>
		!!value && typeof value === "object" && !Array.isArray(value);
	const readJson = async (path: string): Promise<Record<string, unknown>> => {
		const value: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				(await readResourceFile(path, sourceDescription(LOCK_ID), signal)).body,
			),
		);
		if (!isRecord(value)) throw Error("Expected toolchain JSON record");
		return value;
	};
	const lockBytes = (
		await readResourceFile(
			join(root, "package-lock.json"),
			sourceDescription(LOCK_ID),
			signal,
		)
	).body;
	const lock: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(lockBytes),
	);
	if (!isRecord(lock) || !isRecord(lock.packages))
		throw Error("Expected toolchain package lock");
	const lockedPackages = lock.packages;
	const required =
		engine === "hyperframes"
			? HYPERFRAMES_TOOLCHAIN
			: engine === "three"
				? THREE_TOOLCHAIN
				: REMOTION_TOOLCHAIN;
	for (const [name, version] of Object.entries(required)) {
		const manifest = await readJson(
			join(root, "node_modules", name, "package.json"),
		);
		const lockedPackage = lockedPackages[`node_modules/${name}`];
		if (
			manifest.name !== name ||
			manifest.version !== version ||
			!isRecord(lockedPackage) ||
			lockedPackage.version !== version
		)
			throw Error(`Configured toolchain must pin ${name} ${version}`);
	}
	if (
		engine === "three" &&
		Object.keys(lockedPackages).some((path) =>
			path.endsWith("/node_modules/three"),
		)
	)
		throw Error("Three toolchain must contain exactly one Three.js runtime");
	// Portable provenance, without registry URLs, credentials, scripts or local paths.
	const packages = Object.entries(lockedPackages)
		.filter(([path]) => path !== "")
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([path, value]) => {
			if (
				!isRecord(value) ||
				!/^node_modules\/[A-Za-z0-9@._/-]+$/.test(path) ||
				path
					.split("/")
					.some((part) => !part || part === "." || part === "..") ||
				typeof value.version !== "string" ||
				!/^[0-9][0-9A-Za-z.+_-]{0,80}$/.test(value.version) ||
				typeof value.integrity !== "string" ||
				!/^sha512-[A-Za-z0-9+/]+=*$/.test(value.integrity)
			)
				throw Error(
					"Toolchain lock must use versioned registry packages with SHA-512 integrity",
				);
			return { path, version: value.version, integrity: value.integrity };
		});
	// A dependency-only lock cannot reproduce a scene after the Host's adapter changes.
	const threeProfile =
		engine === "three"
			? threeToolchainProfile({ particleRuntime, liquidRuntime })
			: undefined;
	const adapter =
		engine === "three"
			? threeProfile!.adapter
			: engine === "remotion"
				? {
						id: "rocut-remotion-html",
						version: remotionMetadataProfile === "metadata-pinned-v1" ? 2 : 1,
						sha256: resourceDigest(
							new TextEncoder().encode(
								[
									REMOTION_FRAME_DRIVER,
									REMOTION_ENVIRONMENT,
									REMOTION_MEDIA_WRAPPER,
									REMOTION_COMPILER_CHILD,
									HTML_MEDIA_BOOTSTRAP,
									OFFTHREAD_BOOTSTRAP,
									REMOTION_AUDIO_BOOTSTRAP,
									REMOTION_PRODUCED_THUMBNAIL_CAPTURE,
									JSON.stringify(NATIVE_VIDEO_COLOR_ADAPTER),
									REMOTION_METADATA_POLICY_SOURCE,
									REMOTION_METADATA_LIFETIME_SOURCE,
								].join("\n"),
							).buffer,
						),
					}
				: {
						id: "rocut-hyperframes-html",
						version: 1,
						sha256: resourceDigest(
							new TextEncoder().encode(
								[
									HYPERFRAMES_FRAME_DRIVER,
									HYPERFRAMES_COMPILER_CHILD,
									HTML_MEDIA_BOOTSTRAP,
									HYPERFRAMES_AUDIO_BOOTSTRAP,
									HYPERFRAMES_AUDIO_GRAPH_BOOTSTRAP,
									HYPERFRAMES_NATIVE_HISTORY_CAPTURE,
								].join("\n"),
							).buffer,
						),
					};
	let audioGraph;
	if (audioProfile === HYPERFRAMES_GRAPH_PROFILE) {
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: root,
			signal,
		});
		if (runtime.packageLockSha256 !== resourceDigest(lockBytes))
			throw Error("Graph toolchain lock changed during compilation admission");
		audioGraph = hyperframesGraphCompileIdentity(runtime, audioTiming);
	}
	const body = new TextEncoder().encode(
		JSON.stringify({
			version: 1,
			packages,
			...(adapter ? { adapter } : {}),
			...(audioGraph ? { audioGraph } : {}),
			...(threeProfile?.threeParticle
				? { threeParticle: threeProfile.threeParticle }
				: {}),
			...(threeProfile?.threeLiquidObject
				? { threeLiquidObject: threeProfile.threeLiquidObject }
				: {}),
		}),
	).buffer;
	const runtimeNotices =
		engine === "three"
			? await Promise.all(
					(["three", "@elftia/three-assets", "@noble/hashes"] as const).map(
						async (name) => ({
							name,
							version: THREE_TOOLCHAIN[name],
							license: new TextDecoder("utf-8", { fatal: true }).decode(
								(
									await readResourceFile(
										join(root, "node_modules", name, "LICENSE"),
										sourceDescription(LOCK_ID),
										signal,
									)
								).body,
							),
						}),
					),
				)
			: undefined;
	return {
		root,
		runtimeNotices,
		compilerEntry: pathToFileURL(
			engine === "hyperframes"
				? join(core, "dist/compiler/index.js")
				: join(root, "node_modules/esbuild/lib/main.js"),
		).href,
		parserEntry:
			engine === "hyperframes"
				? pathToFileURL(join(core, "dist/compiler/htmlDocument.js")).href
				: undefined,
		lock: {
			resource: describeResource(
				sourceDescription(LOCK_ID),
				body.byteLength,
				resourceDigest(body),
			),
			body,
		},
	};
}
