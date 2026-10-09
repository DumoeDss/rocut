import { initializeGpu, disposeCompositor, disposeGpu } from "opencut-wasm";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { SessionResources } from "../../packages/editor-classic/src/editor/session/resources";
import type { VideoCache } from "../../packages/editor-classic/src/services/video-cache/service";
import { WasmCompositor } from "../../packages/editor-classic/src/services/renderer/compositor/wasm-compositor";
import { runNativeEngineExportProbe } from "./hyperframes-browser-probe";
import { runHdrExportProbe } from "./hdr-browser-probe";

async function run() {
	const response = await fetch("/api/source");
	if (!response.ok) throw Error(await response.text());
	const source = await response.json() as ProgrammaticSource;
	await initializeGpu();
	const compositor = new WasmCompositor({ trackGpuResource: ({ handle, label }) => ({
		handle, label, resourceId: `offthread:${handle}`, release: () => disposeCompositor(handle),
	}) } as SessionResources);
	try {
		const params = {
			width: 64, height: 64, fps: source.frameRate, compositor,
			videoCache: { getFrameAt: async () => null } as unknown as VideoCache,
		};
		const encodedBytes = await runNativeEngineExportProbe(source, params, { indices: [40, 42], startTime: 88000, frameTicks: 4000 });
		const hdrChecks = await runHdrExportProbe(params);
		return { passed: true, encodedBytes, decodedSourceFrames: [40, 42], nativeComponent: "OffthreadVideo",
			hdrChecks, backend: "standalone-chromium-native-decoder", electronTested: false, fullHostTested: false };
	} finally { compositor.dispose(); disposeGpu(); }
}
void run().then(result => Reflect.set(globalThis, "__offthreadResult", result),
	error => Reflect.set(globalThis, "__offthreadResult", { error: String(error?.stack ?? error) }));
