import { expect, test } from "bun:test";
import * as wasm from "opencut-wasm";
import { withHyperframesAudioGraphAnalyzer } from "../programmatic/hyperframes-audio-analysis";
import type { HyperframesAudioGraphSnapshot } from "../programmatic/hyperframes-audio-graph-types";
import {
	lifecycleTiming,
	withLifecycleProject,
} from "../../../../script/fixtures/hyperframes-audio-analysis-lifecycle-project";

const toolchain = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
test.skipIf(!toolchain)(
	"real native seek observes a clip entirely between 25fps picture frames",
	async () => {
		await withLifecycleProject(
			toolchain!,
			async ({ source, options }) => {
				await withHyperframesAudioGraphAnalyzer(options, async (analyzer) => {
					let baseline!: HyperframesAudioGraphSnapshot;
					for (let index = 0; index < source.durationFrames; index++) {
						const result = await analyzer.frame(lifecycleTiming(source, index));
						const snapshot = result.snapshot as HyperframesAudioGraphSnapshot;
						expect(snapshot.time).toBe(index / 25);
						expect(snapshot.tracks).toHaveLength(1);
						expect(snapshot.tracks[0].resolvedAuthorGain).toEqual({
							state: "unobserved",
						});
						if (index === 0) baseline = snapshot;
					}
					const graph = {
						version: 1,
						semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
						frameRate: source.frameRate,
						sampleRate: 48000,
						firstFrame: 0,
						frameCount: source.durationFrames,
						durationFrames: source.durationFrames,
						sources: analyzer.sources.map(({ id, mimeType, body }) => ({
							id,
							mimeType,
							byteLength: body.length,
						})),
						snapshot: baseline,
					};
					const discovery = JSON.parse(
						wasm.resolveHyperframesAudioDiscoveryJson(JSON.stringify(graph)),
					);
					expect(discovery.error).toBeUndefined();
					expect(discovery.plan.seeks).toHaveLength(1);
					const seek = discovery.plan.seeks[0] as {
						time: number;
						instanceIds: string[];
					};
					expect(seek.time).toBeCloseTo(0.102, 14);
					expect(seek.instanceIds).toEqual([baseline.tracks[0].instanceId]);
					const result = await analyzer.seek(graph, seek);
					expect(result.time).toBe(seek.time);
					const snapshot = result.snapshot as HyperframesAudioGraphSnapshot;
					expect(snapshot.time).toBe(seek.time);
					expect(snapshot.tracks[0].observedAt).toBe(seek.time);
					expect(snapshot.tracks[0].native.start).toBeCloseTo(0.101, 14);
					expect(snapshot.tracks[0].native.end).toBeCloseTo(0.103, 14);
					expect(snapshot.tracks[0].resolvedAuthorGain).toMatchObject({
						state: "observed",
						observedAt: seek.time,
						source: "normalized-volume-lane",
						points: [
							{ t: 0, v: 0.25 },
							{ t: 0.002, v: 0.75 },
						],
					});
					const gain = snapshot.tracks[0].resolvedAuthorGain;
					if (gain.state !== "observed")
						throw Error("Expected a real native gain observation");
					expect(gain.gainBeforeFades).toBeCloseTo(0.5, 10);
					// Browser facts remain untrusted even after a validated seek.
					const admitted = JSON.parse(
						wasm.resolveHyperframesAudioGraphJson(
							JSON.stringify({ ...graph, snapshot }),
						),
					);
					expect(admitted.error).toBeUndefined();
					// Serialized collection must cover mixed seek/frame operations, too.
					const pending = analyzer.seek(graph, seek);
					await expect(
						analyzer.frame(lifecycleTiming(source, 3)),
					).rejects.toThrow("serially");
					await expect(analyzer.seek(graph, seek)).rejects.toThrow("serially");
					expect((await pending).snapshot).toEqual(snapshot);
					await expect(
						analyzer.seek(graph, { ...seek, time: 0.32 }),
					).rejects.toThrow("inside the composition");
					await expect(
						analyzer.seek(graph, { ...seek, time: Number.NaN }),
					).rejects.toThrow("native seek JSON");
					await expect(
						analyzer.seek(graph, {
							...seek,
							instanceIds: ["missing-instance"],
						}),
					).rejects.toThrow("instance identities");
					const foreign = structuredClone(graph);
					foreign.snapshot.tracks[0].resourceId = "c".repeat(64);
					foreign.sources[0].id = "c".repeat(64);
					await expect(analyzer.seek(foreign, seek)).rejects.toThrow(
						"unadmitted source",
					);
					// Failed admission never poisons the collector's guard or its next target.
					expect((await analyzer.seek(graph, seek)).snapshot).toEqual(snapshot);
				});
			},
			new URL(
				"../../../../script/fixtures/hyperframes-audio-native-seek.html",
				import.meta.url,
			),
		);
	},
	40000,
);
