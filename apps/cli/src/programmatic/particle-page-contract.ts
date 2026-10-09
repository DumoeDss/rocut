import type { ParticleIdentity, ParticlePolicy } from "./particle-protocol";

/** Capture-local, Host-owned configuration. It contains no executable paths. */
export interface ParticlePageConfig {
	readonly version: 1;
	readonly identity: ParticleIdentity;
	readonly policy: ParticlePolicy;
	readonly requestTimeoutMs: number;
}

export const PARTICLE_CONFIG_NAME = "__rocutParticleConfig";
export const PARTICLE_PAGE_CLEANUP_NAME = "__rocutParticleCleanup";
export const PARTICLE_REQUEST_TAG = "rocut-particle-request";
export const PARTICLE_REPLY_TAG = "rocut-particle-reply";
export const PARTICLE_CLEANUP_REQUEST_TAG = "rocut-particle-cleanup";
export const PARTICLE_CLEANUP_ACK_TAG = "rocut-particle-cleaned";
export const PARTICLE_PAGE_CHECK_NAME = "__rocutParticleCheck";
export const PARTICLE_CHECK_REQUEST_TAG = "rocut-particle-check";
export const PARTICLE_CHECK_ACK_TAG = "rocut-particle-checked";
