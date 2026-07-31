import { createKeybindingsStore } from "@/actions/keybindings-store";
import { createAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { createPropertiesStore } from "@/components/editor/panels/properties/stores/properties-store";
import { createEditorStore } from "@/editor/editor-store";
import { createPanelStore } from "@/editor/panel-store";
import type { EditorSession } from "@/editor/session/session-types";
import { createPreviewStore } from "@/preview/preview-store";
import { createSoundsStore } from "@/sounds/sounds-store";
import { createStickersStore } from "@/stickers/stickers-store";
import { createTimelineStore } from "@/timeline/timeline-store";

export const EDITOR_SESSION_STORE_KEYS = [
	"panel",
	"editor",
	"preview",
	"timeline",
	"sounds",
	"stickers",
	"keybindings",
	"properties",
	"assetsPanel",
] as const;

export type EditorSessionStoreKey = (typeof EDITOR_SESSION_STORE_KEYS)[number];

/**
 * Private live-state boundary for one editor session.
 *
 * Durable preference substrates may be shared, but every StoreApi below is
 * constructed once per session. Keep this exhaustive object as the only
 * registry construction route so a tenth store cannot silently be omitted.
 */
export interface EditorSessionStores {
	panel: ReturnType<typeof createPanelStore>;
	editor: ReturnType<typeof createEditorStore>;
	preview: ReturnType<typeof createPreviewStore>;
	timeline: ReturnType<typeof createTimelineStore>;
	sounds: ReturnType<typeof createSoundsStore>;
	stickers: ReturnType<typeof createStickersStore>;
	keybindings: ReturnType<typeof createKeybindingsStore>;
	properties: ReturnType<typeof createPropertiesStore>;
	assetsPanel: ReturnType<typeof createAssetsPanelStore>;
}

interface OwnedStores {
	readonly stores: EditorSessionStores;
	disposed: boolean;
}

const storesBySession = new WeakMap<EditorSession, OwnedStores>();
const STORE_LIFECYCLE = Symbol("editorSessionStoreLifecycle");

type StoresWithLifecycle = EditorSessionStores & {
	[STORE_LIFECYCLE]?: { disposed: boolean };
};

export function createEditorSessionStores(): EditorSessionStores {
	const lifecycle = { disposed: false };
	const stores: EditorSessionStores = {
		panel: createPanelStore(),
		editor: createEditorStore(),
		preview: createPreviewStore(),
		timeline: createTimelineStore(),
		sounds: createSoundsStore({ isDisposed: () => lifecycle.disposed }),
		stickers: createStickersStore({ isDisposed: () => lifecycle.disposed }),
		keybindings: createKeybindingsStore(),
		properties: createPropertiesStore(),
		assetsPanel: createAssetsPanelStore(),
	};

	assertCompleteEditorSessionStores(stores);
	return Object.assign(stores, {
		[STORE_LIFECYCLE]: lifecycle,
	});
}

export function assertCompleteEditorSessionStores(
	stores: Partial<EditorSessionStores>,
): asserts stores is EditorSessionStores {
	const entries = EDITOR_SESSION_STORE_KEYS.map((key) => stores[key]);
	const missing = EDITOR_SESSION_STORE_KEYS.filter((key) => !stores[key]);
	const distinct = new Set(entries.filter(Boolean));
	if (
		missing.length > 0 ||
		distinct.size !== EDITOR_SESSION_STORE_KEYS.length
	) {
		throw new Error(
			"Editor session store registry must contain nine distinct stores. " +
				`Missing: ${missing.join(", ") || "none"}; distinct: ${distinct.size}/9.`,
		);
	}
}

export function bindEditorSessionStores({
	session,
	stores = createEditorSessionStores(),
}: {
	session: EditorSession;
	stores?: EditorSessionStores;
}): EditorSessionStores {
	assertCompleteEditorSessionStores(stores);
	if (storesBySession.has(session)) {
		throw new Error(
			`Session ${session.id} already owns an editor store registry.`,
		);
	}
	const lifecycle = (stores as StoresWithLifecycle)[STORE_LIFECYCLE] ?? {
		disposed: false,
	};
	storesBySession.set(session, { stores, ...lifecycle });
	return stores;
}

export function storesForSession(session: EditorSession): EditorSessionStores {
	const owned = storesBySession.get(session);
	if (!owned || owned.disposed || session.state === "disposed") {
		throw new Error(
			`No live editor store registry is owned by session ${session.id}. ` +
				"The session is unknown or disposed.",
		);
	}
	return owned.stores;
}

export function releaseEditorSessionStores(session: EditorSession): void {
	const owned = storesBySession.get(session);
	if (!owned) return;
	owned.disposed = true;
	const lifecycle = (owned.stores as StoresWithLifecycle)[STORE_LIFECYCLE];
	if (lifecycle) lifecycle.disposed = true;
	storesBySession.delete(session);
}
