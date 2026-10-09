import { expect, test } from "bun:test";
import type { ProgrammaticFrameRequest } from "@opencut/editor-contracts";
import {
	createProgrammaticFrameDeadline,
	type FrameRouteClock,
} from "../programmatic/frame-service-deadline";

const source: ProgrammaticFrameRequest["source"] = {
	version: 1,
	runtime: "html-document",
	code: "",
	width: 320,
	height: 240,
	frameRate: { numerator: 30, denominator: 1 },
	durationFrames: 121,
	seed: 7391,
	build: {
		version: 1,
		engine: "three",
		engineVersion: "0.185.1",
		entryFile: "index.ts",
		capabilities: ["particle-surface-v1"],
		inputs: [],
		toolchainLock: {
			id: "lock",
			kind: "source",
			attachmentKey: "lock",
			mimeType: "application/json",
			byteLength: 2,
			sha256: "a".repeat(64),
		},
	},
};
const frame = {
	source,
	clipStart: 0,
	clipDuration: 484000,
	trimStart: 0,
	timelineTime: 0,
} satisfies ProgrammaticFrameRequest;

function harness(start = 1000) {
	let now = start;
	let id = 0;
	const timers = new Map<number, { callback(): void; at: number }>();
	const clock: FrameRouteClock = {
		now: () => now,
		schedule(callback, delayMs) {
			const key = ++id;
			timers.set(key, { callback, at: now + delayMs });
			return () => {
				timers.delete(key);
			};
		},
	};
	const controller = new AbortController();
	const route = createProgrammaticFrameDeadline({
		controller,
		startedAt: start,
		clock,
	});
	return {
		route,
		controller,
		timerCount: () => timers.size,
		jumpWithoutTimers(time: number) {
			now = time;
		},
		advanceTo(time: number) {
			for (;;) {
				const next = [...timers.entries()]
					.filter(([, timer]) => timer.at <= time)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!next) break;
				now = next[1].at;
				timers.delete(next[0]);
				next[1].callback();
			}
			now = time;
		},
	};
}

test("parsed Electron particles outlive 15s but abort at the original 45s route deadline", () => {
	const h = harness();
	h.advanceTo(11000);
	h.route.acceptParsed(frame, true);
	h.advanceTo(16000);
	expect(h.controller.signal.aborted).toBe(false);
	h.advanceTo(30000);
	h.route.acceptParsed(frame, true);
	h.advanceTo(45999);
	expect(h.controller.signal.aborted).toBe(false);
	h.advanceTo(46000);
	expect(h.controller.signal.aborted).toBe(true);
	expect(h.timerCount()).toBe(0);
	h.route.dispose();
});

test("an unparsed body keeps its 15s admission deadline even for a future particle request", () => {
	const h = harness();
	h.advanceTo(16000);
	expect(h.controller.signal.aborted).toBe(true);
	h.route.acceptParsed(frame, true);
	expect(h.timerCount()).toBe(0);
	h.route.dispose();
});

test("event-loop-delayed parsing cannot promote a request after body admission expired", () => {
	const h = harness();
	h.jumpWithoutTimers(16000);
	expect(h.controller.signal.aborted).toBe(false);
	h.route.acceptParsed(frame, true);
	expect(h.controller.signal.aborted).toBe(true);
	expect(h.timerCount()).toBe(0);
	h.route.dispose();
});

test("ordinary Electron and explicit Chromium particle requests retain 15s", () => {
	for (const [input, electron] of [
		[{ ...frame, source: { ...source, build: undefined } }, true],
		[frame, false],
	] as const) {
		const h = harness();
		h.advanceTo(4000);
		h.route.acceptParsed(input, electron);
		h.advanceTo(15999);
		expect(h.controller.signal.aborted).toBe(false);
		h.advanceTo(16000);
		expect(h.controller.signal.aborted).toBe(true);
		h.route.dispose();
	}
});

test("malformed source/frame shapes never receive an extended deadline", () => {
	for (const input of [
		null,
		[],
		{},
		{ source },
		{ ...frame, timelineTime: "0" },
		{ ...frame, source: { ...source, runtime: "canvas-worker" } },
		{ ...frame, source: { ...source, width: "320" } },
		{
			...frame,
			source: { ...source, build: { ...source.build, engine: "remotion" } },
		},
		{
			...frame,
			source: {
				...source,
				build: { ...source.build, capabilities: ["unknown"] },
			},
		},
	]) {
		const h = harness();
		h.route.acceptParsed(input, true);
		h.advanceTo(16000);
		expect(h.controller.signal.aborted).toBe(true);
		h.route.dispose();
	}
});

test("caller/dispose cancellation remains immediate; promotion never revives cancellation", () => {
	const h = harness();
	h.route.acceptParsed(frame, true);
	h.controller.abort();
	expect(h.timerCount()).toBe(0);
	h.route.acceptParsed(frame, true);
	h.advanceTo(46000);
	expect(h.controller.signal.aborted).toBe(true);
	h.route.dispose();
});

test("successful route finalization removes its timer and cannot later abort", () => {
	const h = harness();
	h.route.acceptParsed(frame, true);
	h.advanceTo(20000);
	h.route.dispose();
	expect(h.timerCount()).toBe(0);
	h.route.acceptParsed(frame, true);
	h.advanceTo(100000);
	expect(h.controller.signal.aborted).toBe(false);
});
