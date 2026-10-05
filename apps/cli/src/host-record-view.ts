import { isDeepStrictEqual } from "node:util";
import type { ProjectRecord } from "@opencut/editor-ports";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only explicitly non-content persistence fields may keep a reviewed draft.
 * Comparing the whole retained record fails closed for unknown/plugin fields;
 * a projected transaction document alone would silently omit those fields. */
export function isViewOnlyRecordSave(before: ProjectRecord, after: ProjectRecord): boolean {
	if (!object(before.data) || !object(after.data) ||
		!object(before.data.metadata) || !object(after.data.metadata)) return false;
	const content = (record: ProjectRecord) => {
		const data = { ...(record.data as Record<string, unknown>) };
		const metadata = { ...(data.metadata as Record<string, unknown>) };
		delete data.timelineViewState;
		delete metadata.updatedAt;
		return { ...record, data: { ...data, metadata } };
	};
	return isDeepStrictEqual(content(before), content(after));
}
