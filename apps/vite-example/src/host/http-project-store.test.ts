import { expect, test } from "bun:test";
import {
	ProjectStoreError,
	type ProjectStoreErrorCode,
} from "@opencut/editor-ports";
import { HttpProjectStore } from "./http-project-store";

test("HTTP storage only recognizes explicit readonly, never status or permission text", async () => {
	for (const [error, code] of [
		["readonly", "readonly"],
		["EPERM", "unavailable"],
		["forbidden", "unavailable"],
		["revision-conflict", "conflict"],
	] as const satisfies readonly (readonly [string, ProjectStoreErrorCode])[]) {
		const store = new HttpProjectStore({
			fetchImpl: async () =>
				new Response(JSON.stringify({ error }), { status: 403 }),
		});
		try {
			await store.list();
			throw new Error("Expected rejection");
		} catch (failure) {
			expect(failure).toBeInstanceOf(ProjectStoreError);
			if (!(failure instanceof ProjectStoreError)) throw failure;
			expect(failure.code).toBe(code);
		}
	}
});
