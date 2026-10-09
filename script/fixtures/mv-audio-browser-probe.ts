import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { audioSignal, mvAudioFixture } from "./mv-audio-fixture";
import { checkAudioAttachmentFailures } from "./mv-audio-errors-probe";
import {
	assertPost as assert,
	postAt as at,
	postCapture,
	postPixels,
	postHash,
} from "./mv-post-fixture";

export async function runMvAudioProbe() {
	const { source, resources, scene, analysis, background, spriteSource } =
		await mvAudioFixture();
	const checks: string[] = [];
	let captures = 0;
	const sheet = document.createElement("canvas");
	sheet.id = "mv-audio-contact-sheet";
	sheet.width = 640;
	sheet.height = 4 * 152;
	document.body.append(sheet);
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#182130";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	const label = (row: number, value: string) => {
		ctx.fillStyle = "white";
		ctx.font = "12px sans-serif";
		ctx.fillText(value, 4, row * 152 + 14);
	};
	const capture = async (
		s: ProgrammaticSource,
		frame = 0,
		cell?: [number, number],
		assets = resources,
	) => {
		const image = await postCapture(s, assets, frame);
		captures++;
		try {
			if (cell) {
				const [row, col] = cell,
					x = col * 128,
					y = row * 152 + 20;
				for (let a = 0; a < 128; a += 8)
					for (let b = 0; b < 128; b += 8) {
						ctx.fillStyle = (a + b) % 16 ? "#666" : "#aaa";
						ctx.fillRect(x + a, y + b, 8, 8);
					}
				const scale = 128 / Math.max(image.width, image.height);
				ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
			}
			return postPixels(image, s.width, s.height);
		} finally {
			image.close();
		}
	};
	const rejects = async (
		s: ProgrammaticSource,
		pattern: RegExp,
		assets = resources,
	) => {
		let error = "";
		try {
			await capture(s, 0, undefined, assets);
		} catch (e) {
			error = String(e);
		}
		assert(
			pattern.test(error),
			`Expected ${pattern}, received ${error || "a frame"}`,
		);
		assert(
			document.querySelectorAll("iframe").length === 0,
			"Failed audio render leaked iframe",
		);
	};
	label(0, "song start 0.25s: f0 / f3 / f6 / source held / song continues");
	const f0 = await capture(source, 0, [0, 0]),
		f3 = await capture(source, 3, [0, 1]),
		f6 = await capture(source, 6, [0, 2]);
	assert(
		at(f0, 48, 32).join() === "255,0,0,255" && at(f0, 30, 32)[3] === 0,
		"Song-start envelope did not move sprite",
	);
	assert(
		at(f3, 40, 32)[0] === 255 && at(f3, 50, 32)[3] === 0,
		"Envelope interpolation pixel incorrect",
	);
	assert(
		at(f6, 32, 32)[0] === 255 && at(f6, 48, 32)[3] === 0,
		"Envelope endpoint not rendered",
	);
	const held = await capture(
		spriteSource(audioSignal("source"), true),
		6,
		[0, 3],
	);
	const song = await capture(
		spriteSource(audioSignal("song"), true),
		6,
		[0, 4],
	);
	assert(
		(await postHash(held)) === (await postHash(f0)),
		"Reference did not hold source-clock response",
	);
	assert(
		(await postHash(song)) === (await postHash(f6)),
		"Reference incorrectly held song-clock response",
	);
	await capture(source, 20);
	assert(
		(await postHash(await capture(source, 3))) === (await postHash(f3)),
		"Reverse seek reused stale analysis response",
	);
	checks.push(
		"real analysis bytes through Rust resolver: nonzero song offset, interpolated sprite pixels, source/song reference clocks and reverse seek",
	);

	const camera: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe!,
			outputRoles: ["background"],
			nodes: [
				{
					id: "shot",
					scene: {
						...scene,
						sprites: [],
						background: {
							image: background.resource.id,
							from: { x: 0, y: 0, zoom: 2 },
							to: { x: 0, y: 0, zoom: 2 },
							audio: [{ target: "x", signal: audioSignal(), amount: 1 }],
						},
					},
				},
			],
		},
	};
	label(1, "audio camera f0 / f6 / beat post f0 / f6 / f18");
	const cam0 = await capture(camera, 0, [1, 0]),
		cam6 = await capture(camera, 6, [1, 1]);
	assert(
		at(cam0, 8, 32).join() === "0,255,0,255" &&
			at(cam6, 8, 32).join() === "0,0,255,255",
		"Camera envelope did not pan cover image",
	);
	const post: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe!,
			nodes: [
				{
					id: "shot",
					scene: { kind: "solid", role: "foreground", color: [1, 1, 1, 1] },
				},
			],
			post: [
				{
					roles: ["foreground"],
					effects: [{ kind: "vignette", amount: 0 }],
					audio: [
						{
							effect: 0,
							amount: 1,
							signal: {
								kind: "beatPulse",
								clock: "song",
								missing: "zero",
								decay: Math.LN2,
							},
						},
					],
				},
			],
		},
	};
	const p0 = await capture(post, 0, [1, 2]),
		p6 = await capture(post, 6, [1, 3]),
		p18 = await capture(post, 18, [1, 4]);
	assert(
		at(p6, 0, 0)[0] < at(p0, 0, 0)[0] && at(p0, 0, 0)[0] < at(p18, 0, 0)[0],
		"Nonuniform beat intervals failed to modulate post pixels",
	);
	const ended = {
		...post,
		recipe: { ...post.recipe!, songStartSeconds: 1.25 },
	};
	assert(
		at(await capture(ended), 0, 0).join() === "255,255,255,255",
		"Invented a pulse after final measured beat",
	);
	checks.push(
		"camera pan and post intensity change pixels; variable measured beat intervals and no final-beat extrapolation",
	);

	label(2, "missing vocals -> zero / drawing f2 / f3 / portrait / landscape");
	await rejects(
		spriteSource(audioSignal("song", "vocal_rms")),
		/signal unavailable/,
	);
	const silent = await capture(
		spriteSource(audioSignal("song", "vocal_rms", "zero")),
		0,
		[2, 0],
	);
	assert(
		(await postHash(silent)) === (await postHash(f6)),
		"Missing-zero did not preserve base pose",
	);
	const drawn = spriteSource(audioSignal("source"));
	const drawnScene = drawn.recipe!.nodes[0].scene;
	assert(drawnScene.kind === "illust", "Bad fixture scene");
	if (drawnScene.kind !== "illust") throw Error("Bad fixture scene");
	const quantized: ProgrammaticSource = {
		...drawn,
		recipe: {
			...drawn.recipe!,
			nodes: [
				{
					id: "shot",
					scene: {
						...drawnScene,
						sprites: [{ ...drawnScene.sprites![0], drawingFps: 12 }],
					},
				},
			],
		},
	};
	assert(
		(await postHash(await capture(quantized, 2, [2, 1]))) ===
			(await postHash(await capture(quantized, 3, [2, 2]))),
		"Source envelope ignored drawingFps",
	);
	for (const [col, [width, height]] of [
		[48, 96],
		[96, 48],
	].entries()) {
		const sized = { ...source, width, height },
			bytes = await capture(sized, 3, [2, col + 3]);
		assert(
			(await postHash(bytes)) === (await postHash(await capture(sized, 3))),
			"Non-square audio seek unstable",
		);
	}
	checks.push(
		"explicit missing vocal policy, drawing-clock sampling and deterministic portrait/landscape captures",
	);

	await checkAudioAttachmentFailures({ source, resources, analysis, rejects });
	checks.push(
		"missing/corrupt/invalid-UTF8/wrong-song attachments rejected before sandbox; abort and original timeline/trim retained",
	);
	const exported = {
		...source,
		recipe: { ...source.recipe!, post: post.recipe!.post },
	};
	label(
		3,
		"production export source f4 / f16 (synthetic signal; silent video)",
	);
	await capture(exported, 4, [3, 0]);
	await capture(exported, 16, [3, 1]);
	return { passed: true, checks, captures, source: exported, resources };
}
