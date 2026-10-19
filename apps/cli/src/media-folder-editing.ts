import type { AutomationApi } from "@opencut/editor-automation";
import { planMediaFolderMutation } from "@opencut/editor-classic/editing";
import type { MediaFolderMutation } from "@opencut/editor-contracts";
import {
	MotionTextApiError,
	record,
	onlyKeys,
	nonEmptyString,
} from "./motion-text-request";

/** Return a revision-bound plan; clients submit it through the existing apply route. */
export async function planMediaFolderEdit({
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
		assets: await automation.assets(),
	};
	try {
		return {
			expectedRevision: revision,
			idempotencyKey,
			operations: planMediaFolderMutation({
				document,
				operation: spec.operation as MediaFolderMutation,
			}),
		};
	} catch (error) {
		throw new MotionTextApiError({
			status: 400,
			code: "invalid-media-folder-edit",
			message: error instanceof Error ? error.message : String(error),
		});
	}
}
