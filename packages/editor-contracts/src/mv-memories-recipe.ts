import type { ProgrammaticResource } from "./programmatic-resources";
import type { MvMemories } from "./mv-memories";
import type { MvHeartRecipeRequest } from "./mv-heart-recipe";
import type { MvAudioStop } from "./mv-recipe-audio";
import type { MvRole, MvSpan } from "./mv-recipe";
export type MvMemoriesRecipeScene = { kind: "memories"; settings: MvMemories; role: MvRole; span: MvSpan; bpm: number };
export type MvMemoriesRecipeRequestNode = {
	kind: "memoriesOwnerRequest";
	readonly role: MvRole;
	nodeId: string;
	request: {
		status: "pendingNativeOwner";
		args: MvMemories;
		resources: ProgrammaticResource[];
		frame: { songTicks: number; shotStartTicks: number; shotEndTicks: number; beats: number[]; bpm: number; downbeatIndex: number };
		provenance: MvHeartRecipeRequest["provenance"];
		downbeats: number[];
		stops?: MvAudioStop[] | null;
		reservation: {
			nativeFactsPending: true;
			declaredEncodedBytes: number;
			ownerMaxBytes: number;
			ownerMaxSessions: number;
			frameMetadataMaxBytes: number;
			host: { recipeReservationBytes: number; sessionCeilingBytes: number; maxLiveSessions: number; rasterByteLimit: number } | null;
		};
	};
};
