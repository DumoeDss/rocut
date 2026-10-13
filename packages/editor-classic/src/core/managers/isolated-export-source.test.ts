import { expect, test } from "bun:test";
import { decodeIsolatedExportSource } from "./isolated-export-source";

function source() {
	const projectId = `composition:${"a".repeat(64)}`;
	const date = "2026-01-01T00:00:00.000Z";
	return {
		projectId,
		revision: 0,
		data: {
			metadata: {
				id: projectId,
				name: "isolated",
				duration: 120000,
				createdAt: date,
				updatedAt: date,
			},
			currentSceneId: "composition-scene",
			version: 1,
			motionTextSequences: [],
			settings: {
				fps: { num: 30, den: 1 },
				canvasSize: { width: 1280, height: 720 },
				background: { type: "color", color: "#000000" },
			},
			scenes: [
				{
					id: "composition-scene",
					name: "isolated",
					createdAt: date,
					updatedAt: date,
					tracks: {
						main: { id: "main", type: "video", elements: [] },
						audio: [],
						overlay: [
							{
								id: "graphics",
								type: "graphic",
								elements: [
									{
										id: "graphic",
										type: "graphic",
										duration: 120000,
										programmatic: { code: "fixed" },
										params: {},
									},
								],
							},
						],
					},
				},
			],
		},
	};
}

test("isolated render view is detached without installing an active project", () => {
	const original = source(),
		decoded = decodeIsolatedExportSource(original);
	expect(decoded.metadata.id).toBe(original.projectId);
	expect(decoded.settings).not.toBe(original.data.settings);
	expect(decoded.scenes[0].tracks).not.toBe(original.data.scenes[0].tracks);
	original.data.scenes[0].tracks.overlay[0].elements[0].programmatic.code =
		"mutated";
	expect(decoded.scenes[0].tracks.overlay[0].elements[0]).toMatchObject({
		programmatic: { code: "fixed" },
	});
});

test("isolated decoder rejects project, revision and scene identity drift", () => {
	const variants = [source(), source(), source(), source(), source()];
	variants[0].projectId = "active";
	variants[1].revision = 1;
	variants[2].data.metadata.id = "active";
	variants[3].data.currentSceneId = "other";
	variants[4].data.scenes.push(variants[4].data.scenes[0]);
	for (const value of variants)
		expect(() => decodeIsolatedExportSource(value)).toThrow();
});
