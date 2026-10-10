import assert from "node:assert/strict";

export function checkCapabilities(module) {
	const sha = "a".repeat(64),
		documentSha = "b".repeat(64);
	const input = (id) => ({
		id,
		kind: "source",
		mimeType: "application/octet-stream",
		byteLength: 0,
		sha256: sha,
		attachmentKey: `programmatic-source-sha256-${sha}`,
	});
	const source = {
		version: 1,
		runtime: "html-document",
		code: "",
		documentId: "build.html",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 60,
		seed: 1,
		resources: [
			{
				id: "build.html",
				kind: "document",
				mimeType: "text/html",
				byteLength: 500000,
				sha256: documentSha,
				attachmentKey: `programmatic-sha256-${documentSha}`,
			},
		],
		build: {
			version: 1,
			engine: "three",
			engineVersion: "0.185.1",
			entryFile: "index.html",
			inputs: [input("index.html"), input("empty.css")],
			toolchainLock: input("_rocut/toolchain-lock.json"),
		},
	};
	const cases = [
		{ name: "plain-three-no-declaration", build: {}, accepted: true },
		{
			name: "liquid-object-v1",
			build: { capabilities: ["liquid-object-v1"] },
			accepted: true,
		},
		{
			name: "mixed",
			build: { capabilities: ["particle-surface-v1", "liquid-object-v1"] },
			accepted: false,
		},
		{
			name: "duplicate",
			build: { capabilities: ["liquid-object-v1", "liquid-object-v1"] },
			accepted: false,
		},
		{
			name: "unknown",
			build: { capabilities: ["liquid-object-v2"] },
			accepted: false,
		},
		{
			name: "hyperframes",
			build: {
				engine: "hyperframes",
				engineVersion: "0.8.139",
				capabilities: ["liquid-object-v1"],
			},
			accepted: false,
		},
		{
			name: "remotion",
			build: {
				engine: "remotion",
				engineVersion: "4.0.440",
				compositionId: "Intro",
				capabilities: ["liquid-object-v1"],
			},
			accepted: false,
		},
	];
	return cases.map((testCase) => {
		const mapped = JSON.parse(
			module.resolveProgrammaticFrameJson(
				JSON.stringify({
					source: { ...source, build: { ...source.build, ...testCase.build } },
					clipStart: 0,
					clipDuration: 120000,
					trimStart: 0,
					timelineTime: 0,
				}),
			),
		);
		assert.equal(mapped.frame?.index === 0, testCase.accepted, testCase.name);
		return {
			name: testCase.name,
			expectedAccepted: testCase.accepted,
			actualAccepted: mapped.frame?.index === 0,
			response: mapped,
		};
	});
}
