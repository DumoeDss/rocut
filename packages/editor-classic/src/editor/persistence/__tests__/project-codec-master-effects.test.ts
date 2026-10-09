import { expect, test } from "bun:test";
import { decodeProject, encodeProject } from "../project-codec";
import { projectFixture } from "../../transactions/opencut/__tests__/fixture";

test("master effects roundtrip detached and replace rather than merge retained parameters", () => {
	const project = projectFixture();
	project.settings.masterEffects = [
		{
			id: "grade",
			type: "exposure",
			enabled: true,
			params: { exposure: 1, removed: 2 },
		},
		{ id: "old", type: "invert", enabled: false, params: {} },
	];
	const retained = encodeProject({ project, retained: {} });
	project.settings.masterEffects = [
		{ id: "grade", type: "exposure", enabled: true, params: { exposure: 0.5 } },
	];
	const reloaded = decodeProject(encodeProject({ project, retained }));
	expect(reloaded.settings.masterEffects).toEqual(
		project.settings.masterEffects,
	);
	reloaded.settings.masterEffects![0].params.exposure = 0;
	expect(project.settings.masterEffects[0].params.exposure).toBe(0.5);
	expect(decodeProject(retained).settings.masterEffects).toHaveLength(2);
	project.settings.masterEffects = [];
	expect(
		decodeProject(encodeProject({ project, retained })).settings.masterEffects,
	).toEqual([]);
});

test("legacy project omission remains an identity master without schema rewriting", () => {
	const project = projectFixture();
	const saved = encodeProject({ project, retained: {} });
	const loaded = decodeProject(saved);
	expect(loaded.version).toBe(project.version);
	expect(loaded.settings.masterEffects).toBeUndefined();
});
