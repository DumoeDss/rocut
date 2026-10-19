import { expect, test } from "bun:test";
import { createCreatorSnapshotFence } from "./creator-snapshot-fence";
import type { CreatorWorkspaceSnapshot } from "./creator-workspace-types";
const snapshot = (
	revision: string,
	projectId = "a",
): CreatorWorkspaceSnapshot => ({
	projectId,
	revision,
	assets: [],
	documents: [],
});
test("late broadcasts and out-of-order command refreshes cannot regress facts", () => {
	const accept = createCreatorSnapshotFence();
	expect(accept(snapshot("1"))).toBe(true);
	expect(accept(snapshot("4"))).toBe(true);
	expect(accept(snapshot("2"))).toBe(false);
	expect(accept(snapshot("3"))).toBe(false);
	expect(accept(snapshot("4"))).toBe(true);
	expect(accept(snapshot("5", "b"))).toBe(false);
	expect(accept(snapshot("invalid"))).toBe(false);
	expect(createCreatorSnapshotFence()(snapshot("0", "b"))).toBe(true);
});
