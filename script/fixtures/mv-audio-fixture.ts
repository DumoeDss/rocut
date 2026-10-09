import { prepareMvAudioJson } from "opencut-wasm";
import type {
	MvAudioSignal,
	MvScene,
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import { nativeAudioFixture } from "./mv-audio-native-fixture";
import { postResource } from "./mv-post-fixture";

export const audioSignal = (
	clock: "song" | "source" = "song",
	channel: "mix_rms" | "vocal_rms" = "mix_rms",
	missing: "error" | "zero" = "error",
): MvAudioSignal => ({ kind: "envelope", channel, clock, missing });

export async function audioResource(
	body: ArrayBuffer,
): Promise<ResolvedProgrammaticResource> {
	const sha256 = [
		...new Uint8Array(await crypto.subtle.digest("SHA-256", body)),
	]
		.map((v) => v.toString(16).padStart(2, "0"))
		.join("");
	return {
		body,
		resource: {
			id: "analysis/song.json",
			kind: "analysis",
			mimeType: "application/json",
			byteLength: body.byteLength,
			sha256,
			attachmentKey: `programmatic-sha256-${sha256}`,
		},
	};
}

export async function mvAudioFixture() {
	const native = await nativeAudioFixture();
	const result: { data?: unknown; error?: string } = JSON.parse(
		prepareMvAudioJson(JSON.stringify(native.input)),
	);
	if (result.error || !result.data)
		throw Error(result.error ?? "Missing prepared audio");
	const analysis = await audioResource(
		new TextEncoder().encode(JSON.stringify(result.data)).buffer,
	);
	const image = await postResource("subject.png", (c) => {
		c.fillStyle = "red";
		c.fillRect(24, 8, 16, 48);
	});
	const background = await postResource("background.png", (c) => {
		c.fillStyle = "blue";
		c.fillRect(0, 0, 32, 64);
		c.fillStyle = "lime";
		c.fillRect(32, 0, 32, 64);
	});
	const resources = [image, background, analysis];
	const pose = { x: 0.5, y: 0.5, height: 1, rotation: 0, opacity: 1 };
	const scene: Extract<MvScene, { kind: "illust" }> = {
		kind: "illust",
		motion: { startFrame: 0, durationFrames: 24 },
		easing: "linear",
		sprites: [
			{
				image: image.resource.id,
				role: "foreground",
				from: pose,
				to: pose,
				anchor: [0.5, 0.5],
				audio: [{ target: "x", signal: audioSignal(), amount: 0.25 }],
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
		recipe: {
			version: 1,
			root: "shot",
			songStartSeconds: 0.25,
			outputRoles: ["foreground"],
			audio: {
				resource: analysis.resource.id,
				inputSha256: native.expectedAudioSha256,
			},
			nodes: [{ id: "shot", scene }],
		},
	};
	const spriteSource = (
		signal: MvAudioSignal,
		held = false,
	): ProgrammaticSource => ({
		...source,
		recipe: {
			...source.recipe!,
			root: held ? "held" : "shot",
			nodes: [
				{
					id: "shot",
					scene: {
						...scene,
						sprites: [
							{
								...scene.sprites![0],
								audio: [{ target: "x", signal, amount: 0.25 }],
							},
						],
					},
				},
				...(held
					? [
							{
								id: "held",
								scene: {
									kind: "ref" as const,
									input: "shot",
									timeMap: [{ atFrame: 0, sourceFrame: 0 }],
								},
							},
						]
					: []),
			],
		},
	});
	return { source, resources, scene, analysis, background, spriteSource };
}
