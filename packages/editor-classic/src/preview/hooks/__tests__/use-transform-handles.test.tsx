import { beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";

type Snapshot = {
	selected: { trackId: string; elementId: string }[];
	x: number;
};
let current: Snapshot;
let committed: Snapshot;
const tracks = (snapshot: Snapshot) => ({
	main: {
		id: "track",
		elements: [{ id: "clip", type: "graphic", params: { x: snapshot.x } }],
	},
});
const scene = (snapshot: Snapshot) => ({
	getSelectedElements: () => snapshot.selected,
	getTracks: () => tracks(snapshot),
	getCurrentTime: () => 0,
	getMediaAssets: () => [],
	getCanvasSize: () => ({ width: 1920, height: 1080 }),
});
const editor = {
	selection: { getSelectedElements: () => current.selected },
	timeline: { getPreviewTracks: () => tracks(current) },
	playback: { getCurrentTime: () => 0 },
	media: { getAssets: () => [] },
	project: {
		getActive: () => ({
			settings: { canvasSize: { width: 1920, height: 1080 } },
		}),
	},
};
const modulePath = (relative: string) =>
	fileURLToPath(new URL(relative, import.meta.url));
mock.module(modulePath("../../../editor/use-editor.ts"), () => ({
	useEditor: (selector: (value: typeof editor) => unknown) => selector(editor),
	useEditorInstance: () => editor,
}));
mock.module(modulePath("../../../hooks/use-committed-ref.ts"), () => ({
	// React render must see current selector values while imperative handlers
	// still hold the previous committed dependencies until layout effects run.
	useCommittedRef: (deps: Record<string, unknown>) => ({
		current: { ...deps, scene: scene(committed) },
	}),
}));
mock.module(modulePath("../../../hooks/use-shift-key.ts"), () => ({
	useShiftKey: () => ({ current: false }),
}));
mock.module(
	modulePath("../../../editor/session/editor-session-provider.tsx"),
	() => ({ useEditorSession: () => ({}) }),
);
mock.module(modulePath("../../../editor/cancel-interaction.ts"), () => ({
	registerCanceller: () => () => {},
}));
mock.module(modulePath("../../components/preview-viewport.tsx"), () => ({
	usePreviewViewport: () => ({}),
}));
mock.module(modulePath("../../element-bounds.ts"), () => ({
	// The regression concerns the snapshot supplied to existing bounds logic,
	// not its Rust/layout algorithms. Return an observable per-snapshot bound.
	getVisibleElementsWithBounds: ({
		tracks: value,
	}: {
		tracks: ReturnType<typeof tracks>;
	}) =>
		value.main.elements.map((element) => ({
			trackId: "track",
			elementId: element.id,
			element,
			bounds: {
				cx: element.params.x,
				cy: 0,
				width: 320,
				height: 240,
				rotation: 0,
			},
		})),
}));
const { useTransformHandles } = await import("../use-transform-handles");
function render() {
	let result: ReturnType<typeof useTransformHandles> | undefined;
	function Probe() {
		result = useTransformHandles({});
		return null;
	}
	renderToStaticMarkup(createElement(Probe));
	expect(result).toBeDefined();
	return result!;
}
beforeEach(() => {
	committed = { selected: [], x: 5 };
	current = { selected: [], x: 5 };
});
test("selection renders handles from this render before committed deps advance", () => {
	current = { selected: [{ trackId: "track", elementId: "clip" }], x: 5 };
	expect(render().selectedWithBounds?.elementId).toBe("clip");
});
test("clearing selection removes handles in the same render", () => {
	committed = { selected: [{ trackId: "track", elementId: "clip" }], x: 5 };
	expect(render().hasVisualSelection).toBe(false);
});
test("same selected clip uses updated bounds without an unrelated rerender", () => {
	committed = { selected: [{ trackId: "track", elementId: "clip" }], x: 5 };
	current = { selected: [...committed.selected], x: 42 };
	expect(render().selectedWithBounds?.bounds.cx).toBe(42);
});
