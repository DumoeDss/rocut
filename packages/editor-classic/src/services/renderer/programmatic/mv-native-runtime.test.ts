import { expect, test } from "bun:test";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { resolveProgrammaticFrame } from "./frame";
import {
	prepareMvNativeRasterTicket,
	type MvNativeRasterTicket,
} from "./mv-native-admission";
import { runMvNativeRaster } from "./mv-native-runtime";
import { nativeTestHost } from "./mv-native-test-host";
import { TestNativeBitmap } from "./mv-native-test-realm";

async function ticket() {
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "",
		width: 64,
		height: 64,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 30,
		seed: 17,
		recipe: {
			version: 1,
			songStartSeconds: 0,
			root: "fill",
			outputRoles: ["background"],
			post: [],
			nodes: [
				{
					id: "fill",
					scene: { kind: "solid", role: "background", color: [1, 0, 0, 1] },
				},
			],
		},
	};
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 120000,
		trimStart: 0,
		timelineTime: 0,
	});
	if (!frame) throw Error("Missing native test frame");
	return prepareMvNativeRasterTicket({ source, frame });
}

test("native runtime rejects a forged ticket before touching the DOM", async () => {
	await expect(
		runMvNativeRaster({ ticket: {} as MvNativeRasterTicket }),
	).rejects.toThrow("Invalid or consumed");
});

test("success keeps the private realm until its disposal acknowledgement", async () => {
	const admitted = await ticket();
	const host = nativeTestHost();
	try {
		const pending = runMvNativeRaster({ ticket: admitted });
		host.emit("ready");
		expect(host.sent[0]?.type).toBe("render");
		expect(Object.keys(host.sent[0]!.input as object).sort()).toEqual([
			"frame",
			"height",
			"imageAdmissions",
			"resources",
			"sequenceImages",
			"width",
		]);
		const bitmap = new TestNativeBitmap(64, 64);
		host.emit("rendered", { bitmap });
		expect(await pending).toBe(bitmap);
		expect(bitmap.closed).toBe(false);
		expect(host.sent.map((item) => item.type)).toEqual(["render", "dispose"]);
		expect(host.removed).toBe(false);
		expect(host.port1.closed).toBe(false);
		expect(host.timerDelays).toEqual([250]);
		host.emit("disposed");
		expect(host.removed).toBe(true);
		expect(host.port1.closed && host.port2.closed).toBe(true);
		expect(host.timerDelays).toEqual([]);
		bitmap.close();
		await expect(runMvNativeRaster({ ticket: admitted })).rejects.toThrow(
			"Invalid or consumed",
		);
	} finally {
		host.restore();
	}
});

test("abort closes late bitmaps, ignores the wrong disposal identity and has bounded fallback", async () => {
	const admitted = await ticket();
	const host = nativeTestHost();
	try {
		const controller = new AbortController();
		const pending = runMvNativeRaster({
			ticket: admitted,
			signal: controller.signal,
		});
		host.emit("ready");
		controller.abort(Error("cancel-native-host"));
		await expect(pending).rejects.toThrow("cancel-native-host");
		const bitmap = new TestNativeBitmap(64, 64);
		host.emit("rendered", { bitmap });
		expect(bitmap.closed).toBe(true);
		host.emit("disposed", { requestId: "other" });
		expect(host.removed).toBe(false);
		host.fire(250);
		expect(host.removed).toBe(true);
		expect(host.timerDelays).toEqual([]);
	} finally {
		host.restore();
	}
});

test("invalid frame identity or dimensions closes the transferred bitmap", async () => {
	for (const identity of [true, false]) {
		const admitted = await ticket();
		const host = nativeTestHost();
		try {
			const pending = runMvNativeRaster({ ticket: admitted });
			host.emit("ready");
			const bitmap = new TestNativeBitmap(identity ? 64 : 63, 64);
			host.emit("rendered", {
				bitmap,
				...(identity ? { requestId: "other" } : {}),
			});
			await expect(pending).rejects.toThrow(
				identity ? "identity" : "dimensions",
			);
			expect(bitmap.closed).toBe(true);
			host.emit("disposed");
			expect(host.removed).toBe(true);
		} finally {
			host.restore();
		}
	}
});

test("watchdog requests cooperative disposal then destroys an unresponsive realm", async () => {
	const admitted = await ticket();
	const host = nativeTestHost();
	try {
		const pending = runMvNativeRaster({ ticket: admitted });
		expect(host.timerDelays).toEqual([5000]);
		host.fire(5000);
		await expect(pending).rejects.toThrow("timed out");
		expect(host.sent.map((item) => item.type)).toEqual(["dispose"]);
		expect(host.removed).toBe(false);
		host.fire(250);
		expect(host.removed).toBe(true);
	} finally {
		host.restore();
	}
});
