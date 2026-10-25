import { mediaTime } from "@opencut/editor-classic";
import type { useEditorInstance } from "@opencut/editor-classic/session";

type Editor = ReturnType<typeof useEditorInstance>;
export function locateMvNativeObjects(editor: Editor, value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Invalid navigation");
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) =>
				!["nativeProjectId", "sceneId", "atTick", "objectIds"].includes(key),
		) ||
		typeof input.nativeProjectId !== "string" ||
		typeof input.sceneId !== "string" ||
		typeof input.atTick !== "number" ||
		!Number.isSafeInteger(input.atTick) ||
		input.atTick < 0 ||
		!Array.isArray(input.objectIds) ||
		input.objectIds.length < 1 ||
		input.objectIds.length > 1000 ||
		!input.objectIds.every(
			(id) => typeof id === "string" && id.length > 0 && id.length <= 500,
		) ||
		new Set(input.objectIds).size !== input.objectIds.length
	)
		throw Error("Invalid navigation");
	const project = editor.project.getActiveOrNull(),
		scene = editor.scenes.getActiveScene();
	if (
		project?.metadata.id !== input.nativeProjectId ||
		scene.id !== input.sceneId
	)
		throw Error("Navigation project changed");
	const tracks = [
		...scene.tracks.overlay,
		scene.tracks.main,
		...scene.tracks.audio,
	];
	const elements = input.objectIds.map((id) => {
		const found = tracks.flatMap((track) =>
			track.elements
				.filter((element) => element.id === id)
				.map((element) => ({ trackId: track.id, elementId: element.id })),
		);
		if (found.length !== 1) throw Error("Navigation object changed");
		return found[0];
	});
	editor.playback.pause();
	editor.playback.seek({ time: mediaTime({ ticks: input.atTick }) });
	editor.selection.setSelectedElements({ elements });
}

/** A parent-only, view-only protocol; no files, scripts or project edits are accepted. */
export function bindMvNativeNavigation(
	editor: Editor,
	whenReady: (signal?: AbortSignal) => Promise<void>,
	target: Window = window,
) {
	if (target.parent === target) return () => {};
	let disposed = false,
		busy = false;
	let active: AbortController | undefined;
	const receive = (event: MessageEvent) => {
		const data: unknown = event.data;
		if (
			event.source !== target.parent ||
			!data ||
			typeof data !== "object" ||
			Array.isArray(data)
		)
			return;
		const { type, version, requestId, ...input } = data as Record<
			string,
			unknown
		>;
		if (
			type !== "elftia:mv-native-locate" ||
			version !== 1 ||
			typeof requestId !== "string" ||
			!/^[\w-]{1,100}$/.test(requestId) ||
			busy
		)
			return;
		busy = true;
		const controller = new AbortController();
		active = controller;
		const timer = setTimeout(() => controller.abort(), 4000);
		void (async () => {
			let ok = false;
			try {
				await whenReady(controller.signal);
				if (!disposed && !controller.signal.aborted) {
					locateMvNativeObjects(editor, input);
					ok = true;
				}
			} catch {
				/* Reply with bounded failure only. */
			} finally {
				busy = false;
				active = undefined;
				clearTimeout(timer);
			}
			if (!disposed)
				target.parent.postMessage(
					{ type: "elftia:mv-native-located", version: 1, requestId, ok },
					event.origin === "null" ? "*" : event.origin,
				);
		})();
	};
	target.addEventListener("message", receive);
	return () => {
		disposed = true;
		active?.abort();
		target.removeEventListener("message", receive);
	};
}
