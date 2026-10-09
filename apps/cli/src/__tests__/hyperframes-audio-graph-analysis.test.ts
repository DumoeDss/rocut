import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { FileProjectStore } from "../file-store";
import { compileProgrammaticProject } from "../programmatic/engines/compile-project";
import {
	withHyperframesAudioAnalyzer,
	withHyperframesAudioGraphAnalyzer,
} from "../programmatic/hyperframes-audio-analysis";
import type { HyperframesAudioGraphSnapshot } from "../programmatic/hyperframes-audio-graph-types";
import { nativeAudioWav } from "../../../../script/fixtures/native-audio-fixture";

const toolchainDirectory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
const timing = (source: ProgrammaticSource, index: number) => ({
	source,
	clipStart: 0,
	clipDuration: source.durationFrames * 4800,
	trimStart: 0,
	timelineTime: index * 4800,
});

test.skipIf(!toolchainDirectory)(
	"real archived native runtime reaches the Host graph analyzer without enabling legacy graph rendering",
	async () => {
		const parent = resolve(tmpdir());
		const staging = await mkdtemp(join(parent, "rocut-hf-graph-analysis-"));
		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(Error("Graph analyzer test timed out")),
			45000,
		);
		try {
			const sourceDirectory = join(staging, "author");
			await mkdir(sourceDirectory);
			await copyFile(
				fileURLToPath(
					new URL(
						"../../../../script/fixtures/hyperframes-audio-graph-collector.html",
						import.meta.url,
					),
				),
				join(sourceDirectory, "source.html"),
			);
			await copyFile(
				join(toolchainDirectory!, "node_modules/gsap/dist/gsap.min.js"),
				join(sourceDirectory, "gsap.js"),
			);
			await writeFile(
				join(sourceDirectory, "tone.wav"),
				nativeAudioWav({ seconds: 0.16, sample: () => 0.125 }),
				{ flag: "wx" },
			);
			const resourceStore = {
				store: new FileProjectStore({
					root: join(staging, "store"),
					schemaVersion: 1,
				}),
				projectId: "graph-analyzer",
			};
			const { source } = await compileProgrammaticProject({
				action: "compile",
				toolchainDirectory: toolchainDirectory!,
				context: resourceStore,
				signal: controller.signal,
				enqueue: (task) => task(),
				input: {
					version: 1,
					engine: "hyperframes",
					sourceDirectory,
					entryFile: "source.html",
					files: ["source.html", "gsap.js", "tone.wav"],
					width: 64,
					height: 64,
					frameRate: { numerator: 25, denominator: 1 },
					durationFrames: 18,
					seed: 7,
					audio: { version: 1, mode: "native" },
				},
			});
			const require = createRequire(
				new URL("../../../vite-example/package.json", import.meta.url),
			);
			const { chromium } = await import(
				pathToFileURL(require.resolve("@playwright/test")).href
			);
			const options = {
				executable: chromium.executablePath(),
				request: timing(source, 0),
				resourceStore,
				signal: controller.signal,
			};
			await expect(
				withHyperframesAudioAnalyzer(options, (analyzer) =>
					analyzer.frame(timing(source, 0)),
				),
			).rejects.toThrow("native audio graph adapter");
			await withHyperframesAudioGraphAnalyzer(options, async (analyzer) => {
				expect(analyzer.sources).toHaveLength(1);
				const observations: HyperframesAudioGraphSnapshot[] = [];
				for (const index of [0, 3, 9, 0]) {
					const result = await analyzer.frame(timing(source, index));
					expect(result.frameIndex).toBe(index);
					const snapshot = result.snapshot as HyperframesAudioGraphSnapshot;
					expect(snapshot).toMatchObject({
						version: 1,
						nativeVersion: "0.8.139",
						time: index / 25,
					});
					expect(snapshot.tracks).toHaveLength(9);
					expect(snapshot.buses).toHaveLength(2);
					expect(
						new Set(
							[...snapshot.tracks, ...snapshot.buses].map(
								(item) => item.instanceId,
							),
						).size,
					).toBe(11);
					expect(
						snapshot.tracks.filter((item) => item.authorId === "track"),
					).toHaveLength(2);
					expect(
						snapshot.tracks
							.filter((item) => item.authorId === "muted")
							.every((item) => item.authoredMuted),
					).toBe(true);
					expect(
						snapshot.tracks
							.filter((item) => item.authorId === "loop")
							.every((item) => !item.authoredMuted),
					).toBe(true);
					expect(
						snapshot.tracks.every(
							(item) =>
								item.resourceId === analyzer.sources[0].id &&
								item.observedAt === index / 25,
						),
					).toBe(true);
					if (index === 3) {
						const gains = snapshot.tracks.filter(
							(item) => item.resolvedAuthorGain.state === "observed",
						);
						expect(gains.length).toBeGreaterThan(0);
						expect(
							gains.every(
								(item) =>
									item.resolvedAuthorGain.state === "observed" &&
									Number.isFinite(item.resolvedAuthorGain.gainBeforeFades),
							),
						).toBe(true);
					}
					observations.push(snapshot);
				}
				expect(observations[0]).toEqual(observations[3]);
				const pending = analyzer.frame(timing(source, 3));
				await expect(analyzer.frame(timing(source, 9))).rejects.toThrow(
					"serially",
				);
				await pending;
			});
			const aborted = new AbortController();
			aborted.abort(Error("Graph analysis intentionally aborted"));
			await expect(
				withHyperframesAudioGraphAnalyzer(
					{ ...options, signal: aborted.signal },
					async () => null,
				),
			).rejects.toThrow("intentionally aborted");
		} finally {
			clearTimeout(timeout);
			controller.abort();
			if (
				dirname(staging) !== parent ||
				!basename(staging).startsWith("rocut-hf-graph-analysis-")
			)
				throw Error("Unsafe graph analyzer fixture cleanup");
			await rm(staging, { recursive: true, force: true });
		}
	},
	50000,
);
