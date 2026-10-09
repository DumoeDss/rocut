import type {
	ProgrammaticSource,
	ResolvedProgrammaticResource,
} from "@opencut/editor-contracts";
import type { MvTypeCardPlan } from "../../packages/editor-contracts/src/mv-type-card-plan";
import type { createTypeCardReference } from "./mv-type-card-reference-browser";
import type { TypeCardReferenceArgs } from "./mv-type-card-reference-contract";
import {
	typeCardCase,
	typeCardSource,
	TYPE_CARD_START,
	TYPE_CARD_DURATION,
	TYPE_CARD_BEATS,
} from "./mv-type-card-source";
import {
	capture,
	check,
	difference,
	pixels,
	verifyFontResolution,
} from "./mv-type-card-capture";

export type TypeCardOracle = Awaited<
	ReturnType<typeof createTypeCardReference>
>;
export async function originalPixels(
	oracle: TypeCardOracle,
	args: TypeCardReferenceArgs,
	index: number,
	beats: readonly number[] = TYPE_CARD_BEATS,
	fps = 60,
) {
	const result = await oracle.render({
		args,
		time: TYPE_CARD_START + index / fps,
		shotStart: TYPE_CARD_START,
		duration: TYPE_CARD_DURATION,
		beats,
	});
	try {
		return {
			pixels: pixels(result.bitmap, 1920, 1080),
			provenance: result.provenance,
		};
	} finally {
		result.bitmap.close();
		result.canvas.width = result.canvas.height = 1;
	}
}
export function display(
	actual: Uint8ClampedArray,
	expected: Uint8ClampedArray,
	label: string,
) {
	let view = document.getElementById(`comparison-${label.split(" ")[0]}`);
	if (!view) {
		view = document.createElement("div");
		view.id = `comparison-${label.split(" ")[0]}`;
		document.body.append(view);
	}
	view.replaceChildren();
	const heading = document.createElement("h2");
	heading.textContent = `${label}: original / Rocut / difference × 16`;
	view.append(heading);
	const delta = new Uint8ClampedArray(actual.length);
	for (let i = 0; i < delta.length; i++)
		delta[i] =
			i % 4 === 3
				? 255
				: Math.min(255, Math.abs(actual[i]! - expected[i]!) * 16);
	for (const data of [expected, actual, delta]) {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		canvas.style.width = "640px";
		canvas.style.height = "360px";
		canvas
			.getContext("2d")!
			.putImageData(
				new ImageData(new Uint8ClampedArray(data), 1920, 1080),
				0,
				0,
			);
		view.append(canvas);
	}
}
async function expectFailure(action: () => Promise<unknown>, label: string) {
	let failed = false;
	try {
		await action();
	} catch {
		failed = true;
	}
	check(failed, label);
}

