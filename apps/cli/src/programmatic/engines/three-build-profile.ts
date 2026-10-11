import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import {
	loadProgrammaticResources,
	type ProgrammaticResourceStore,
} from "../resources";
import {
	assertCurrentThreeParticleAdapter,
	assertThreeParticleCompileIdentity,
	hasThreeParticleCapability,
	loadThreeParticleRuntime,
	parseThreeParticleArchive,
	type ThreeParticleCompileIdentity,
	type ThreeParticleRuntime,
} from "../three-particle-provenance";
import {
	assertCurrentThreeLiquidObjectAdapter,
	hasThreeLiquidObjectCapability,
	loadThreeLiquidObjectRuntime,
	parseThreeLiquidObjectArchive,
} from "../three-liquid-object-provenance";
import {
	assertThreeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectRuntime,
} from "../three-liquid-object-identity";
import { THREE_LIQUID_OBJECT_BROWSER_MODULE } from "../liquid-object-browser-module";
import { THREE_FRAME_DRIVER } from "./three-driver";
import { THREE_PARTICLE_FRAME_DRIVER } from "./three-particle-driver";
import { THREE_LIQUID_OBJECT_FRAME_DRIVER } from "./three-liquid-object-driver";
import { hasThreeSvgModel } from "./three-asset-features";

interface ThreeBuildProfile {
	readonly archive?: {
		inputs: ResolvedProgrammaticResource[];
		lock: ResolvedProgrammaticResource;
		particle?: ThreeParticleCompileIdentity;
		liquid?: ThreeLiquidObjectCompileIdentity;
	};
	readonly particleRuntime?: ThreeParticleRuntime;
	readonly liquidRuntime?: ThreeLiquidObjectRuntime;
	readonly driver: string;
	readonly liquidCompiler?: { version: 1; runtime: string };
}

/** Read the old identity before worker discovery; never fill a contradictory
 * archive with whatever runtime happens to be configured on this Host. */
export async function prepareThreeBuildProfile(options: {
	action: "compile" | "rebuild" | "revise";
	source: ProgrammaticSource;
	context: ProgrammaticResourceStore;
	signal: AbortSignal;
}): Promise<ThreeBuildProfile | undefined> {
	const { source, context, signal, action } = options;
	if (source.build?.engine !== "three") return undefined;
	let archive: ThreeBuildProfile["archive"];
	if (action !== "compile") {
		const inputs = await loadProgrammaticResources(
			context,
			[...source.build.inputs, source.build.toolchainLock],
			signal,
		);
		const lock = inputs.pop()!;
		archive = {
			inputs,
			lock,
			particle: parseThreeParticleArchive(source, lock.body),
			liquid: parseThreeLiquidObjectArchive({ source, body: lock.body }),
		};
		if (archive.particle)
			assertCurrentThreeParticleAdapter(
				archive.particle,
				hasThreeSvgModel(source.resources),
			);
		if (archive.liquid)
			assertCurrentThreeLiquidObjectAdapter(
				archive.liquid,
				hasThreeSvgModel(source.resources),
			);
	}
	const particleRuntime = hasThreeParticleCapability(source)
		? await loadThreeParticleRuntime(signal, archive?.particle?.samplerIdentity)
		: undefined;
	const liquidRuntime = hasThreeLiquidObjectCapability(source)
		? await loadThreeLiquidObjectRuntime({
				signal,
				expectedIdentity: archive?.liquid?.workerIdentity,
			})
		: undefined;
	return {
		archive,
		particleRuntime,
		liquidRuntime,
		driver: liquidRuntime
			? THREE_LIQUID_OBJECT_FRAME_DRIVER
			: particleRuntime
				? THREE_PARTICLE_FRAME_DRIVER
				: THREE_FRAME_DRIVER,
		...(liquidRuntime
			? {
					liquidCompiler: {
						version: 1 as const,
						runtime: THREE_LIQUID_OBJECT_BROWSER_MODULE,
					},
				}
			: {}),
	};
}

export function assertThreeBuildProfile(options: {
	profile: ThreeBuildProfile | undefined;
	source: ProgrammaticSource;
	lock: ArrayBuffer;
}) {
	if (!options.profile) return;
	const particle = parseThreeParticleArchive(options.source, options.lock);
	const liquid = parseThreeLiquidObjectArchive({
		source: options.source,
		body: options.lock,
	});
	if (options.profile.archive?.particle)
		assertThreeParticleCompileIdentity(
			options.profile.archive.particle,
			particle,
		);
	if (options.profile.archive?.liquid)
		assertThreeLiquidObjectCompileIdentity({
			archived: options.profile.archive.liquid,
			current: liquid,
		});
}
