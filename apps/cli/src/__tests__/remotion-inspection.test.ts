import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseRemotionInspection,
	inspectionRevision,
	admitInspectedCompositions,
	selectInspectedComposition,
} from "../programmatic/remotion-inspection-snapshot";
import { createRemotionInspectionSession } from "../programmatic/remotion-inspection-service";
import { snapshotSourceFiles } from "../programmatic/engines/source-snapshot";
import { withBuildResources } from "../programmatic/engines/build-source";
import type { RemotionInspectionSnapshot } from "../programmatic/remotion-inspection-types";

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "rocut-inspection-test-"));
	try {
		await writeFile(
			join(root, "index.tsx"),
			"export const original = 1;",
			"utf8",
		);
		const parsed = parseRemotionInspection({
			version: 1,
			sourceDirectory: root,
			entryFile: "index.tsx",
			files: ["index.tsx"],
			inputProps: { label: "中文" },
			seed: 7,
		});
		const inputs = await snapshotSourceFiles(
			root,
			parsed.source,
			new AbortController().signal,
		);
		const snapshot: RemotionInspectionSnapshot = {
			revision: "",
			source: withBuildResources(
				parsed.source,
				inputs.map((i) => i.resource),
				parsed.source.build!.toolchainLock,
			),
			inputs,
			toolchainLockSha256: "a".repeat(64),
			metadataAdapter: {
				id: "rocut-remotion-html",
				version: 2,
				sha256: "b".repeat(64),
			},
			compositions: [
				{
					id: "First",
					width: 64,
					height: 64,
					fps: 30,
					durationFrames: 90,
					props: { label: "中文", derived: 1 },
				},
			],
		};
		admitInspectedCompositions({ snapshot: snapshot });
		snapshot.revision = inspectionRevision(snapshot);
		await writeFile(
			join(root, "index.tsx"),
			"export const original = 2;",
			"utf8",
		);
		return snapshot;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}
const selection = (snapshot: RemotionInspectionSnapshot) => ({
	revision: snapshot.revision,
	compositionId: "First",
	frameRate: { numerator: 30, denominator: 1 },
});
const options = {
	toolchainDirectory: "C:/fixture",
	executable: "C:/fixture/browser.exe",
	context: {} as never,
	enqueue: async <T>(task: () => Promise<T>) => task(),
};
const compiled = { source: {} as never, reusedDocument: false };

test("real source snapshot survives author mutation/deletion; revision binds props and bytes", async () => {
	const snapshot = await fixture();
	const prepared = selectInspectedComposition({
		snapshot: snapshot,
		input: selection(snapshot),
	});
	expect(new TextDecoder().decode(prepared.inputs[0].body)).toBe(
		"export const original = 1;",
	);
	expect(prepared.source.build!.inputProps).toEqual({ label: "中文" });
	expect(prepared.metadataReceipt.returnedProps).toEqual({
		label: "中文",
		derived: 1,
	});
	expect(prepared.metadataReceipt.adapter.version).toBe(2);
	expect(() =>
		selectInspectedComposition({
			snapshot: snapshot,
			input: {
				...selection(snapshot),
				compositionId: "Unknown",
			},
		}),
	).toThrow("not present");
	expect(() =>
		selectInspectedComposition({
			snapshot: snapshot,
			input: {
				...selection(snapshot),
				frameRate: { numerator: 29, denominator: 1 },
			},
		}),
	).toThrow();
	snapshot.compositions[0].props.derived = 2;
	expect(() =>
		selectInspectedComposition({
			snapshot: snapshot,
			input: selection(snapshot),
		}),
	).toThrow("revision");
	snapshot.compositions[0].props.derived = 1;
	new Uint8Array(snapshot.inputs[0].body)[0] ^= 1;
	expect(() =>
		selectInspectedComposition({
			snapshot: snapshot,
			input: selection(snapshot),
		}),
	).toThrow("bytes changed");
});

test("fractional native FPS is never rounded, and Rust rejects invalid metadata geometry", async () => {
	const snapshot = await fixture();
	snapshot.compositions[0].fps = 30000 / 1001;
	admitInspectedCompositions({ snapshot: snapshot });
	expect(snapshot.compositions[0].admission).toBe(
		"requires-explicit-frame-rate",
	);
	admitInspectedCompositions({
		snapshot: snapshot,
		frameRates: {
			First: { numerator: 30000, denominator: 1001 },
		},
	});
	expect(snapshot.compositions[0].admission).toBe("accepted");
	snapshot.compositions[0].width = -1;
	expect(() => admitInspectedCompositions({ snapshot: snapshot })).toThrow();
});

test("metadata throw invalidates receipt; returnedprops nondeterminism cannot compile", async () => {
	const snapshot = await fixture();
	let mode = "ok",
		compilations = 0;
	const session = createRemotionInspectionSession({
		...options,
		inspect: async () => {
			if (mode === "throw") throw Error("calculateMetadata failed");
			const next = structuredClone(snapshot);
			if (mode === "changed") next.compositions[0].props.derived = 99;
			return next;
		},
		compile: async () => {
			compilations++;
			return compiled;
		},
	});
	await session.perform({
		action: "inspect",
		input: {},
		signal: new AbortController().signal,
	});
	mode = "changed";
	await expect(
		session.perform({
			action: "compile-inspected",
			input: selection(snapshot),
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("metadata/props changed");
	expect(compilations).toBe(0);
	mode = "ok";
	await session.perform({
		action: "inspect",
		input: {},
		signal: new AbortController().signal,
	});
	mode = "throw";
	await expect(
		session.perform({
			action: "inspect",
			input: {},
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("calculateMetadata failed");
	await expect(
		session.perform({
			action: "compile-inspected",
			input: selection(snapshot),
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("revision unavailable");
});

test("cancelled, cleared and superseded requests never publish or compile an old snapshot", async () => {
	const snapshot = await fixture();
	let release!: () => void,
		inspections = 0;
	const session = createRemotionInspectionSession({
		...options,
		inspect: async () => {
			if (++inspections === 1)
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			return structuredClone(snapshot);
		},
		compile: async () => compiled,
	});
	const controller = new AbortController();
	const old = session.perform({
		action: "inspect",
		input: {},
		signal: controller.signal,
	});
	await session.perform({
		action: "inspect",
		input: {},
		signal: new AbortController().signal,
	});
	controller.abort();
	release();
	await expect(old).rejects.toThrow();
	const result = await session.perform({
		action: "compile-inspected",
		input: selection(snapshot),
		signal: new AbortController().signal,
	});
	expect(result).toHaveProperty("inspectionRevision", snapshot.revision);
	await expect(
		session.perform({
			action: "compile-inspected",
			input: selection(snapshot),
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("revision unavailable");
	await session.perform({
		action: "inspect",
		input: {},
		signal: new AbortController().signal,
	});
	session.clear();
	await expect(
		session.perform({
			action: "compile-inspected",
			input: selection(snapshot),
			signal: new AbortController().signal,
		}),
	).rejects.toThrow("revision unavailable");
});