export async function verifyTypeCardPixels(
	resources: readonly ResolvedProgrammaticResource[],
	oracle: TypeCardOracle,
) {
	const observations: Record<string, unknown> = {},
		provenance: unknown[] = [];
	const progress = {
		stage: "pixels",
		current: "initializing",
		observations,
		provenance,
	};
	Reflect.set(globalThis, "__mvTypeCardProgress", progress);
	for (const mode of ["quiet", "flicker"] as const) {
		const { args, settings } = typeCardCase(mode),
			source = typeCardSource(
				resources.map((item) => item.resource),
				settings,
			);
		if (mode === "quiet")
			observations.fontResolution = await verifyFontResolution(
				source,
				resources,
			);
		const frames =
			mode === "quiet"
				? [30, 0, 6, 7, 18, 60, 120, 210, 239, 30]
				: [1, 0, 2, 3, 4, 10, 12, 15, 19, 45, 90, 135, 180, 210, 235, 1];
		let repeat: Uint8ClampedArray | undefined;
		for (const index of frames) {
			progress.current = `${mode}/original/${index}`;
			const actual = await capture(source, resources, index),
				expected = await originalPixels(oracle, args, index);
			const error = difference(actual, expected.pixels);
			observations[`${mode}-original-${index}`] = error;
			display(actual, expected.pixels, `${mode} frame ${index}`);
			check(
				error.max <= 2 && error.mae < 0.025,
				`Original ${mode} mismatch ${index}: ${JSON.stringify(error)}`,
			);
			if (index === frames[0]) {
				if (repeat)
					check(
						difference(actual, repeat).max === 0,
						`${mode} reverse/repeated seek nondeterministic`,
					);
				repeat = actual;
			}
			if (index === 0) provenance.push(expected.provenance);
		}
		const base = await capture(source, resources, 120);
		check(
			difference(base, await capture(source, resources, 120, 20)).max === 0,
			`${mode} trim changed source clock`,
		);
		const reversed = structuredClone(source);
		Reflect.set(reversed.recipe!, "root", "reverse");
		(reversed.recipe!.nodes as unknown[]).push({
			id: "reverse",
			scene: {
				kind: "ref",
				input: "card",
				timeMap: [
					{ atFrame: 0, sourceFrame: 239 },
					{ atFrame: 239, sourceFrame: 0 },
				],
			},
		});
		check(
			difference(base, await capture(reversed, resources, 119)).max === 0,
			`${mode} ref did not remap scene clock`,
		);
		const role = structuredClone(source);
		Reflect.set(role.recipe!, "outputRoles", ["subject"]);
		check(
			(await capture(role, resources, 120)).every((v) => v === 0),
			`${mode} excluded role leaked`,
		);
		const wrong = await originalPixels(oracle, args, mode === "quiet" ? 7 : 1);
		check(
			difference(base, wrong.pixels).mae > 0.05,
			`${mode} wrong clock negative control invisible`,
		);
		const controls: readonly [
			string,
			number,
			(plan: MvTypeCardPlan) => void,
		][] =
			mode === "quiet"
				? [
						[
							"blur",
							18,
							(p) => {
								for (const g of p.quiet!.glyphs) Reflect.set(g, "blur", 0);
							},
						],
						["glyphs", 60, (p) => Reflect.set(p.quiet!, "glyphs", [])],
						["rule", 120, (p) => Reflect.set(p.quiet!, "rule", [])],
						["subtitle", 120, (p) => Reflect.set(p.quiet!, "subtitle", null)],
						["grain", 60, (p) => Reflect.set(p, "grain", null)],
					]
				: [
						[
							"rgb",
							1,
							(p) =>
								Reflect.set(
									p.flicker!,
									"text",
									p.flicker!.text.filter((_, i) => i % 3 === 1),
								),
						],
						["scanlines", 1, (p) => Reflect.set(p.flicker!, "erasers", [])],
						[
							"slice-offsets",
							1,
							(p) => {
								for (const band of p.flicker!.bands)
									Reflect.set(band, "destinationRect", [...band.sourceRect]);
							},
						],
						["blocks", 1, (p) => Reflect.set(p.flicker!, "blocks", [])],
						[
							"morse",
							120,
							(p) => {
								Reflect.set(p.flicker!.morse, "elements", []);
								Reflect.set(p.flicker!.morse.label, "opacity", 0);
							},
						],
						["grain", 19, (p) => Reflect.set(p, "grain", null)],
						["idle", 24, (p) => Reflect.set(p.flicker!, "idleScan", null)],
						[
							"flood",
							235,
							(p) => {
								Reflect.set(p, "flood", null);
								Reflect.set(p, "white", null);
							},
						],
						["negative", 235, (p) => Reflect.set(p, "negative", null)],
					];
		for (const [name, index, mutate] of controls) {
			progress.current = `${mode}/negative/${name}/${index}`;
			const error = difference(
				await capture(source, resources, index),
				await capture(source, resources, index, 0, mutate),
			);
			observations[`${mode}-negative-${name}`] = error;
			check(
				error.changed > 100 && error.mae > 0.002,
				`${mode}/${name} negative control invisible: ${JSON.stringify(error)}`,
			);
		}
	}
	const vertical = typeCardCase("quiet", true),
		verticalSource = typeCardSource(
			resources.map((r) => r.resource),
			vertical.settings,
		);
	for (const index of [18, 120, 239]) {
		progress.current = `vertical/original/${index}`;
		const expected = await originalPixels(oracle, vertical.args, index),
			actual = await capture(verticalSource, resources, index),
			error = difference(actual, expected.pixels);
		observations[`vertical-${index}`] = error;
		check(
			error.max <= 2 && error.mae < 0.025,
			`Vertical quiet mismatch ${index}: ${JSON.stringify(error)}`,
		);
	}
	for (const beats of [[12.25], [12.25, 14.25], [12.25, 13.75, 15.25]]) {
		const { args, settings } = typeCardCase("flicker");
		check(settings.mode === "flicker", "Missing flicker settings");
		Reflect.set(settings, "beats", {
			kind: "manual",
			songTicks: beats.map((b) => Math.round(b * 120000)),
		});
		const source = typeCardSource(
			resources.map((r) => r.resource),
			settings,
		);
		for (const index of [0, 180]) {
			progress.current = `beats-${beats.length}/original/${index}`;
			const expected = await originalPixels(oracle, args, index, beats),
				actual = await capture(source, resources, index),
				error = difference(actual, expected.pixels);
			observations[`beats-${beats.length}-${index}`] = error;
			check(
				error.max <= 2 && error.mae < 0.025,
				`${beats.length}-beat layout mismatch ${index}: ${JSON.stringify(error)}`,
			);
		}
	}
	progress.current = "font-resource-failures-and-live-cancellation";
	await verifyResourceFailures(verticalSource, resources);
	progress.current = "pixels-complete";
	return {
		observations,
		provenance,
		checks: [
			"Complete original quiet/flicker 1920x1080 pixels with exact local Japanese/ASCII fonts, horizontal/vertical quiet, 15Hz glitch and 24Hz grain boundaries",
			"Reverse/repeat, trim, ref clocks, roles, one/two/three-beat layout selection, missing-layer and wrong-clock negative controls",
			"Real isolated browser font measurement -> Rust plan; missing/corrupt fonts and live cancellation without leaked iframe",
		],
	};
}

