import { expect, mock, test } from "bun:test";
import {
	bindMvNativeNavigation,
	locateMvNativeObjects,
} from "./mv-native-navigation";

function fixture() {
	const pause = mock(() => {}),
		seek = mock((_value: unknown) => {}),
		select = mock((_value: unknown) => {});
	const editor = {
		project: { getActiveOrNull: () => ({ metadata: { id: "project" } }) },
		scenes: {
			getActiveScene: () => ({
				id: "scene",
				tracks: {
					overlay: [{ id: "front", elements: [{ id: "character" }] }],
					main: { id: "back", elements: [{ id: "background" }] },
					audio: [],
				},
			}),
		},
		playback: { pause, seek },
		selection: { setSelectedElements: select },
	} as unknown as Parameters<typeof locateMvNativeObjects>[0];
	const input = {
		nativeProjectId: "project",
		sceneId: "scene",
		atTick: 240000,
		objectIds: ["background", "character"],
	};
	return { editor, input, pause, seek, select };
}
test("locates saved native objects and seeks in native ticks without editing content", () => {
	const f = fixture();
	locateMvNativeObjects(f.editor, f.input);
	expect(f.pause).toHaveBeenCalledTimes(1);
	expect(f.seek).toHaveBeenCalledWith({ time: 240000 });
	expect(f.select).toHaveBeenCalledWith({
		elements: [
			{ trackId: "back", elementId: "background" },
			{ trackId: "front", elementId: "character" },
		],
	});
});
test("rejects other projects, stale objects and extra authority before any view change", () => {
	const f = fixture();
	for (const value of [
		{ ...f.input, nativeProjectId: "other" },
		{ ...f.input, sceneId: "other" },
		{ ...f.input, objectIds: ["missing"] },
		{ ...f.input, objectIds: ["character", "character"] },
		{ ...f.input, atTick: NaN },
		{ ...f.input, code: "untrusted" },
	])
		expect(() => locateMvNativeObjects(f.editor, value)).toThrow();
	expect(f.pause).not.toHaveBeenCalled();
	expect(f.seek).not.toHaveBeenCalled();
	expect(f.select).not.toHaveBeenCalled();
});
test("accepts only the actual parent and drops a pending navigation after disposal", async () => {
	const f = fixture(),
		sent = mock((_data: unknown, _origin: string) => {});
	let listener: ((event: MessageEvent) => void) | undefined,
		ready: () => void = () => {};
	const parent = { postMessage: sent };
	const target = {
		parent,
		addEventListener: (_type: string, fn: typeof listener) => {
			listener = fn;
		},
		removeEventListener: () => {
			listener = undefined;
		},
	} as unknown as Window;
	const dispose = bindMvNativeNavigation(
		f.editor,
		() =>
			new Promise<void>((resolve) => {
				ready = resolve;
			}),
		target,
	);
	const receive = (source: unknown) =>
		listener?.({
			source,
			origin: "https://host.invalid",
			data: {
				type: "elftia:mv-native-locate",
				version: 1,
				requestId: "view-one",
				...f.input,
			},
		} as MessageEvent);
	receive({});
	expect(f.pause).not.toHaveBeenCalled();
	receive(parent);
	dispose();
	ready();
	await Promise.resolve();
	await Promise.resolve();
	expect(f.pause).not.toHaveBeenCalled();
	expect(sent).not.toHaveBeenCalled();
});
