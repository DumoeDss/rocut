/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- isolated media/font/GPU boundary doubles; manager, domain and compositor remain real classes. */
import { mock } from "bun:test";
import type { EditorCore } from "..";
import type { SessionResources } from "../../editor/session/resources";
import type { AssetResolver, RuntimeAssetLoader } from "@opencut/editor-ports";
import type { VideoCache } from "../../services/video-cache/service";
import type { WasmCompositor } from "../../services/renderer/compositor/wasm-compositor";
import type { TextureUploadDescriptor } from "../../services/renderer/compositor/types";

let failRelease = false;
class NativeAdmission {
	request() {
		throw Error("Unexpected image preparation");
	}
	key() {
		return "opaque";
	}
	admit() {}
	begin() {
		return 1n;
	}
	step() {
		return true;
	}
	take() {
		return new Uint8Array();
	}
	dispose() {}
	free() {}
}
mock.module("opencut-wasm", () => ({
	MvImagePreprocessOwner: NativeAdmission,
	createCompositor: () => 1,
	disposeCompositor: () => {},
	getCompositorCanvasForHandle: () => ({ width: 2, height: 2 }),
	getLastFrameProfile: () => [],
	releaseTextureForHandle: () => {
		if (failRelease) throw Error("GPU texture recovery failed");
	},
	renderFrameForHandle: () => {},
	resizeCompositorForHandle: () => {},
	uploadTextureForHandle: () => {},
	formatTimecode: () => "unused",
}));
mock.module("../../services/renderer/canvas-utils", () => ({
	createCanvasSurface: () => ({ canvas: {}, context: {} }),
}));
mock.module("../../services/renderer/resolve", () => ({
	resolveRenderTree: async () => {},
}));
mock.module("../../services/renderer/compositor/frame-descriptor", () => ({
	buildFrameDescriptor: async () => ({ frame: {}, textures: [] }),
}));
mock.module("../../services/renderer/scene-exporter", () => ({
	SceneExporter: class {},
}));
mock.module("../../services/renderer/scene-builder", () => ({
	buildScene: () => {
		throw Error("Unexpected scene build");
	},
}));
mock.module("../../media/audio", () => ({
	createTimelineAudioBuffer: () => {
		throw Error("Unexpected audio build");
	},
}));
mock.module("../../media/programmatic-audio-runtime", () => ({
	ProgrammaticAudioRuntime: class {
		async invalidate() {}
	},
}));
mock.module("../../services/renderer/motion-text/font-runtime", () => ({
	MotionTextFontRuntime: class {
		invalidate() {}
		dispose() {}
	},
}));
mock.module("../../services/renderer/effect-preview", () => ({
	resetEffectPreviewService() {},
}));
mock.module("../../utils/browser", () => ({
	downloadBlob() {
		throw Error("Unexpected download");
	},
}));
mock.module("../../wasm", () => ({
	resolveMediaTimeRange() {
		throw Error("Unexpected range resolution");
	},
}));

class Canvas {
	width: number;
	height: number;
	constructor(...[width, height]: [number, number]) {
		this.width = width;
		this.height = height;
	}
	getContext() {
		return { drawImage() {} };
	}
}
Reflect.set(globalThis, "OffscreenCanvas", Canvas);
const { RendererManager } = await import("./renderer-manager");
const { RootNode } = await import("../../services/renderer/nodes/root-node");

export function managerResidencyFixture() {
	failRelease = false;
	const resources = {
		getActivityGeneration: () => 0,
		assertActivityGeneration: () => {},
		trackGpuResource: ({ handle }: { handle: number }) => ({
			handle,
			release() {},
		}),
	} as unknown as SessionResources;
	const manager = new RendererManager({
		editor: {} as EditorCore,
		resources,
		assetResolver: {} as AssetResolver,
		assetLoader: {} as RuntimeAssetLoader,
		videoCache: {} as VideoCache,
	});
	const renderer = manager.createCanvasRenderer({
		width: 2,
		height: 2,
		fps: { numerator: 60, denominator: 1 },
	});
	const domain = renderer.rasterResidencyDomain;
	const compositor = Reflect.get(manager, "compositor") as WasmCompositor;
	const oldRoot = new RootNode({ duration: 1 }),
		currentRoot = new RootNode({ duration: 1 });
	manager.setRenderTree({ renderTree: oldRoot });
	const oldScope = domain.tree(oldRoot),
		currentScope = domain.tree(currentRoot);
	const makeTexture = (id: string): TextureUploadDescriptor => ({
		kind: "external",
		id,
		source: new OffscreenCanvas(2, 2),
		sourceVersion: "1",
		width: 2,
		height: 2,
	});
	const current = makeTexture("current-raster"),
		media = makeTexture("committed-media"),
		old = makeTexture("uncertain-old");
	const currentClient = currentScope.client({}),
		oldClient = oldScope.client({});
	if (current.kind !== "external" || old.kind !== "external")
		throw Error("Expected external raster");
	currentClient.reserveCanvas({ width: 2, height: 2 }).attach(current.source);
	oldClient.reserveCanvas({ width: 2, height: 2 }).attach(old.source);
	const publication = domain.preparePublication({
		scope: currentScope,
		textures: [current, media],
	});
	compositor.ensureInitialized({ width: 2, height: 2 });
	compositor.syncTextures([current, media]);
	publication.commitAfterTextureSync();
	currentClient.close();
	const failed = domain.preparePublication({
		scope: oldScope,
		textures: [old],
	});
	compositor.syncTextures([old]);
	failed.discard({ textureSyncStarted: true });
	oldClient.close();
	return {
		manager,
		domain,
		compositor,
		oldRoot,
		currentRoot,
		oldScope,
		currentScope,
		bytes: () => Reflect.get(domain.preprocessor, "externalBytes") as number,
		cacheIds: () => [
			...(Reflect.get(compositor, "cache") as Map<string, unknown>).keys(),
		],
		failRecovery: (value: boolean) => {
			failRelease = value;
		},
		drainTransactions: () => compositor.runExclusive(async () => {}),
	};
}
