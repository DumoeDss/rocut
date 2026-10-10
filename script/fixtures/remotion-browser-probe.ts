import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";
import { runRemotionVideoProbe } from "./remotion-video-browser-probe";
import { compilePinnedRemotionProbe } from "./remotion-pinned-build-probe";

export async function runRemotionSourceProbe(): Promise<ProgrammaticSource | undefined> {
	const spec = Reflect.get(globalThis, "__engineBuildSpec");
	if (spec?.engine !== "remotion") return;
	const provider = createHttpProgrammaticFrames({ base: "/api" });
	const compile = async (changes: object = {}) => {
		const response = await fetch("/api/programmatic/build/compile", { method: "POST", body: JSON.stringify({ ...spec, ...changes }) });
		if (!response.ok) throw Error(await response.text());
		return (await response.json()).source as ProgrammaticSource;
	};
	const render = (source: ProgrammaticSource, frame = 0, signal = new AbortController().signal) => provider.renderPng({
		request: { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: frame * 4000 }, signal,
	});
	const pixel = (bitmap: ImageBitmap, x: number, y: number) => {
		const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0); return [...ctx.getImageData(x, y, 1, 1).data];
	};
	const equal = (actual: unknown, expected: unknown, label: string) => {
		if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error(`Remotion ${label}: ${JSON.stringify({ actual, expected })}`);
	};
	console.log("HTML probe: preparing native Remotion through production API");
	const source = await compilePinnedRemotionProbe({ spec });
	for (const frame of [30, 15, 0, 23, 22, 31, 45, 30]) {
		console.log(`HTML probe: Remotion requested frame ${frame}`);
		const bitmap = await createImageBitmap(await render(source, frame));
		try {
			const parent = frame >= 15 && frame < 45, child = frame >= 23 && frame < 31;
			equal(pixel(bitmap, parent ? (frame - 15) * 2 + 2 : 2, 8), parent ? [255, 0, 0, 128] : [0, 0, 0, 0], `parent frame ${frame}`);
			equal(pixel(bitmap, child ? (frame - 23) * 2 + 2 : 2, 40), child ? [0, 255, 0, 255] : [0, 0, 0, 0], `child frame ${frame}`);
			equal(pixel(bitmap, Math.ceil(frame / 2) + 2, 60), [0, 0, 255, 255], "root context");
			equal(pixel(bitmap, 60, 24), [0, 0, 0, 0], "alpha");
			equal(pixel(bitmap, 42, 50), [255, 255, 255, 255], "imported image");
			equal(pixel(bitmap, 50, 50), [255, 255, 255, 255], "staticFile image");
			equal(pixel(bitmap, 60, 50), [0, 255, 0, 255], "font/default/input/calculated props");
			equal(pixel(bitmap, 56, 8), [0, 255, 255, 255], "lazy + delayRender state committed");
		} finally { bitmap.close(); }
	}
	console.log("HTML probe: Remotion native contexts, assets and asynchronous readiness passed");
	let stalledSource: ProgrammaticSource | undefined;
	for (const [changes, message] of [
		[{ width: 65 }, "metadata differs"],
		[{ inputProps: { mode: "throw" } }, "intentional-remotion-error"],
		[{ inputProps: { mode: "cancel" } }, "intentional-remotion-cancel"],
		[{ inputProps: { mode: "media" } }, "muted"],
		[{ inputProps: { mode: "audio" } }, "media/artifact"],
		[{ inputProps: { mode: "stall" } }, "timed out|not cleared"],
	] as const) {
		const bad = await compile(changes);
		if ("inputProps" in changes && changes.inputProps.mode === "stall") stalledSource = bad;
		let failed = false;
		try { await render(bad); } catch (error) { if (!new RegExp(message).test(String(error))) throw error; failed = true; }
		if (!failed) throw Error(`Remotion invalid frame unexpectedly succeeded: ${message}`);
	}
	if (!stalledSource) throw Error("Missing cancellation fixture");
	const cancellation = new AbortController(), timer = setTimeout(() => cancellation.abort(), 1000);
	let aborted = false;
	try { await render(stalledSource, 0, cancellation.signal); }
	catch (error) { if (!/abort|cancel/i.test(String(error))) throw error; aborted = true; }
	finally { clearTimeout(timer); }
	if (!aborted) throw Error("Cancelled Remotion capture unexpectedly succeeded");
	await render(source);
	console.log("HTML probe: Remotion metadata/error/cancelRender/media/stalled delayRender/client abort and recovery passed");
	await runRemotionVideoProbe(spec);
	return source;
}
