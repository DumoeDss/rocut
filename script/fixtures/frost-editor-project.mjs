import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";
import {
	snapshot,
	digest,
	validateArtifacts,
} from "./flame-wrap-editor-controls.mjs";

export function createFrostClips({ image, frostImage }) {
	const settings = {
		width: 192,
		height: 128,
		durationFrames: 24,
		frameRate: { numerator: 24, denominator: 1 },
	};
	const shot = frostImage({
		image,
		settings,
		params: { holdTicks: 0, recoveryTicks: 60000 },
		strokes: [
			{
				time: 0,
				fromX: 0.25,
				fromY: 0.5,
				toX: 0.75,
				toY: 0.5,
				radius: 0.12,
				strength: 1,
			},
		],
	});
	const clips = ["frost-static", "frost-peer", "frost-disabled"].map(
		(id, index) => {
			const effects = structuredClone(shot.effects);
			if (index === 2) effects[0].enabled = false;
			return {
				id,
				trackId: "frost-shots",
				startTime: index * 120000,
				duration: 120000,
				trimStart: 0,
				trimEnd: 0,
				editing: {
					type: "graphic",
					name: id,
					definitionId: "programmatic",
					params: {},
					programmatic: structuredClone(shot.source),
					effects,
					animations: structuredClone(shot.animations),
				},
			};
		},
	);
	return { clips, settings };
}

export async function assertPrivateFrostHost({ request, artifacts }) {
	validateArtifacts(artifacts);
	const projectPath = await realpath(artifacts.projectPath),
		root = await realpath(artifacts.root);
	const rootRelative = win32.relative("C:/tmps", root);
	assert(
		rootRelative &&
			!rootRelative.startsWith("..") &&
			!win32.isAbsolute(rootRelative),
		"Resolved fixture root escaped C:/tmps",
	);
	const relative = win32.relative(root, projectPath);
	assert(
		relative && !relative.startsWith("..") && !win32.isAbsolute(relative),
		"Project escaped isolated fixture",
	);
	const persisted = JSON.parse(await readFile(projectPath, "utf8"));
	assert.deepEqual(
		await request("record"),
		{ record: persisted.record, summary: persisted.summary },
		"Host record does not match explicitly supplied private project file",
	);
}

export async function prepareFrostEditorProject({
	request,
	artifacts,
	creator,
	imagePath,
}) {
	await assertPrivateFrostHost({ request, artifacts });
	const initial = await snapshot(request);
	assert.equal(
		initial.clips.length,
		0,
		"Preparation requires empty private fixture clips",
	);
	assert.equal(initial.revision, 0, "Preparation requires new private project");
	assert.equal(
		initial.tracks.length,
		1,
		"Expected only default empty main track",
	);
	assert.equal(typeof initial.tracks[0].sceneId, "string");
	assert.deepEqual(initial.tracks[0], {
		id: initial.tracks[0].id,
		sceneId: initial.tracks[0].sceneId,
		name: "Main Track",
		kind: "video",
		hidden: false,
		muted: false,
	});
	const resolvedImage = await realpath(imagePath),
		root = await realpath(artifacts.root);
	const relative = win32.relative(root, resolvedImage);
	assert(
		relative && !relative.startsWith("..") && !win32.isAbsolute(relative),
		"Image escaped isolated fixture",
	);
	const imageBytes = await readFile(resolvedImage);
	const { resource } = await request("programmatic/resources/import", {
		id: "frost-source.png",
		kind: "image",
		filePath: resolvedImage,
		mimeType: "image/png",
	});
	assert.equal(resource.sha256, digest(imageBytes));
	const imported = await snapshot(request);
	assert.deepEqual(imported.clips, initial.clips);
	assert.deepEqual(imported.tracks, initial.tracks);
	const { frostImage } = await import(pathToFileURL(creator).href);
	const { clips, settings } = createFrostClips({ image: resource, frostImage });
	assert.equal(clips[0].editing.effects[0].id, artifacts.effectId);
	const response = await request("apply", {
		expectedRevision: imported.revision,
		operations: [
			{
				kind: "update-project",
				projectId: initial.project.id,
				patch: {
					name: "Frost private UI fixture",
					canvasWidth: 192,
					canvasHeight: 128,
					frameRate: settings.frameRate,
				},
			},
			{
				kind: "create-track",
				track: {
					id: "frost-shots",
					name: "Frost",
					kind: "graphic",
					hidden: false,
				},
			},
			...clips.map((clip) => ({ kind: "create-clip", clip })),
		],
	});
	assert.equal(response.accepted, true);
	const actual = await snapshot(request);
	assert.equal(actual.revision, imported.revision + 1);
	for (const expected of clips)
		assert.deepEqual(
			actual.clips.find((clip) => clip.id === expected.id),
			expected,
		);
	return {
		graph: actual,
		resource,
		scope:
			"Prepared via actual Creator frostImage and formal Host apply; browser not yet verified",
	};
}
