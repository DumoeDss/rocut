/**
 * @opencutSurface provider — the editor-native transaction plane (design §26.7, T3 ruling)
 */
// Declared entry "./transactions" (S06 follow-on: web-surface wiring). The
// editor-native `TransactionDocumentAdapter` plus the host-seed helpers a
// backend needs to persist the SAME record the editor session reads and
// writes — one plane, one file, the dual-plane unification ruled 2026-08-17.
//
// Closure discipline, mirroring "./storage/migrations" (S05 P3): everything
// here must stay free of BOTH react and the `opencut-wasm` runtime closure —
// the adapter, the projection and the project codec are pure TS, and the seed
// inlines the default-scene construction precisely because
// `timeline/scenes` transitively runtime-imports `src/wasm` (the S05
// wasm-init direction-level finding: that closure does not initialize under
// bun on the Windows machine of record). The version constant comes from the
// `migrations/version` leaf for the same reason — importing the transformer
// chain executes it. apps/cli/src/__tests__ enforces this statically.
import type { ProjectId, ProjectRecord, ProjectSummary } from "@opencut/editor-ports";
import { encodeProject } from "./editor/persistence/project-codec";
import { createOpenCutTransactionDocumentAdapter } from "./editor/transactions/opencut/adapter";
import { OPEN_CUT_TRANSACTION_ENVELOPE_KEY } from "./editor/transactions/opencut/adapter";
import { digestProjectRecord } from "./editor/transactions/opencut/adapter";
import type {
	OpenCutAssetCatalogEntry,
	OpenCutCommitToken,
	OpenCutProjectDraft,
	StagedOpenCutCandidate,
	EncodedOpenCutPublicationReceipt,
} from "./editor/transactions/opencut/types";
import type { OpenCutTransactionDocumentAdapter } from "./editor/transactions/opencut/adapter";
import type { TProject, TProjectMetadata } from "./project/types";
import type { TScene } from "./timeline/types";
import type { MediaTime } from "./wasm";
import { CURRENT_PROJECT_VERSION } from "./services/storage/migrations/version";

export { createOpenCutTransactionDocumentAdapter };
export { OPEN_CUT_TRANSACTION_ENVELOPE_KEY, digestProjectRecord };
export type {
	OpenCutTransactionDocumentAdapter,
	OpenCutAssetCatalogEntry,
	OpenCutCommitToken,
	OpenCutProjectDraft,
	StagedOpenCutCandidate,
	EncodedOpenCutPublicationReceipt,
};
export { CURRENT_PROJECT_VERSION };

/**
 * The envelope a committed editor-plane record carries under
 * {@link OPEN_CUT_TRANSACTION_ENVELOPE_KEY}. The host reads exactly these
 * fields for its external-save parent-chain check; the shape is owned by the
 * adapter (`editor/transactions/opencut/adapter.ts`), which remains the one
 * writer.
 */
export interface OpenCutRecordEnvelopeSummary {
	readonly revision: number;
	readonly idempotency: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read the transaction envelope summary off a persisted record's payload.
 *
 * Returns null when the payload carries no envelope (a pre-transaction
 * editor record or a foreign file) — hosts treat that as revision 0 with no
 * idempotency history, exactly as the adapter's decode does.
 */
export function readOpenCutEnvelopeSummary(
	data: unknown,
): OpenCutRecordEnvelopeSummary | null {
	if (!isRecord(data)) return null;
	const raw = data[OPEN_CUT_TRANSACTION_ENVELOPE_KEY];
	if (!isRecord(raw)) return null;
	if (
		typeof raw.revision !== "number" ||
		!Number.isInteger(raw.revision) ||
		raw.revision < 0 ||
		!Array.isArray(raw.idempotency)
	) {
		throw new Error("Invalid OpenCut transaction envelope");
	}
	return { revision: raw.revision, idempotency: raw.idempotency };
}

/**
 * Build the seed record for a fresh editor-plane project: a full `TProject`
 * payload at {@link CURRENT_PROJECT_VERSION} carrying a revision-0 envelope.
 *
 * The default scene is inlined (not `buildDefaultScene`) to keep this entry's
 * runtime closure wasm-free — the literal mirrors
 * `timeline/scenes.buildDefaultScene` and `timeline/placement/main-track`'s
 * `MAIN_TRACK_NAME`; `apps/cli`'s closure test pins the "Main Track" literal
 * to that constant so the duplication cannot drift silently.
 */
export function createOpenCutProjectRecord(args: {
	readonly projectId: ProjectId;
	readonly name: string;
	readonly now?: () => Date;
}): { readonly record: ProjectRecord; readonly summary: ProjectSummary } {
	const now = args.now ?? (() => new Date());
	const timestamp = now();
	const scene: TScene = {
		id: crypto.randomUUID(),
		name: "Main scene",
		isMain: true,
		tracks: {
			overlay: [],
			main: {
				id: crypto.randomUUID(),
				name: "Main Track",
				type: "video",
				elements: [],
				muted: false,
				hidden: false,
			},
			audio: [],
		},
		bookmarks: [],
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const metadata: TProjectMetadata = {
		id: args.projectId,
		name: args.name,
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Brand recovery without importing the wasm runtime closure: zero IS the integer tick count MediaTime requires.
		duration: 0 as MediaTime,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	const project: TProject = {
		metadata,
		scenes: [scene],
		currentSceneId: scene.id,
		settings: {
			fps: { numerator: 30, denominator: 1 },
			canvasSize: { width: 1920, height: 1080 },
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: "#000000" },
		},
		version: CURRENT_PROJECT_VERSION,
	};
	const data = encodeProject({ project, retained: {} });
	if (!isRecord(data)) {
		throw new Error("Encoded OpenCut project must be an object");
	}
	const record: ProjectRecord = {
		id: args.projectId,
		schemaVersion: CURRENT_PROJECT_VERSION,
		data: {
			...data,
			[OPEN_CUT_TRANSACTION_ENVELOPE_KEY]: {
				version: 1,
				revision: 0,
				idempotency: [],
				assetCatalog: [],
			},
		},
	};
	const summary: ProjectSummary = {
		id: args.projectId,
		name: args.name,
		createdAt: timestamp.toISOString(),
		updatedAt: timestamp.toISOString(),
	};
	return { record, summary };
}
