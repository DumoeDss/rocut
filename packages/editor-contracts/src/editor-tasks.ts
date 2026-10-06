/** Tasks requiring the attached editor runtime, not a second project writer. */
export type EditorTaskRequest = {
	readonly expectedRevision: number;
	readonly idempotencyKey: string;
} & (
	| { readonly kind: "history.status" | "history.undo" | "history.redo" }
	| {
			readonly kind: "captions.import";
			readonly sceneId: string;
			readonly trackId: string;
			readonly fileName: string;
			readonly input: string;
	  }
	| {
			readonly kind: "captions.transcribe";
			readonly sceneId: string;
			readonly trackId: string;
			readonly language?: string;
			readonly modelId?: string;
			/** Model acquisition may use the network. Never infer consent. */
			readonly allowModelDownload: true;
	  }
);

export function isEditorTaskRequest(
	value: unknown,
): value is EditorTaskRequest {
	if (!isRecord(value)) return false;
	const v = value;
	if (
		!Number.isSafeInteger(v.expectedRevision) ||
		Number(v.expectedRevision) < 0 ||
		typeof v.idempotencyKey !== "string" ||
		!v.idempotencyKey.trim() ||
		v.idempotencyKey.length > 200
	)
		return false;
	const common = ["kind", "expectedRevision", "idempotencyKey"];
	let allowed: string[];
	if (
		["history.status", "history.undo", "history.redo"].includes(String(v.kind))
	) {
		allowed = common;
	} else {
		if (
			typeof v.sceneId !== "string" ||
			!v.sceneId ||
			typeof v.trackId !== "string" ||
			!v.trackId
		)
			return false;
		if (v.kind === "captions.import") {
			if (
				typeof v.fileName !== "string" ||
				!/\.(srt|ass)$/i.test(v.fileName) ||
				typeof v.input !== "string" ||
				v.input.length > 2_000_000
			)
				return false;
			allowed = [...common, "sceneId", "trackId", "fileName", "input"];
		} else if (v.kind === "captions.transcribe") {
			if (
				v.allowModelDownload !== true ||
				(v.language !== undefined && typeof v.language !== "string") ||
				(v.modelId !== undefined && typeof v.modelId !== "string")
			)
				return false;
			allowed = [
				...common,
				"sceneId",
				"trackId",
				"language",
				"modelId",
				"allowModelDownload",
			];
		} else return false;
	}
	return Object.keys(v).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
