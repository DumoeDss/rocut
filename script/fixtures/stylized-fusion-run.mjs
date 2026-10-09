import assert from "node:assert/strict";
import {
	capture,
	decodeFusion,
	exportFusion,
	seek,
} from "./stylized-fusion-checks.mjs";
import { editFusion } from "./stylized-fusion-editing.mjs";

export async function runFusion(
	page,
	artifacts,
	evidence,
	agentRequest,
	publicPath,
) {
	evidence.canvases = await page.locator("canvas").evaluateAll((nodes) =>
		nodes.map((node) => ({
			width: node.width,
			height: node.height,
			rect: node.getBoundingClientRect().toJSON(),
		})),
	);
	await seek(page, 1);
	evidence.preview = [await capture(page, artifacts, "preview-retro")];
	await seek(page, 3);
	evidence.preview.push(await capture(page, artifacts, "preview-retro-second"));
	await seek(page, 5);
	evidence.preview.push(await capture(page, artifacts, "preview-particles"));
	await seek(page, 6, 15);
	evidence.preview.push(await capture(page, artifacts, "preview-peel"));
	const threeFrame = page.waitForResponse(
		(r) => publicPath(r.url()) === "/api/programmatic/frame",
		{ timeout: 30000 },
	);
	await seek(page, 8, 15);
	assert.equal((await threeFrame).status(), 200, "Real Three preview frame");
	evidence.preview.push(await capture(page, artifacts, "preview-three"));
	await seek(page, 1);
	const reversed = await capture(page, artifacts, "preview-retro-reversed");
	assert.equal(
		reversed.sha256,
		evidence.preview[0].sha256,
		"Reverse seek must restore same displayed pixels",
	);
	evidence.checks.push({
		name: "real preview of all four shots and reverse seek",
		pass: true,
	});
	evidence.agentTransport =
		"direct authenticated Host HTTP, actual attached-editor task runner";
	await editFusion(page, artifacts, evidence, agentRequest);
	const video = await exportFusion(page, artifacts, evidence, agentRequest);
	evidence.decoded = decodeFusion(
		video,
		artifacts,
		process.env.ROCUT_FUSION_FFMPEG_DIR,
	);
	evidence.checks.push({
		name: "independent 300-frame video and segmented stereo audio decode",
		pass: true,
	});
}
