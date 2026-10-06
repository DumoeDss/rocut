import type { AutomationApi } from "@opencut/editor-automation";
import { planSceneMutation } from "@opencut/editor-classic/editing";
import {
	MotionTextApiError,
	record,
	onlyKeys,
	nonEmptyString,
} from "./motion-text-request";

/** Plan only. Apply the returned batch through the durable revision/idempotency path. */
export async function planSceneEdit({
	automation,
	input,
}: {
	automation: AutomationApi;
	input: unknown;
}) {
	const spec = record(input);
	onlyKeys(spec, ["operation", "idempotencyKey"]);
	const idempotencyKey = nonEmptyString(spec.idempotencyKey, "idempotencyKey")!;
	const revision = await automation.revision();
	const document = {
		project: await automation.project(),
		tracks: await automation.tracks(),
		markers: await automation.markers(),
	};
	try {
		return {
			expectedRevision: revision,
			idempotencyKey,
			operations: planSceneMutation({ document, operation: spec.operation }),
		};
	} catch (error) {
		throw new MotionTextApiError({
			status: 400,
			code: "invalid-scene-edit",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
