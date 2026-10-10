/** Prepared gate only. Requires explicit admitted real artwork and a compiled
 * private CPU producer; never silently substitutes synthetic/bundled art. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { chromium } from "../browser-probe-toolchain.mjs";

test("complete Road main and foreground native pixels match unchanged original", async () => {
	const root = process.env.MV_ROAD_ORIGINAL_ROOT;
	const path = process.env.MV_ROAD_NATIVE_CHARACTER_PATH;
	const executable = process.env.MV_ROAD_CPU_EXECUTABLE;
	assert.ok(
		root && path && executable,
		"Explicit original root, real admitted PNG and private CPU executable required",
	);
	const bytes = readFileSync(path);
	assert.ok(bytes.length > 0 && bytes.length <= 16 * 1024 * 1024);
	assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	const resource = {
		id: "runner.png",
		kind: "image",
		attachmentKey: `programmatic-sha256-${sha256}`,
		mimeType: "image/png",
		byteLength: bytes.length,
		sha256,
	};
	const interpreter = readFileSync(
		new URL(
			"../../packages/editor-classic/src/services/renderer/programmatic/mv-road-renderer.ts",
			import.meta.url,
		),
		"utf8",
	);
	const renderer = new Function(
		interpreter.replace("export const", "const") +
			";return MV_ROAD_RENDERER_SOURCE;",
	)();
	const sources = Object.fromEntries(
		["util", "assets", "draw"].map((key) => [
			key,
			readFileSync(`${root}/core/${key}.js`, "utf8"),
		]),
	);
	sources.scene = readFileSync(`${root}/scenes/memory.js`, "utf8");
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent(
			'<base href="http://road.fixture/engine/index.html">',
		);
		const dimensions = await page.evaluate(async (base64) => {
			const data = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
			window.roadNativeCharacter = await createImageBitmap(
				new Blob([data], { type: "image/png" }),
				{ premultiplyAlpha: "default", colorSpaceConversion: "none" },
			);
			return {
				width: window.roadNativeCharacter.width,
				height: window.roadNativeCharacter.height,
			};
		}, bytes.toString("base64"));
		const run = spawnSync(executable, [], {
			maxBuffer: 64 * 1024 * 1024,
			env: {
				...process.env,
				TEMP: "E:/Elftia-private-tests/rocut-ink-20261009-F0U4dW/temp",
				TMP: "E:/Elftia-private-tests/rocut-ink-20261009-F0U4dW/temp",
				MV_ROAD_CPU_NATIVE_FACT: JSON.stringify({ resource, ...dimensions }),
			},
		});
		assert.equal(run.status, 0, run.stderr.toString());
		const rows = JSON.parse(run.stdout);
		for (const row of rows) {
			assert.deepEqual(
				row.character,
				{ resource, ...dimensions },
				"Native decoder/source identity must reach Rust producer",
			);
			const result = await page.evaluate(
				({ row, sources, renderer }) => {
					const make = (width = 1920, height = 1080) => {
						const canvas = document.createElement("canvas");
						canvas.width = width;
						canvas.height = height;
						return canvas;
					};
					window.Z = {};
					for (const key of ["util", "assets", "draw", "scene"])
						(0, eval)(sources[key]);
					const Z = window.Z;
					Z.loaded.set("runner.png", window.roadNativeCharacter);
					Z.scratch = [make(), make(), make()];
					Z.audio = {
						stops: row.stops.map((start) => ({ start })),
						downbeats: row.downbeats,
					};
					const expected = make().getContext("2d"),
						expectedFg = make().getContext("2d");
					Z.SCENES.road.draw(expected, {
						t: row.t,
						args: row.args,
						shot: { t0: row.start, t1: row.end },
						clock: Z.makeClock(
							Array.from({ length: 401 }, (_, i) => i * 0.5),
							120,
						),
						fg: expectedFg,
					});
					const actual = make().getContext("2d"),
						actualFg = make().getContext("2d");
					const draw = new Function(`${renderer};return drawMvRoad;`)();
					draw(
						actual,
						row.plan,
						{
							descriptor: () => ({ kind: "image" }),
							image: () => window.roadNativeCharacter,
						},
						make,
						actualFg,
					);
					const compare = (a, b) => {
						const x = a.getImageData(0, 0, 1920, 1080).data,
							y = b.getImageData(0, 0, 1920, 1080).data;
						let mismatches = 0,
							maximumDifference = 0;
						for (let i = 0; i < x.length; i++)
							if (x[i] !== y[i]) {
								mismatches++;
								maximumDifference = Math.max(
									maximumDifference,
									Math.abs(x[i] - y[i]),
								);
							}
						return { mismatches, maximumDifference };
					};
					return {
						main: compare(actual, expected),
						foreground: compare(actualFg, expectedFg),
					};
				},
				{ row, sources, renderer },
			);
			assert.equal(
				result.main.mismatches,
				0,
				JSON.stringify({ mode: row.args.mode, t: row.t, ...result }),
			);
			assert.equal(
				result.foreground.mismatches,
				0,
				JSON.stringify({ mode: row.args.mode, t: row.t, ...result }),
			);
		}
	} finally {
		await browser.close();
	}
});
