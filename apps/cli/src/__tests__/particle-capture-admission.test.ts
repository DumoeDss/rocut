import { expect, test } from "bun:test";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import { renderHtmlPng } from "../programmatic/html-rasterizer";

function request(): ProgrammaticFrameRequest {
	const archive = (id: string) => ({
		id,
		kind: "source" as const,
		mimeType: "application/octet-stream",
		byteLength: 0,
		sha256: "a".repeat(64),
		attachmentKey: `programmatic-source-sha256-${"a".repeat(64)}`,
	});
	return {
		source: {
			version: 1,
			runtime: "html-document",
			code: "<html><body></body></html>",
			width: 64,
			height: 64,
			frameRate: { numerator: 30, denominator: 1 },
			durationFrames: 30,
			seed: 1,
			build: {
				version: 1,
				engine: "three",
				engineVersion: "0.185.1",
				entryFile: "scene.ts",
				capabilities: ["particle-surface-v1"],
				inputs: [archive("scene.ts")],
				toolchainLock: archive("_rocut/toolchain-lock.json"),
			},
		},
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: 0,
	};
}

test("particle declarations require the verified archive before Chromium or sampler startup", async () => {
	await expect(
		renderHtmlPng({ request: request(), signal: new AbortController().signal }),
	).rejects.toThrow("verified archive resource store");
});

test("PNG-only Electron capture cannot accept a particle declaration", async () => {
	await expect(
		renderHtmlPng({
			request: request(),
			signal: new AbortController().signal,
			connectionFile: "C:/not-accessed/particle-capture-connection.json",
		}),
	).rejects.toThrow("Particle surface capture is not supported");
});

test("ordinary sources still reach the existing backend admission", async () => {
	const input = request();
	delete (input.source as { build?: unknown }).build;
	await expect(
		renderHtmlPng({ request: input, signal: new AbortController().signal }),
	).rejects.toThrow("No HTML frame backend configured");
});
