/** Capture identity is correlation data, never an authorization token. */
export type ParticleIdentity = Readonly<{
	sessionId: string;
	captureId: string;
	frameId: string;
	sourceId: string;
}>;

export type { ParticlePolicy } from "./particle-policy-types";

type Envelope = ParticleIdentity & {
	version: 1;
	operation: "particleSurface";
	id: number;
};

export type ParticleSampleRequest = Envelope & {
	kind: "sample";
	requestJson: string;
};
export type ParticleCancelRequest = Envelope & { kind: "cancel" };
export type ParticleRequest = ParticleSampleRequest | ParticleCancelRequest;
export type ParticleFailureCode = "surface" | "protocol" | "cancelled";
export type ParticleResponse = Envelope &
	(
		| { ok: true; responseJson: string }
		| { ok: false; error: { code: ParticleFailureCode; message: string } }
	);

type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];
export type ParticleSurfaceTriangle = {
	position: [Vec3, Vec3, Vec3];
	normal?: [Vec3, Vec3, Vec3] | null;
	uv?: [Vec2, Vec2, Vec2] | null;
	color?: [Vec4, Vec4, Vec4] | null;
	primitiveIndex: number;
	materialIndex?: number | null;
};
export type ParticleSurfaceRequestData = {
	triangles: ParticleSurfaceTriangle[];
	count: number;
	seed: number;
	motion?: import("./particle-motion-contract").ParticleMotion;
};
export type ParticleSurfaceSample = {
	position: Vec3;
	motionPosition?: Vec3;
	size?: number;
	normal: Vec3;
	uv?: Vec2;
	color?: Vec4;
	barycentric: Vec3;
	triangleIndex: number;
	primitiveIndex: number;
	materialIndex?: number;
};
export type ParticleSurfaceResult =
	| { version: 1; ok: true; samples: ParticleSurfaceSample[] }
	| {
			version: 1;
			ok: false;
			error: { code: string; path: string; message: string };
	  };
