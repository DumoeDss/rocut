import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { createHttpProgrammaticFrames } from "../../apps/vite-example/src/host/http-programmatic-frames";

export let remotionVideoSource: ProgrammaticSource | undefined;

/** Independent of native timing: the encoded source contains the frame number. */
export function readNativeVideoFrame(image: CanvasImageSource, top = 0): number {
	const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
	ctx.drawImage(image, 0, 0);
	let value = 0;
	for (let bit = 0; bit < 6; bit++) {
		const rgba = [...ctx.getImageData(bit * 8 + 4, top + 8, 1, 1).data];
		if (rgba[3] < 250 || rgba.slice(0, 3).some(channel => channel > 25 && channel < 230))
			throw Error(`Video frame marker is undecoded/ambiguous: ${rgba}`);
		if (rgba[0] >= 230) value |= 1 << bit;
	}
	return value;
}

export async function runRemotionVideoProbe(spec: Record<string, unknown>) {
	const provider = createHttpProgrammaticFrames({ base: "/api" });
	const post = async (path: string, body: unknown) => {
		const response = await fetch(`/api/programmatic/${path}`, { method: "POST", body: JSON.stringify(body) });
		if (!response.ok) throw Error(await response.text());
		return response.json();
	};
	const compile = async (mode = "video", extra = {}) => (await post("build/compile", { ...spec, inputProps: { mode }, ...extra })).source as ProgrammaticSource;
	const render = (source: ProgrammaticSource, frame: number) => provider.renderPng({
		request: { source, clipStart: 0, clipDuration: 240000, trimStart: 0, timelineTime: frame * 4000 }, signal: new AbortController().signal,
	});
	const source = await compile();
	for (const frame of [23, 5, 6, 24, 25, 4, 0, 8, 15, 16, 23]) {
		const bitmap = await createImageBitmap(await render(source, frame));
		try {
			if (frame >= 5 && frame < 25) {
				const expected = 6 + (frame - 5) * 2, actual = readNativeVideoFrame(bitmap);
				if (actual !== expected) throw Error(`Native video trim/rate/Sequence at ${frame}: expected ${expected}, got ${actual}`);
			} else {
				const ctx = new OffscreenCanvas(64, 64).getContext("2d")!;
				ctx.drawImage(bitmap, 0, 0);
				if (ctx.getImageData(4, 8, 1, 1).data[3] !== 0) throw Error(`Native video half-open Sequence at ${frame}`);
			}
			const looped = readNativeVideoFrame(bitmap, 32);
			if (looped !== 12 + frame % 8) throw Error(`Native video loop at ${frame}: got ${looped}`);
		} finally { bitmap.close(); }
	}
	const { resource } = await post("resources/import", {
		filePath: `${spec.sourceDirectory}/assets/frames.webm`, id: "video/frames.webm", kind: "video", mimeType: "video/webm",
	});
	const bridged = await compile("video", { resources: [resource], inputProps: { mode: "video", resourceId: resource.id } });
	const bitmap = await createImageBitmap(await render(bridged, 16));
	try { if (readNativeVideoFrame(bitmap, 32) !== 12) throw Error("Video attachment bridge did not decode correct frame"); }
	finally { bitmap.close(); }
	const html: ProgrammaticSource = {
		version: 1, runtime: "html-document", width: 64, height: 64, seed: 7,
		frameRate: { numerator: 30, denominator: 1 }, durationFrames: 60, resources: [resource],
		code: `<style>body{margin:0}</style><video muted width="64" height="32" data-rocut-src="${resource.id}"></video>
<script>window.rocut={renderFrame:frame=>window.rocutMedia.seek(document.querySelector('video'),frame.time)};</script>`,
	};
	for (const frame of [42, 0, 15, 42]) {
		const bitmap = await createImageBitmap(await render(html, frame));
		try { if (readNativeVideoFrame(bitmap) !== frame) throw Error(`Explicit HTML video seek failed at ${frame}`); }
		finally { bitmap.close(); }
	}
	for (const code of [
		html.code.replace('frame.time', '2'),
		html.code.replace('muted width', 'autoplay muted width'),
		html.code.replace('frame.time', 'NaN'),
	]) {
		let failed = false;
		try { await render({ ...html, code }, 0); } catch { failed = true; }
		if (!failed) throw Error("Invalid explicit video seek unexpectedly succeeded");
	}
	for (const [mode, message] of [
		["corrupt-video", /decode failed/], ["audible-video", /muted|media\/artifact/],
		["raw-video", /not ready/], ["offthread", /OffthreadVideo requires/],
	] as const) {
		const bad = await compile(mode);
		let failed = false;
		try { await render(bad, 6); }
		catch (error) { if (!message.test(String(error))) throw error; failed = true; }
		if (!failed) throw Error(`Unsafe video frame unexpectedly succeeded: ${mode}`);
	}
	const corrupted = { ...bridged, resources: bridged.resources!.map(r => r.kind === "video" ? { ...r, sha256: "b".repeat(64), attachmentKey: `programmatic-sha256-${"b".repeat(64)}` } : r) };
	let missing = false;
	try { await render(corrupted, 6); } catch { missing = true; }
	if (!missing) throw Error("Missing video attachment unexpectedly succeeded");
	const recovered = await createImageBitmap(await render(source, 23));
	try { if (readNativeVideoFrame(recovered) !== 42) throw Error("Video capture did not recover"); }
	finally { recovered.close(); }
	remotionVideoSource = source;
	console.log("HTML probe: native video source frames, Sequence/trim/rate/loop/reverse seek, attachment bridge and media failures passed");
}
