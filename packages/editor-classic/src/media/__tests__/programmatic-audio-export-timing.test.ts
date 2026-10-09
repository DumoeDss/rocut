import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	graphSource,
	harness,
	signal,
} from "./programmatic-audio-graph-fixture";

test("preview/export source cache partitions final timing while preserving source gain semantics", async () => {
	const { runtime, identities, renders } = harness();
	const legacy = graphSource();
	const selected: ProgrammaticSource = {
		...legacy,
		audio: {
			...legacy.audio!,
			timing: "native-exporter",
			volumeDb: -6,
			muted: false,
		},
	};
	const original = await runtime.load({ source: legacy, signal: signal() });
	// Even a deliberately identical fake Host identity must not merge distinct
	// source timing modes; the production Host also partitions its identity.
	const preview = await runtime.load({ source: selected, signal: signal() });
	expect(preview?.data).not.toBe(original?.data);
	expect(renders).toHaveLength(2);
	expect(identities[1].request).toMatchObject({
		source: { audio: { timing: "native-exporter" } },
	});
	expect(renders[1].request).toMatchObject({
		source: { audio: { timing: "native-exporter" } },
	});
	expect(JSON.stringify(renders[1].request)).not.toContain("volumeDb");
	const exported = await runtime.load({
		source: { ...selected, audio: { ...selected.audio!, volumeDb: 0 } },
		signal: signal(),
	});
	expect(exported?.data).toBe(preview?.data);
	expect(exported?.gain).toBe(1);
	expect(renders).toHaveLength(2);
	expect((await runtime.load({ source: legacy, signal: signal() }))?.data).toBe(
		original?.data,
	);
	expect(identities).toHaveLength(4);
	await runtime.invalidate();
});
