import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { InMemoryProjectStore } from "@opencut/editor-ports/in-memory";
import { loadEngineToolchain } from "../programmatic/engines/toolchain";
import { loadHyperframesFxRuntime } from "../programmatic/hyperframes-fx-runtime";
import {
	hyperframesGraphCompileIdentity,
	verifyHyperframesGraphArchive,
} from "../programmatic/hyperframes-graph-provenance";
import {
	hyperframesGraphTimingIdentity,
	type HyperframesGraphTiming,
} from "../programmatic/hyperframes-graph-timing";
import { saveResourceBytes } from "../programmatic/resource-bytes";

test("timing identity is immutable, absent for default and rejects caller-invented modes", () => {
	expect(hyperframesGraphTimingIdentity(undefined)).toBeUndefined();
	const selected = hyperframesGraphTimingIdentity("native-exporter")!;
	expect(Object.isFrozen(selected)).toBe(true);
	expect(Object.keys(selected).sort()).toEqual([
		"mixerSha256",
		"timing",
		"timingRevision",
	]);
	for (const invalid of [
		null,
		"",
		"sample-aligned",
		1,
		{ timing: "native-exporter" },
	]) {
		expect(() =>
			hyperframesGraphTimingIdentity(invalid as HyperframesGraphTiming),
		).toThrow("Unsupported");
	}
});

const directory = process.env.ROCUT_TEST_HYPERFRAMES_TOOLCHAIN;
test.skipIf(!directory || !process.env.ROCUT_TEST_WASM_DIRECTORY)(
	"selected timing has a distinct archive lock and default lock bytes do not change",
	async () => {
		const signal = new AbortController().signal;
		const runtime = await loadHyperframesFxRuntime({
			toolchainDirectory: directory!,
			signal,
		});
		const old = await loadEngineToolchain(
			directory!,
			"hyperframes",
			signal,
			"hyperframes-graph-v1",
		);
		const selected = await loadEngineToolchain(
			directory!,
			"hyperframes",
			signal,
			"hyperframes-graph-v1",
			undefined,
			"native-exporter",
		);
		const oldLock = JSON.parse(new TextDecoder().decode(old.lock.body));
		const newLock = JSON.parse(new TextDecoder().decode(selected.lock.body));
		expect(newLock.audioGraph).toEqual(
			hyperframesGraphCompileIdentity(runtime, "native-exporter"),
		);
		const { timing, timingRevision, mixerSha256, ...unchanged } =
			newLock.audioGraph;
		expect({ timing, timingRevision, mixerSha256 }).toEqual(
			hyperframesGraphTimingIdentity("native-exporter"),
		);
		expect(JSON.stringify({ ...newLock, audioGraph: unchanged })).toBe(
			new TextDecoder().decode(old.lock.body),
		);
		expect(oldLock.audioGraph).toEqual(
			hyperframesGraphCompileIdentity(runtime),
		);
		expect(selected.lock.resource.sha256).not.toBe(old.lock.resource.sha256);
		expect(() =>
			hyperframesGraphCompileIdentity({ ...runtime }, "native-exporter"),
		).toThrow("reviewed native runtime");
		const resourceStore = {
			projectId: "timing-lock",
			store: new InMemoryProjectStore(),
		};
		await saveResourceBytes(resourceStore, old.lock);
		await saveResourceBytes(resourceStore, selected.lock);
		const source = {
			runtime: "html-document",
			audio: {
				mode: "native",
				profile: "hyperframes-graph-v1",
				timing: "native-exporter",
			},
			build: { engine: "hyperframes", toolchainLock: selected.lock.resource },
		} as ProgrammaticSource;
		const options = { source, resourceStore, runtime, signal };
		expect(await verifyHyperframesGraphArchive(options)).toEqual(
			newLock.audioGraph,
		);
		await expect(
			verifyHyperframesGraphArchive({
				...options,
				source: {
					...source,
					build: { ...source.build!, toolchainLock: old.lock.resource },
				},
			}),
		).rejects.toThrow("explicitly recompile");
		await expect(
			verifyHyperframesGraphArchive({
				...options,
				source: {
					...source,
					audio: {
						version: 1,
						mode: "native",
						profile: "hyperframes-graph-v1",
					},
				},
			}),
		).rejects.toThrow("explicitly recompile");
		await expect(
			loadEngineToolchain(
				directory!,
				"hyperframes",
				signal,
				undefined,
				undefined,
				"native-exporter",
			),
		).rejects.toThrow("requires the HyperFrames graph profile");
	},
);
