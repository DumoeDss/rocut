import { expect, test } from "bun:test";
import { probeExclusiveHeartCapacity, probeHeartAggregateCapacity } from "./mv-heart-owner-capacity";
import type { HeartNativePixels } from "./mv-heart-owner-provider";

function harness({ failFrame = false, globalReserved = 0 } = {}) {
	const events: string[] = [], evidence: unknown[] = [];
	let sessions = 0, reserved = 0;
	const owner = {
		prepare: () => 1, manifestJson: () => "{}", imageBytes: () => new Uint8Array(),
		frameJson: () => "{}", cancel: () => true,
		diagnosticJson: () => JSON.stringify({ sessions, reservedBytes: reserved, globalReservedBytes: reserved + globalReserved }),
		dispose: () => { events.push("ownerDispose"); }, free: () => { events.push("ownerFree"); },
	};
	const source: HeartNativePixels = {
		resource: { id: "heart", kind: "image", mimeType: "image/png", attachmentKey: `programmatic-sha256-${"0".repeat(64)}`, byteLength: 1, sha256: "0".repeat(64) },
		encoded: new ArrayBuffer(1), rgba: new Uint8Array(1024 * 1024 * 4), width: 1024, height: 1024,
	};
	const args: Parameters<typeof probeExclusiveHeartCapacity>[0] = {
		createOwner: () => owner, capabilityJson: () => "{}",
		nativePng: async size => {
			events.push(`source/${size}`);
			return { source, bitmap: { width: size, height: size, close: () => { events.push("sourceClose"); } } };
		},
		upload: async () => ({ width: 1024, height: 1024, close: () => { events.push("uploadClose"); } }),
		prepareProvider: async ({ ceilingBytes, createBitmap }) => {
			events.push("prepare"); sessions = 1; reserved = ceilingBytes;
			const bitmap = await createBitmap({ width: 1024, height: 1024, bytes: source.rgba });
			return {
				session: 1, preparedImage: () => bitmap,
				frame: input => {
					events.push(`frame/${JSON.stringify(input)}`);
					if (failFrame) throw Error("injected frame failure");
					return { plan: { rasterBudgetBytes: 40 * 1024 * 1024 } };
				},
				dispose: () => { events.push("providerDispose"); bitmap.close(); sessions = 0; reserved = 0; },
			};
		},
		frame: ({ ticks }) => ticks,
		render: () => { events.push("render"); const pixels = new Uint8ClampedArray(1920 * 1080 * 4); pixels[0] = 1; return pixels; },
		onEvidence: value => { evidence.push(value); },
	};
	return { args, events, evidence };
}

test("capacity orchestration retains exact1024, three frames, early evidence and full release (injected lightweight protocol only)", async () => {
	const h = harness(), report = await probeExclusiveHeartCapacity(h.args);
	expect(report.exactSourceSize).toEqual([1024, 1024]);
	expect(report.frames.map(frame => frame.ticks)).toEqual([0, 120000, 128041]);
	expect(report.uploadedNativeBitmaps).toBe(1);
	expect(report.closedNativeBitmaps).toBe(1);
	expect(report.resizingOrFallback).toBe(false);
	expect(h.evidence.length).toBe(4);
	expect(h.events.slice(-4)).toEqual(["uploadClose", "sourceClose", "ownerDispose", "ownerFree"]);
	expect(report.released).toEqual({ sessions: 0, reservedBytes: 0, globalReservedBytes: 0 });
});

test("capacity orchestration publishes prepared evidence and drains all ownership when a frame fails", async () => {
	const h = harness({ failFrame: true });
	await expect(probeExclusiveHeartCapacity(h.args)).rejects.toThrow("injected frame failure");
	expect(h.evidence).toEqual([{ phase: "prepared", exactSourceSize: [1024, 1024], uploadedNativeBitmaps: 1, ceilingBytes: 256 * 1024 * 1024 }]);
	expect(h.events.slice(-5)).toEqual(["providerDispose", "uploadClose", "sourceClose", "ownerDispose", "ownerFree"]);
});

test("exclusive capacity refuses an occupied global budget before allocating source pixels", async () => {
	const h = harness({ globalReserved: 64 * 1024 * 1024 });
	await expect(probeExclusiveHeartCapacity(h.args)).rejects.toThrow("exclusive global reservation");
	expect(h.events).toEqual(["ownerDispose", "ownerFree"]);
});

test("64+256 rejection is classified by exact aggregate error, not no-fallback wrapper text", async () => {
	const h = harness();
	const owner = h.args.createOwner();
	owner.diagnosticJson = () => JSON.stringify({ sessions: 1, reservedBytes: 64 * 1024 * 1024, globalReservedBytes: 64 * 1024 * 1024 });
	const report = await probeHeartAggregateCapacity({ owner, capabilityJson: h.args.capabilityJson,
		nativePng: h.args.nativePng, prepareProvider: async () => { throw Error("Heart owner aggregate ceiling exceeded"); } });
	expect(report.scope).toContain("not source-resolution capacity");
	expect(report.retainedSessionUnchanged).toBe(true);
	expect(report.existingReservationBytes).toBe(64 * 1024 * 1024);
	expect(report.attemptedReservationBytes).toBe(256 * 1024 * 1024);
	expect(h.events).toEqual(["source/1024", "sourceClose"]);
});
