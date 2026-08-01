import { describe, expect, test } from "bun:test";
import type { MediaTime } from "@/wasm";
import { subscribeToPlaybackTime } from "../playback-time-subscription";

describe("timecode playback subscription", () => {
	test("observes general and frame updates and releases both channels", () => {
		const generalListeners = new Set<() => void>();
		const updateListeners = new Set<(time: MediaTime) => void>();
		let currentTime = 0 as MediaTime;
		let generalUnsubscribes = 0;
		let updateUnsubscribes = 0;

		const playback = {
			getCurrentTime: () => currentTime,
			subscribe: (listener: () => void) => {
				generalListeners.add(listener);
				return () => {
					generalUnsubscribes += 1;
					generalListeners.delete(listener);
				};
			},
			onUpdate: (listener: (time: MediaTime) => void) => {
				updateListeners.add(listener);
				return () => {
					updateUnsubscribes += 1;
					updateListeners.delete(listener);
				};
			},
		};
		const observed: MediaTime[] = [];
		const unsubscribe = subscribeToPlaybackTime(playback, () => {
			observed.push(playback.getCurrentTime());
		});

		currentTime = 100 as MediaTime;
		generalListeners.forEach((listener) => listener());
		currentTime = 150_000 as MediaTime;
		updateListeners.forEach((listener) => listener(currentTime));

		expect(observed.map(Number)).toEqual([100, 150_000]);
		expect(generalListeners.size).toBe(1);
		expect(updateListeners.size).toBe(1);

		unsubscribe();
		currentTime = 200_000 as MediaTime;
		generalListeners.forEach((listener) => listener());
		updateListeners.forEach((listener) => listener(currentTime));

		expect(observed.map(Number)).toEqual([100, 150_000]);
		expect(generalListeners.size).toBe(0);
		expect(updateListeners.size).toBe(0);
		expect(generalUnsubscribes).toBe(1);
		expect(updateUnsubscribes).toBe(1);
	});
});
