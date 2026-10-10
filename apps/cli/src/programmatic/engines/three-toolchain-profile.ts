import {
	getThreeParticleAdapterHash,
	threeParticleCompileIdentity,
	type ThreeParticleRuntime,
} from "../three-particle-provenance";
import { getThreeLiquidObjectAdapterHash } from "../three-liquid-object-adapter";
import {
	threeLiquidObjectCompileIdentity,
	type ThreeLiquidObjectRuntime,
} from "../three-liquid-object-identity";
import { resourceDigest } from "../resources";
import { THREE_FRAME_DRIVER } from "./three-driver";
import { REMOTION_COMPILER_CHILD } from "./remotion-compiler-child";

export function threeToolchainProfile(options: {
	particleRuntime?: ThreeParticleRuntime;
	liquidRuntime?: ThreeLiquidObjectRuntime;
}) {
	const { particleRuntime, liquidRuntime } = options;
	if (particleRuntime && liquidRuntime)
		throw Error("Three toolchain requires exactly one native build profile");
	const adapter = {
		id: "rocut-three-html",
		version: 1,
		sha256: liquidRuntime
			? getThreeLiquidObjectAdapterHash()
			: particleRuntime
				? getThreeParticleAdapterHash()
				: resourceDigest(
						new TextEncoder().encode(
							THREE_FRAME_DRIVER + "\n" + REMOTION_COMPILER_CHILD,
						).buffer,
					),
	};
	return {
		adapter,
		threeParticle: particleRuntime
			? threeParticleCompileIdentity(particleRuntime, adapter.sha256)
			: undefined,
		threeLiquidObject: liquidRuntime
			? threeLiquidObjectCompileIdentity({
					runtime: liquidRuntime,
					adapterSha256: adapter.sha256,
				})
			: undefined,
	};
}
