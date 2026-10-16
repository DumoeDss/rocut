/** Optional host rasterizer. PNG preserves alpha; Rocut still owns encoding.
 * Providers must observe abort and release the isolated browser on every exit.
 */
export interface ProgrammaticFrameProvider<
	Request = unknown,
	Resource = unknown,
> {
	renderPng(args: { request: Request; signal: AbortSignal }): Promise<Blob>;
	/** Optional source soundtrack. Raw stereo f32LE, never mastered per source. */
	renderAudio?(args: {
		request: unknown;
		signal: AbortSignal;
	}): Promise<ProgrammaticAudioData>;
	/** Revalidate graph runtime identity before looking up cached source PCM. */
	getAudioIdentity?(args: {
		request: unknown;
		signal: AbortSignal;
	}): Promise<ProgrammaticAudioIdentity>;
	/** Authenticated project-attachment read, not arbitrary path/network access. */
	loadResource?(args: {
		resource: Resource;
		signal: AbortSignal;
	}): Promise<Blob>;
	/** Prepare a rebuilt archived source; applying it remains an editor transaction. */
	reviseBuild?(args: {
		request: unknown;
		signal: AbortSignal;
	}): Promise<unknown>;
	/** Read-only GLB metadata. The Host owns attachments and fixed toolchain configuration. */
	inspectAnimation?(args: {
		resource: Resource;
		signal: AbortSignal;
	}): Promise<unknown>;
}

export interface ProgrammaticAudioData {
	pcm: ArrayBuffer;
	sampleRate: number;
	channels: number;
	frames: number;
	sampleOrigin: number;
	hasAudio: boolean;
	/** Required for the explicit HyperFrames graph profile, absent for legacy audio. */
	identity?: ProgrammaticAudioIdentity;
}

export interface ProgrammaticAudioIdentity {
	readonly version: 1;
	readonly profile: "hyperframes-graph-v1";
	readonly id: string;
}

/** Transport shape only: the authenticated host owns identity/provenance. */
export function isProgrammaticAudioIdentity(
	value: unknown,
): value is ProgrammaticAudioIdentity {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return (
		Object.keys(value).length === 3 &&
		"version" in value &&
		value.version === 1 &&
		"profile" in value &&
		value.profile === "hyperframes-graph-v1" &&
		"id" in value &&
		typeof value.id === "string" &&
		/^[a-f0-9]{64}$/.test(value.id)
	);
}
