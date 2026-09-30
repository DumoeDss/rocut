import { describe, expect, test } from "bun:test";
import { transformProjectV31ToV32 } from "../transformers/v31-to-v32";

describe("V31 to V32 Migration", () => {
	test("adds the motion-text sequence collection without changing opaque fields", () => {
		const project = {
			id: "project-v31-motion-text",
			version: 31,
			scenes: [],
			providerExtension: { preserve: [1, { nested: true }] },
		};

		const result = transformProjectV31ToV32({ project });

		expect(result.skipped).toBe(false);
		expect(result.project).toEqual({
			...project,
			version: 32,
			motionTextSequences: [],
		});
	});

	test("preserves an existing sequence collection and its unknown fields", () => {
		const motionTextSequences = [
			{
				id: "sequence:title",
				schemaVersion: 1,
				futureExtension: { provider: "keep" },
			},
		];
		const result = transformProjectV31ToV32({
			project: {
				id: "project-v31-existing-motion-text",
				version: 31,
				motionTextSequences,
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.motionTextSequences).toBe(motionTextSequences);
		expect(result.project.version).toBe(32);
	});

	test("does not replace an opaque pre-existing value", () => {
		const motionTextSequences = { providerOwned: true };
		const result = transformProjectV31ToV32({
			project: {
				id: "project-v31-opaque-collision",
				version: 31,
				motionTextSequences,
			},
		});

		expect(result.skipped).toBe(false);
		expect(result.project.motionTextSequences).toBe(motionTextSequences);
	});

	test("skips a project that is already v32", () => {
		const project = { id: "p1", version: 32, scenes: [] };
		const result = transformProjectV31ToV32({ project });
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("already v32");
		expect(result.project).toBe(project);
	});

	test("skips a project that is not v31", () => {
		const project = { id: "p1", version: 30, scenes: [] };
		const result = transformProjectV31ToV32({ project });
		expect(result.skipped).toBe(true);
		expect(result.reason).toBe("not v31");
		expect(result.project).toBe(project);
	});
});
