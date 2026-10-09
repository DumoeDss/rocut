import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { admitFinalUiProject } from "./particle-editor-export-admission";

test.skipIf(!process.env.ROCUT_PARTICLE_PROJECT_FIXTURE)(
	"full-duration admission consumes production decoded tracks and rejects stale UI opacity or changed project geometry/timing",
	async () => {
		const path = process.env.ROCUT_PARTICLE_PROJECT_FIXTURE!;
		const bytes = await readFile(path);
		const original = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		expect(() => admitFinalUiProject(original)).toThrow();
		// CPU fixture variant only. No saved project, UI action, or runtime export is synthesized.
		const input = structuredClone(original);
		input.record.data.scenes[0].tracks.overlay[0].elements[0].params.opacity = 0.55;
		const before = JSON.stringify(input);
		const admitted = admitFinalUiProject(input);
		expect(Number(admitted.project.metadata.duration)).toBe(484000);
		expect(Number(admitted.clip.duration)).toBe(484000);
		expect(admitted.clip.programmatic?.durationFrames).toBe(121);
		expect(admitted.project.settings.canvasSize).toEqual({
			width: 1920,
			height: 1080,
		});
		expect(admitted.clip.params.opacity).toBe(0.55);
		admitted.clip.params.opacity = 1;
		expect(JSON.stringify(input)).toBe(before);
		for (const alter of [
			(value: typeof input) =>
				(value.record.data.settings.canvasSize.width = 320),
			(value: typeof input) => (value.record.data.metadata.duration = 24000),
			(value: typeof input) =>
				(value.record.data.scenes[0].tracks.overlay[0].elements[0].duration = 24000),
			(value: typeof input) =>
				(value.record.data.scenes[0].tracks.overlay[0].elements[0].startTime = 4000),
			(value: typeof input) =>
				(value.record.data.scenes[0].tracks.overlay[0].elements[0].trimStart = 4000),
			(value: typeof input) =>
				(value.record.data.scenes[0].tracks.overlay[0].elements[0].programmatic.durationFrames = 6),
		]) {
			const changed = structuredClone(input);
			alter(changed);
			expect(() => admitFinalUiProject(changed)).toThrow();
		}
		expect(await readFile(path)).toEqual(bytes);
	},
);
