import { expect, test } from "bun:test";
import { isAbsolute } from "node:path";
import type { ProgrammaticResource } from "@opencut/editor-contracts";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { emberAnalysis, emberAudioFacts } from "./mv-ember-audio";
import { emberCase, emberSource } from "./mv-ember-source";
import type { EmberAudioFacts } from "./mv-ember-reference-contract";

// Run with isolated-web-wasm-preload.mjs and an absolute private build directory.
// These exercise actual import/frame exports, not mocked scene business logic.
const isolated = process.env.ROCUT_TEST_WASM_DIRECTORY;
if (!isolated || !isAbsolute(isolated))
	throw Error(
		"Ember audio-boundary tests require a private ROCUT_TEST_WASM_DIRECTORY",
	);

async function imported(facts: EmberAudioFacts) {
	const attachment = await emberAnalysis(facts);
	const data: unknown = JSON.parse(
		new TextDecoder("utf-8", { fatal: true }).decode(attachment.body),
	);
	if (
		!data ||
		typeof data !== "object" ||
		!("beats" in data) ||
		!Array.isArray(data.beats) ||
		!data.beats.every(
			(beat): beat is number =>
				typeof beat === "number" && Number.isSafeInteger(beat),
		)
	)
		throw Error("Actual importer did not return integer beat ticks");
	return { attachment, data, beats: data.beats };
}

test("authored Ember base and sparse beats are identical before and after the real tick importer", async () => {
	for (const options of [{}, { sparse: true }]) {
		const facts = emberAudioFacts(options),
			result = await imported(facts);
		expect(result.beats.map((tick) => tick / 120000)).toEqual([...facts.beats]);
		for (const [index, beat] of facts.beats.entries())
			expect(beat).toBe(
				((options.sparse ? index + 1 : index) * 55200) / 120000,
			);
	}
	expect(emberAudioFacts().beats[24]).toBe(11.04);
});

test("raw repeated multiplication is a rejected common-input assumption at the exact black boundary", async () => {
	const canonical = emberAudioFacts();
	const raw: EmberAudioFacts = {
		...canonical,
		beats: Array.from({ length: 65 }, (_, index) => index * 0.46),
	};
	const canonicalImport = await imported(canonical),
		rawImport = await imported(raw);
	const boundary = 1324800 / 120000;
	expect(raw.beats[24]).toBe(11.040000000000001);
	expect(raw.beats[24]).not.toBe(canonical.beats[24]);
	expect(rawImport.beats).toEqual(canonicalImport.beats);
	expect(canonicalImport.beats[24]).toBe(1324800);
	// Original JS compares supplied seconds; import represents times in ticks.
	// This scalar negative control deliberately does not pretend to run intro.js.
	// The unchanged browser original-pixel sample ignite-boundary-494 does that.
	expect(boundary >= raw.beats[24]!).toBe(false);
	expect(boundary >= canonical.beats[24]!).toBe(true);
	expect(boundary >= rawImport.beats[24]! / 120000).toBe(true);
});

test("real frame API keeps 493 lit and turns exactly 494/495 black with both imported and manual canonical beats", async () => {
	const facts = emberAudioFacts(),
		result = await imported(facts);
	const fontSha = "d".repeat(64);
	const font: ProgrammaticResource = {
		id: "ember-dot.ttf",
		kind: "font",
		mimeType: "font/ttf",
		byteLength: 100,
		sha256: fontSha,
		attachmentKey: `programmatic-sha256-${fontSha}`,
		font: {
			family: "Controlled transport fixture",
			weight: 400,
			style: "normal",
		},
	};
	const authored = emberCase("ignite", facts);
	if (authored.settings.mode !== "ignite")
		throw Error("Expected ignite fixture");
	const plans: unknown[][] = [];
	for (const beats of [
		authored.settings.beats,
		{ kind: "analysis" as const },
	]) {
		const source = emberSource(
			{ ...authored, settings: { ...authored.settings, beats } },
			[font, result.attachment.resource],
			{ numerator: 100, denominator: 1 },
		);
		const request = {
			source,
			clipStart: 0,
			clipDuration: 1,
			trimStart: 493 * 1200,
			timelineTime: 0,
			analysis: result.data,
		};
		const discovered = resolveProgrammaticFrame(request);
		if (!discovered?.fontMetricRequests?.length)
			throw Error("Expected real HUD advance requests");
		// Only controlled platform transport facts: this test is about the clock,
		// not font rasterization. Actual font/PNG pixels are tested in the browser.
		const fontMetrics = discovered.fontMetricRequests.map((item) => ({
			resource: item.resource,
			glyphs: [],
			advances: (item.advances ?? []).map((advance) => ({
				...advance,
				width: [...advance.text].length * 11.25,
			})),
		}));
		const frames = [493, 494, 495].map((index) => {
			const frame = resolveProgrammaticFrame({
				...request,
				trimStart: index * 1200,
				fontMetrics,
			});
			if (!frame?.recipePlan || frame.recipePlan.root.kind !== "ember")
				throw Error("Missing complete Ember frame");
			expect(frame.index).toBe(index);
			expect(frame.recipePlan.songSeconds).toBe(
				(732000 + index * 1200) / 120000,
			);
			return frame.recipePlan.root.data.commands;
		});
		expect(frames[0]!.length).toBeGreaterThan(1);
		expect(frames[0]!.some((command) => command.kind === "text")).toBe(true);
		for (const commands of frames.slice(1)) {
			expect(commands).toHaveLength(1);
			expect(commands[0]).toMatchObject({
				kind: "rect",
				rect: [0, 0, 1920, 1080],
				paint: {
					kind: "fill",
					composite: "source-over",
					opacity: 1,
					style: { kind: "solid", color: [0, 0, 0, 1] },
				},
			});
		}
		plans.push(frames);
	}
	expect(plans[0]).toEqual(plans[1]);
});
