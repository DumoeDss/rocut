import type {
	HyperframesResolvedAuthorGain,
	HyperframesResolvedAuthorGainFacts,
} from "./hyperframes-audio-graph-gain-types";
export type {
	HyperframesResolvedAuthorGain,
	HyperframesResolvedAuthorGainFacts,
} from "./hyperframes-audio-graph-gain-types";

/** Unadmitted browser facts, not an executable graph or a feature capability. */
export interface HyperframesNativePoint {
	t: number;
	v: number;
	curve?: number;
	viaX?: number;
	viaY?: number;
}

/** Values already resolved by the pinned runtime; no DOM timing fallback. */
export interface HyperframesNativeClipFacts {
	start: number;
	end: number;
	duration: number;
	mediaStart: number;
	sourceDuration: number;
	playbackRate: number;
	rate: number | { target: string; points: HyperframesNativePoint[] };
	loop: boolean;
	volume: number | null;
	fades: { fadeIn: number; fadeOut: number };
	volumeKeyframes?: { time: number; volume: number }[];
}

export interface HyperframesAudioGraphTrack {
	instanceId: string;
	authorId: string | null;
	resourceId: string;
	type: "audio" | "video";
	authoredMuted: boolean;
	/** Native closest('[data-hidden]') result, including the element itself. */
	ancestorHidden: boolean;
	observedAt: number;
	native: HyperframesNativeClipFacts;
	resolvedAuthorGain: HyperframesResolvedAuthorGain;
	attributes: {
		groupRenderId: string | null;
		groupAuthorId: string | null;
		fxChain: string | null;
		automation: string | null;
		/** Attribute presence, not the transport-forced HTMLMediaElement.muted. */
		muted: boolean;
		hasAudio: string | null;
	};
}

export interface HyperframesAudioGraphBus {
	instanceId: string;
	authorId: string | null;
	hidden: boolean;
	attributes: {
		volume: string | null;
		fxChain: string | null;
		automation: string | null;
	};
}

export interface HyperframesAudioGraphSnapshot {
	version: 1;
	nativeVersion: "0.8.139";
	/** Requested composition seconds. Each track also retains native observedAt. */
	time: number;
	tracks: HyperframesAudioGraphTrack[];
	buses: HyperframesAudioGraphBus[];
}

/** Host supplies admitted resource identity and mute captured before transport. */
export interface HyperframesAudioGraphDeclaration {
	resourceId: string;
	authoredMuted: boolean;
}

export interface HyperframesAudioGraphBridge {
	registerMedia(
		element: HTMLMediaElement,
		declaration: HyperframesAudioGraphDeclaration,
	): void;
	begin(frame: { time: number }): void;
	/** Receive the actual pinned runtime clip, before its active-window branch. */
	collectTrack(
		element: HTMLMediaElement,
		clip: HyperframesNativeClipFacts & { el: HTMLMediaElement },
		observedAt: number,
	): void;
	collectResolvedAuthorGain(
		element: HTMLMediaElement,
		clip: HyperframesNativeClipFacts & { el: HTMLMediaElement },
		observedAt: number,
		gain: HyperframesResolvedAuthorGainFacts,
	): void;
	snapshot(): HyperframesAudioGraphSnapshot;
}
