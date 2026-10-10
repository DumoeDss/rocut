import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { revisionFixture } from "./programmatic-build-revision-fixture";
import { createRemotionInspectionSession } from "../programmatic/remotion-inspection-service";
import {
	PINNED_AUDIO_INPUT,
	pinnedAudioAuthor,
	pinnedAudioWave,
	type PinnedAudioMode,
} from "./remotion-pinned-audio-source";

export async function pinnedAudioProject({
	toolchainDirectory,
	executable,
	mode,
}: {
	toolchainDirectory: string;
	executable: string;
	mode: PinnedAudioMode;
}) {
	const fixture = await revisionFixture("remotion", toolchainDirectory);
	const session = createRemotionInspectionSession({
		context: fixture.context,
		executable,
		toolchainDirectory,
		enqueue: async <T>(task: () => Promise<T>) => task(),
	});
	try {
		const wav = pinnedAudioWave();
		await writeFile(
			join(fixture.author, fixture.entryFile),
			pinnedAudioAuthor(mode),
			"utf8",
		);
		await writeFile(join(fixture.author, "tone.wav"), wav);
		const receipt = await session.perform({
			action: "inspect",
			input: {
				version: 1,
				sourceDirectory: fixture.author,
				entryFile: fixture.entryFile,
				files: [fixture.entryFile, "tone.wav"],
				seed: 7,
				inputProps: PINNED_AUDIO_INPUT,
			},
			signal: AbortSignal.timeout(30000),
		});
		if (!("revision" in receipt) || !receipt.revision || !receipt.compositions)
			throw Error("Expected audio inspection receipt");
		const compiled = await session.perform({
			action: "compile-inspected",
			input: {
				revision: receipt.revision,
				compositionId: "Rocut",
				frameRate: { numerator: 30, denominator: 1 },
			},
			signal: AbortSignal.timeout(30000),
		});
		if (!("source" in compiled))
			throw Error("Expected pinned audio compilation");
		return {
			...fixture,
			source: compiled.source,
			inspection: receipt,
			wav,
			cleanup: async () => {
				session.clear();
				await fixture.cleanup();
			},
		};
	} catch (error) {
		session.clear();
		await fixture.cleanup();
		throw error;
	}
}
