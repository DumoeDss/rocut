export interface CreatorDocument {
	readonly purpose?: "character" | "scene";
	readonly id: string;
	readonly title: string;
	readonly group: string;
	readonly content: string;
	readonly contentState?: "unloaded";
	readonly revision?: string;
}

export interface CreatorAssetVersion {
	readonly id: string;
	readonly canRegenerate?: boolean;
	readonly durationSeconds?: number;
	readonly label: string;
	readonly mediaType: "image" | "video" | "audio" | "programmatic";
	readonly previewUrl?: string;
	readonly posterUrl?: string;
	readonly posterStatus?: string;
	readonly waveform?: readonly number[];
	readonly mediaId?: string;
	readonly sha256?: string;
	readonly model?: string;
	readonly source?: string;
	readonly prompt?: string;
	readonly references?: readonly { id: string; label: string }[];
	readonly status?: "pending" | "ready" | "failed";
}

export interface CreatorAsset {
	readonly id: string;
	readonly name: string;
	readonly selectedVersionId?: string;
	readonly versions: readonly CreatorAssetVersion[];
	readonly usages?: readonly {
		id: string;
		label: string;
		versionId: string;
		projectId?: string;
		sceneId?: string;
	}[];
}

export interface CreatorWorkspaceSnapshot {
	readonly scopeRevision?: string;
	readonly clipReferences?: readonly {
		readonly projectId: string;
		readonly sceneId: string;
		readonly clipId: string;
		readonly assetId: string;
		readonly versionId: string;
		readonly sha256: string;
		readonly status?:
			| "linked"
			| "imported"
			| "missing"
			| "needs-reconciliation";
	}[];
	readonly projectId: string;
	readonly revision: string;
	readonly capabilities?: {
		readonly saveDocument: boolean;
		readonly selectVersion: boolean;
		readonly regenerate: boolean;
		readonly generate?: boolean;
		readonly placeVersion: boolean;
		readonly mention: boolean;
		readonly replaceVersion?: boolean;
		readonly locateInCanvas?: boolean;
	};
	readonly jobs?: readonly { id: string; status: string; stage: string }[];
	readonly documents: readonly CreatorDocument[];
	readonly assets: readonly CreatorAsset[];
}

export type CreatorWorkspaceCommand =
	| { type: "timeline.annotations"; nativeProjectId: string; sceneId: string }
	| { type: "timeline.saved"; nativeProjectId: string; sceneId: string }
	| { type: "workspace.page"; token: string; index: number }
	| {
			type: "document.read";
			projectId: string;
			projectRevision: string;
			scopeRevision: string;
			documentId: string;
			revision: string;
	  }
	| {
			type: "asset.generate";
			mediaType: "image" | "video";
			providerId: string;
			modelId: string;
			prompt: string;
			references?: Record<string, { assetId: string; versionId: string }[]>;
	  }
	| { type: "generation.catalog"; mediaType: "image" | "video" }
	| { type: "asset.audio-summary"; assetId: string; versionId: string }
	| { type: "asset.ensure-poster"; projectId: string; assetId: string; versionId: string; sha256: string }
	| {
			type: "document.save";
			documentId: string;
			content: string;
			revision?: string;
	  }
	| { type: "asset.select-version"; assetId: string; versionId: string }
	| {
			type: "asset.regenerate";
			assetId?: string;
			versionId?: string;
			prompt: string;
			providerId?: string;
			modelId?: string;
			references?: Record<string, { assetId: string; versionId: string }[]>;
	  }
	| {
			type: "asset.place-version";
			expectedSha256?: string;
			assetId: string;
			versionId: string;
			native?: CreatorNativePlacement;
	  }
	| { type: "context.mention"; assetId: string; versionId?: string }
	| { type: "context.locate-canvas"; assetId: string; versionId: string }
	| {
			type: "asset.replace-version.prepare";
			assetId: string;
			versionId: string;
			expectedSha256?: string;
			clipIds: string[];
			registeredTargetId: string;
			nativeProjectId: string;
			nativeRevision: string;
	  }
	| { type: "asset.replace-version.confirm"; planId: string };

export interface CreatorNativePlacement {
	readonly projectId: string;
	readonly sceneId: string;
	readonly revision: number;
	readonly placement: {
		readonly clipId: string;
		readonly trackId: string;
		readonly startTime: number;
		readonly duration?: number;
		readonly trimStart: number;
		readonly trimEnd: number;
		readonly newTrack?: { type: "video" | "audio"; index: number };
	};
}

export interface CreatorWorkspaceCommandResult {
	readonly annotations?: CreatorTimelineAnnotations | { status: "unmanaged" };
	readonly poster?:
		| { status: "available"; url: string }
		| { status: "unavailable"; reason: string };
	readonly planId?: string;
	readonly catalog?: {
		status: "ready" | "unavailable";
		providers: readonly {
			id: string;
			name: string;
			defaultModelId?: string;
			models: readonly { id: string; name: string }[];
		}[];
		reason?: string;
	};
	readonly summary?:
		| {
				status: "available";
				durationSeconds: number;
				waveform: readonly number[];
		  }
		| { status: "unavailable"; reason: string };
	readonly snapshot?: CreatorWorkspaceSnapshot;
	readonly message?: string;
}

export interface CreatorTimelineAnnotation {
	readonly id: string;
	readonly label: string;
	readonly startTick: number;
	readonly endTick: number;
}
export interface CreatorTimelineLyric extends CreatorTimelineAnnotation {
	readonly nodeId: string;
	readonly clipId: string;
	readonly trackId: string;
}
export interface CreatorTimelineAnnotations {
	readonly status: "available";
	readonly timelineId: string;
	readonly frameRate: { numerator: number; denominator: number };
	readonly sectionsStatus: "candidate" | "unsegmented";
	readonly sectionsReason?: string;
	readonly lyricsClock?: "scene-timeline-ticks";
	readonly lyricsNativeRevision?: number;
	readonly sections: readonly CreatorTimelineAnnotation[];
	readonly lyrics: readonly CreatorTimelineLyric[];
}

/** Transport-independent host port; canonical project content stays with the host. */
export interface CreatorWorkspaceBridge {
	readDocument?(input: {
		document: CreatorDocument;
		snapshot: CreatorWorkspaceSnapshot;
	}): Promise<CreatorDocument>;
	getSnapshot(): Promise<CreatorWorkspaceSnapshot>;
	subscribe(listener: (snapshot: CreatorWorkspaceSnapshot) => void): () => void;
	execute(
		command: CreatorWorkspaceCommand,
	): Promise<CreatorWorkspaceCommandResult>;
}
