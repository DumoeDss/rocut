import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	PINNED_AUDIO_INPUT,
	PINNED_AUDIO_RETURNED,
	PINNED_AUDIO_SEEKS,
} from "./remotion-pinned-audio-source";
import { pinnedAudioProject } from "./remotion-pinned-audio-fixture";
import {
	pinnedAudioExpected,
	pinnedAudioExpectedRms,
} from "./remotion-pinned-audio-oracle";
import {
	withRemotionAudioAnalyzer,
	type NativeAudioObservation,
} from "../programmatic/remotion-audio-analysis";
import { loadProgrammaticResource } from "../programmatic/resources";
import { remotionMetadataJsonSha256 } from "../programmatic/remotion-metadata-receipt";
import { readArchivedRemotionMetadataPolicy } from "../programmatic/remotion-metadata-archive";

const executable = process.env.ROCUT_TEST_BROWSER_EXECUTABLE;
const toolchainDirectory = process.env.ROCUT_ENGINE_TOOLCHAIN_DIR;
const enabled =
	process.env.ROCUT_RUN_REMOTION_PINNED_AUDIO_BROWSER === "1" &&
	executable &&
	toolchainDirectory;

for (const mode of ["stable", "props-drift", "geometry-drift"] as const) {
	test.skipIf(!enabled)(
		`real pinned Remotion native audio: ${mode}`,
		async () => {
			const fixture = await pinnedAudioProject({
				toolchainDirectory: toolchainDirectory!,
				executable: executable!,
				mode: mode,
			});
			try {
				expect(fixture.inspection.compositions).toMatchObject([
					{
						id: "Rocut",
						width: 80,
						height: 48,
						durationFrames: 36,
						props: PINNED_AUDIO_RETURNED,
					},
				]);
				expect(fixture.source).toMatchObject({
					width: 80,
					height: 48,
					durationFrames: 36,
					build: { inputProps: PINNED_AUDIO_INPUT },
				});
				expect(fixture.source.build!.inputProps).not.toHaveProperty(
					"resolvedGain",
				);
				const resource = fixture.source.resources!.find(
					(item) => item.id === fixture.source.documentId,
				)!;
				const [document, lock] = await Promise.all([
					loadProgrammaticResource({ ...fixture.context, resource }),
					loadProgrammaticResource({
						...fixture.context,
						resource: fixture.source.build!.toolchainLock,
					}),
				]);
				const policy = readArchivedRemotionMetadataPolicy({
					source: fixture.source,
					lock: lock.body,
					document: document.body,
				});
				expect(policy).toMatchObject({
					profile: "metadata-pinned-v1",
					adapter: { version: 2 },
					receipt: {
						width: 80,
						height: 48,
						durationFrames: 36,
						returnedProps: PINNED_AUDIO_RETURNED,
						inputPropsSha256: remotionMetadataJsonSha256(PINNED_AUDIO_INPUT),
					},
				});
				const timing = (index: number) => ({
					clipStart: 0,
					clipDuration: 144000,
					trimStart: 0,
					timelineTime: index * 4000,
				});
				const analysis = withRemotionAudioAnalyzer(
					{
						executable: executable!,
						request: { ...timing(12), source: fixture.source },
						resourceStore: fixture.context,
						signal: AbortSignal.timeout(90000),
					},
					async (analyzer) => {
						expect(analyzer.sources).toHaveLength(1);
						expect(analyzer.sources[0].body).toEqual(fixture.wav);
						const expectedId = createHash("sha256")
							.update("audio/wav")
							.update("\0")
							.update(fixture.wav)
							.digest("hex");
						expect(analyzer.sources[0].id).toBe(expectedId);
						let first: NativeAudioObservation[] | undefined;
						for (const index of PINNED_AUDIO_SEEKS) {
							const result = await analyzer.frame(timing(index));
							expect(result.frameIndex).toBe(index);
							const expected = pinnedAudioExpected(index);
							expect(result.assets).toHaveLength(expected.length);
							for (const [position, asset] of result.assets.entries()) {
								expect(asset).toMatchObject({
									type: "audio",
									resourceId: expectedId,
									playbackRate: expected[position].playbackRate,
									toneFrequency: 1,
									audioStreamIndex: 0,
								});
								expect(
									Math.abs(asset.sourceTime - expected[position].sourceTime),
								).toBeLessThan(1e-9);
								expect(
									Math.abs(asset.volume - expected[position].volume),
								).toBeLessThan(1e-9);
								expect(asset.volume).toBeGreaterThan(0);
								expect(
									pinnedAudioExpectedRms({
										wav: analyzer.sources[0].body,
										frame: index,
									}),
								).toBeGreaterThan(0.08);
							}
							if (index === 12) {
								if (first) expect(result.assets).toEqual(first);
								else first = result.assets;
							}
						}
					},
				);
				if (mode === "stable") await analysis;
				else
					await expect(analysis).rejects.toThrow(
						mode === "props-drift" ? "props differ" : "metadata differs",
					);
			} finally {
				await fixture.cleanup();
			}
		},
		120000,
	);
}
