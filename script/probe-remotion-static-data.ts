import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { renderHtmlPng } from "../apps/cli/src/programmatic/html-rasterizer";
import {
	prepareStaticDataFixture,
	staticData,
} from "./fixtures/remotion-static-data-fixture";
import type { ProgrammaticSource } from "@opencut/editor-contracts";

const toolchain = process.env.ROCUT_TEST_REMOTION_TOOLCHAIN!;
const ffmpeg = process.env.ROCUT_TEST_FFMPEG!;
const wasm = process.env.ROCUT_TEST_WASM_DIRECTORY!;
const require = createRequire(
	new URL("../apps/vite-example/package.json", import.meta.url),
);
const { chromium } = await import(
	pathToFileURL(require.resolve("@playwright/test")).href
);
if (![toolchain, ffmpeg, wasm].every((path) => path && isAbsolute(path)))
	throw Error(
		"Provide absolute private Remotion toolchain, WASM and FFmpeg paths",
	);
const artifacts = await mkdtemp(join(tmpdir(), "rocut-remotion-static-data-"));
console.log(JSON.stringify({ artifacts }));
const hash = (bytes: Uint8Array | string) =>
	createHash("sha256").update(bytes).digest("hex");
const namedInputs = [
	"script/probe-remotion-static-data.ts",
	"script/fixtures/remotion-static-data.tsx",
	"script/fixtures/remotion-static-data-config.json",
	"script/fixtures/remotion-static-data-fixture.ts",
	"apps/cli/src/programmatic/engines/remotion-compiler-child.ts",
	"apps/cli/src/programmatic/engines/build-revision.ts",
	"apps/cli/src/programmatic/engines/compile-project.ts",
	"apps/cli/src/programmatic/engines/remotion-driver.ts",
	"apps/cli/src/programmatic/engines/toolchain.ts",
	"apps/cli/src/programmatic/html-document.ts",
];
const identity = () =>
	Promise.all(
		namedInputs.map(async (path) => ({
			path,
			sha256: hash(await readFile(path)),
		})),
	);
const inputsBefore = await identity();
const observations: {
	label: string;
	frame: number;
	pngSha256: string;
	rgbaSha256: string;
}[] = [];
const failures: { mode: string; error: string }[] = [];
try {
	const fixture = await prepareStaticDataFixture(artifacts, toolchain);
	const { source } = await fixture.compile("compile", fixture.specification);
	const render = async (
		value: ProgrammaticSource,
		frame: number,
		label: string,
		palette = [
			[255, 0, 0],
			[0, 255, 0],
			[0, 0, 255],
		],
	) => {
		const png = await renderHtmlPng({
			executable: chromium.executablePath(),
			resourceStore: fixture.context,
			signal: AbortSignal.timeout(20000),
			request: {
				source: value,
				clipStart: 0,
				clipDuration: 12000,
				trimStart: 0,
				timelineTime: frame * 4000,
			},
		});
		await writeFile(join(artifacts, `${label}.png`), png, { flag: "wx" });
		const decoded = execFileSync(
			ffmpeg,
			[
				"-v",
				"error",
				"-f",
				"image2pipe",
				"-i",
				"pipe:0",
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgba",
				"pipe:1",
			],
			{
				input: png,
				windowsHide: true,
				timeout: 15000,
				maxBuffer: 65536,
			},
		);
		assert.equal(decoded.length, 32 * 32 * 4);
		const expected = [...palette[frame]!, 255];
		for (let i = 0; i < decoded.length; i++)
			assert.equal(decoded[i], expected[i % 4], `${label}: RGBA channel ${i}`);
		const row = {
			label,
			frame,
			pngSha256: hash(png),
			rgbaSha256: hash(decoded),
		};
		observations.push(row);
		return row;
	};
	for (const frame of [2, 0, 1, 0])
		await render(source, frame, `original-${observations.length}`);
	assert.equal(observations[1]!.rgbaSha256, observations[3]!.rgbaSha256);
	await rename(
		fixture.specification.sourceDirectory,
		join(artifacts, "author-removed"),
	);
	const rebuilt = await fixture.compile(
		"rebuild",
		JSON.parse(JSON.stringify(source)),
	);
	assert.equal(rebuilt.reusedDocument, true);
	assert.deepEqual(rebuilt.source, source);
	assert.equal(
		(await render(rebuilt.source, 1, "archive-rebuilt")).rgbaSha256,
		observations[2]!.rgbaSha256,
	);
	const changedData = JSON.stringify({
		...JSON.parse(staticData["data/palette.json"]),
		colors: ["#00ffff", "#ff00ff", "#ffff00"],
	});
	const revised = await fixture.compile("revise", {
		source,
		changes: [{ id: "public/data/palette.json", code: changedData }],
		inputProps: {
			expected: { ...staticData, "data/palette.json": changedData },
		},
	});
	await render(revised.source, 1, "archive-revised", [
		[0, 255, 255],
		[255, 0, 255],
		[255, 255, 0],
	]);
	for (const [mode, message] of [
		["missing", /Undeclared Remotion static file/],
		["network", /fetch|CSP|external resource/i],
	] as const) {
		const bad = await fixture.compile("revise", {
			source,
			changes: [],
			inputProps: { expected: staticData, mode },
		});
		await assert.rejects(async () => {
			try {
				await render(bad.source, 0, mode);
			} catch (error) {
				failures.push({ mode, error: String(error) });
				throw error;
			}
		}, message);
	}
	await render(rebuilt.source, 0, "after-failed-requests");
	const inputsAfter = await identity();
	assert.deepEqual(
		inputsAfter,
		inputsBefore,
		"Inputs changed during verification",
	);
	const report = {
		passed: true,
		scope:
			"Production compile/archive/revise -> native Remotion getStaticFiles/staticFile/fetch -> isolated Chromium PNG -> independent FFmpeg RGBA; no installed Electron or encoded-video claim",
		inputs: inputsBefore,
		wasmSha256: hash(await readFile(join(wasm, "opencut_wasm_bg.wasm"))),
		documentSha256: source.resources!.find(
			(resource) => resource.id === source.documentId,
		)!.sha256,
		archivedInputIdentities: source.build!.inputs,
		toolchainLock: source.build!.toolchainLock,
		rebuiltPixelsExact: true,
		fullFramePixelTolerance: 0,
		observations,
		negativeControls: failures,
	};
	await writeFile(
		join(artifacts, "verification.json"),
		JSON.stringify(report, null, 2),
		{ flag: "wx" },
	);
	console.log(
		JSON.stringify({
			artifacts,
			passed: true,
			observations: observations.length,
			negativeControls: failures.length,
		}),
	);
} catch (error) {
	await writeFile(
		join(artifacts, "failure.json"),
		JSON.stringify(
			{
				passed: false,
				error: String(error),
				inputsBefore,
				observations,
				failures,
			},
			null,
			2,
		),
		{ flag: "wx" },
	);
	throw error;
}
