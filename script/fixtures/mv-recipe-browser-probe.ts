import type {
	MvRecipe,
	MvRole,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";

const equal = (name: string, a: unknown, b: unknown) => {
	if (JSON.stringify(a) !== JSON.stringify(b))
		throw Error(`${name}: ${JSON.stringify({ a, b })}`);
};
const pixel = (image: CanvasImageSource, x: number, y: number) => {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return [...ctx.getImageData(x, y, 1, 1).data];
};
const digest = (image: CanvasImageSource) => {
	const c = new OffscreenCanvas(64, 64),
		ctx = c.getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	return crypto.subtle
		.digest("SHA-256", ctx.getImageData(0, 0, 64, 64).data)
		.then((b) => [...new Uint8Array(b)].join(","));
};
async function asset(
	id: string,
	draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
): Promise<ResolvedProgrammaticResource> {
	const c = new OffscreenCanvas(16, 16);
	draw(c.getContext("2d")!);
	const body = await (
		await c.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return {
		body,
		resource: {
			id,
			kind: "image",
			mimeType: "image/png",
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}
export async function runMvRecipeProbe() {
	const checks: string[] = [];
	const resources = [
		await asset("bg.png", (c) => {
			c.fillStyle = "red";
			c.fillRect(0, 0, 8, 16);
			c.fillStyle = "blue";
			c.fillRect(8, 0, 8, 16);
		}),
		await asset("actor.png", (c) => {
			c.fillStyle = "lime";
			c.fillRect(0, 0, 16, 16);
		}),
	];
	const pose = { x: 0.25, y: 0.5, height: 0.25, rotation: 0, opacity: 1 };
	const recipe: MvRecipe = {
		version: 1,
		root: "shot",
		songStartSeconds: 12.25,
		outputRoles: ["background", "foreground"],
		nodes: [
			{
				id: "shot",
				scene: {
					kind: "illust",
					motion: { startFrame: 0, durationFrames: 24 },
					easing: "linear",
					background: {
						image: "bg.png",
						from: { x: -1, y: 0, zoom: 2 },
						to: { x: 1, y: 0, zoom: 2 },
					},
					sprites: [
						{
							image: "actor.png",
							role: "foreground",
							from: pose,
							to: { ...pose, x: 0.75 },
							anchor: [0.5, 0.5],
							drawingFps: 12,
						},
					],
				},
			},
		],
	};
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 24, denominator: 1 },
		durationFrames: 24,
		seed: 7,
		resources: resources.map((r) => r.resource),
		recipe,
	};
	const frame = (s: ProgrammaticSource, index: number) =>
		resolveProgrammaticFrame({
			source: s,
			clipStart: 120000,
			clipDuration: 120000,
			trimStart: 0,
			timelineTime: 120000 + index * 5000,
		})!;
	const sample = async (
		s: ProgrammaticSource,
		index: number,
		run: (image: ImageBitmap) => Promise<void> | void,
	) => {
		const image = await renderProgrammaticCanvas({
			source: s,
			frame: frame(s, index),
			resources,
		});
		try {
			await run(image);
		} finally {
			image.close();
		}
	};
	const roles = (
		outputRoles: MvRole[],
		post: MvRecipe["post"] = [],
	): ProgrammaticSource => ({
		...source,
		recipe: { ...recipe, outputRoles, post },
	});
	const foreground = roles(["foreground"]),
		background = roles(["background"]);
	const hashes: string[] = [];
	for (const i of [0, 1, 8, 0])
		await sample(foreground, i, async (image) => {
			hashes.push(await digest(image));
			equal(
				"transparent foreground outside subject",
				pixel(image, 63, 63),
				[0, 0, 0, 0],
			);
		});
	equal("12fps actor holds across two 24fps frames", hashes[0], hashes[1]);
	equal("seek repeat", hashes[0], hashes[3]);
	if (hashes[0] === hashes[2]) throw Error("Actor did not move");
	const bgHashes: string[] = [];
	for (const i of [0, 1])
		await sample(background, i, async (image) => {
			bgHashes.push(await digest(image));
		});
	if (bgHashes[0] === bgHashes[1])
		throw Error("Camera incorrectly quantized with actor");
	equal("nonzero song start", frame(source, 6).recipePlan?.songSeconds, 12.5);
	checks.push(
		"real declared images, independent actor/camera sampling, nonzero song clock and reverse seek",
	);
	await sample(
		roles(
			["foreground", "background"],
			[
				{
					roles: ["background"],
					effects: [
						{
							kind: "grade",
							exposure: 0,
							contrast: 1,
							saturation: 0,
							lift: [0, 0, 0],
							gain: [1, 1, 1],
						},
					],
				},
			],
		),
		0,
		(image) => {
			equal(
				"post does not touch foreground",
				pixel(image, 16, 32),
				[0, 255, 0, 255],
			);
			equal(
				"background-only desaturation",
				pixel(image, 8, 8),
				[54, 54, 54, 255],
			);
		},
	);
	const postForeground = roles(
		["foreground"],
		[
			{
				roles: ["foreground"],
				effects: [
					{
						kind: "palette",
						colors: [
							[1, 0, 0, 1],
							[1, 0, 0, 1],
						],
						mix: 1,
					},
					{ kind: "vignette", amount: 0.5 },
					{ kind: "grain", amount: 0.1, fps: 12 },
				],
			},
		],
	);
	const postHashes: string[] = [];
	for (const i of [0, 8, 0])
		await sample(postForeground, i, async (image) => {
			postHashes.push(await digest(image));
			equal("post preserves alpha", pixel(image, 63, 63), [0, 0, 0, 0]);
		});
	equal("seeded finishing repeats", postHashes[0], postHashes[2]);
	checks.push(
		"canonical role order, selected-role grade/ramp/grain/vignette and preserved alpha",
	);
	for (const style of [
		{ kind: "xfade" },
		{ kind: "wipe", angle: 0 },
		{ kind: "iris", center: [0.5, 0.5] },
	] as const) {
		const transition: ProgrammaticSource = {
			...source,
			resources: [],
			recipe: {
				...recipe,
				root: "mix",
				outputRoles: ["foreground"],
				nodes: [
					{
						id: "a",
						scene: { kind: "solid", role: "foreground", color: [1, 0, 0, 1] },
					},
					{
						id: "b",
						scene: { kind: "solid", role: "foreground", color: [0, 0, 0, 0] },
					},
					{
						id: "mix",
						scene: {
							kind: "transition",
							from: "a",
							to: "b",
							span: { startFrame: 4, durationFrames: 8 },
							easing: "linear",
							style,
						},
					},
				],
			},
		};
		const capture = async (i: number) =>
			renderProgrammaticCanvas({
				source: transition,
				frame: frame(transition, i),
			});
		for (const i of [4, 8, 12, 8]) {
			const image = await capture(i);
			try {
				if (i === 4)
					equal("transition starts on A", pixel(image, 8, 8), [255, 0, 0, 255]);
				else if (i === 12)
					equal(
						"transition ends on transparent B",
						pixel(image, 8, 8),
						[0, 0, 0, 0],
					);
				else if (style.kind === "xfade")
					equal(
						"true premultiplied alpha mix",
						pixel(image, 8, 8),
						[255, 0, 0, 128],
					);
				else if (style.kind === "wipe") {
					equal(
						"wipe replaces, not overlays A",
						pixel(image, 8, 8),
						[0, 0, 0, 0],
					);
					equal(
						"wipe retains outgoing region",
						pixel(image, 56, 8),
						[255, 0, 0, 255],
					);
				} else
					equal(
						"iris replaces center with transparent B",
						pixel(image, 32, 32),
						[0, 0, 0, 0],
					);
			} finally {
				image.close();
			}
		}
	}
	checks.push(
		"all three real A/B transitions, transparent incoming content and exact boundaries",
	);
	// A and B are both time-varying images here, not solid test overlays.
	const dual: ProgrammaticSource = {
		...source,
		recipe: {
			...recipe,
			root: "dual",
			nodes: [
				...recipe.nodes,
				{
					id: "later",
					scene: {
						kind: "illust",
						motion: { startFrame: 0, durationFrames: 24 },
						easing: "linear",
						sprites: [
							{
								image: "actor.png",
								role: "foreground",
								from: { ...pose, x: 0.8 },
								to: { ...pose, x: 0.2 },
								anchor: [0.5, 0.5],
							},
						],
					},
				},
				{
					id: "dual",
					scene: {
						kind: "transition",
						from: "shot",
						to: "later",
						span: { startFrame: 0, durationFrames: 24 },
						easing: "linear",
						style: { kind: "xfade" },
					},
				},
			],
		},
	};
	const dualHashes: string[] = [];
	for (const i of [4, 16, 4])
		await sample(dual, i, async (image) => {
			dualHashes.push(await digest(image));
		});
	equal("dual scene reverse seek", dualHashes[0], dualHashes[2]);
	if (dualHashes[0] === dualHashes[1])
		throw Error("Dual scene transition froze its inputs");
	checks.push(
		"time-varying dual illust inputs, no flattened foreground or stale transition canvas",
	);
	equal(
		"no recipe sandbox left",
		document.querySelectorAll("iframe").length,
		0,
	);
	return { passed: true, checks, source: dual, resources };
}
