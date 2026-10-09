import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as wasm from "opencut-wasm";
import { variableRateGraphFixture } from "../../../../script/fixtures/hyperframes-variable-rate-production-fixture";
import { nativeAudioWav } from "../../../../script/fixtures/native-audio-fixture";
import { startHost } from "../host";
import { TargetRegistry } from "../target-registry";

test("HTML capability is explicit, authenticated, unavailable without a browser and Rust-validated before launch", async () => {
	const parent = path.resolve(tmpdir());
	const root = await mkdtemp(path.join(parent, "rocut-html-route-"));
	if (
		path.dirname(root) !== parent ||
		!path.basename(root).startsWith("rocut-html-route-")
	)
		throw Error("Invalid route fixture cleanup root");
	const options = {
		projectRoot: path.join(root, "project"),
		registry: new TargetRegistry(path.join(root, "registry")),
	};
	let host = await startHost({ ...options, htmlBrowserExecutable: "" });
	const api = (route: string) => new URL(`api/${route}`, host.editorUrl);
	try {
		const catalog = await (await fetch(api("editing/catalog"))).json();
		expect(catalog.programmatic.runtimes).toEqual(["canvas-worker"]);
		expect(catalog.programmatic.htmlDocument.configured).toBe(false);
		const context = await (await fetch(api("context"))).json();
		expect(context.programmaticNativeAudio.configured).toBe(false);
		expect(context.programmaticNativeAudio.hyperframesGraph.configured).toBe(
			false,
		);
		expect(context.programmaticNativeAudio.hyperframesGraph.fxAutomation).toBe(
			"native-parameters-and-preset-mix-v1",
		);
		expect(context.programmaticNativeAudio.hyperframesGraph.timing).toEqual({
			selection: "source.audio.timing",
			default: "sample-aligned",
			optionalModes: ["native-exporter"],
			nativeExporter: "final-track-trim-and-ms-placement-v1",
		});
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).toContain("webaudio-fractional-start-phase");
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).not.toContain("fx-automation");
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).not.toContain("variable-rate-loop");
		expect(
			context.programmaticNativeAudio.hyperframesGraph.unsupported,
		).not.toContain("variable-rate");
		const rate = {
			target: "rate" as const,
			points: [
				{ t: 0, v: 0.5 },
				{ t: 0.2, v: 2 },
			],
		};
		const fixture = variableRateGraphFixture(
			nativeAudioWav({ seconds: 4, sample: () => 0 }),
			"audio/wav",
			{
				id: "capability-rate",
				channels: 2,
				sampleRate: 48000,
				duration: 0.2,
				mediaStart: 0.1,
				rate,
			},
			rate,
			44100,
		);
		const resolve = () =>
			JSON.parse(
				wasm.resolveHyperframesAudioExecutionPlanJson(
					JSON.stringify(fixture.request),
				),
			);
		expect(resolve().error).toBeUndefined();
		expect(
			resolve().plan.decodedSources[0].ratePreparation.nativeSampleRate,
		).toBe(48000);
		fixture.request.graph.snapshot.tracks[0].native.loop = true;
		fixture.request.graph.snapshot.tracks[0].native.sourceDuration = 0.35;
		expect(resolve().error).toBeUndefined();
		expect(
			resolve().plan.decodedSources[0].ratePreparation.sourceLoop.periodFrames,
		).toBe(12000);
		expect(resolve().plan.tracks[0].loop).toBe(false);
		fixture.request.graph.snapshot.tracks[0].native.sourceDuration += 1 / 48000;
		expect(resolve().error).toContain("fractional-sample");
		expect(
			(
				await fetch(api("programmatic/audio/identity"), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(503);
		expect(
			(
				await fetch(
					new URL("/wrong/api/programmatic/audio/identity", host.editorUrl),
					{ method: "POST", body: "{}" },
				)
			).status,
		).toBe(401);
		expect(
			(await fetch(api("programmatic/audio"), { method: "POST", body: "{}" }))
				.status,
		).toBe(503);
		expect(
			(
				await fetch(new URL("/wrong/api/programmatic/audio", host.editorUrl), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(401);
		expect(
			(await fetch(api("programmatic/frame"), { method: "POST", body: "{}" }))
				.status,
		).toBe(503);
		expect(
			(
				await fetch(new URL("/wrong/api/programmatic/frame", host.editorUrl), {
					method: "POST",
					body: "{}",
				})
			).status,
		).toBe(401);
		await host.close();
		// A real executable which is NOT Chromium: all inputs below must fail before spawn.
		host = await startHost({
			...options,
			htmlBrowserExecutable: process.execPath,
		});
		const enabled = await (await fetch(api("editing/catalog"))).json();
		expect(enabled.programmatic.htmlDocument.availability).toBe(
			"configured-not-health-probed",
		);
		for (const body of [
			"{",
			"null",
			"{}",
			JSON.stringify({ source: { runtime: "html-document", width: 999999 } }),
		]) {
			const result = await fetch(api("programmatic/frame"), {
				method: "POST",
				body,
			});
			expect(result.status).toBe(422);
		}
	} finally {
		await host.close();
		await rm(root, { recursive: true, force: true });
	}
});