async function verifyResourceFailures(
	source: ProgrammaticSource,
	resources: readonly ResolvedProgrammaticResource[],
) {
	await expectFailure(
		() =>
			capture(
				source,
				resources.filter((r) => r.resource.id !== "mincho"),
				60,
			),
		"Missing font silently fell back",
	);
	const broken = resources.map((r) => ({ ...r, body: r.body.slice(0) }));
	new Uint8Array(broken.find((r) => r.resource.id === "mincho")!.body)[128] ^=
		1;
	await expectFailure(
		() => capture(source, broken, 60),
		"Corrupt font digest silently accepted",
	);
	const count = document.querySelectorAll("iframe").length,
		controller = new AbortController();
	let cleanupObserver = () => {};
	const inserted = new Promise<void>((resolve, reject) => {
		const observer = new MutationObserver(() => {
			if (document.querySelectorAll("iframe").length > count) {
				cleanupObserver();
				resolve();
			}
		});
		const timer = setTimeout(() => {
			cleanupObserver();
			reject(
				Error("Cancellation fixture did not observe a live isolated iframe"),
			);
		}, 2000);
		cleanupObserver = () => {
			clearTimeout(timer);
			observer.disconnect();
		};
		observer.observe(document.body, { childList: true });
	});
	const pending = capture(
		source,
		resources,
		60,
		0,
		undefined,
		controller.signal,
	).then(
		() => false,
		() => true,
	);
	try {
		await Promise.race([
			inserted,
			pending.then(() => {
				throw Error("Cancellation frame settled before iframe insertion");
			}),
		]);
		check(
			document.querySelectorAll("iframe").length > count,
			"Cancellation did not exercise a live isolated iframe",
		);
		controller.abort(
			new DOMException("Dedicated typeCard fixture cancellation", "AbortError"),
		);
		check(await pending, "Cancelled frame completed");
		check(
			document.querySelectorAll("iframe").length === count,
			"Cancelled typeCard left a sandbox iframe",
		);
	} finally {
		cleanupObserver();
		controller.abort(
			new DOMException("TypeCard cancellation fixture cleanup", "AbortError"),
		);
		await pending;
	}
}
