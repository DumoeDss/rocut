/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- Minimal DOM and timer collaborators isolate viewport persistence without a browser. */
import { expect, test } from "bun:test";
import { ZoomController, type ZoomConfig } from "../zoom-controller";

function fixture() {
	let playing = true,
		projectId = "first",
		playhead = 120000;
	let element: { scrollLeft: number } | null = { scrollLeft: 400 };
	const writes: unknown[] = [];
	const timers: Array<{ handler: () => void; cancelled: boolean }> = [];
	const listeners = new Set<() => void>();
	const config = {
		minZoom: 1,
		getContainerEl: () => element,
		getTracksScrollEl: () => element,
		getRulerScrollEl: () => element,
		getCurrentPlayheadTime: () => playhead,
		getProjectId: () => projectId,
		getIsPlaying: () => playing,
		subscribePlayback: (listener: () => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		seek() {},
		setTimelineViewState: (state: unknown) => {
			writes.push(state);
		},
		resources: {
			setTimeout: ({ handler }: { handler: () => void }) => {
				const timer = { handler, cancelled: false };
				timers.push(timer);
				return {
					resourceId: String(timers.length),
					cancel() {
						timer.cancelled = true;
					},
				};
			},
		},
	} as unknown as ZoomConfig;
	const controller = new ZoomController({
		configRef: { current: config },
		initialZoom: 2,
	});
	return {
		controller,
		writes,
		timers,
		listeners,
		pause() {
			playing = false;
			listeners.forEach((listener) => listener());
		},
		move({ scrollLeft, time }: { scrollLeft: number; time: number }) {
			element = { scrollLeft };
			playhead = time;
			controller.saveScrollPosition();
		},
		switchProject() {
			projectId = "second";
		},
		detach() {
			element = null;
		},
		runTimers() {
			for (const timer of timers.splice(0))
				if (!timer.cancelled) timer.handler();
		},
	};
}

test("playback-follow scrolling does not repeatedly save the whole project", () => {
	const f = fixture();
	for (let index = 0; index < 30; index++) {
		f.move({ scrollLeft: index * 100, time: index * 120000 });
		f.runTimers();
	}
	expect(f.writes).toEqual([]);
	f.controller.destroy();
});

test("pause persists the latest followed position once and releases its subscription", () => {
	const f = fixture();
	const unsubscribe = f.controller.bindPlaybackPersistence();
	f.move({ scrollLeft: 200, time: 240000 });
	f.move({ scrollLeft: 500, time: 600000 });
	f.pause();
	f.runTimers();
	expect(f.writes).toEqual([
		{ zoomLevel: 2, scrollLeft: 500, playheadTime: 600000 },
	]);
	f.pause();
	f.runTimers();
	expect(f.writes).toHaveLength(1);
	unsubscribe();
	expect(f.listeners.size).toBe(0);
	f.controller.destroy();
});

test("unmount retains the last view even after the DOM ref is detached", () => {
	const f = fixture();
	f.move({ scrollLeft: 800, time: 960000 });
	f.detach();
	f.controller.destroy();
	f.runTimers();
	expect(f.writes).toEqual([
		{ zoomLevel: 2, scrollLeft: 800, playheadTime: 960000 },
	]);
});

test("pending view state cannot leak into another project on unmount", () => {
	const f = fixture();
	f.move({ scrollLeft: 800, time: 960000 });
	f.switchProject();
	f.controller.destroy();
	f.runTimers();
	expect(f.writes).toEqual([]);
});

test("manual scrolling while paused retains the existing debounce", () => {
	const f = fixture();
	f.pause();
	f.move({ scrollLeft: 200, time: 240000 });
	f.move({ scrollLeft: 300, time: 360000 });
	expect(f.writes).toEqual([]);
	f.runTimers();
	expect(f.writes).toEqual([
		{ zoomLevel: 2, scrollLeft: 300, playheadTime: 360000 },
	]);
	f.controller.destroy();
	expect(f.writes).toHaveLength(1);
});

test("playback notifications after a project switch discard old pending position", () => {
	const f = fixture();
	const unsubscribe = f.controller.bindPlaybackPersistence();
	f.move({ scrollLeft: 800, time: 960000 });
	f.switchProject();
	f.pause();
	f.runTimers();
	expect(f.writes).toEqual([]);
	unsubscribe();
	f.controller.destroy();
});
