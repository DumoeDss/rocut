import { expect, test } from "bun:test";
import {
	createSoundPreviewController,
	type SoundPreviewAudio,
} from "../preview-controller";

function fixture() {
	const changes: Array<number | null> = [];
	const errors: string[] = [];
	const audio: FakeAudio[] = [];
	const owner = createSoundPreviewController({
		onChange: (id) => changes.push(id),
		onError: (message) => errors.push(message),
		createAudio: (url) => {
			const element = new FakeAudio(url);
			audio.push(element);
			return element;
		},
	});
	return { owner, changes, errors, audio };
}

class FakeAudio implements SoundPreviewAudio {
	paused = true;
	loads = 0;
	src: string | null;
	reject!: (error: Error) => void;
	listeners = new Map<string, Set<() => void>>();
	constructor(url: string) {
		this.src = url;
	}
	play() {
		this.paused = false;
		return new Promise<void>((_resolve, reject) => {
			this.reject = reject;
		});
	}
	pause() {
		this.paused = true;
	}
	load() {
		this.loads++;
	}
	removeAttribute(name: string) {
		if (name === "src") this.src = null;
	}
	addEventListener(...[type, listener]: [string, () => void]) {
		const callbacks = this.listeners.get(type) ?? new Set();
		callbacks.add(listener);
		this.listeners.set(type, callbacks);
	}
	removeEventListener(...[type, listener]: [string, () => void]) {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string) {
		this.listeners.get(type)?.forEach((listener) => listener());
	}
}

function assertReleased(audio: FakeAudio) {
	expect(audio.paused).toBe(true);
	expect(audio.src).toBeNull();
	expect(audio.loads).toBe(1);
	expect(
		[...audio.listeners.values()].every((listeners) => listeners.size === 0),
	).toBe(true);
}

test("replacement releases old audio and stale ended/error/play rejection cannot change the next sound", async () => {
	const { owner, audio, changes, errors } = fixture();
	owner.toggle({ sound: { id: 1, previewUrl: "first.wav" } });
	const lateEnd = [...audio[0].listeners.get("ended")!][0];
	const lateError = [...audio[0].listeners.get("error")!][0];
	owner.toggle({ sound: { id: 2, previewUrl: "second.wav" } });
	assertReleased(audio[0]);
	lateEnd();
	lateError();
	audio[0].reject(new Error("obsolete rejection"));
	await Promise.resolve();
	expect(changes.at(-1)).toBe(2);
	expect(errors).toEqual([]);
	expect(audio[1].paused).toBe(false);
	owner.dispose();
});

test("toggle stop, ended and error all release source/listeners exactly once", () => {
	for (const action of ["toggle", "ended", "error"] as const) {
		const { owner, audio, changes, errors } = fixture();
		const sound = { id: 1, previewUrl: "fixture.wav" };
		owner.toggle({ sound });
		if (action === "toggle") owner.toggle({ sound });
		else audio[0].emit(action);
		owner.stop();
		owner.dispose();
		assertReleased(audio[0]);
		expect(changes).toEqual([1, null]);
		expect(errors).toHaveLength(action === "error" ? 1 : 0);
	}
});

test("current play rejection releases resources and reports a recoverable message", async () => {
	const { owner, audio, errors, changes } = fixture();
	owner.toggle({ sound: { id: 1, previewUrl: "fixture.wav" } });
	audio[0].reject(new Error("network secret URL must not be displayed"));
	await Promise.resolve();
	assertReleased(audio[0]);
	expect(changes).toEqual([1, null]);
	expect(errors).toHaveLength(1);
	expect(errors[0]).not.toContain("secret");
	owner.toggle({ sound: { id: 2, previewUrl: "retry.wav" } });
	expect(audio[1].paused).toBe(false);
	owner.dispose();
});

test("dispose releases pending playback without post-unmount callbacks and is terminal", async () => {
	const { owner, audio, changes, errors } = fixture();
	owner.toggle({ sound: { id: 1, previewUrl: "fixture.wav" } });
	owner.dispose();
	owner.dispose();
	audio[0].reject(new Error("late rejection"));
	await Promise.resolve();
	owner.toggle({ sound: { id: 2, previewUrl: "other.wav" } });
	assertReleased(audio[0]);
	expect(audio).toHaveLength(1);
	expect(changes).toEqual([1]);
	expect(errors).toEqual([]);
});

test("removing or replacing the selected source stops it; unrelated list refresh preserves it", () => {
	const { owner, audio } = fixture();
	const sound = { id: 1, previewUrl: "fixture.wav" };
	owner.toggle({ sound });
	owner.retain([{ ...sound }, { id: 2 }]);
	expect(audio[0].paused).toBe(false);
	owner.retain([{ id: 1, previewUrl: "replacement.wav" }]);
	assertReleased(audio[0]);
	owner.toggle({ sound });
	owner.retain([]);
	assertReleased(audio[1]);
});
