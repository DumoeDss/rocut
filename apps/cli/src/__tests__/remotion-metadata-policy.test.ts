import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import {
	readArchivedRemotionMetadataPolicy,
	remotionReceiptBinding,
	remotionSourceMetadataSpec,
} from "../programmatic/remotion-metadata-archive";
import { createRemotionMetadataReceipt } from "../programmatic/remotion-metadata-receipt";
import { validateRemotionMetadataPolicy } from "../programmatic/remotion-metadata-policy";
import { createRemotionMetadataLifetime } from "../programmatic/remotion-metadata-lifetime";

const bytes = (value: string) => new TextEncoder().encode(value).buffer;
function fixture() {
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "html-document",
		code: "",
		seed: 7,
		width: 64,
		height: 32,
		durationFrames: 10,
		frameRate: { numerator: 30, denominator: 1 },
		build: {
			version: 1,
			engine: "remotion",
			engineVersion: "4.0.342",
			entryFile: "main.tsx",
			inputs: [],
			compositionId: "Main",
			inputProps: { supplied: 3 },
			toolchainLock: {
				id: "lock",
				kind: "source",
				mimeType: "application/json",
				attachmentKey: "fixture-lock",
				byteLength: 1,
				sha256: "c".repeat(64),
			},
		},
	};
	const adapter = {
		id: "rocut-remotion-html" as const,
		version: 2 as const,
		sha256: "a".repeat(64),
	};
	const binding = remotionReceiptBinding({
		source: source,
		adapter: adapter,
		inspectionRevision: "b".repeat(64),
	});
	const receipt = createRemotionMetadataReceipt({
		binding,
		returnedProps: { derived: 7 },
	});
	const policy = {
		profile: "metadata-pinned-v1" as const,
		adapter,
		binding,
		receipt,
	};
	const marker = (value: unknown = policy) =>
		`<script type="application/json" id="rocut-remotion-metadata-receipt">${JSON.stringify(value)}</script>`;
	return {
		source,
		adapter,
		policy,
		marker,
		lock: bytes(JSON.stringify({ adapter })),
	};
}

test("persisted pinned marker survives archive recovery; missing or contradictory authority never downgrades", () => {
	const f = fixture();
	expect(
		readArchivedRemotionMetadataPolicy({
			source: f.source,
			lock: f.lock,
			document: bytes(f.marker()),
		}),
	).toEqual(f.policy);
	for (const html of [
		"",
		f.marker() + f.marker(),
		f.marker({ ...f.policy, receipt: undefined }),
		f.marker({ ...f.policy, profile: "legacy-unpinned" }),
	])
		expect(() =>
			readArchivedRemotionMetadataPolicy({
				source: f.source,
				lock: f.lock,
				document: bytes(html),
			}),
		).toThrow();
	const legacyLock = bytes(
		JSON.stringify({ adapter: { ...f.adapter, version: 1 } }),
	);
	expect(
		readArchivedRemotionMetadataPolicy({
			source: f.source,
			lock: legacyLock,
			document: bytes(""),
		}),
	).toEqual({
		profile: "legacy-unpinned",
		adapter: { ...f.adapter, version: 1 },
	});
	expect(() =>
		readArchivedRemotionMetadataPolicy({
			source: f.source,
			lock: legacyLock,
			document: bytes(f.marker()),
		}),
	).toThrow("legacy archive");
});

test("archive recovery rejects current source, adapter and lock binding drift", () => {
	for (const field of ["props", "lock", "width", "adapter"] as const) {
		const f = fixture();
		if (field === "props")
			f.source = {
				...f.source,
				build: { ...f.source.build!, inputProps: { supplied: 4 } },
			};
		if (field === "lock")
			f.source = {
				...f.source,
				build: {
					...f.source.build!,
					toolchainLock: {
						...f.source.build!.toolchainLock,
						sha256: "d".repeat(64),
					},
				},
			};
		if (field === "width")
			f.source = { ...f.source, width: f.source.width + 1 };
		if (field === "adapter")
			f.lock = bytes(
				JSON.stringify({ adapter: { ...f.adapter, sha256: "d".repeat(64) } }),
			);
		expect(() =>
			readArchivedRemotionMetadataPolicy({
				source: f.source,
				lock: f.lock,
				document: bytes(f.marker()),
			}),
		).toThrow();
	}
});

test("pre-author policy freezes source/receipt and rejects v2 missing receipt or attempted legacy profile", () => {
	const f = fixture(),
		spec = remotionSourceMetadataSpec(f.source);
	const runtime = validateRemotionMetadataPolicy({
		spec: spec,
		policy: f.policy,
	});
	expect(Object.isFrozen(spec.inputProps)).toBe(true);
	expect(Object.isFrozen(f.policy.receipt.returnedProps)).toBe(true);
	expect(() => runtime.assertInputProps({ supplied: 4 })).toThrow(
		"input props differ",
	);
	expect(() =>
		validateRemotionMetadataPolicy({
			spec: spec,
			policy: {
				profile: "metadata-pinned-v1",
				adapter: f.adapter,
			},
		}),
	).toThrow("receipt missing");
	expect(() =>
		validateRemotionMetadataPolicy({
			spec: spec,
			policy: {
				profile: "legacy-unpinned",
				adapter: f.adapter,
			},
		}),
	).toThrow("profile/adapter mismatch");
});

test("bounded lifetime preserves undefined rejection and observes late rejected promises", async () => {
	const lifetime = createRemotionMetadataLifetime({
		timeoutMs: 20,
		check() {},
	});
	let rejected = false;
	try {
		await lifetime.wait(Promise.reject(undefined));
	} catch (error) {
		rejected = true;
		expect(error).toBeUndefined();
	}
	expect(rejected).toBe(true);
	let rejectLate!: (reason: unknown) => void;
	const pending = lifetime.wait(
		new Promise((_resolve, reject) => {
			rejectLate = reject;
		}),
	);
	lifetime.abort(Error("stopped"));
	await expect(pending).rejects.toThrow("stopped");
	rejectLate(Error("late failure"));
	await Promise.resolve();
	lifetime.finish();
	expect(() => lifetime.check()).toThrow();
});
